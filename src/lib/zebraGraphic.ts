import { unzlibSync } from "fflate";

/** A monochrome bitmap uploaded from a Zebra printer: raw GRF rows (1 bit per
 *  pixel, MSB-first, 1 = black) plus the pixel dimensions. */
export interface PrinterBitmap {
  width: number;
  height: number;
  /** GRF bytes: `height` rows of `width / 8` bytes each. */
  mono: Uint8Array;
}

/** Wrap a design's ZPL so the printer renders it to a stored graphic (^IS, with
 *  print suppressed) and then uploads that graphic to the host (^HY). The reply
 *  is a ~DY the caller decodes with {@link decodeDyGraphic}. `^IS` is injected
 *  before the label's final `^XZ` so it captures the rendered format. */
export function buildPrinterPreviewZpl(designZpl: string): string {
  // `^LL` applies to continuous media only; `,Y` forces the design length onto
  // gap/notch media too. Preview-only; the print path respects real media.
  const sized = designZpl.replace(/(\^LL\d+)(?![\d,])/g, "$1,Y");
  // A name of its own per render, so the scratch never overwrites an object the user keeps on R:.
  const scratch = `R:ZL${Math.floor(Math.random() * 0x1000000).toString(16).toUpperCase().padStart(6, "0")}.GRF`;
  const store = /\^XZ\s*$/.test(sized) ? sized.replace(/\^XZ\s*$/, `^IS${scratch},N^XZ`) : `${sized}^IS${scratch},N^XZ`;
  // The ^ID rides in the same transmission, so the scratch never stays on the printer.
  return `${store}\n^XA^HY${scratch}^XZ^XA^ID${scratch}^FS^XZ`;
}

function base64ToBytes(b64: string): Uint8Array {
  // The printer wraps the payload with CRLF every N chars; atob rejects
  // whitespace, so strip it all first.
  const clean = b64.replace(/\s/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Decode a ~DY graphic-upload response (from ^HY/^HG) into a bitmap. The data
 *  field is `~DY<name>,<fmt>,<type>,<total>,<bytesPerRow>,<payload>` where the
 *  payload is ZB64: `:Z64:<base64 of zlib>:crc` (compressed) or `:B64:<base64>:crc`
 *  (plain). Returns null if the response carries no decodable graphic. */
export function decodeDyGraphic(raw: string): PrinterBitmap | null {
  const dy = raw.indexOf("~DY");
  if (dy < 0) return null;
  const marker = /:([ZB])64:/.exec(raw.slice(dy));
  if (!marker) return null;
  const markerAbs = dy + marker.index;
  const parts = raw.slice(dy + 3, markerAbs).split(",");
  const total = Number.parseInt(parts[3] ?? "", 10);
  const bytesPerRow = Number.parseInt(parts[4] ?? "", 10);
  if (!Number.isFinite(total) || !Number.isFinite(bytesPerRow) || bytesPerRow <= 0) return null;

  const afterMarker = raw.slice(markerAbs + marker[0].length);
  // base64 has no ':', so the FIRST colon ends the payload and begins the CRC.
  // (lastIndexOf would over-capture a trailing status line the printer may
  // append after the ~DY, breaking the base64 decode of a valid graphic.)
  const crcIdx = afterMarker.indexOf(":");
  const payload = crcIdx >= 0 ? afterMarker.slice(0, crcIdx) : afterMarker;

  let grf: Uint8Array;
  try {
    const bytes = base64ToBytes(payload);
    grf = marker[1] === "Z" ? unzlibSync(bytes) : bytes;
  } catch {
    return null;
  }
  // Size from the header's declared byte count `total`, not the decoded length:
  // a short (truncated) upload is rejected instead of rendered a row short, and
  // any overshoot is trimmed to the declared bitmap.
  const height = Math.floor(total / bytesPerRow);
  if (height <= 0 || grf.length < bytesPerRow * height) return null;
  return { width: bytesPerRow * 8, height, mono: grf.subarray(0, bytesPerRow * height) };
}

export interface ContentBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The bounds widened to whole bytes, so the rows copy without re-packing bits. */
export function cropBitmap(bmp: PrinterBitmap, bounds: ContentBounds): PrinterBitmap {
  const firstByte = Math.floor(bounds.left / 8);
  const lastByte = Math.ceil(bounds.right / 8);
  const width = (lastByte - firstByte) * 8;
  const height = bounds.bottom - bounds.top;
  const source = bmp.width / 8;
  const mono = new Uint8Array((width / 8) * height);
  for (let y = 0; y < height; y++) {
    mono.set(bmp.mono.subarray((bounds.top + y) * source + firstByte, (bounds.top + y) * source + lastByte), y * (width / 8));
  }
  return { width, height, mono };
}

/** Black-pixel bounding box (right/bottom exclusive). The print is padded
 *  inside the full head raster, so the bitmap frame isn't the content. */
export function contentBounds(bmp: PrinterBitmap): ContentBounds {
  const bytesPerRow = bmp.width / 8;
  let left = bmp.width;
  let right = 0;
  let top = bmp.height;
  let bottom = 0;
  for (let y = 0; y < bmp.height; y++) {
    const row = y * bytesPerRow;
    for (let b = bytesPerRow - 1; b >= 0; b--) {
      const v = bmp.mono[row + b] ?? 0;
      if (v === 0) continue;
      // MSB is the leftmost pixel, so the lowest set bit is the rightmost.
      let low = 0;
      while ((v & (1 << low)) === 0) low++;
      right = Math.max(right, b * 8 + (8 - low));
      top = Math.min(top, y);
      bottom = y + 1;
      break;
    }
    for (let b = 0; b * 8 < left && b < bytesPerRow; b++) {
      const v = bmp.mono[row + b] ?? 0;
      if (v === 0) continue;
      let high = 7;
      while ((v & (1 << high)) === 0) high--;
      left = Math.min(left, b * 8 + (7 - high));
      break;
    }
  }
  return bottom === 0 ? { left: 0, right: 0, top: 0, bottom: 0 } : { left, right, top, bottom };
}

/** Expand a 1bpp GRF bitmap to RGBA (1 = black) for a canvas ImageData. Pure so
 *  the render layer just wraps the result; keeps DOM out of the decoder. */
export function monoToRgba(bmp: PrinterBitmap): Uint8ClampedArray<ArrayBuffer> {
  const { width, height, mono } = bmp;
  const bytesPerRow = width / 8;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bit = ((mono[y * bytesPerRow + (x >> 3)] ?? 0) >> (7 - (x & 7))) & 1;
      const v = bit ? 0 : 255;
      const o = (y * width + x) * 4;
      rgba[o] = v;
      rgba[o + 1] = v;
      rgba[o + 2] = v;
      rgba[o + 3] = 255;
    }
  }
  return rgba;
}

/**
 * Convert a raster image to ZPL ^GFA (Graphic Field ASCII hex) command.
 *
 * Process:
 * 1. Draw image into a canvas at the target dot resolution (rotation baked in)
 * 2. Convert to 1-bit monochrome (threshold)
 * 3. Encode as hex bytes (MSB first, left-to-right)
 * 4. Emit ^GFA,{totalBytes},{totalBytes},{bytesPerRow},{hexData}
 *
 * The canvas preview is painted from the same packed bytes (monoRasterToRgba),
 * so what the editor shows is bit-identical to what the printer receives.
 */
import { isAxisSwapped, type ZplRotation } from '../registry/rotation';
import { loadImage } from './loadImage';

export interface GfaResult {
  /** Complete ^GFA command string */
  zpl: string;
  /** Emitted (byte-padded) width in dots */
  widthDots: number;
  /** Emitted height in dots */
  heightDots: number;
}

/** 1-bit raster shared by the ^GFA encoder and the canvas preview. */
export interface MonoRaster {
  /** Packed rows, MSB-first within each byte. 1 = black dot. */
  bytes: Uint8Array;
  bytesPerRow: number;
  /** Byte-padded width the printer receives (multiple of 8). */
  paddedWidth: number;
  /** Visible width the raster was drawn at (post-rotation); pad columns beyond
   *  it are blank. */
  widthDots: number;
  heightDots: number;
}

/** Threshold RGBA pixels (paddedWidth stride) into packed 1-bit rows.
 *  BT.601 luminance; lum < threshold = black dot. */
export function packMonoBits(
  pixels: Uint8ClampedArray,
  paddedWidth: number,
  heightDots: number,
  threshold: number,
): Uint8Array {
  const bytesPerRow = paddedWidth / 8;
  const bytes = new Uint8Array(bytesPerRow * heightDots);
  for (let row = 0; row < heightDots; row++) {
    for (let byteIdx = 0; byteIdx < bytesPerRow; byteIdx++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const px = byteIdx * 8 + bit;
        const idx = (row * paddedWidth + px) * 4;
        const lum =
          0.299 * (pixels[idx] ?? 255) +
          0.587 * (pixels[idx + 1] ?? 255) +
          0.114 * (pixels[idx + 2] ?? 255);
        if (lum < threshold) byte |= 0x80 >> bit;
      }
      bytes[row * bytesPerRow + byteIdx] = byte;
    }
  }
  return bytes;
}

/** Expand the packed bits back to RGBA for the WYSIWYG preview: black where
 *  the printer fires a dot, transparent elsewhere (label shows through).
 *  Pad columns beyond widthDots are dropped; they never print ink. */
export function monoRasterToRgba(raster: MonoRaster): Uint8ClampedArray<ArrayBuffer> {
  const { bytes, bytesPerRow, widthDots, heightDots } = raster;
  const rgba = new Uint8ClampedArray(widthDots * heightDots * 4);
  for (let y = 0; y < heightDots; y++) {
    for (let x = 0; x < widthDots; x++) {
      const black = ((bytes[y * bytesPerRow + (x >> 3)] ?? 0) & (0x80 >> (x & 7))) !== 0;
      if (black) rgba[(y * widthDots + x) * 4 + 3] = 255;
    }
  }
  return rgba;
}

/** Hex-encode a packed raster as the ^GFA command. */
export function gfaFromRaster(raster: MonoRaster): string {
  const { bytes, bytesPerRow } = raster;
  const hexChars: string[] = [];
  for (const byte of bytes) {
    hexChars.push(byte.toString(16).toUpperCase().padStart(2, "0"));
  }
  return `^GFA,${bytes.length},${bytes.length},${bytesPerRow},${hexChars.join("")}`;
}

/** Row count for a width-scaled image, clamped to 1: a very wide/short source
 *  rounds to 0 but still prints one row, and the ^FT bottom anchor must agree.
 *  Single source for the aspect math shared by the raster and the emit height. */
export function scaledHeightDots(widthDots: number, srcWidth: number, srcHeight: number): number {
  return Math.max(1, Math.round(widthDots * (srcHeight / srcWidth)));
}

/** Draw a loaded image at dot resolution on white, threshold it, and return the
 *  packed 1-bit raster. `^GF` has no orientation letter, so a non-N rotation is
 *  baked into the drawn pixels (axes swap on R/B). The single encoder for both
 *  the ^GFA emit and the preview, so their pixel/threshold/packing can't drift.
 *  Null when no 2d context is available or the image has no intrinsic width
 *  (dimensionless SVGs report naturalWidth 0 in Firefox; aspect would be NaN). */
export function rasterizeMono(
  img: HTMLImageElement,
  widthDots: number,
  threshold: number,
  rotation: ZplRotation = 'N',
): MonoRaster | null {
  // widthDots<=0 (a degenerate ^GF import with bytesPerRow 0) would leave a 0
  // canvas dimension, and getImageData throws IndexSizeError on it; fail safe
  // to a placeholder instead of crashing the render. Headless: no canvas.
  if (typeof document === "undefined" || widthDots <= 0 || !img.naturalWidth) return null;
  const uprightH = scaledHeightDots(widthDots, img.naturalWidth, img.naturalHeight);
  const swap = isAxisSwapped(rotation);
  const outW = swap ? uprightH : widthDots;
  const outH = swap ? widthDots : uprightH;

  // bytesPerRow must be a whole number (width padded to 8-bit boundary)
  const bytesPerRow = Math.ceil(outW / 8);
  const paddedWidth = bytesPerRow * 8;

  const canvas = document.createElement("canvas");
  canvas.width = paddedWidth;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // White background (ZPL: 0 = white); also flattens alpha the way the
  // printer sees it.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, paddedWidth, outH);
  ctx.save();
  switch (rotation) {
    case 'R': ctx.translate(uprightH, 0); ctx.rotate(Math.PI / 2); break;
    case 'I': ctx.translate(widthDots, uprightH); ctx.rotate(Math.PI); break;
    case 'B': ctx.translate(0, widthDots); ctx.rotate(-Math.PI / 2); break;
  }
  ctx.drawImage(img, 0, 0, widthDots, uprightH);
  ctx.restore();

  const pixels = ctx.getImageData(0, 0, paddedWidth, outH).data;
  return {
    bytes: packMonoBits(pixels, paddedWidth, outH, threshold),
    bytesPerRow,
    paddedWidth,
    widthDots: outW,
    heightDots: outH,
  };
}

/** WYSIWYG preview canvas from the same raster the emit encodes. Upright; the
 *  canvas turns it via rotatedGroupTransform. */
export function monoPreviewCanvas(
  img: HTMLImageElement,
  widthDots: number,
  threshold: number,
): HTMLCanvasElement | null {
  const raster = rasterizeMono(img, widthDots, threshold);
  return raster ? rasterPreviewCanvas(raster) : null;
}

/** The packed raster as a canvas, shared by the source-image path and the
 *  decoded-^GF one so both previews are drawn identically. */
export function rasterPreviewCanvas(raster: MonoRaster): HTMLCanvasElement | null {
  // A degenerate raster would make ImageData throw (same guard as rasterizeMono).
  if (raster.widthDots <= 0 || raster.heightDots <= 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = raster.widthDots;
  canvas.height = raster.heightDots;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(
    new ImageData(monoRasterToRgba(raster), raster.widthDots, raster.heightDots),
    0,
    0,
  );
  return canvas;
}

/**
 * @param dataUrl   The image as a data-URL
 * @param widthDots Target width in dots (height derived from aspect ratio)
 * @param threshold Luminance threshold 0-255 for black (default 128)
 * @param rotation  Baked-in orientation (default 'N')
 */
export async function imageToGFA(
  dataUrl: string,
  widthDots: number,
  threshold = 128,
  rotation: ZplRotation = 'N',
): Promise<GfaResult> {
  return gfaFromImage(
    await loadImage(dataUrl, 'Failed to load image for GFA conversion'),
    widthDots,
    threshold,
    rotation,
  );
}

/** Same encode from an already-decoded image, for callers that had to decode
 *  first to check it: a second decode of the same source costs its own timeout
 *  budget. */
export function gfaFromImage(
  img: HTMLImageElement,
  widthDots: number,
  threshold = 128,
  rotation: ZplRotation = 'N',
): GfaResult {
  const raster = rasterizeMono(img, widthDots, threshold, rotation);
  if (!raster) throw new Error("Could not rasterize image");
  return {
    zpl: gfaFromRaster(raster),
    widthDots: raster.paddedWidth,
    heightDots: raster.heightDots,
  };
}

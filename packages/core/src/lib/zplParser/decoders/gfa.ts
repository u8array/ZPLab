import { Unzlib } from "fflate";
import { parseGfWrapper, wrapGfB64 } from "./crc";
import { latin1ToBytes, NON_LATIN1_RE } from "../../binaryText";
import type { UnsafeRawFieldSpan } from "../helpers";

/** Rewrite unsafe byte-counted spans text-safe, in place: the payload
 *  re-wraps as `:B64:` and format B transcodes to A (the spec pairing for
 *  wrapped data, p.1602/181); C keeps its letter. */
export function rewriteRawFieldSpans(
  text: string,
  spans: readonly UnsafeRawFieldSpan[],
): string {
  let out = "";
  let cursor = 0;
  for (const sp of spans) {
    const letter = sp.format === "B" ? "A" : text.slice(sp.formatStart, sp.formatEnd);
    out +=
      text.slice(cursor, sp.formatStart) +
      letter +
      text.slice(sp.formatEnd, sp.dataStart) +
      wrapGfB64(latin1ToBytes(text.slice(sp.dataStart, sp.end)));
    cursor = sp.end;
  }
  return out + text.slice(cursor);
}

/** Inflates a :Z64: zlib payload, streamed so a zip bomb aborts at the cap instead of OOMing the webview. */
function tryInflateZlib(input: Uint8Array): Uint8Array | null {
  // unzlibSync threw on empty input; the streamed loop simply never runs, so
  // without this a 0-byte payload decoded "successfully" to nothing and the
  // canvas painted a transparent graphic over the missing-graphic placeholder.
  if (input.length === 0) return null;
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let overflow = false;
    const inflate = new Unzlib((chunk) => {
      total += chunk.length;
      if (total > GF_MAX_DECODED_BYTES) {
        overflow = true;
        throw new Error("gf inflate exceeds the decode budget");
      }
      chunks.push(chunk);
    });
    // Fed in slices so a runaway ratio is caught after the first over-cap chunk,
    // before the full output is ever allocated.
    const STEP = 16_384;
    for (let i = 0; i < input.length && !overflow; i += STEP) {
      inflate.push(input.subarray(i, i + STEP), i + STEP >= input.length);
    }
    if (overflow) return null;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  } catch {
    return null;
  }
}

/** Nibble shift over slice/parseInt; the per-byte pair dominates on multi-KB bitmaps. */
function gfaHexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) {
    const hi = parseInt(hex[i * 2] ?? "0", 16);
    const lo = parseInt(hex[i * 2 + 1] ?? "0", 16);
    out[i] = (hi << 4) | lo;
  }
  return out;
}

interface GfPayloadDecoded {
  data: Uint8Array;
  crcOk: boolean;
  /** Decoded from a raw byte-counted binary payload (format B). */
  raw?: boolean;
}

/** Text-safe data slot for a preserved raw field: a byte-counted binary
 *  payload re-wraps as `:B64:` (data-identical to the device, survives UTF-8
 *  write-out and CRLF normalization); anything else stays verbatim. */
export function preserveGfData(
  rawData: string,
  format: "A" | "B" | "C",
  byteCount: number,
): string {
  if (format === "A" || rawData.length !== byteCount || NON_LATIN1_RE.test(rawData)) {
    return rawData;
  }
  const t = rawData.trimStart();
  if (t.startsWith(":B64:") || t.startsWith(":Z64:")) return rawData;
  return wrapGfB64(latin1ToBytes(rawData));
}

/** :B64:/:Z64: -> base64 (+inflate); A -> RLE-hex; raw B -> latin1 bytes
 *  (length must match the count). C: only :Z64: decodes (ZDesigner form,
 *  the inflate result IS the raster); raw/:B64: C stays compressed -> null. */
export function gfPayloadToBytes(
  rawData: string,
  format: "A" | "B" | "C",
  bytesPerRow: number,
  byteCount: number,
): GfPayloadDecoded | null {
  const wrapper = parseGfWrapper(rawData);
  if (wrapper) {
    if (format === "C" && wrapper.kind === "b64") return null;
    const bytes =
      wrapper.kind === "z64" ? tryInflateZlib(wrapper.bytes) : wrapper.bytes;
    if (!bytes) return null;
    return { data: bytes, crcOk: wrapper.crcOk };
  }
  if (format === "C") return null;
  if (format === "A") {
    const expanded = decompressGFA(rawData, bytesPerRow);
    // Null past the budget rather than partial rows, which would re-export a silently cropped image.
    if (expanded === null) return null;
    return { data: gfaHexToBytes(expanded), crcOk: true };
  }
  if (rawData.length === byteCount && !NON_LATIN1_RE.test(rawData)) {
    return { data: latin1ToBytes(rawData), crcOk: true, raw: true };
  }
  return null;
}

/** Decode ceiling shared with the preview budget (gfaDecode's 16 Mdot cap):
 *  RLE lets a few input chars declare unbounded output, so the decoder stops
 *  at the size no consumer would accept anyway. */
export const GF_MAX_DECODED_BYTES = 2_000_000;

const HEX_RE = /[0-9A-Fa-f]/;
const isHex = (ch: string) => HEX_RE.test(ch);
const isCompressChar = (ch: string) =>
  (ch >= "G" && ch <= "Y") || (ch >= "g" && ch <= "z");
const repeatCount = (ch: string): number => {
  if (ch >= "G" && ch <= "Y") return ch.charCodeAt(0) - 70; // G=1 .. Y=19
  if (ch >= "g" && ch <= "z") return (ch.charCodeAt(0) - 102) * 20; // g=20 .. z=400
  return 0;
};

// ^GFA ZPL Alt Data Compression: G-Y x1-19, g-z x20-400 (mult 20), combinable.
// , = pad row with 0; ! = pad with F; : = repeat previous row.
function decompressGFA(data: string, bytesPerRow: number): string | null {
  const nibblesPerRow = bytesPerRow * 2;
  const maxRows = Math.ceil((GF_MAX_DECODED_BYTES * 2) / nibblesPerRow);
  const rows: string[] = [];
  let currentRow = "";
  let i = 0;

  /** Set when a repeat run had to be cut short: the output is then a partial
   *  graphic, never an honest one. */
  let clamped = false;

  /** Nibbles still inside the decode budget, so no single step can exceed it. */
  const remainingNibbles = () =>
    Math.max(0, (maxRows - rows.length) * nibblesPerRow - currentRow.length);

  const pushRow = () => {
    rows.push(currentRow.slice(0, nibblesPerRow).padEnd(nibblesPerRow, "0"));
    currentRow = "";
  };

  while (i < data.length && rows.length < maxRows) {
    const ch = data[i] ?? "";

    if (ch === ",") {
      // Labelary: always emits a row, even after one the data filled exactly.
      pushRow();
      i++;
    } else if (ch === "!") {
      // Same with ones (p.1759), and likewise unconditional.
      currentRow = currentRow.padEnd(nibblesPerRow, "F");
      rows.push(currentRow.slice(0, nibblesPerRow));
      currentRow = "";
      i++;
    } else if (ch === ":") {
      rows.push(
        rows.length > 0
          ? (rows[rows.length - 1] ?? "0".repeat(nibblesPerRow))
          : "0".repeat(nibblesPerRow),
      );
      i++;
    } else if (isCompressChar(ch)) {
      let count = repeatCount(ch);
      i++;
      while (i < data.length && isCompressChar(data[i] ?? "")) {
        count += repeatCount(data[i] ?? "");
        i++;
      }
      const nextCh = data[i] ?? "";
      if (i < data.length && isHex(nextCh)) {
        // Clamped before the allocation, not by the row cap below: one repeat count can over-allocate on its own.
        const room = remainingNibbles();
        if (count > room) clamped = true;
        currentRow += nextCh.repeat(Math.min(count, room));
        i++;
      }
    } else if (isHex(ch)) {
      currentRow += ch;
      i++;
    } else {
      i++;
    }

    // Drained fully: one long repeat run can span many rows, and a lone `if`
    // lets currentRow grow (and re-slice) quadratically.
    while (currentRow.length >= nibblesPerRow) {
      rows.push(currentRow.slice(0, nibblesPerRow));
      currentRow = currentRow.slice(nibblesPerRow);
    }
  }

  // Stopped on the cap rather than on the input, or cut a run short: either way
  // the rest of the graphic was never expanded, so there is no honest partial
  // answer to hand back.
  if (i < data.length || clamped) return null;

  if (currentRow.length > 0) {
    pushRow();
  }

  return rows.join("");
}

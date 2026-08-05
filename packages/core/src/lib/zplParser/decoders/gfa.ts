import { unzlibSync } from "fflate";
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

/** Inflate `:Z64:` zlib payload; null on malformed deflate stream. */
function tryInflateZlib(input: Uint8Array): Uint8Array | null {
  try {
    return unzlibSync(input);
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
    return { data: gfaHexToBytes(decompressGFA(rawData, bytesPerRow)), crcOk: true };
  }
  if (rawData.length === byteCount && !NON_LATIN1_RE.test(rawData)) {
    return { data: latin1ToBytes(rawData), crcOk: true, raw: true };
  }
  return null;
}

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
function decompressGFA(data: string, bytesPerRow: number): string {
  const nibblesPerRow = bytesPerRow * 2;
  const rows: string[] = [];
  let currentRow = "";
  let i = 0;

  const pushRow = () => {
    rows.push(currentRow.slice(0, nibblesPerRow).padEnd(nibblesPerRow, "0"));
    currentRow = "";
  };

  while (i < data.length) {
    const ch = data[i] ?? "";

    if (ch === ",") {
      pushRow();
      i++;
    } else if (ch === "!") {
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
        currentRow += nextCh.repeat(count);
        i++;
      }
    } else if (isHex(ch)) {
      currentRow += ch;
      i++;
    } else {
      i++;
    }

    if (currentRow.length >= nibblesPerRow) {
      rows.push(currentRow.slice(0, nibblesPerRow));
      currentRow = currentRow.slice(nibblesPerRow);
    }
  }

  if (currentRow.length > 0) {
    pushRow();
  }

  return rows.join("");
}

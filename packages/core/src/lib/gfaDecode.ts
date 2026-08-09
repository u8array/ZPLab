// A ^GF command back into the packed raster the preview draws, for designs
// that own only the encoded bytes. The payload decoding stays the parser's.

import type { MonoRaster } from "./imageToZpl";
import { GF_MAX_BYTES_PER_ROW, GF_MAX_ROWS, parseGfHeader } from "../registry/image";
import { GF_MAX_DECODED_BYTES, gfPayloadToBytes } from "./zplParser/decoders/gfa";

/** And the two together: the caps multiply out to 163 Mpx, which the preview
 *  canvas would back with hundreds of megabytes. Derived from the decoder's
 *  own ceiling so the two cannot drift. */
const MAX_DOTS = GF_MAX_DECODED_BYTES * 8;

/** Null when the header is unusable or the payload does not decode; callers
 *  fall back to their placeholder rather than drawing noise. */
export function rasterFromGfa(gfa: string, visibleWidthDots?: number): MonoRaster | null {
  const head = parseGfHeader(gfa.trim());
  // Same empty-payload guard gfaHeaderDims applies: a bare header decodes to a
  // blank raster, which would hide the missing-graphic placeholder and publish
  // a measured footprint for a field that prints nothing.
  if (!head || head.payload.trim() === "") return null;
  const { format, bytesPerRow } = head;
  // Bounded before the decoder runs: it pads each row to the declared width, so
  // a header claiming 2^28 bytes throws RangeError out of the render body.
  if (!Number.isInteger(bytesPerRow) || bytesPerRow > GF_MAX_BYTES_PER_ROW) {
    return null;
  }
  // b, or c when b is omitted (spec p.215: b == c uncompressed), same fallback the boundary applies.
  // A bare parseInt("") is NaN, and the raw-binary branch then length-compares against it and refuses a graphic that prints.
  const countStr = head.totalBytes !== "" ? head.totalBytes : head.dataBytes;
  const decoded = gfPayloadToBytes(
    head.payload,
    format,
    bytesPerRow,
    countStr === "" ? Number.NaN : Number.parseInt(countStr, 10),
  );
  if (!decoded) return null;
  // Row count comes from the header (p.215 c/d); a fractional or missing count falls back to the placeholder.
  if (head.dataBytes === "") return null;
  const declaredRows = Number.parseInt(head.dataBytes, 10) / bytesPerRow;
  if (!Number.isInteger(declaredRows) || declaredRows <= 0) return null;
  // A short stream pads to the declared row count instead of shrinking the graphic; past the caps nothing draws.
  const heightDots = declaredRows;
  if (heightDots <= 0 || heightDots > GF_MAX_ROWS) return null;
  if (heightDots * bytesPerRow * 8 > MAX_DOTS) return null;
  const needed = heightDots * bytesPerRow;
  let bytes = decoded.data.subarray(0, needed);
  if (bytes.length < needed) {
    const padded = new Uint8Array(needed);
    padded.set(bytes);
    bytes = padded;
  }
  const paddedWidth = bytesPerRow * 8;
  return {
    bytes,
    bytesPerRow,
    paddedWidth,
    widthDots: Math.min(visibleWidthDots ?? paddedWidth, paddedWidth),
    heightDots,
  };
}

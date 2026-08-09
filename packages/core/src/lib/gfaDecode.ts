// A ^GF command back into the packed raster the preview draws, for designs
// that own only the encoded bytes. The payload decoding stays the parser's.

import type { MonoRaster } from "./imageToZpl";
import { GF_MAX_BYTES_PER_ROW, parseGfHeader } from "../registry/image";
import { GF_MAX_DECODED_BYTES, gfPayloadToBytes } from "./zplParser/decoders/gfa";

/** Rows a preview will draw; past this the raster is not a label graphic. */
const MAX_ROWS = 20_000;

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
  // b, or c when b is omitted (spec p.215: b == c uncompressed) — the same
  // fallback the boundary applies. A bare parseInt("") is NaN, and the raw-binary
  // branch then length-compares against it and refuses a graphic that prints.
  const countStr = head.totalBytes !== "" ? head.totalBytes : head.dataBytes;
  const decoded = gfPayloadToBytes(
    head.payload,
    format,
    bytesPerRow,
    countStr === "" ? Number.NaN : Number.parseInt(countStr, 10),
  );
  if (!decoded) return null;
  // Rows come from the header count (spec p.215: c / d), which is the number
  // bounds and emit use; the stream may carry more or fewer than it declares.
  // A present-but-fractional count is malformed: fall back to the placeholder
  // like gfaHeaderDims/emit do, or the canvas would draw a floored row count the
  // emitter rejects and the two would disagree on an ^FT image's position.
  // c is required, so there is no stream fallback: a header without it prints
  // nothing (it consumes the rest of the stream instead), and drawing the rows
  // that happened to decode would show ink the printer never produces.
  if (head.dataBytes === "") return null;
  const declaredRows = Number.parseInt(head.dataBytes, 10) / bytesPerRow;
  if (!Number.isInteger(declaredRows) || declaredRows <= 0) return null;
  // The declared count is the height bounds and emit size the field by, and the
  // firmware prints the rows the payload omits as blank, so a short stream is
  // padded rather than shrinking the graphic. Past the caps nothing is drawn at
  // all (placeholder), rather than under-drawing one we cannot hold.
  const heightDots = declaredRows;
  if (heightDots <= 0 || heightDots > MAX_ROWS) return null;
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

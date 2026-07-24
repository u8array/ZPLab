import type { LabelObject } from "@zplab/core/types/Group";
import type { ObjectChanges } from "@zplab/core/types/LabelObject";
import { BARCODE_1D_TYPES } from "@zplab/core/registry";
import { isAxisSwapped, objectRotation } from "@zplab/core/registry/rotation";
import { valueAnchorShift } from "@zplab/core/lib/valueAnchor";

/** Rotated visual footprint in dots, as the canvas measures it. */
interface BarcodeFootprint {
  w: number;
  h: number;
}

type BarcodeWidthProber = (obj: LabelObject) => BarcodeFootprint | null;

/** Barcode width is not computable headlessly (bwip must encode), so the
 *  canvas registers a synchronous prober at runtime; in node tests it stays
 *  null and anchor re-pinning is simply off. */
let prober: BarcodeWidthProber | null = null;

export function registerBarcodeWidthProber(p: BarcodeWidthProber | null): void {
  prober = p;
}

/** Clears only if `p` is still active, so a stale unmount cleanup can't null
 *  a successor registration. */
export function unregisterBarcodeWidthProber(p: BarcodeWidthProber): void {
  if (prober === p) prober = null;
}

export function probeBarcodeFootprint(obj: LabelObject): BarcodeFootprint | null {
  return prober ? prober(obj) : null;
}

/** Justified barcodes: shift the origin so a width-changing props edit keeps
 *  the justified edge fixed. Skipped when the edit positions the object itself
 *  (transformer commits carry x/y) and on rotation changes (axes swap). */
export function anchorRepin(obj: LabelObject, changes: ObjectChanges, next: LabelObject): LabelObject {
  // 1D-only: the ftFlip math matches barcodeFtAnchorOffset only there (QR
  // graphics use an "N" offset + module shift the re-pin doesn't model);
  // graphics have static extents, so fieldJustify never re-pins them.
  if (!BARCODE_1D_TYPES.has(next.type)) return next;
  // Absent means L (schema contract), and L participates under the FT flip.
  const justify = next.fieldJustify ?? 'L';
  const props = (next as { props: object }).props;
  const rot = objectRotation(props);
  // ^FT+I/B inverts the anchor math (see valueAnchorShift).
  const ftFlip =
    (next as { positionType?: string }).positionType === 'FT' && (rot === 'I' || rot === 'B');
  if (justify === 'L' && !ftFlip) return next;
  // `in`, not value-check: an explicit x/y key marks a positioning edit, and
  // x: undefined is already illegal (the merge spread would clobber obj.x).
  if (!changes.props || 'x' in changes || 'y' in changes) return next;
  if ('rotation' in changes.props) return next;
  // Both widths from the same synchronous probe: width-neutral edit = exact no-op.
  const before = probeBarcodeFootprint(obj);
  const after = probeBarcodeFootprint(next);
  if (!before || !after) return next;
  const swapped = isAxisSwapped(rot);
  const delta = swapped ? before.h - after.h : before.w - after.w;
  const shift = valueAnchorShift(justify, delta, ftFlip);
  if (shift === 0) return next;
  return swapped ? { ...next, y: next.y + shift } : { ...next, x: next.x + shift };
}

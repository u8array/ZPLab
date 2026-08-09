import type { LabelObject } from "../types/Group";
import type { ObjectChanges } from "../types/LabelObject";
import { BARCODE_1D_TYPES, getEntry } from "../registry";
import { isAxisSwapped, objectRotation } from "../registry/rotation";
import { valueAnchorShift } from "./valueAnchor";
import type { Footprint as BarcodeFootprint } from "./footprintProber";

export type { BarcodeFootprint };

/** ^FT+I/B inverts the anchor math (see valueAnchorShift). */
function hasFtFlip(o: LabelObject): boolean {
  const rot = objectRotation((o as { props: object }).props);
  return (o as { positionType?: string }).positionType === "FT" && (rot === "I" || rot === "B");
}

/** Re-pins justified 1D barcodes so a width-changing edit keeps the justified edge fixed. */
export function anchorRepin(
  obj: LabelObject,
  changes: ObjectChanges,
  next: LabelObject,
  probe: (o: LabelObject) => BarcodeFootprint | null,
): LabelObject {
  // 1D-only: the ftFlip math matches barcodeFtAnchorOffset only there (QR
  // graphics use an "N" offset + module shift the re-pin doesn't model);
  // graphics have static extents, so fieldJustify never re-pins them.
  if (!BARCODE_1D_TYPES.has(next.type)) return next;
  // Absent means L (schema contract), and L participates under the FT flip.
  const justify = next.fieldJustify ?? "L";
  const rot = objectRotation((next as { props: object }).props);
  const ftFlip = hasFtFlip(next);
  if (justify === "L" && !ftFlip) return next;
  // `in`, not value-check: an explicit x/y key marks a positioning edit, and
  // x: undefined is already illegal (the merge spread would clobber obj.x).
  if (!changes.props || "x" in changes || "y" in changes) return next;
  if ("rotation" in changes.props) return next;
  // Re-pinning presumes the anchored edge was already in force: an op that
  // introduces the justify/flip itself has no pinned edge to keep, so shifting
  // by the width delta would move it off the x the caller just set.
  if ((obj.fieldJustify ?? "L") !== justify || hasFtFlip(obj) !== ftFlip) return next;
  // Both widths from the same synchronous probe: width-neutral edit = exact no-op.
  const before = probe(obj);
  const after = probe(next);
  if (!before || !after) return next;
  const swapped = isAxisSwapped(rot);
  const delta = swapped ? before.h - after.h : before.w - after.w;
  const shift = valueAnchorShift(justify, delta, ftFlip);
  if (shift === 0) return next;
  return swapped ? { ...next, y: next.y + shift } : { ...next, x: next.x + shift };
}

/** Shared leaf edit pipeline: normalize, replace, merge props, re-pin, in that order. */
export function applyChanges(
  obj: LabelObject,
  changes: ObjectChanges,
  probe: (o: LabelObject) => BarcodeFootprint | null,
): LabelObject {
  const normalize = getEntry(obj.type)?.normalizeChanges;
  const normalized = normalize ? normalize(obj as never, changes as never) : changes;
  const current = (obj as { props?: object }).props ?? {};
  const next = {
    ...obj,
    ...normalized,
    // Always written, never conditionally spread: `normalized` may carry an
    // explicit `props: undefined`, which the spread above would leave in place
    // and hand every renderer and emitter a propless object.
    props: normalized.props ? { ...current, ...normalized.props } : (obj as { props?: object }).props,
  } as LabelObject;
  return anchorRepin(obj, normalized as ObjectChanges, next, probe);
}

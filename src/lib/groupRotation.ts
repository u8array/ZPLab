// Pure 90deg rotation of a selection (group / multi-select) about its union bbox
// centre. ZPL only has 0/90/180/270 field orientations, so turns are quarter
// steps. Every leaf rotates its VISUAL centre to stay rigid despite per-type
// anchor quirks; see leafChanges for the per-type handling.

import type { LabelObject, LeafObject } from "@zplab/core/types/Group";
import { isGroup } from "@zplab/core/types/Group";
import { objectBoundsDots, selectionUnionDots, type BoundingBoxDots, type ObjectBoundsCtx } from "@zplab/core/lib/objectBounds";
import { ZPL_ROTATIONS, isZplRotation, type ZplRotation } from "@zplab/core/registry/rotation";
import { barSubRect } from "@zplab/core/lib/bwipConstants";
import { barcodeTextZoneDots, barcodeZoneAbove } from "@zplab/core/lib/barcodeHri";
import type { ObjectChanges } from "@zplab/core/types/LabelObject";

interface Vec { x: number; y: number }

/** Rotate (dx, dy) by `steps` clockwise quarter turns (screen coords, y down). */
function rotateVec(dx: number, dy: number, steps: number): Vec {
  switch (((steps % 4) + 4) % 4) {
    case 1: return { x: -dy, y: dx };
    case 2: return { x: -dx, y: -dy };
    case 3: return { x: dy, y: -dx };
    default: return { x: dx, y: dy };
  }
}

function rotateAbout(p: Vec, pivot: Vec, steps: number): Vec {
  const r = rotateVec(p.x - pivot.x, p.y - pivot.y, steps);
  return { x: pivot.x + r.x, y: pivot.y + r.y };
}

function advanceRotation(r: string, steps: number): string {
  if (!isZplRotation(r)) return r;
  const i = ZPL_ROTATIONS.indexOf(r);
  return ZPL_ROTATIONS[(((i + steps) % 4) + 4) % 4] ?? r;
}

/** Axis-aligned line angles (0/90/180/270) emit ^GB; other angles emit ^GD. */
function isAxisAligned(angle: number): boolean {
  return (((angle % 90) + 90) % 90) === 0;
}

/** A leaf's bbox rotated `steps` quarter turns about `pivot`, dims swapping on
 *  odd steps. Rounded: box bounds are already integer (round is a no-op), but a
 *  line's bounds carry trig residue (lineBounds uses cos/sin, e.g. cos(270deg)
 *  is ~-1e-16), which would otherwise leak a `99.99999` anchor into the model. */
function rotatedRect(leaf: LeafObject, pivot: Vec, steps: number, ctx: ObjectBoundsCtx) {
  const b = objectBoundsDots(leaf, ctx);
  const c1 = rotateAbout({ x: b.x, y: b.y }, pivot, steps);
  const c2 = rotateAbout({ x: b.x + b.width, y: b.y + b.height }, pivot, steps);
  return {
    x: Math.round(Math.min(c1.x, c2.x)),
    y: Math.round(Math.min(c1.y, c2.y)),
    width: Math.round(Math.abs(c2.x - c1.x)),
    height: Math.round(Math.abs(c2.y - c1.y)),
  };
}

/** Model anchor that lands a probe bbox (measured at x=y=0) centred on `centre`. */
function anchorFor(centre: Vec, probe: BoundingBoxDots): { x: number; y: number } {
  return {
    x: Math.round(centre.x - (probe.x + probe.width / 2)),
    y: Math.round(centre.y - (probe.y + probe.height / 2)),
  };
}

function leafChanges(
  leaf: LeafObject,
  pivot: Vec,
  steps: number,
  ctx: ObjectBoundsCtx,
): ObjectChanges {
  if (leaf.type === "line") {
    const p = leaf.props as { angle: number };
    const angle = (((p.angle + 90 * steps) % 360) + 360) % 360;
    // Axis-aligned bars emit ^GB, whose ^FO anchor is NOT the bbox top-left for
    // every angle: 180 anchors at the top-right, 270 at the bottom-left (see
    // line.toZPL). Rotating the raw anchor would land off by `thickness` when the
    // turn changes that convention, so rotate the bbox then re-anchor.
    if (isAxisAligned(p.angle)) {
      const r = rotatedRect(leaf, pivot, steps, ctx);
      const x = angle === 180 ? r.x + r.width : r.x;
      const y = angle === 270 ? r.y + r.height : r.y;
      return { x, y, props: { angle } };
    }
    // Diagonal (^GD): the anchor is a centreline endpoint, so rotating it about
    // the pivot keeps the line rigid.
    const a = rotateAbout({ x: leaf.x, y: leaf.y }, pivot, steps);
    return { x: Math.round(a.x), y: Math.round(a.y), props: { angle } };
  }

  if (leaf.type === "box" || leaf.type === "ellipse") {
    const r = rotatedRect(leaf, pivot, steps, ctx);
    return { x: r.x, y: r.y, props: { width: r.width, height: r.height } };
  }

  // Symbol / image: footprint can't turn via a group here (symbol rotates only
  // the glyph; image group-rotation is a follow-up), so keep w x h and just
  // reposition by the centre. Symbol advances its glyph rotation; image keeps
  // its own single-object rotation prop untouched. Odd dims can round here,
  // but that's isolated, not a per-step accumulation.
  if (leaf.type === "symbol" || leaf.type === "image") {
    const b = objectBoundsDots(leaf, ctx);
    const centre = rotateAbout({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, pivot, steps);
    const x = Math.round(centre.x - b.width / 2);
    const y = Math.round(centre.y - b.height / 2);
    if (leaf.type === "symbol") {
      const r = advanceRotation((leaf.props as { rotation: string }).rotation, steps);
      return { x, y, props: { rotation: r } };
    }
    return { x, y };
  }

  // text / barcodes: rotate the VISUAL centre, then re-anchor from the
  // new-orientation bbox. Anchor-rotation assumes the object spins about model
  // x/y, false for barcodes (they keep top-left on reorient), so centre-based is
  // what keeps the group rigid.
  const b = objectBoundsDots(leaf, ctx);
  const centre = rotateAbout({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, pivot, steps);
  const props = leaf.props as { rotation?: string };
  if (typeof props.rotation !== "string") {
    // Rotation-less type (maxicode): footprint can't turn, but the anchor may
    // still be a ^FT baseline, so probe the bbox instead of writing a top-left.
    return anchorFor(centre, objectBoundsDots({ ...leaf, x: 0, y: 0 } as LeafObject, ctx));
  }
  const newRot = advanceRotation(props.rotation, steps) as ZplRotation;
  // Feed the probe the post-turn measured footprint + barcode bar sub-rect so
  // the new-orientation bbox (and thus the anchor offset) is right.
  const probeCtx = rotateMeasured(ctx, leaf, newRot, ((steps % 2) + 2) % 2 === 1);
  const probe = objectBoundsDots(
    { ...leaf, x: 0, y: 0, props: { ...leaf.props, rotation: newRot } } as LeafObject,
    probeCtx,
  );
  return { ...anchorFor(centre, probe), props: { rotation: newRot } };
}

/** Clone the bounds ctx with this leaf's measured footprint set for `newRot`:
 *  axis-swap on an odd turn, plus the barcode bar sub-rect, since the HRI zone
 *  travels around the rectangle per orientation (N bottom, R left, I top, B
 *  right). Without this the probe re-anchors a rotated barcode off by the zone. */
function rotateMeasured(
  ctx: ObjectBoundsCtx,
  leaf: LeafObject,
  newRot: ZplRotation,
  odd: boolean,
): ObjectBoundsCtx {
  const m = ctx.measured?.get(leaf.id);
  if (!m) return ctx;
  const width = odd ? m.height : m.width;
  const height = odd ? m.width : m.height;
  const next = { ...m, width, height };
  const tz = barcodeTextZoneDots(leaf);
  if (tz > 0) {
    // Same placement the renderer uses; objectBounds only needs the bar's top,
    // left and height for the FT anchor, so barW is dropped here.
    const { barTop, barLeft, barH } = barSubRect(newRot, barcodeZoneAbove(leaf), tz, width, height);
    next.barTopDots = barTop;
    next.barLeftDots = barLeft;
    next.barHeightDots = barH;
  } else if (next.barHeightDots !== undefined) {
    // Bars fill the rotated footprint when there's no text zone; recomputing the
    // height keeps the FT y-shift off the stale pre-turn value on an odd turn.
    next.barHeightDots = height;
  }
  const measured = new Map(ctx.measured);
  measured.set(leaf.id, next);
  return { ...ctx, measured };
}

/** Leaves under `ids` that actually move: visible and not locked, with lock and
 *  visibility cascaded from ancestors (mirrors the store's lock cascade and the
 *  canvas's visibleLeaves). A leaf inside a locked or hidden group is excluded
 *  from both the pivot and the changes, so the pivot can't be skewed by objects
 *  the store will refuse to move (cascaded lock) or that aren't on screen. */
function selectedMovableLeaves(objects: LabelObject[], ids: readonly string[]): LeafObject[] {
  const wanted = new Set(ids);
  const out: LeafObject[] = [];
  const walk = (nodes: LabelObject[], selected: boolean, locked: boolean, hidden: boolean) => {
    for (const n of nodes) {
      const sel = selected || wanted.has(n.id);
      const lock = locked || !!n.locked;
      const hide = hidden || n.visible === false;
      if (isGroup(n)) walk(n.children, sel, lock, hide);
      else if (sel && !lock && !hide) out.push(n);
    }
  };
  walk(objects, false, false, false);
  return out;
}

/** Per-leaf changes for rotating the selection `steps` clockwise quarter turns
 *  about the centre of its union bbox. Empty when nothing rotatable is selected. */
export function rotateSelectionChanges(
  objects: LabelObject[],
  ids: readonly string[],
  ctx: ObjectBoundsCtx,
  steps: number,
): Map<string, ObjectChanges> {
  const result = new Map<string, ObjectChanges>();
  if (((steps % 4) + 4) % 4 === 0) return result;
  const leaves = selectedMovableLeaves(objects, ids);
  if (leaves.length === 0) return result;
  const union = selectionUnionDots(objects, leaves.map((l) => l.id), ctx);
  if (!union) return result;
  // Integer pivot: a quarter turn maps the integer lattice onto itself, so
  // anchors/corners stay exact (no per-step rounding that would drift objects
  // apart over 1/2/3 turns and only re-align after a full 360deg).
  const pivot: Vec = {
    x: Math.round(union.x + union.width / 2),
    y: Math.round(union.y + union.height / 2),
  };
  for (const leaf of leaves) {
    result.set(leaf.id, leafChanges(leaf, pivot, steps, ctx));
  }
  return result;
}

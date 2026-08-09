// Axis-aligned bbox intersections between leaf objects, as neutral geometric
// facts: intent is not in the model (text on a reverse box overlaps on
// purpose), so callers judge. Headless barcode bboxes are estimates (`approx`).

import type { LeafObject } from "../registry";
import {
  boundsAreApprox,
  objectBoundsDots,
  type BoundingBoxDots,
  type ObjectBoundsCtx,
} from "./objectBounds";

/** One leaf's bbox plus the approx flag; the shared input for bounds
 *  reporting and overlap detection so both derive from the same boxes. */
export interface LeafBoxDots {
  id: string;
  box: BoundingBoxDots;
  /** Bbox is a headless estimate (barcode footprint or single-line text), not
   *  render-exact. See boundsAreApprox. */
  approx: boolean;
}

export function leafBoxesDots(
  leaves: readonly LeafObject[],
  ctx: ObjectBoundsCtx,
): LeafBoxDots[] {
  return leaves.map((l) => ({
    id: l.id,
    box: objectBoundsDots(l, ctx),
    approx: boundsAreApprox(l, ctx.measured),
  }));
}

export interface OverlapDots {
  a: string;
  b: string;
  /** Axis-aligned intersection rect in dots. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Either bbox is approximate, so the rect isn't render-exact. */
  approx: boolean;
}

function intersect(a: BoundingBoxDots, b: BoundingBoxDots): BoundingBoxDots | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/** Overlap-count cap. The pairwise scan is O(n²); an unbounded result also
 *  bloats the agent payload. Past this the layout is degenerate anyway, so
 *  stop and let the caller flag truncation. */
export const MAX_OVERLAPS = 500;

/** Index loop (no per-row slice allocation) with an early exit at `cap`.
 *  `keep` rejects a pair before it counts against the cap: a caller that
 *  discards pairs afterwards would let them crowd out real collisions. */
export function computeOverlaps(
  boxes: readonly LeafBoxDots[],
  cap: number = MAX_OVERLAPS,
  keep?: (a: LeafBoxDots, b: LeafBoxDots) => boolean,
): OverlapDots[] {
  const out: OverlapDots[] = [];
  for (let i = 0; i < boxes.length && out.length < cap; i++) {
    const bi = boxes[i];
    if (!bi) continue;
    for (let j = i + 1; j < boxes.length && out.length < cap; j++) {
      const bj = boxes[j];
      if (!bj) continue;
      const rect = intersect(bi.box, bj.box);
      if (!rect || (keep && !keep(bi, bj))) continue;
      out.push({ a: bi.id, b: bj.id, ...rect, approx: bi.approx || bj.approx });
    }
  }
  return out;
}

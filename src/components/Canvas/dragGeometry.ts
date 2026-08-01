// Pure drag-snap geometry: each function takes plain numbers and returns a
// delta to apply to the whole drag, so the snap policy stays testable without a
// stage and the controller stays a thin imperative layer.

import { computeSnap, type SnapGuide, type SnapRect } from "../../lib/snapGuides";
import { printableRectDots, type BoundingBoxDots } from "@zplab/core/lib/objectBounds";
import type { PageLabel } from "@zplab/core/types/LabelConfig";

/** Printable-area snap rect (dots), the {@link printableRectDots} rect tagged
 *  with the snap id so it shares one source with the out-of-bounds check. */
export function labelSnapRectDots(label: PageLabel): SnapRect {
  return { id: "_lbl", ...printableRectDots(label) };
}

/** Round to the nearest grid multiple; identity when the grid is off. */
export function snapToGrid(value: number, gridDots: number): number {
  return gridDots > 0 ? Math.round(value / gridDots) * gridDots : value;
}

/**
 * Grid-snap delta for a box's top-left (dots). One delta for the whole drag, so
 * a multi-selection keeps its relative offsets.
 */
export function gridSnapDelta(box: BoundingBoxDots, gridDots: number): { dx: number; dy: number } {
  return {
    dx: snapToGrid(box.x, gridDots) - box.x,
    dy: snapToGrid(box.y, gridDots) - box.y,
  };
}

/**
 * Smart-snap delta for one rect against the other objects + label, all in model
 * dots. One delta for the whole drag, so the union snaps as a unit.
 */
export function smartSnapDelta(
  box: SnapRect,
  others: SnapRect[],
  labelRect: SnapRect | undefined,
  threshold: number,
): { dx: number; dy: number; guides: SnapGuide[] } {
  const r = computeSnap(box, others, threshold, labelRect, labelRect);
  return { dx: r.x - box.x, dy: r.y - box.y, guides: r.guides };
}

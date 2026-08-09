import type { LeafObject } from "@zplab/core/registry";
import { getEntry, SHAPE_PRIMITIVE_TYPES } from "@zplab/core/registry";
import {
  isRightAnchoredField,
  rightAnchorBoxWidthDots,
  rightAnchorShiftDots,
  type BoundingBoxDots,
} from "@zplab/core/lib/objectBounds";
import { makeFree } from "./lineConstrain";

export interface MultiResizeChange {
  id: string;
  x: number;
  y: number;
  props?: Record<string, number>;
}

/** Linear reprojection to a resized union: x' = origin.x + (x - bbox.x) * fx.
 *  Shapes also scale (box/ellipse via commitTransform, line via endpoint),
 *  stroke thickness never. `origin` is the POST-gesture bbox origin: left/top
 *  drags move it while the opposite edge stays pinned. */
export function projectMultiResize(
  leafs: readonly LeafObject[],
  bbox: BoundingBoxDots,
  origin: { x: number; y: number },
  fx: number,
  fy: number,
  snap: (v: number) => number,
  /** Rendered box width (dots) by id, for the right-anchor carry-back below;
   *  the canvas's measured snapshot, the source the single-resize inverse uses.
   *  Omitted, only props-derivable widths (symbol, blank text) carry back. */
  measuredWidthDots?: (id: string) => number | undefined,
): MultiResizeChange[] {
  const projectX = (x: number) => origin.x + (x - bbox.x) * fx;
  const projectY = (y: number) => origin.y + (y - bbox.y) * fy;
  const changes: MultiResizeChange[] = [];
  for (const leaf of leafs) {
    // Union bbox is ink space but leaf.x is the model anchor: project the ink edge, then carry the anchor back by one box width.
    const boxWidth = rightAnchorBoxWidthDots(leaf, measuredWidthDots?.(leaf.id));
    // Unmeasured right-anchored leaf: its ink edge is unknown, so projecting
    // its model x would move it in the wrong space and persist that. Leaving it
    // where it is loses the resize for one member; guessing loses its position.
    if (boxWidth === null && isRightAnchoredField(leaf)) {
      changes.push({ id: leaf.id, x: leaf.x, y: Math.round(projectY(leaf.y)) });
      continue;
    }
    const shift = rightAnchorShiftDots(leaf, boxWidth ?? 0);
    // Rounded once, around the whole expression: re-adding a fractional
    // measured width after rounding left a non-integer x, and a vertical-only
    // drag then recorded an undo step for a sub-dot horizontal nudge.
    const x = Math.round(projectX(leaf.x - shift) + shift);
    const y = Math.round(projectY(leaf.y));
    if (!SHAPE_PRIMITIVE_TYPES.has(leaf.type)) {
      changes.push({ id: leaf.id, x, y });
      continue;
    }
    if (leaf.type === "line") {
      const p = leaf.props as { angle: number; length: number; thickness: number };
      const rad = (p.angle * Math.PI) / 180;
      // Reproject the endpoint, then read the new angle/length back off it.
      const free = makeFree(Math.cos(rad) * p.length * fx, Math.sin(rad) * p.length * fy);
      const length = Math.max(1, snap(free.length));
      changes.push({
        id: leaf.id,
        x,
        y,
        props: {
          angle: free.angle,
          length,
          // Same cap as the endpoint/panel commits; t > length lands in the
          // ^GB t-promotion regime and prints a t x t block.
          thickness: Math.min(p.thickness, length),
        },
      });
      continue;
    }
    const commitFn = getEntry(leaf.type)?.commitTransform;
    const props = commitFn
      ? (commitFn(leaf, { sx: fx, sy: fy, snap, nodeHeight: 0, anchor: null }) as Record<
          string,
          number
        >)
      : undefined;
    changes.push({ id: leaf.id, x, y, props });
  }
  return changes;
}

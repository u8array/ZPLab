import type { LeafObject } from "@zplab/core/registry";
import { getEntry, SHAPE_PRIMITIVE_TYPES } from "@zplab/core/registry";
import {
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
    // The union bbox is ink space while leaf.x is the model anchor, and for a
    // right-justified field those differ by one box width: project the ink edge
    // and carry the anchor back (same rule as groupRotation's leafChanges).
    // Zero for shapes, which are never right-anchored (GRAPHIC_ANCHOR_TYPES),
    // and their width is the one this gesture changes.
    const shift = rightAnchorShiftDots(
      leaf,
      rightAnchorBoxWidthDots(leaf, measuredWidthDots?.(leaf.id)),
    );
    const x = Math.round(projectX(leaf.x - shift)) + shift;
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

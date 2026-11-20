import type Konva from "konva";

/** Frame-named getClientRect wrappers: mixing frames is how the rotated-view
 *  2D-resize anchor walked, so each capture names its coordinate frame. */

export interface NodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Local-frame bbox (transform skipped), so it is independent of the live
 *  drag scale. */
export function naturalRect(node: Konva.Node): NodeRect {
  return node.getClientRect({ skipTransform: true, skipStroke: true, skipShadow: true });
}

/** Parent-frame bbox: the frame node.x()/y() and the label offsets live in,
 *  so commit/pin math is view-rotation-proof. */
export function parentRect(node: Konva.Node): NodeRect {
  return node.getClientRect({
    skipShadow: true,
    skipStroke: true,
    relativeTo: node.getParent() ?? undefined,
  });
}

/** Stage-frame bbox. Equals the parent frame only at view rotation 0, so
 *  every consumer must be rotation-gated (or use parentRect). */
export function stageRect(node: Konva.Node, stage: Konva.Stage | null): NodeRect {
  return node.getClientRect({
    skipShadow: true,
    skipStroke: true,
    relativeTo: stage ?? undefined,
  });
}

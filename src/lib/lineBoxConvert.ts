// Line and filled box are the same ^GB primitive with different drag
// affordances. These pure mappers swap obj.type between "line" and "box" while
// keeping the same pixels, so the editor can offer a Line | Box mode toggle.
// Geometry is carried via top-left + width/height; the store replaces the whole
// node (props are swapped, never merged) so no stale line/box props leak.

import type { LabelObject } from "@zplab/core/types/Group";
import type { LineProps } from "@zplab/core/registry/line";
import { box, type BoxProps } from "@zplab/core/registry/box";
import { outlineInset } from "@zplab/core/lib/shapeGeometry";

type LineLeaf = LabelObject & { type: "line"; props: LineProps };
type BoxLeaf = LabelObject & { type: "box"; props: BoxProps };

export function isShapeToggleable(obj: LabelObject): boolean {
  return obj.type === "line" || obj.type === "box";
}

/** Axis-aligned = angle is exactly a multiple of 90deg, matching what line.toZPL
 *  emits as ^GB. A near-axis line still prints as a diagonal ^GD, so snapping it
 *  to a box would silently drop the slant; gate it out (exact, not rounded). */
function isAxisAligned(angle: number): boolean {
  return (((angle % 90) + 90) % 90) === 0;
}

/** Convertibility is settings-dependent: a line toggles only when axis-aligned
 *  (diagonal would lose its angle); a box only when it renders as a square-
 *  cornered solid band (filled or a thin outline that collapses to solid). A
 *  rounded box or a true outline frame is not a line and stays put. */
export function canToggleShapeMode(obj: LabelObject): boolean {
  if (obj.type === "box") {
    const p = obj.props as BoxProps;
    // A line has no rounding, so a rounded box would change on print; require
    // square corners on top of a solid body.
    return p.rounding === 0 && outlineInset(p.width, p.height, p.thickness, p.filled, true).renderFilled;
  }
  if (obj.type === "line") return isAxisAligned((obj.props as LineProps).angle);
  return false;
}

/** The mode the toggle would switch to, for the segment icon/label. */
export function oppositeShapeMode(obj: LabelObject): "line" | "box" | null {
  if (obj.type === "line") return "box";
  if (obj.type === "box") return "line";
  return null;
}

/** Axis-aligned line -> box. width/height take the line's length/thickness; the
 *  top-left shifts for 180/270 lines (they extend left/up from the anchor,
 *  mirroring line.toZPL's bx/by) so the covered pixels are identical. A line is a
 *  solid band, so the box is filled. The stored border is capped at the line's
 *  own thickness so emit stays byte-identical (a filled box floors thickness to
 *  min(w,h)); the small default leaves a thin outline to reveal once the user
 *  unchecks filled on a box with real height. */
export function lineToBox(line: LineLeaf): BoxLeaf {
  const p = line.props;
  const a = ((Math.round(p.angle) % 360) + 360) % 360;
  const horizontal = a === 0 || a === 180;
  const props: BoxProps = {
    width: horizontal ? p.length : p.thickness,
    height: horizontal ? p.thickness : p.length,
    thickness: Math.min(box.defaultProps.thickness, p.thickness),
    filled: true,
    color: p.color,
    rounding: 0,
    ...(p.reverse !== undefined ? { reverse: p.reverse } : {}),
  };
  return {
    ...line,
    type: "box",
    x: a === 180 ? line.x - p.length : line.x,
    y: a === 270 ? line.y - p.length : line.y,
    props,
  };
}

/** Box -> line: the longer axis becomes length, the shorter becomes thickness,
 *  axis-aligned at the same top-left. Geometry (bounding box) is preserved;
 *  rounding and outline are dropped (a line is a solid band by nature). */
export function boxToLine(box: BoxLeaf): LineLeaf {
  const p = box.props;
  const horizontal = p.width >= p.height;
  const props: LineProps = {
    angle: horizontal ? 0 : 90,
    length: horizontal ? p.width : p.height,
    thickness: horizontal ? p.height : p.width,
    color: p.color,
    ...(p.reverse !== undefined ? { reverse: p.reverse } : {}),
  };
  return { ...box, type: "line", props };
}

/** Swap a line<->box leaf. The convertibility invariant lives here (not just in
 *  the UI), so a non-convertible object (other type, or a diagonal line that
 *  would lose its angle) is returned unchanged regardless of caller. */
export function toggleShapeMode(obj: LabelObject): LabelObject {
  if (!canToggleShapeMode(obj)) return obj;
  if (obj.type === "line") return lineToBox(obj as LineLeaf);
  return boxToLine(obj as BoxLeaf);
}

import type { LeafObject } from "../registry";
import { BARCODE_1D_TYPES } from "../registry";
import { GRAPHIC_ANCHOR_TYPES, graphicAnchorCoords, printerAnchoredX, textZplAnchorCoords } from "../registry/zplHelpers";
import { objectBoundsDots, type BoundingBoxDots, type ObjectBoundsCtx } from "./objectBounds";

/** The ^FO/^FT origin (dots) the generator actually emits for this leaf, i.e.
 *  the coordinate the printer sees. The single source the off-label preflight
 *  shares with emission, so "is the position off-label" can't drift from what
 *  prints: text uses the cap-top/baseline transform, graphics anchor at their
 *  bbox (top-left under ^FO, a bottom corner under ^FT), barcodes/symbol emit at
 *  the model coord (a gated R 1D at the measured right edge). Pass `box` when the caller already has the bbox to skip a
 *  recompute. Known minor gap: an ^FT right-justified diagonal line or image uses
 *  the visual bbox width, a few dots off the emitted ^GD/^GF width, which only
 *  shifts the near-left edge for a field whose right corner sits at ~x=0. */
export function emittedAnchorDots(
  obj: LeafObject,
  ctx: ObjectBoundsCtx,
  box?: BoundingBoxDots,
): { x: number; y: number } {
  if (obj.type === "text") {
    const { x, y } = textZplAnchorCoords(obj as Parameters<typeof textZplAnchorCoords>[0], ctx.label, ctx.variables);
    return { x, y };
  }
  if (GRAPHIC_ANCHOR_TYPES.has(obj.type)) {
    // A line's model x/y is an endpoint, not the bbox top-left, so the bbox (not
    // obj.x/obj.y) is the emitted ^FO origin; box/ellipse/image coincide.
    const b = box ?? objectBoundsDots(obj, ctx);
    return graphicAnchorCoords(b.x, b.y, b.width, b.height, obj.positionType, obj.fieldJustify);
  }
  const ax = BARCODE_1D_TYPES.has(obj.type) ? printerAnchoredX(obj, ctx.label) : null;
  return { x: ax ?? obj.x, y: obj.y };
}

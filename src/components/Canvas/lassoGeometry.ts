import type Konva from "konva";
import type { CornerRadii } from "@zplab/core/lib/shapeGeometry";

/** Konva node name marking a shape whose interior is click-through. Stamped by
 *  shapeHitProps and the rounded-box ring so both hit rules share one decision;
 *  declared here to keep this module free of React/store dependencies. */
export const HOLLOW_HIT_NAME = "hollow-hit";

export interface LassoRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ClientBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Duck-typed slice of a Konva shape, so tests can fake nodes without Konva. */
interface ShapeLike {
  className?: string;
  strokeWidth?: () => number;
  hitStrokeWidth?: () => number | string;
  getAttr?: (name: string) => unknown;
}

/** A rounded ^GB ring publishes its free interior as node attrs. */
export const HOLLOW_INSET_ATTR = "hollowInset";
export const HOLLOW_RADIUS_ATTR = "hollowRadius";
export const hollowRingAttrs = (inset: number, radius: number): Record<string, number> => ({
  [HOLLOW_INSET_ATTR]: inset,
  [HOLLOW_RADIUS_ATTR]: radius,
});

/** The padded ring in px; `inset` is where the free interior starts. */
export interface HollowRingSpec extends CornerRadii {
  width: number;
  height: number;
  band: number;
  inset: number;
}

/** The true arcs offset by `pad`, never recomputed from the padded box, so hit
 *  path and lasso interior agree. */
export function hollowRingSpec(
  w: number,
  h: number,
  band: number,
  radii: CornerRadii,
  pad: number,
): HollowRingSpec {
  return {
    width: w + 2 * pad,
    height: h + 2 * pad,
    band: band + 2 * pad,
    outer: radii.outer + pad,
    inner: Math.max(0, radii.inner - pad),
    inset: band + pad,
  };
}

/** Parity with shapeHitProps: a shape it marked with HOLLOW_HIT_NAME is
 *  click-through in its interior, so a lasso fully inside that frame (hit
 *  ring excluded) must not capture it either. */
function insideHollowFrame(node: Konva.Node, rect: LassoRect, box: ClientBox): boolean {
  const shape = (
    node as unknown as { findOne?: (selector: string) => ShapeLike | undefined }
  ).findOne?.(`.${HOLLOW_HIT_NAME}`);
  if (!shape) return false;
  const stroke = shape.strokeWidth?.() ?? 0;
  const hit = shape.hitStrokeWidth?.();
  const hitWidth = typeof hit === "number" ? hit : stroke;
  // The stroke path sits strokeWidth/2 inside the bbox edge (outlineInset) and
  // the hit ring extends hitStrokeWidth/2 to each side of it.
  const inset = stroke / 2 + hitWidth / 2;
  const corners: [number, number][] = [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x, rect.y + rect.h],
    [rect.x + rect.w, rect.y + rect.h],
  ];
  const hollowInset = shape.getAttr?.(HOLLOW_INSET_ATTR);
  const isRing = typeof hollowInset === "number";
  // Hollow Rect frames are square-cornered (rounded ones are rings).
  if (shape.className === "Rect" || isRing) {
    const frameInset = isRing ? hollowInset : inset;
    const x0 = box.x + frameInset;
    const y0 = box.y + frameInset;
    const x1 = box.x + box.width - frameInset;
    const y1 = box.y + box.height - frameInset;
    if (!(rect.x > x0 && rect.y > y0 && rect.x + rect.w < x1 && rect.y + rect.h < y1)) {
      return false;
    }
    const hollowRadius = isRing ? shape.getAttr?.(HOLLOW_RADIUS_ATTR) : 0;
    const r = typeof hollowRadius === "number" ? hollowRadius : 0;
    if (r <= 0) return true;
    // Point-in-rounded-rect via distance to the nearest corner circle.
    return corners.every(([px, py]) => {
      const dx = Math.max(x0 + r - px, px - (x1 - r), 0);
      const dy = Math.max(y0 + r - py, py - (y1 - r), 0);
      return dx * dx + dy * dy < r * r;
    });
  }
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const irx = box.width / 2 - inset;
  const iry = box.height / 2 - inset;
  if (irx <= 0 || iry <= 0) return false;
  // A rect lies inside the (convex) inner ellipse iff all four corners do.
  return corners.every(([px, py]) => ((px - cx) / irx) ** 2 + ((py - cy) / iry) ** 2 < 1);
}

/**
 * Returns IDs whose Konva node's stage-relative client rect intersects the
 * lasso rect. Pure function over the stage's current geometry.
 */
export function getIdsIntersectingRect(
  stage: Konva.Stage,
  candidateIds: string[],
  rect: LassoRect,
): string[] {
  return candidateIds.filter((id) => {
    const node = stage.findOne<Konva.Node>(`#${id}`);
    if (!node) return false;
    const box = node.getClientRect({ relativeTo: stage });
    return (
      rect.x < box.x + box.width &&
      rect.x + rect.w > box.x &&
      rect.y < box.y + box.height &&
      rect.y + rect.h > box.y &&
      !insideHollowFrame(node, rect, box)
    );
  });
}

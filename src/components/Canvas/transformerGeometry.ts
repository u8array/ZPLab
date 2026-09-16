import type { Range } from "@zplab/core/types/propSpec";
import { isAxisSwapped, type ZplRotation } from "@zplab/core/registry/rotation";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface ActiveEdgeFlags {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}

/** Start-of-drag frame for the 1D moduleWidth live reflow: the model box in
 *  parent px plus the starting module width, captured once so the anchored
 *  edge stays fixed across every re-render of the drag. */
export interface BarcodeMwReflowStart {
  rotation: ZplRotation;
  edges: ActiveEdgeFlags;
  mw0: number;
  mwBounds: Range;
  leftX: number;
  topY: number;
  rightX: number;
  bottomY: number;
}

/** Per-tick geometry of the 1D moduleWidth live reflow. Quantises from the
 *  TOTAL drag extent against the start box (identical inputs to the in-drag
 *  box snap, so the two can never disagree or oscillate: rendered pixel
 *  widths are stepwise in moduleWidth, an incremental-scale quantiser would
 *  hunt). Always returns the band's geometry, also mid-band: the caller pins
 *  the node to it every tick, which makes the reflow the sole band pin and
 *  keeps the module raster in rotated views where boundBoxFunc's snap bails.
 *  Both edges come from the start box's LINEAR module model; the caller fits
 *  the re-rendered content into that frame via a residual scale. */
export function barcodeMwReflowGeometry(
  start: BarcodeMwReflowStart,
  frameExtentPx: number,
  centered = false,
): { moduleWidth: number; targetXPx: number; targetYPx: number; linearExtentPx: number } | null {
  if (!(start.mw0 > 0)) return null;
  const swapped = isAxisSwapped(start.rotation);
  const startExtent = swapped ? start.bottomY - start.topY : start.rightX - start.leftX;
  if (!(startExtent > 0) || !(frameExtentPx > 0)) return null;
  const moduleWidth = computeNewModules(start.mw0, frameExtentPx / startExtent, start.mwBounds.min, start.mwBounds.max);
  const linearExtentPx = startExtent * (moduleWidth / start.mw0);
  if (!swapped) {
    return {
      moduleWidth,
      targetXPx: pinnedMin(start.edges.left, start.leftX, start.rightX, linearExtentPx, centered),
      targetYPx: start.topY,
      linearExtentPx,
    };
  }
  return {
    moduleWidth,
    targetXPx: start.leftX,
    targetYPx: pinnedMin(start.edges.top, start.topY, start.bottomY, linearExtentPx, centered),
    linearExtentPx,
  };
}

/** Min-coordinate of the pinned new extent: centered (Alt) mirrors around the
 *  start centre so both sides move; else the anchored (non-grabbed) edge holds
 *  via the same math as `pinAnchoredEdge` (delegated so the two can't drift).
 *  Used by the barcode reflow geometry and the box/ellipse pin. */
export function pinnedMin(
  minEdgeActive: boolean,
  min: number,
  max: number,
  extent: number,
  centered: boolean,
): number {
  if (centered) return (min + max - extent) / 2;
  return pinAnchoredEdge(minEdgeActive, min, max - min, extent);
}

/** Start-of-drag frame for the 1D bar-height live reflow: the footprint bbox in
 *  parent px plus the constant non-bar share of the height axis (HRI text zone,
 *  EAN guard-tail zone). The transformer frames the bars only (the zone is
 *  outside the client rect), so the frame extent is the bar height directly;
 *  the zone is added back only to reconstruct the bbox for the anchored-edge
 *  pin. The height axis is the screen Y for N/I and the screen X for R/B. */
export interface BarcodeHeightReflowStart {
  rotation: ZplRotation;
  edges: ActiveEdgeFlags;
  leftX: number;
  topY: number;
  rightX: number;
  bottomY: number;
  /** Constant (non-bar) share of the height-axis extent, px. */
  zonePx: number;
}

/** Per-tick geometry of the 1D bar-height live reflow: the bar extent the frame
 *  implies and the pinned top-left. The frame is bar-only, so bar height = frame
 *  extent; the pin reconstructs the bbox as frame + zone so the anchored edge
 *  holds. Null for a collapsed frame. */
export function barcodeHeightReflowGeometry(
  start: BarcodeHeightReflowStart,
  frameExtentPx: number,
  centered = false,
): { barExtentPx: number; targetXPx: number; targetYPx: number } | null {
  if (!(frameExtentPx > 0)) return null;
  const barExtentPx = frameExtentPx;
  const bboxExtentPx = frameExtentPx + start.zonePx;
  const swapped = isAxisSwapped(start.rotation);
  if (swapped) {
    return {
      barExtentPx,
      targetXPx: pinnedMin(start.edges.left, start.leftX, start.rightX, bboxExtentPx, centered),
      targetYPx: start.topY,
    };
  }
  return {
    barExtentPx,
    targetXPx: start.leftX,
    targetYPx: pinnedMin(start.edges.top, start.topY, start.bottomY, bboxExtentPx, centered),
  };
}

/** Snap a height to a multiple of stepPx, with stepPx as the minimum. */
export function snapBoxHeight(height: number, stepPx: number): number {
  return Math.max(stepPx, Math.round(height / stepPx) * stepPx);
}

/** Reject a resize only when it shrinks an axis below the floor. A box already
 *  thinner than the floor (e.g. converted from a thin line) stays growable and
 *  movable; only active shrinking past the floor is vetoed. */
export function shrinkingBelowFloor(
  oldBox: BoundingBox,
  newBox: BoundingBox,
  floor: number,
): boolean {
  return (
    (newBox.width < floor && newBox.width < oldBox.width) ||
    (newBox.height < floor && newBox.height < oldBox.height)
  );
}

/** Uniform scale preserving oldBox's aspect, from the dominant drag axis.
 *  Square 2D symbols stay square; rectangular DataMatrix keeps its DMRE
 *  shape. Anchor inferred from non-moving edge (Konva hides it from
 *  boundBoxFunc). */
export function forceAspectBox(oldBox: BoundingBox, newBox: BoundingBox): BoundingBox {
  if (!(oldBox.width > 0) || !(oldBox.height > 0)) return newBox;
  const leftMoved = Math.abs(newBox.x - oldBox.x) > 0.001;
  const topMoved = Math.abs(newBox.y - oldBox.y) > 0.001;
  const scale = Math.max(
    Math.abs(newBox.width) / oldBox.width,
    Math.abs(newBox.height) / oldBox.height,
  );
  const width = oldBox.width * scale;
  const height = oldBox.height * scale;
  const x = leftMoved ? oldBox.x + oldBox.width - width : oldBox.x;
  const y = topMoved ? oldBox.y + oldBox.height - height : oldBox.y;
  return { ...newBox, x, y, width, height };
}

/** Stacked-2D (PDF417/MicroPDF417/Codablock): height steps by rowHeight,
 *  width by moduleWidth. Both axes must snap in lock-step with the commit so
 *  the dropped bbox matches the post-render bitmap. R/B swap the screen axes,
 *  and the module-width bounds are carried per anchor. */
export interface RowAnchor {
  kind: "row";
  nodeHeight: number;
  rowHeight: number;
  nodeWidth: number;
  moduleWidth: number;
  moduleWidthBounds: Range;
  rotation: ZplRotation;
}

/** 1D ^BY moduleWidth quantise anchor. The moduleWidth axis is the screen
 *  width for N/I and the screen height for R/B (the bars turn a quarter), so
 *  the snap needs both extents plus the rotation to pick the axis. */
export interface ModuleWidthAnchor {
  kind: "moduleWidth";
  moduleWidthBounds: Range;
  nodeWidth: number;
  nodeHeight: number;
  moduleWidth: number;
  rotation: "N" | "R" | "I" | "B";
}

/** Start-of-drag frame for the uniform-module (2D code) reflow: rendered bbox
 *  in parent px plus the module range. The per-tick pin from it replaces
 *  boundBoxFunc's snap/aspect, which is frame-wrong under view rotation. */
export interface UniformReflowStart {
  edges: ActiveEdgeFlags;
  modules0: number;
  min: number;
  max: number;
  leftX: number;
  topY: number;
  rightX: number;
  bottomY: number;
}

/** Per-tick geometry of the uniform-module reflow. Quantises the TOTAL frame
 *  extent (not incremental scale) to integer modules: the per-tick scale reset
 *  re-bases on the re-rendered bitmap, so incremental quantising would
 *  oscillate across crossings. Both axes scale by the smaller axis's ratio. */
export function uniformReflowGeometry(
  start: UniformReflowStart,
  frameWPx: number,
  frameHPx: number,
  centered = false,
): { modules: number; targetXPx: number; targetYPx: number; linearW: number; linearH: number } | null {
  const startW = start.rightX - start.leftX;
  const startH = start.bottomY - start.topY;
  if (!(start.modules0 > 0) || !(startW > 0) || !(startH > 0)) return null;
  if (!(frameWPx > 0) || !(frameHPx > 0)) return null;
  const scale = Math.min(frameWPx / startW, frameHPx / startH);
  const modules = computeNewModules(start.modules0, scale, start.min, start.max);
  const factor = modules / start.modules0;
  const linearW = startW * factor;
  const linearH = startH * factor;
  return {
    modules,
    targetXPx: pinnedMin(start.edges.left, start.leftX, start.rightX, linearW, centered),
    targetYPx: pinnedMin(start.edges.top, start.topY, start.bottomY, linearH, centered),
    linearW,
    linearH,
  };
}

export type TransformAnchor = RowAnchor | ModuleWidthAnchor;

/** Single source of truth for module-step rounding shared by the
 *  in-drag snap and the on-release commit so they cannot diverge. */
export function computeNewModules(
  currentModules: number,
  scale: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, Math.round(currentModules * scale)));
}

/** Drag-handle move epsilon: below this an edge counts as stationary. */
const HANDLE_MOVE_EPS = 0.001;

/** Replace one screen axis's extent with `snapped`, pinning the non-grabbed
 *  edge so the stationary side holds while the snapped extent grows from it. */
function pinSnappedAxis(
  oldBox: BoundingBox,
  newBox: BoundingBox,
  axis: "x" | "y",
  snapped: number,
  eps: number,
): BoundingBox {
  if (axis === "y") {
    const topMoved = Math.abs(newBox.y - oldBox.y) > eps;
    const y = topMoved ? oldBox.y + oldBox.height - snapped : oldBox.y;
    return { ...newBox, y, height: snapped };
  }
  const leftMoved = Math.abs(newBox.x - oldBox.x) > eps;
  const x = leftMoved ? oldBox.x + oldBox.width - snapped : oldBox.x;
  return { ...newBox, x, width: snapped };
}

export function applyHeightSnap(
  oldBox: BoundingBox,
  newBox: BoundingBox,
  dotPx: number,
  anchor: TransformAnchor | null,
): BoundingBox {
  if (anchor?.kind !== "row" || anchor.rowHeight <= 0) return newBox;
  // rowHeight axis is the screen height for N/I, the screen width for R/B.
  const swapped = isAxisSwapped(anchor.rotation);
  const axisNode = swapped ? anchor.nodeWidth : anchor.nodeHeight;
  if (axisNode <= 0) return newBox;
  const stepPx = axisNode / anchor.rowHeight;
  const snapped = snapBoxHeight(swapped ? newBox.width : newBox.height, stepPx);
  return pinSnappedAxis(oldBox, newBox, swapped ? "x" : "y", snapped, dotPx * 0.5);
}

/** Snap one axis extent to the nearest integer ^BY moduleWidth multiple. */
function snapModuleExtent(
  extent: number,
  anchorExtent: number,
  moduleWidth: number,
  bounds: Range,
): number {
  const nextMw = computeNewModules(moduleWidth, extent / anchorExtent, bounds.min, bounds.max);
  return anchorExtent * (nextMw / moduleWidth);
}

/** Shared by 1D and stacked-2D since both commit width via the same ^BY moduleWidth rounding. */
export function applyModuleWidthSnap(
  oldBox: BoundingBox,
  newBox: BoundingBox,
  anchor: TransformAnchor | null,
): BoundingBox {
  if (anchor?.kind !== "moduleWidth" && anchor?.kind !== "row") return newBox;
  if (anchor.moduleWidth <= 0) return newBox;
  const swapped = isAxisSwapped(anchor.rotation);
  const axisNode = swapped ? anchor.nodeHeight : anchor.nodeWidth;
  if (axisNode <= 0) return newBox;
  const snapped = snapModuleExtent(
    swapped ? newBox.height : newBox.width,
    axisNode,
    anchor.moduleWidth,
    anchor.moduleWidthBounds,
  );
  return pinSnappedAxis(oldBox, newBox, swapped ? "y" : "x", snapped, HANDLE_MOVE_EPS);
}

/** Pin the anchored side of a resize: a grabbed min edge (left/top) shifts the
 *  position so the opposite edge stays fixed; else the min edge holds. */
export function pinAnchoredEdge(
  minEdgeActive: boolean,
  start: number,
  startExtent: number,
  newExtent: number,
): number {
  return minEdgeActive ? start + startExtent - newExtent : start;
}

/** Absorbs px<->dot float rounding so integer positions are preserved. */
export const POSITION_MOVE_TOLERANCE_DOTS = 1;

/** Pin non-grabbed edges to start so Konva's sub-pixel drift can't walk them. */
export function pinInactiveEdges(
  bbox: BoundingBox,
  startBox: BoundingBox,
  active: ActiveEdgeFlags,
): BoundingBox {
  let { x, y, width, height } = bbox;

  if (!active.left && !active.right) {
    x = startBox.x;
    width = startBox.width;
  } else if (!active.left) {
    const newRight = x + width;
    x = startBox.x;
    width = Math.max(0, newRight - x);
  } else if (!active.right) {
    const startRight = startBox.x + startBox.width;
    width = Math.max(0, startRight - x);
  }

  if (!active.top && !active.bottom) {
    y = startBox.y;
    height = startBox.height;
  } else if (!active.top) {
    const newBottom = y + height;
    y = startBox.y;
    height = Math.max(0, newBottom - y);
  } else if (!active.bottom) {
    const startBottom = startBox.y + startBox.height;
    height = Math.max(0, startBottom - y);
  }

  return { ...bbox, x, y, width, height };
}

/** Guards snap-on-resize from pulling off-grid shapes to grid as a side-effect. */
export function positionDidMove(
  rawDots: number,
  previousDots: number,
): boolean {
  return Math.abs(rawDots - previousDots) > POSITION_MOVE_TOLERANCE_DOTS;
}

/** Returns null on unknown/rotater so callers can fall back to bbox-diff. */
export function activeEdgesFromAnchorName(name: string | null): ActiveEdgeFlags | null {
  if (!name) return null;
  const left = name.includes("left");
  const right = name.includes("right");
  const top = name.includes("top");
  const bottom = name.includes("bottom");
  if (!left && !right && !top && !bottom) return null;
  return { left, right, top, bottom };
}

import type { LeafObject } from "@zplab/core/registry";
import { QR_FT_MODULE_OFFSET } from "@zplab/core/lib/bwipConstants";
import {
  barcodeFtAnchorOffset,
  isBarcode,
  qrPrintsAsGraphic,
  rightAnchorBoxWidthDots,
  rightAnchorShiftDots,
  rotatedFootprint,
} from "@zplab/core/lib/objectBounds";
import { qrByHeight } from "@zplab/core/registry/qrcode";
import { isAxisSwapped, objectRotation, type ZplRotation } from "@zplab/core/registry/rotation";
import { getMeasuredSnapshot } from "../../lib/measuredBoundsCache";

/** Cached upright (unrotated) bar-rect size + HRI zone offsets (dots). Falls
 *  back to props.height for the H of a not-yet-rendered 1D barcode, else 0. */
function cacheBar(obj: LeafObject): { w: number; h: number; barLeft: number; barTop: number } {
  const m = getMeasuredSnapshot().get(obj.id);
  return {
    w: m?.uprightBarWDots ?? 0,
    h: m?.uprightBarHDots ?? (obj.props as { height?: number }).height ?? 0,
    barLeft: m?.barLeftDots ?? 0,
    barTop: m?.barTopDots ?? 0,
  };
}

/** Render delta for a ^FT barcode (rendered-top-left = obj + delta), mirroring
 *  objectBounds.barcodeTopLeft. The caller passes the committed upright size on a
 *  resize so the commit lands on the field anchor; dims are pre-swapped here. */
function ftBarcodeRenderDelta(
  obj: LeafObject,
  uprightW: number,
  uprightH: number,
  qrMagnification?: number,
): { x: number; y: number } {
  const { barLeft, barTop } = cacheBar(obj);
  const graphicQr = qrPrintsAsGraphic(obj);
  const off = barcodeFtAnchorOffset(
    graphicQr ? "N" : objectRotation(obj.props),
    uprightW,
    uprightH,
  );
  const qrShift =
    obj.type === "qrcode" && !graphicQr
      ? QR_FT_MODULE_OFFSET *
        (qrMagnification ?? (obj.props as { magnification: number }).magnification)
      : 0;
  return { x: off.x - barLeft, y: off.y - qrShift - barTop };
}

function isFtBarcode(obj: LeafObject): boolean {
  return obj.positionType === "FT" && isBarcode(obj);
}

/** Post-resize upright bar size (dots) from the continuous drag scale (R/B swap
 *  the drag axes, like effectiveScale). Use the continuous scale, not the snapped
 *  props: feeding the rounded props back makes rotated barcodes jump on release. */
export function committedUprightBarDots(
  rotation: ZplRotation,
  sx: number,
  sy: number,
  uprightW: number,
  uprightH: number,
): { w: number; h: number } {
  const swap = isAxisSwapped(rotation);
  return { w: uprightW * (swap ? sy : sx), h: uprightH * (swap ? sx : sy) };
}

/** Rendered top-left -> stored model position. QR FO subtracts the pinned ^BY Y
 *  artifact; FT barcodes invert the rotation-aware bar anchor. On a resize pass
 *  the committed upright bar size (`committedUprightW/H`, in dots) so the inverse
 *  uses the same dimensions the commit stores; omit it elsewhere to use the
 *  current rendered size. `committedMagnification` likewise pins the QR firmware
 *  shift to the post-resize magnification (uniform resize) so it stays lockstep. */
export function modelPositionFromRenderedTopLeft(
  obj: LeafObject,
  renderedXDots: number,
  renderedYDots: number,
  committedUprightW?: number,
  committedUprightH?: number,
  committedMagnification?: number,
): { x: number; y: number } {
  // Shifts by the upright BOX width, which on a quarter turn is the upright height; the committed pair is always upright.
  const committedBoxW =
    committedUprightW !== undefined && committedUprightH !== undefined && obj.type !== "symbol"
      ? rotatedFootprint(committedUprightW, committedUprightH, objectRotation(obj.props)).width
      : committedUprightW;
  const anchor = rightAnchorShift(obj, committedBoxW);
  if (obj.type === "qrcode" && obj.positionType !== "FT" && !qrPrintsAsGraphic(obj)) {
    return { x: renderedXDots + anchor, y: renderedYDots - qrByHeight(obj.props) };
  }
  if (isFtBarcode(obj)) {
    const c = cacheBar(obj);
    const w = committedUprightW ?? c.w;
    const h = committedUprightH ?? c.h;
    const d = ftBarcodeRenderDelta(obj, w, h, committedMagnification);
    const barAnchor = rightAnchorShiftDots(obj, rotatedFootprint(w, h, objectRotation(obj.props)).width);
    return { x: renderedXDots - d.x + barAnchor, y: renderedYDots - d.y };
  }
  // ^FO barcodes: the render shifts by the HRI zone (objectBounds.barcodeTopLeft
  // subtracts it), so the inverse must add it back or a resize commits a
  // position one zone off from where the object was drawn.
  const zone = foBarcodeZone(obj);
  return {
    x: renderedXDots + zone.barLeft + anchor,
    y: renderedYDots + zone.barTop,
  };
}

/** Inverse of `modelPositionFromRenderedTopLeft` at the current size. */
export function renderedTopLeftFromModel(obj: LeafObject): {
  x: number;
  y: number;
} {
  if (obj.type === "qrcode" && obj.positionType !== "FT" && !qrPrintsAsGraphic(obj)) {
    return renderedWithAnchor(obj, obj.x, obj.y + qrByHeight(obj.props));
  }
  if (isFtBarcode(obj)) {
    const c = cacheBar(obj);
    const d = ftBarcodeRenderDelta(obj, c.w, c.h);
    return renderedWithAnchor(obj, obj.x + d.x, obj.y + d.y);
  }
  const zone = foBarcodeZone(obj);
  return { x: obj.x - zone.barLeft - rightAnchorShift(obj), y: obj.y - zone.barTop };
}

/** Same shift for the branches that return before the fall-through. */
function renderedWithAnchor(obj: LeafObject, x: number, y: number): { x: number; y: number } {
  return { x: x - rightAnchorShift(obj), y };
}

/** How far left of its model x the canvas draws a right-justified field; unmeasurable draws unshifted,
 *  and the renderer, this transform and its inverse all read it here so they stay each other's inverse. */
export function rightAnchorShift(obj: LeafObject, committedWidth?: number): number {
  // A resize passes the width it is committing; otherwise the measured footprint.
  const width = rightAnchorBoxWidthDots(obj, committedWidth ?? getMeasuredSnapshot().get(obj.id)?.width);
  return width === null ? 0 : rightAnchorShiftDots(obj, width);
}

/** The HRI-zone offset an ^FO barcode's render applies, zero for everything
 *  else. Mirrors objectBounds.barcodeTopLeft's plain-^FO return. */
function foBarcodeZone(obj: LeafObject): { barLeft: number; barTop: number } {
  if (!isBarcode(obj)) return { barLeft: 0, barTop: 0 };
  const c = cacheBar(obj);
  return { barLeft: c.barLeft, barTop: c.barTop };
}

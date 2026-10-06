import { errorMessage } from "./errorMessage";
import { queryPrinter, type PrinterOutcome } from "./printerQuery";
import type { QueryTarget } from "./printTarget";
import {
  buildPrinterPreviewZpl,
  contentBounds,
  decodeDyGraphic,
  monoToRgba,
  type PrinterBitmap,
} from "./zebraGraphic";

export interface PrinterRenderDims {
  width: number;
  height: number;
  contentLeft: number;
  contentRight: number;
  contentTop: number;
  contentBottom: number;
}

export function printerRenderDims(bmp: PrinterBitmap): PrinterRenderDims {
  const c = contentBounds(bmp);
  return {
    width: bmp.width,
    height: bmp.height,
    contentLeft: c.left,
    contentRight: c.right,
    contentTop: c.top,
    contentBottom: c.bottom,
  };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PrinterPreviewLayout {
  /** Bitmap region to draw; x/y skip the firmware padding. */
  crop: Rect;
  /** Mismatch zones, in dots from the label origin. */
  hatches: Rect[];
}

/** Crop one axis' padding, but never past where content starts, so an
 *  edge-justified firmware is not cropped into. */
function reconcileAxis(
  bitmap: number,
  labelSize: number,
  contentStart: number,
  contentEnd: number,
): { offset: number; drawSize: number } {
  const centering = Math.max(0, Math.floor((bitmap - labelSize) / 2));
  const offset = Math.min(centering, contentStart);
  const end = Math.max(0, contentEnd - offset);
  return { offset, drawSize: Math.min(bitmap - offset, Math.max(labelSize, end)) };
}

/** Reconcile render against label (dots). The firmware centers the print in
 *  the full head raster (measured ZD230: 800-dot print, 832-dot head), so crop
 *  the padding per axis; whatever is left over becomes a mismatch hatch. */
export function printerPreviewLayout(
  dims: PrinterRenderDims,
  label: { width: number; height: number },
): PrinterPreviewLayout {
  const x = reconcileAxis(dims.width, label.width, dims.contentLeft, dims.contentRight);
  const y = reconcileAxis(dims.height, label.height, dims.contentTop, dims.contentBottom);
  const drawWidth = x.drawSize;
  const drawHeight = y.drawSize;

  // Two non-overlapping bands so a mismatch corner is hatched exactly once:
  // no gap, no double-opacity overlap.
  const hatches: Rect[] = [];
  const sharedWidth = Math.min(drawWidth, label.width);
  if (drawWidth !== label.width) {
    hatches.push({
      x: sharedWidth,
      y: 0,
      width: Math.abs(drawWidth - label.width),
      height: drawWidth > label.width ? drawHeight : label.height,
    });
  }
  if (drawHeight !== label.height) {
    hatches.push({
      x: 0,
      y: Math.min(drawHeight, label.height),
      width: sharedWidth,
      height: Math.abs(drawHeight - label.height),
    });
  }
  return { crop: { x: x.offset, y: y.offset, width: drawWidth, height: drawHeight }, hatches };
}

/** Rasterize the printer's 1bpp upload to a PNG data URL (canvas-backed, like
 *  labelary's blob URLs; a data URL survives the same cache path since
 *  revokeObjectURL on it is a no-op). */
export function bitmapToDataUrl(bmp: PrinterBitmap): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(new ImageData(monoToRgba(bmp), bmp.width, bmp.height), 0, 0);
  return canvas.toDataURL("image/png");
}

/** Ask the printer to render the design and upload the resulting bitmap
 *  (^IS store + ^HY upload over one bidirectional channel). Ground truth from
 *  the firmware renderer, so it needs raw TCP (9100) or a USB read channel,
 *  not IPP. Desktop shell only: the web build has neither. */
export async function fetchPrinterPreview(
  target: QueryTarget,
  designZpl: string,
): Promise<PrinterOutcome<PrinterBitmap>> {
  try {
    const res = await queryPrinter(target, buildPrinterPreviewZpl(designZpl));
    if (res.kind !== "ok") return res;
    const bitmap = decodeDyGraphic(res.value);
    return bitmap
      ? { kind: "ok", value: bitmap }
      : { kind: "error", message: "no graphic in printer response" };
  } catch (e) {
    return { kind: "error", message: errorMessage(e) };
  }
}

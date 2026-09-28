import { isDesktopShell } from "./platform";
import { errorMessage } from "./errorMessage";
import { queryZplUsb } from "./usbPrint";
import {
  buildPrinterPreviewZpl,
  contentBounds,
  decodeDyGraphic,
  monoToRgba,
  type PrinterBitmap,
} from "./zebraGraphic";

/** Where the preview query goes: the raw-TCP port or a USB printer id. */
export type PreviewTarget =
  | { kind: "network"; host: string; port: number }
  | { kind: "usb"; id: string };

/** Failure kinds the query dispatch and the final result share, so
 *  fetchPrinterPreview forwards them to the caller unchanged. */
type PrinterQueryFailure =
  | { kind: "refused" }
  | { kind: "unreachable" }
  | { kind: "not_found" }
  | { kind: "permission_denied" }
  | { kind: "error"; message: string };

export type PrinterPreviewResult = { kind: "bitmap"; bitmap: PrinterBitmap } | PrinterQueryFailure;

/** One wording per failure, so the preview overlay, the print window and the PDF export tell the same story. */
export function printerFailureMessage(failure: PrinterQueryFailure, target: PreviewTarget): string {
  switch (failure.kind) {
    case "refused":
      // 'refused' is network-only, so the port hint needs a network target.
      return `The printer refused the connection.${target.kind === "network" ? ` Check that port ${target.port} is open.` : ""}`;
    case "unreachable":
      return "Could not reach the printer. Check the IP address and network.";
    case "not_found":
      return "USB printer not found. Re-plug it and check Settings, Printer.";
    case "permission_denied":
      return "No access to the USB printer. Grant it in the print dialog, USB tab.";
    case "error":
      return failure.message;
  }
}

/** queryTarget's outcome: the raw reply to decode, or a failure to forward. */
type PrinterQueryOutcome = { kind: "data"; body: string } | PrinterQueryFailure;

interface TcpQueryResult {
  kind: "data" | "refused" | "unreachable";
  body?: string;
}

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

async function queryTarget(target: PreviewTarget, zpl: string): Promise<PrinterQueryOutcome> {
  if (target.kind === "usb") {
    return await queryZplUsb(target.id, zpl);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const res = await invoke<TcpQueryResult>("query_zpl_tcp", {
    host: target.host,
    port: target.port,
    zpl,
  });
  if (res.kind === "refused") return { kind: "refused" };
  if (res.kind === "unreachable") return { kind: "unreachable" };
  return { kind: "data", body: res.body ?? "" };
}

/** Ask the printer to render the design and upload the resulting bitmap
 *  (^IS store + ^HY upload over one bidirectional channel). Ground truth from
 *  the firmware renderer, so it needs raw TCP (9100) or a USB read channel,
 *  not IPP. Desktop shell only: the web build has neither. */
export async function fetchPrinterPreview(
  target: PreviewTarget,
  designZpl: string,
): Promise<PrinterPreviewResult> {
  if (!isDesktopShell) {
    return { kind: "error", message: "printer preview requires the desktop app" };
  }
  try {
    const res = await queryTarget(target, buildPrinterPreviewZpl(designZpl));
    if (res.kind !== "data") return res;
    const bitmap = decodeDyGraphic(res.body);
    return bitmap
      ? { kind: "bitmap", bitmap }
      : { kind: "error", message: "no graphic in printer response" };
  } catch (e) {
    return { kind: "error", message: errorMessage(e) };
  }
}

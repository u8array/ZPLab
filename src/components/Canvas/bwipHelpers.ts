// Browser-side bwip helpers: canvas rendering and validation on top of the
// headless dimension kernel in @zplab/core/lib/barcodeDims (which the MCP
// sidecar shares); this file owns everything that needs a real canvas.

import bwipjs from "bwip-js/browser";
import { errorMessage } from "../../lib/errorMessage";
import { getEntry, type LeafObject } from "@zplab/core/registry";
import { dotsToPx, pxToDots } from "@zplab/core/lib/coordinates";
import { getObjectStringContent } from "@zplab/core/lib/variableBinding";
import { placeholderContentFor, samplePropsFor } from "@zplab/core/registry/placeholderContent";
import { EAN_TEXT_ZONE_DOTS, EAN_UPC_TYPES } from "@zplab/core/lib/bwipConstants";
import {
  drawBarRects,
  firstRawEntry,
  ZEBRA_WIDTH_BAR_TYPES,
  ZEBRA_WIDTH_BCID,
  zebraWidthBarGeometry,
  zebraWidthBarText,
  type ZebraWidthBarType,
} from "@zplab/core/lib/barcodeRawGeometry";
import {
  buildBwipOptions,
  BWIP_SCALE,
  dmBwipInput,
  eanUpcTotalModules,
  get1DBwipScale,
  getDisplaySize,
  getEanUpcHriFragmentsWith,
  rawEanUpc,
  snapTlc39MicroPdfRows,
  splitTlc39Content,
  type BarcodeDisplaySize,
  type BwipEngine,
  type EanUpcType,
  type Tlc39RenderProps,
} from "@zplab/core/lib/barcodeDims";
import type { DataMatrixProps } from "@zplab/core/registry/datamatrix";

export { ZEBRA_WIDTH_BAR_TYPES };
export {
  buildBwipOptions,
  BWIP_SCALE,
  get1DBwipScale,
  getDisplaySize,
  parseZplCode128Escapes,
  snapTlc39MicroPdfRows,
  splitTlc39Content,
  TLC39_MICROPDF_ROW_COUNTS,
} from "@zplab/core/lib/barcodeDims";
export type { BarcodeDisplaySize, EanUpcType, EanUpcHriFragment } from "@zplab/core/lib/barcodeDims";
export { eanCheckDigit, upceCheckDigit } from "@zplab/core/lib/barcodeCheckDigits";

const bwipEngine = bwipjs as unknown as BwipEngine;

/** Kernel EAN/UPC HRI geometry bound to the browser bwip build. */
export function getEanUpcHriFragments(type: EanUpcType, text: string) {
  return getEanUpcHriFragmentsWith(bwipEngine, type, text);
}

// Lazy so SSR imports don't crash on missing `document`.
let _validationCanvas: HTMLCanvasElement | null = null;
function getValidationCanvas(): HTMLCanvasElement {
  if (!_validationCanvas) _validationCanvas = document.createElement("canvas");
  return _validationCanvas;
}

/** Strip `bwip-js: bwipp.symbology:` prefixes from encoder errors for UI display. */
export function cleanBwipError(e: unknown): string {
  const raw = errorMessage(e);
  return raw.replace(/^bwip-js:\s*/i, "").replace(/^bwipp\.[^:]+:\s*/i, "");
}

/** Index of the smallest capacity-ordered ^BX size that fits `p`'s content:
 *  auto mode picks it from the same table, so one encode ranks the whole list.
 *  Returns 0 (disable nothing) when the content won't encode at any size —
 *  that's a content error the preflight already reports. */
export function dataMatrixMinFitIndex(
  p: DataMatrixProps,
  pairs: readonly (readonly [number, number])[],
): number {
  try {
    const [sym] = bwipjs.raw(dmBwipInput(p) as never) as { pixx?: number; pixy?: number }[];
    return Math.max(0, pairs.findIndex(([r, c]) => r === sym?.pixy && c === sym?.pixx));
  } catch {
    return 0;
  }
}

/** Dry-run encode; returns null on success or cleaned error message. */
export function validateMaxicodeBwip(content: string, mode: number): string | null {
  try {
    const opts = {
      bcid: "maxicode",
      text: content || " ",
      scale: BWIP_SCALE,
      mode,
    } as unknown as Parameters<typeof bwipjs.toCanvas>[1];
    bwipjs.toCanvas(getValidationCanvas(), opts);
    return null;
  } catch (e) {
    return cleanBwipError(e);
  }
}

/** Sub-pixel overlap so adjacent module rects don't leave hairline gaps. */
const RAW_BAR_SEAM = 0.4;

export interface EanUpcRawCanvasArgs {
  type: EanUpcType;
  text: string;
  modulePxInt: number;
  barHeightPx: number;
  tailHeightPx: number;
  /** False matches Zebra's HRI-off render (bars only, tails not drawn). */
  extendGuards: boolean;
}

/** Bars + extended guard tails in one fillRect pass via bwip raw
 *  geometry. Canvas always reserves the firmware 13-dot text zone so
 *  the consumer's KImage height stays constant. */
export function renderEanUpcRawCanvas({
  type,
  text,
  modulePxInt,
  barHeightPx,
  tailHeightPx,
  extendGuards,
}: EanUpcRawCanvasArgs): HTMLCanvasElement | null {
  const barH = Math.round(barHeightPx);
  const tailH = Math.max(0, Math.round(tailHeightPx));
  if (modulePxInt <= 0 || barH <= 0) return null;
  const g = rawEanUpc(bwipEngine, type, text);
  if (!g?.sbs) return null;
  const totalModules = eanUpcTotalModules(g);
  if (totalModules <= 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = totalModules * modulePxInt;
  canvas.height = barH + tailH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#000000";
  let cx = 0;
  let isBar = true;
  let barIdx = 0;
  for (const w of g.sbs) {
    const wPx = w * modulePxInt;
    if (isBar) {
      const isGuard = extendGuards && (g.bbs?.[barIdx] ?? 0) < 0;
      const h = isGuard ? canvas.height : barH;
      ctx.fillRect(cx, 0, wPx + RAW_BAR_SEAM, h);
      barIdx++;
    }
    cx += wPx;
    isBar = !isBar;
  }
  return canvas;
}

/** Warning frame geometry: the bar sub-rect for EAN/UPC (guard tails and the
 *  reserved HRI zone excluded, matching the selection frame), the full
 *  footprint otherwise. Same on both render paths so HRI on/off stays aligned. */
export function stateFrameProps(ub: BarcodeDisplaySize["upright"], isEanUpc: boolean) {
  return isEanUpc
    ? { x: ub.barLeftPx, y: ub.barTopPx, width: ub.barW, height: ub.barH }
    : { width: Math.max(ub.w, 1), height: Math.max(ub.h, 1) };
}

/** Synchronous footprint probe for the store's anchor re-pin. Blank/uncodable
 *  content falls back to the sample bars, mirroring BarcodeObject, so prop
 *  edits on a sample-rendered barcode still re-pin against the drawn width. */
export function measureBarcodeFootprintDots(
  obj: LeafObject,
  scale: number,
  dpmm: number,
): { w: number; h: number } | null {
  const blank = (getObjectStringContent(obj) ?? "").trim() === "";
  let target = obj;
  let canvas = blank ? null : renderBarcodeCanvas(obj, scale, dpmm).canvas;
  if (!canvas) {
    const sample = placeholderContentFor(obj.type, obj.props);
    if (!sample) return null;
    target = { ...obj, props: { ...samplePropsFor(obj.type, obj.props), content: sample } } as LeafObject;
    canvas = renderBarcodeCanvas(target, scale, dpmm).canvas;
    if (!canvas) return null;
  }
  const dim = getDisplaySize(target, canvas, scale, dpmm);
  if (dim.w <= 0 || dim.h <= 0) return null;
  return { w: pxToDots(dim.w, scale, dpmm), h: pxToDots(dim.h, scale, dpmm) };
}

/** TLC39 composite (MicroPDF417 on top, Code 39 below; shared width, no separator). */
export function renderTlc39Canvas(
  props: Tlc39RenderProps,
  scale: number,
  dpmm: number,
): HTMLCanvasElement | null {
  const { eci, serial } = splitTlc39Content(props.content);
  const bwipScale = get1DBwipScale(props.moduleWidth, scale, dpmm);
  const modulePx = dotsToPx(props.moduleWidth, scale, dpmm);
  const code39H = dotsToPx(props.height, scale, dpmm);

  const renderCode39 = (text: string): HTMLCanvasElement | null => {
    const c = document.createElement("canvas");
    try {
      bwipjs.toCanvas(c, {
        bcid: "code39",
        text: text || " ",
        scale: bwipScale,
        height: 10,
        includetext: false,
      } as unknown as Parameters<typeof bwipjs.toCanvas>[1]);
    } catch {
      return null;
    }
    return c;
  };

  const stretchTo = (
    src: HTMLCanvasElement,
    targetW: number,
    targetH: number,
  ): HTMLCanvasElement | null => {
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(targetW));
    out.height = Math.max(1, Math.round(targetH));
    const c = out.getContext("2d");
    if (!c) return null;
    c.fillStyle = "white";
    c.fillRect(0, 0, out.width, out.height);
    c.imageSmoothingEnabled = false;
    c.drawImage(src, 0, 0, out.width, out.height);
    return out;
  };

  if (!serial) {
    const src = renderCode39(eci);
    if (!src) return null;
    const w = (src.width / bwipScale) * modulePx;
    return stretchTo(src, w, code39H);
  }

  // "T" linkage flag only appended after MicroPDF actually renders.
  const snappedRows = snapTlc39MicroPdfRows(props.microPdfRows);
  const mpdfSrc = document.createElement("canvas");
  let mpdfOk = true;
  try {
    bwipjs.toCanvas(mpdfSrc, {
      bcid: "micropdf417",
      text: serial,
      scale: BWIP_SCALE,
      rows: snappedRows,
      // TLC39 spec: linked MicroPDF417 is fixed at 4 columns.
      columns: 4,
    } as unknown as Parameters<typeof bwipjs.toCanvas>[1]);
  } catch {
    mpdfOk = false;
  }

  const code39Src = renderCode39(mpdfOk ? `${eci}T` : eci);
  if (!code39Src) return null;
  const code39W = (code39Src.width / bwipScale) * modulePx;

  if (!mpdfOk) return stretchTo(code39Src, code39W, code39H);

  const mpdfW = (mpdfSrc.width / BWIP_SCALE) * modulePx;
  const mpdfH = snappedRows * dotsToPx(props.microPdfRowHeight, scale, dpmm);

  const w = Math.max(1, Math.round(Math.max(code39W, mpdfW)));
  const mpdfPxH = Math.max(1, Math.round(mpdfH));
  const code39PxH = Math.max(1, Math.round(code39H));
  const composite = document.createElement("canvas");
  composite.width = w;
  composite.height = mpdfPxH + code39PxH;
  const ctx = composite.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, composite.width, composite.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(mpdfSrc, 0, 0, w, mpdfPxH);
  ctx.drawImage(code39Src, 0, mpdfPxH, w, code39PxH);
  return composite;
}

function renderZebraWidthBars(
  obj: LeafObject,
  scale: number,
  dpmm: number,
): { canvas: HTMLCanvasElement | null; error: string | null } {
  const type = obj.type as ZebraWidthBarType;
  const p = obj.props as { content?: string; moduleWidth: number; height: number };
  const modulePx = get1DBwipScale(p.moduleWidth, scale, dpmm);
  const heightPx = Math.max(1, Math.round(dotsToPx(p.height, scale, dpmm)));
  try {
    const text = zebraWidthBarText(type, p.content ?? "");
    const entry = firstRawEntry(bwipjs.raw({ bcid: ZEBRA_WIDTH_BCID[type], text } as never));
    const geo = zebraWidthBarGeometry(type, entry, modulePx, heightPx);
    if (!geo) return { canvas: null, error: "encode produced no bar geometry" };
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(geo.width));
    canvas.height = heightPx;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { canvas: null, error: "canvas context unavailable" };
    ctx.fillStyle = "#000000";
    drawBarRects(ctx, geo.rects);
    return { canvas, error: null };
  } catch (e) {
    return { canvas: null, error: cleanBwipError(e) };
  }
}

/** Single source for encoding an object as a barcode at `scale`: used by the
 *  canvas display AND the preflight encode check. Returns the rendered canvas
 *  (null on failure) and a cleaned error message (null on success). A
 *  non-barcode type yields {canvas:null, error:null}. */
export function renderBarcodeCanvas(
  obj: LeafObject,
  scale: number,
  dpmm: number,
): { canvas: HTMLCanvasElement | null; error: string | null } {
  if (obj.type === "tlc39") {
    const canvas = renderTlc39Canvas(obj.props as Parameters<typeof renderTlc39Canvas>[0], scale, dpmm);
    return { canvas, error: canvas ? null : "TLC39 render failed" };
  }
  if (ZEBRA_WIDTH_BAR_TYPES.has(obj.type)) {
    return renderZebraWidthBars(obj, scale, dpmm);
  }
  if (EAN_UPC_TYPES.has(obj.type)) {
    const moduleWidth = (obj.props as { moduleWidth?: number }).moduleWidth ?? 2;
    const printInterpEnabled =
      !getEntry(obj.type)?.interpretationLocked &&
      !!(obj.props as { printInterpretation?: boolean }).printInterpretation;
    const canvas = renderEanUpcRawCanvas({
      type: obj.type as EanUpcType,
      text: getObjectStringContent(obj) ?? "",
      modulePxInt: get1DBwipScale(moduleWidth, scale, dpmm),
      barHeightPx: dotsToPx((obj.props as { height: number }).height, scale, dpmm),
      tailHeightPx: dotsToPx(EAN_TEXT_ZONE_DOTS, scale, dpmm),
      extendGuards: printInterpEnabled,
    });
    return { canvas, error: canvas ? null : "EAN/UPC encode failed" };
  }
  const opts = buildBwipOptions(obj, scale, dpmm);
  if (!opts) return { canvas: null, error: null };
  const canvas = document.createElement("canvas");
  try {
    bwipjs.toCanvas(canvas, opts as unknown as Parameters<typeof bwipjs.toCanvas>[1]);
    return { canvas, error: null };
  } catch (e) {
    return { canvas: null, error: cleanBwipError(e) };
  }
}

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
  bwipRetryOptions,
  getEanUpcHriFragmentsWith,
  rawEanUpc,
  splitTlc39Content,
  tlc39Code39Runs,
  tlc39CompositeLayout,
  tlc39MicroPdfDims,
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
  splitTlc39Content,
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

/** Warning frame geometry: always the bar sub-rect, matching the selection
 *  frame (any reserved HRI zone, below for EAN/UPC or above for logmars/^BS,
 *  lies outside it; without a zone the bar rect is the footprint). */
export function stateFrameProps(ub: BarcodeDisplaySize["upright"]) {
  return {
    x: ub.barLeftPx,
    y: ub.barTopPx,
    width: Math.max(ub.barW, 1),
    height: Math.max(ub.barH, 1),
  };
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

/** TLC39 composite (ZD230-true): MicroPDF417 indented 1*w1 on top, Code 39
 *  below, and in linked form the lone linkage T behind a 10-module gap
 *  printed 1.4*h1 tall (see tlc39Code39Runs / tlc39CompositeLayout). */
export function renderTlc39Canvas(
  props: Tlc39RenderProps,
  scale: number,
  dpmm: number,
): { canvas: HTMLCanvasElement | null; approximated: boolean } {
  const { eci, serial } = splitTlc39Content(props.content);
  const modulePx = dotsToPx(props.moduleWidth, scale, dpmm);
  const code39H = dotsToPx(props.height, scale, dpmm);
  const engine = bwipjs as unknown as BwipEngine;

  const mpdf = serial ? tlc39MicroPdfDims(engine, serial) : null;
  // A serial no linked version can encode degrades to the unlinked Code 39;
  // that preview is a stand-in, so it must badge too.
  const approximated = mpdf ? mpdf.approximated : serial !== "";
  const geo = tlc39Code39Runs(engine, eci, props.wideRatio, mpdf !== null);
  if (!geo) return { canvas: null, approximated };
  const code39W = geo.totalModules * modulePx;

  const mpdfW = mpdf
    ? (mpdf.dims.width / BWIP_SCALE) * dotsToPx(props.microPdfModuleWidth, scale, dpmm)
    : 0;
  const mpdfH = mpdf ? mpdf.targetRows * dotsToPx(props.microPdfRowHeight, scale, dpmm) : 0;
  const layout = tlc39CompositeLayout(code39W, mpdfW, mpdfH, code39H, modulePx, mpdf !== null);

  const composite = document.createElement("canvas");
  composite.width = layout.width;
  composite.height = layout.height;
  const ctx = composite.getContext("2d");
  if (!ctx) return { canvas: null, approximated };
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, composite.width, composite.height);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "black";

  // Code 39 bars from the module runs; the tall stop region overhangs.
  // Boundary rounding (not per-run) so sub-pixel modules cannot collapse
  // wide and narrow runs into the same drawn width at small zoom.
  let xModules = 0;
  for (let i = 0; i < geo.runs.length; i++) {
    const w = geo.runs[i] ?? 0;
    if (i % 2 === 0) {
      const tall = geo.tallFromModule !== null && xModules >= geo.tallFromModule;
      const y = tall ? layout.code39Y - layout.stopOverhangPx : layout.code39Y;
      const h = tall ? layout.code39PxH + 2 * layout.stopOverhangPx : layout.code39PxH;
      const x0 = Math.round(xModules * modulePx);
      const x1 = Math.round((xModules + w) * modulePx);
      ctx.fillRect(x0, y, Math.max(1, x1 - x0), h);
    }
    xModules += w;
  }

  if (mpdf) {
    const mpdfSrc = document.createElement("canvas");
    try {
      bwipjs.toCanvas(mpdfSrc, {
        bcid: "micropdf417",
        text: serial,
        scale: BWIP_SCALE,
        columns: 4,
        // Always the derived count: auto would draw a different version for
        // the bumped and byte-mode cases and get stretched into the footprint.
        rows: mpdf.rows,
      } as unknown as Parameters<typeof bwipjs.toCanvas>[1]);
      ctx.drawImage(mpdfSrc, layout.mpdfX, layout.mpdfY, layout.mpdfPxW, layout.mpdfPxH);
    } catch {
      // Dims already succeeded; a draw failure leaves the Code 39 alone.
    }
  }
  return { canvas: composite, approximated };
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
): { canvas: HTMLCanvasElement | null; error: string | null; approximated?: boolean } {
  if (obj.type === "tlc39") {
    const r = renderTlc39Canvas(obj.props as Parameters<typeof renderTlc39Canvas>[0], scale, dpmm);
    return { canvas: r.canvas, error: r.canvas ? null : "TLC39 render failed", approximated: r.approximated };
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
  if (!opts) {
    // The options builder yields null for over-capacity ^BF content (the
    // firmware prints nothing there, ZD230-measured); surface that as an
    // encode error instead of a silent no-render.
    return {
      canvas: null,
      error: obj.type === "micropdf417" ? "content exceeds the ^BF mode capacity" : null,
    };
  }
  const canvas = document.createElement("canvas");
  try {
    bwipjs.toCanvas(canvas, opts as unknown as Parameters<typeof bwipjs.toCanvas>[1]);
    return { canvas, error: null };
  } catch (e) {
    const retry = bwipRetryOptions(opts);
    if (retry) {
      try {
        bwipjs.toCanvas(canvas, retry as unknown as Parameters<typeof bwipjs.toCanvas>[1]);
        // The micropdf417 retry draws a different symbol version squeezed
        // into the mode-true footprint; surface that (previewApproximate).
        // The Aztec fallback is the device's own auto growth, no flag.
        return { canvas, error: null, approximated: opts.bcid === "micropdf417" };
      } catch {
        // Report the primary failure; the retry is best-effort.
      }
    }
    return { canvas: null, error: cleanBwipError(e) };
  }
}

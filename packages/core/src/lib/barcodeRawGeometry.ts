/**
 * Pure bar geometry for symbologies where bwip-js encodes correctly but at
 * non-Zebra element widths (plessey, planet, postal). The bars are drawn
 * from bwip raw geometry remapped to ^BY module widths; all mappings are
 * pixel-verified against Labelary 8dpmm fixtures. No Canvas/React/bwip deps
 * so the browser renderer and the node visual-regression harness share it;
 * only the bwipjs.raw() call itself stays at the call site (browser vs node
 * build).
 */

import { PLESSEY_RATIO } from "../registry/plessey";

export interface RawBarRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ZebraWidthBarType = "plessey" | "planet" | "postal";

/** bwip bcid per type for the raw-geometry call. */
export const ZEBRA_WIDTH_BCID: Record<ZebraWidthBarType, string> = {
  plessey: "plessey",
  planet: "planet",
  postal: "postnet",
};

export const ZEBRA_WIDTH_BAR_TYPES: ReadonlySet<string> = new Set(
  Object.keys(ZEBRA_WIDTH_BCID),
);

/** Encode text per type: Plessey uppercases like firmware, PLANET strips to
 *  digits and pads to 11/13, POSTNET stays verbatim (bwip throws on
 *  non-digits, which is the encode error the preflight surfaces; stripping
 *  would silently encode a shorter symbol). */
export function zebraWidthBarText(type: ZebraWidthBarType, content: string): string {
  if (type === "plessey") return (content || "0").toUpperCase();
  if (type === "postal") return content || "0";
  let text = (content || "0").replace(/\D/g, "") || "0";
  if (text.length < 11) text = text.padStart(11, "0");
  else if (text.length === 12) text = text.padStart(13, "0");
  return text;
}

/** First entry of a bwipjs.raw() stack; absorbs the per-site double cast
 *  (the bwip import differs between browser build and node tests). */
export function firstRawEntry(stack: unknown): { sbs?: number[]; bhs?: number[] } {
  return (stack as { sbs?: number[]; bhs?: number[] }[] | undefined)?.[0] ?? {};
}

/** Bar rects for one raw stack entry; null when the entry lacks the
 *  geometry array (encode produced nothing usable). */
export function zebraWidthBarGeometry(
  type: ZebraWidthBarType,
  entry: { sbs?: number[]; bhs?: number[] },
  modulePx: number,
  heightPx: number,
): { rects: RawBarRect[]; width: number } | null {
  if (type === "plessey") {
    return entry.sbs ? plesseyBarRects(entry.sbs, PLESSEY_RATIO, modulePx, heightPx) : null;
  }
  return entry.bhs ? postalBarRects(entry.bhs, modulePx, heightPx) : null;
}

/** The shared rasterization step: one fillRect per bar, no seam (these bars
 *  are always separated by spaces, unlike the EAN guard composition). The
 *  caller sets fillStyle; the ctx shape fits browser and @napi-rs canvases. */
export function drawBarRects(
  ctx: { fillRect(x: number, y: number, w: number, h: number): void },
  rects: readonly RawBarRect[],
): void {
  for (const r of rects) ctx.fillRect(r.x, r.y, r.w, r.h);
}

/** BWIPP's hardcoded Plessey element widths (units) mapped to ^BY modules:
 *  narrow = 1, wide = ratio; the 5-unit bar is the terminator's merged
 *  wide+narrow. Covers the complete alphabet BWIPP emits (1/3/5 bars,
 *  2/4 spaces); an unmapped width means the upstream encoding changed. */
export function plesseyModuleRuns(sbs: readonly number[], ratio: number): number[] {
  return sbs.map((u, i) => {
    const m = i % 2 === 0
      ? (u === 1 ? 1 : u === 3 ? ratio : u === 5 ? ratio + 1 : undefined)
      : (u === 2 ? 1 : u === 4 ? ratio : undefined);
    if (m === undefined) throw new Error(`unmapped plessey element width ${u}`);
    return m;
  });
}

export function plesseyBarRects(
  sbs: readonly number[],
  ratio: number,
  modulePx: number,
  heightPx: number,
): { rects: RawBarRect[]; width: number } {
  const rects: RawBarRect[] = [];
  let x = 0;
  plesseyModuleRuns(sbs, ratio).forEach((m, i) => {
    const w = m * modulePx;
    if (i % 2 === 0) rects.push({ x, y: 0, w, h: heightPx });
    x += w;
  });
  return { rects, width: x };
}

/** Zebra ^BZ postal geometry (POSTNET/PLANET): bars one module wide on a
 *  2.5-module pitch; short bars are the bottom 40% of the height. */
export const POSTAL_PITCH_MODULES = 2.5;
export const POSTAL_SHORT_BAR_FRACTION = 0.4;

/** bwip raw `bhs` heights: tall entries are 0.125, short 0.05. */
export function postalTallFlags(bhs: readonly number[]): boolean[] {
  return bhs.map((v) => v >= 0.1);
}

export function postalBarRects(
  bhs: readonly number[],
  modulePx: number,
  heightPx: number,
): { rects: RawBarRect[]; width: number } {
  const pitch = POSTAL_PITCH_MODULES * modulePx;
  // Integer raster: at odd module scales the 2.5-module pitch lands on x.5,
  // which anti-aliases into blur. Rounding per bar (not the pitch) keeps the
  // grid drift-free (8/7 alternation); even module scales are unaffected.
  const shortH = Math.round(POSTAL_SHORT_BAR_FRACTION * heightPx);
  const rects = postalTallFlags(bhs).map((tall, i) => ({
    x: Math.round(i * pitch),
    y: tall ? 0 : heightPx - shortH,
    w: modulePx,
    h: tall ? heightPx : shortH,
  }));
  const width = bhs.length > 0 ? Math.round((bhs.length - 1) * pitch) + modulePx : 0;
  return { rects, width };
}

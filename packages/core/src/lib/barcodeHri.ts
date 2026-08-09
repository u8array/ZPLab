// Pure HRI text-zone resolution shared by the barcode renderer (getDisplaySize)
// and the group-rotation bbox probe, so zone height and side never drift apart.

import { isGs1Active, ObjectRegistry, type LeafObject } from "../registry";
import {
  EAN_TEXT_ZONE_DOTS,
  LOGMARS_TEXT_ZONE_DOTS,
  upcSuppTextZoneDots,
  EAN_UPC_TYPES,
  GS1_HRI_FONT_SCALE,
  GS1_HRI_WIDTH_RATIO,
  HRI_FONT_0,
  VERA_MONO_HRI_EM_PER_MODULE,
} from "./bwipConstants";
import { measureInkWidthPx } from "./labelGeometry/measureTextDots";

/** GS1-128 HRI font em (dots): the scaled-up base, shrunk to fit the bar width
 *  by measured advance so it matches the print whatever face we use. Falls back
 *  to the un-shrunk size when bars aren't measured yet (`barWidthDots <= 0`). */
export function gs1HriFontDots(
  content: string,
  baseFontDots: number,
  barWidthDots: number,
): number {
  const gs1Base = baseFontDots * GS1_HRI_FONT_SCALE;
  const naturalWidthDots = measureInkWidthPx(content, gs1Base, HRI_FONT_0);
  const targetDots = GS1_HRI_WIDTH_RATIO * barWidthDots;
  return barWidthDots > 0 && naturalWidthDots > targetDots
    ? (gs1Base * targetDots) / naturalWidthDots
    : gs1Base;
}

const TEXT_ZONE_DOTS_BY_TYPE: Partial<Record<string, number>> = {
  ean13: EAN_TEXT_ZONE_DOTS,
  ean8: EAN_TEXT_ZONE_DOTS,
  upca: EAN_TEXT_ZONE_DOTS,
  upce: EAN_TEXT_ZONE_DOTS,
  logmars: LOGMARS_TEXT_ZONE_DOTS,
};

/** Types whose interpretation line adds a module-scaled band, rather than the
 *  fixed zone EAN/UPC and logmars reserve. Pinned per type by barcodeHriZone. */
export const HRI_LINE_TYPES: ReadonlySet<string> = new Set([
  "code128",
  "code39",
  "code93",
  "code11",
  "interleaved2of5",
  "msi",
  "codabar",
  "industrial2of5",
  "standard2of5",
]);

/** HRI line height in dots, Labelary-measured at 6 and 8 dpmm over module
 *  widths 1-5: 7 per module plus 7, whatever font class the modulus selects
 *  (spec p.142). ZD230 verification still open. */
export function hriZoneDots(moduleWidth: number): number {
  return 7 * (Math.max(1, Math.round(moduleWidth)) + 1);
}

/** Firmware-reserved HRI text-zone height in dots. ^BS reserves it only when
 *  printInterpretation is on; other EAN/UPC reserve the fixed guard zone always;
 *  the rest reserve a module-scaled line, but only with the line turned on.
 *  `barWidthDots` is the measured bar width, which only the GS1 band below
 *  needs; omitting it over-reserves that band rather than under-reporting it. */
export function barcodeTextZoneDots(obj: LeafObject, barWidthDots = 0): number {
  const p = obj.props as { printInterpretation?: boolean; moduleWidth?: number };
  if (obj.type === "upcEanExtension") {
    return p.printInterpretation ? upcSuppTextZoneDots(p.moduleWidth ?? 2) : 0;
  }
  const fixed = TEXT_ZONE_DOTS_BY_TYPE[obj.type];
  if (fixed !== undefined) return fixed;
  const printsHri = HRI_LINE_TYPES.has(obj.type) && p.printInterpretation === true;
  if (!printsHri) return 0;
  const moduleWidth = p.moduleWidth ?? 2;
  return hriZoneDots(moduleWidth) * gs1ZoneScale(obj, moduleWidth, barWidthDots);
}

/** GS1-128 draws its interpretation line at gs1HriFontDots, up to
 *  GS1_HRI_FONT_SCALE of the plain em, so the plain band hriZoneDots measures is
 *  too short and the HRI runs outside the published bbox (the off-label bottom
 *  test and the overlap scan then under-report it). The band scales with the em,
 *  so scale it by the same ratio the renderer applies. Estimated, not measured:
 *  like hriZoneDots' own fit this still wants Labelary/ZD230 confirmation, and
 *  it deliberately errs long (a too-tall band over-reports, a too-short one
 *  hides ink running off the media). */
function gs1ZoneScale(obj: LeafObject, moduleWidth: number, barWidthDots: number): number {
  // The registry predicate, not a raw props read: a type that cannot carry GS1
  // must not scale its band off a stray flag.
  if (!isGs1Active(ObjectRegistry[obj.type], obj.props)) return 1;
  const hri = ObjectRegistry[obj.type]?.hri;
  const baseFontDots = hri?.fontDots
    ? hri.fontDots(moduleWidth)
    : moduleWidth * VERA_MONO_HRI_EM_PER_MODULE;
  if (baseFontDots <= 0) return 1;
  const content = (obj.props as { content?: string }).content ?? "";
  return gs1HriFontDots(content, baseFontDots, barWidthDots) / baseFontDots;
}

/** HRI sits above the bars when the per-object toggle is set or the symbology
 *  hardcodes it (logmars/^BS). Single source so render and bbox agree (PR #90). */
export function resolveHriAbove(obj: LeafObject): boolean {
  return !!(
    (obj.props as { printInterpretationAbove?: boolean }).printInterpretationAbove ||
    ObjectRegistry[obj.type]?.hri?.textAbove
  );
}

/** Side the zone trims from the bars. EAN/UPC keep their guard tails below the
 *  bars regardless of HRI position, so the zone never flips above for them. */
export function barcodeZoneAbove(obj: LeafObject): boolean {
  return resolveHriAbove(obj) && !EAN_UPC_TYPES.has(obj.type);
}

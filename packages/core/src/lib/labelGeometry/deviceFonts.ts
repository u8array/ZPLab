/**
 * Zebra bitmap device fonts (^A, ids A-H) render at discrete integer
 * magnifications of a fixed cell matrix; a requested height/width snaps to the
 * nearest magnification. The canvas substitutes PrintLab Mono / OCR-B / OCR-A
 * for these (PrintLab Mono shares Vera Mono's metrics bar three dash glyphs),
 * so we reproduce the snap and then size the substitute so its cap-ink height
 * and character advance match what Labelary prints.
 *
 * Sources:
 *   magStep / magWidthStep / advancePerMag  -> Zebra ZPL II font matrix
 *     (cell height, cell width, width + intercharacter gap).
 *   capInkPerMag                             -> Labelary-calibrated per font
 *     (measured for most, fitted where the matrix and render disagree, e.g. G).
 *   capPerEm / advPerEm                      -> measured on the bundled fonts.
 *
 * Font 0 is scalable and handled by the default proportional path, not here.
 */
import { mapLiteralSpans } from "../fnTemplate";

interface DeviceFontSpec {
  magStep: number; // cell height per magnification (dots)
  magWidthStep: number; // cell width per magnification (dots)
  advancePerMag: number; // char advance per magnification = cell width + gap
  capInkPerMag: number; // visible cap-ink height per magnification (Labelary)
  capPerEm: number; // substitute font cap-ink per em
  advPerEm: number; // substitute font advance per em
  // Labelary-calibrated canvas trims: the Font-0 em-anchor lands the
  // substitute's cap-top slightly off; these nudge it back (positive =
  // down / right). yOffEm is a fraction of fontSizeDots; xOffEm also scales
  // with scaleX because it cancels the substitute glyph's left side bearing,
  // which is horizontal geometry.
  yOffEm?: number;
  xOffEm?: number;
  // Glyph-shape width multiplier on scaleX: matches a single glyph's width to
  // Labelary (default 1). Separate from advance so we tune shape then spacing.
  widthCorr?: number;
  // Letter spacing (fraction of fontSizeDots) to restore the advance after a
  // widthCorr squish; positive loosens, negative tightens. Labelary-calibrated.
  letterSpacingEm?: number;
}

// Zebra caps device-font magnification at 10x the base cell.
const MAX_MAG = 10;

const DEVICE_FONTS: Record<string, DeviceFontSpec> = {
  A: { magStep: 9, magWidthStep: 5, advancePerMag: 6, capInkPerMag: 7.125, capPerEm: 0.757, advPerEm: 0.602, yOffEm: 0.036, xOffEm: -0.032, widthCorr: 0.964, letterSpacingEm: 0.021 },
  B: { magStep: 11, magWidthStep: 7, advancePerMag: 9, capInkPerMag: 11.5, capPerEm: 0.762, advPerEm: 0.602, xOffEm: -0.040 },
  C: { magStep: 18, magWidthStep: 10, advancePerMag: 12, capInkPerMag: 14.75, capPerEm: 0.757, advPerEm: 0.602, yOffEm: 0.026, xOffEm: -0.043 },
  D: { magStep: 18, magWidthStep: 10, advancePerMag: 12, capInkPerMag: 14.75, capPerEm: 0.757, advPerEm: 0.602, yOffEm: 0.026, xOffEm: -0.043 },
  E: { magStep: 28, magWidthStep: 15, advancePerMag: 20, capInkPerMag: 21.875, capPerEm: 0.787, advPerEm: 0.723, yOffEm: 0.198, xOffEm: -0.114 },
  F: { magStep: 26, magWidthStep: 13, advancePerMag: 16, capInkPerMag: 22, capPerEm: 0.757, advPerEm: 0.602, yOffEm: 0.034, xOffEm: -0.060 },
  G: { magStep: 60, magWidthStep: 40, advancePerMag: 48, capInkPerMag: 49, capPerEm: 0.757, advPerEm: 0.602, yOffEm: 0.025, widthCorr: 0.817, letterSpacingEm: 0.142 },
  H: { magStep: 21, magWidthStep: 13, advancePerMag: 19, capInkPerMag: 21, capPerEm: 0.780, advPerEm: 0.723, yOffEm: -0.030, xOffEm: -0.117 },
};

const magnify = (requested: number, step: number) =>
  Math.min(MAX_MAG, Math.max(1, Math.round(requested / step)));

/** Cell grid per device font. Exported so fixtures/tests derive their ^A
 *  heights from the same table the snap uses instead of copying it. */
export const DEVICE_FONT_CELLS: Readonly<
  Record<string, { magStep: number; magWidthStep: number }>
> = Object.fromEntries(
  Object.entries(DEVICE_FONTS).map(([id, s]) => [
    id,
    { magStep: s.magStep, magWidthStep: s.magWidthStep },
  ]),
);

/** Snapped magnifications for a bitmap font, or null for Font 0 / unknown
 *  ids / non-positive heights (magnify would otherwise clamp a negative to
 *  mag 1 or propagate NaN). Width 0 derives from the height mag. */
function deviceFontMags(
  fontId: string | undefined,
  heightDots: number,
  widthDots: number,
): { spec: DeviceFontSpec; magH: number; magW: number } | null {
  if (!fontId) return null;
  const spec = DEVICE_FONTS[fontId];
  if (!spec || !(heightDots > 0)) return null;
  const magH = magnify(heightDots, spec.magStep);
  const magW = widthDots > 0 ? magnify(widthDots, spec.magWidthStep) : magH;
  return { spec, magH, magW };
}

/** Deterministic field extent in dots for the ^FO anchor of rotated (I/B)
 *  bitmap fields: cells are monospaced, and Labelary measures the printed
 *  extent at n*advance - gap/2 within 2 dots across fonts. Null for
 *  Font 0 / unknown ids (measured PrintLab width applies there). */
export function deviceFontInkWidthDots(
  fontId: string | undefined,
  heightDots: number,
  widthDots: number,
  content: string,
): number | null {
  const mags = deviceFontMags(fontId, heightDots, widthDots);
  if (!mags) return null;
  const { spec, magW } = mags;
  const n = applyDeviceFontCase(fontId, content).length;
  if (n === 0) return 0;
  const gap = spec.advancePerMag - spec.magWidthStep;
  return magW * (n * spec.advancePerMag - gap / 2);
}

/** Snapped character-cell width (the effective ^A font width), or null
 *  for Font 0 / unknown ids. */
export function deviceFontSnappedWidthDots(
  fontId: string | undefined,
  heightDots: number,
  widthDots: number,
): number | null {
  const mags = deviceFontMags(fontId, heightDots, widthDots);
  return mags ? mags.magW * mags.spec.magWidthStep : null;
}

/** Requested ^A height snapped to the cell grid, or null for Font 0 /
 *  unknown ids / non-positive heights. The firmware anchors a bitmap field
 *  by its snapped cell, so the anchor transform needs this too. */
export function deviceFontSnappedHeightDots(
  fontId: string | undefined,
  heightDots: number,
): number | null {
  const mags = deviceFontMags(fontId, heightDots, 0);
  return mags ? mags.magH * mags.spec.magStep : null;
}

/** The height the firmware actually uses for a text field: bitmap device
 *  fonts snap to their cell grid, everything else keeps the requested
 *  height. Feeds the anchor shift and the block line pitch, which Labelary
 *  both measures at the snapped cell. */
export function effectiveFontHeightDots(
  fontId: string | undefined,
  heightDots: number,
): number {
  return deviceFontSnappedHeightDots(fontId, heightDots) ?? heightDots;
}

// Zebra fonts B and H (OCR-A) have no lowercase glyphs: B prints uppercase,
// H drops lowercase entirely (so "Text" -> "T"). Mirror that on the canvas.
const DEVICE_FONT_CASE: Record<string, "upper" | "stripLower"> = {
  B: "upper",
  H: "stripLower",
};

/** Apply a device font's case behaviour to display text, leaving «marker»
 *  segments untouched. No-op for fonts that keep lowercase. */
export function applyDeviceFontCase(
  fontId: string | undefined,
  text: string,
): string {
  const mode = fontId ? DEVICE_FONT_CASE[fontId] : undefined;
  if (!mode) return text;
  return mapLiteralSpans(text, (seg) =>
    mode === "upper" ? seg.toUpperCase() : seg.replace(/[a-z]/g, ""),
  );
}

export interface DeviceFontMetrics {
  /** CSS font size in dots so the substitute renders the snapped cap-ink. */
  fontSizeDots: number;
  /** Horizontal scale so the substitute advance matches the snapped cell. */
  scaleX: number;
  /** Canvas position nudge in dots (down+, right+) to match Labelary. */
  yOffsetDots: number;
  xOffsetDots: number;
  /** Inter-char spacing in dots (positive loosens, negative tightens). */
  letterSpacingDots: number;
}

/** Resolve canvas size + horizontal scale for a built-in bitmap font, or null
 *  for Font 0 / non-device ids (handled by the default scalable path). */
export function deviceFontMetrics(
  fontId: string | undefined,
  heightDots: number,
  widthDots: number,
): DeviceFontMetrics | null {
  const mags = deviceFontMags(fontId, heightDots, widthDots);
  if (!mags) return null;
  const { spec, magH, magW } = mags;
  const fontSizeDots = (magH * spec.capInkPerMag) / spec.capPerEm;
  const scaleX =
    ((magW * spec.advancePerMag) / (fontSizeDots * spec.advPerEm)) *
    (spec.widthCorr ?? 1);
  return {
    fontSizeDots,
    scaleX,
    yOffsetDots: (spec.yOffEm ?? 0) * fontSizeDots,
    xOffsetDots: (spec.xOffEm ?? 0) * fontSizeDots * scaleX,
    letterSpacingDots: (spec.letterSpacingEm ?? 0) * fontSizeDots,
  };
}

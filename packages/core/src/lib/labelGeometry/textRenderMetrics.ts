import { builtinFontFamily, resolveDeviceFontId, resolvePreviewFontName } from "../customFonts";
import { applyDeviceFontCase, deviceFontInkWidthDots, deviceFontMetrics } from "./deviceFonts";
import { getFontFamily } from "../fontCache";
import type { LabelObject } from "../../types/Group";
import type { LabelConfig } from "../../types/LabelConfig";
import { measureInkWidthPx } from "./measureTextDots";
import { ZPL_FONT_HEIGHT_TO_CSS_RATIO } from "./textPositionTransforms";

/** Shared by renderer, resize commit, emit, parser; inkWidth drift would
 *  desync FO/I and FO/B rotations on round-trip. */
export interface TextRenderMetrics {
  content: string;
  fontFamily: string;
  fontScaleX: number;
  inkWidthDots: number;
  /** Canvas-only: explicit CSS size in dots for bitmap device fonts (A-H),
   *  which snap to discrete magnifications. Undefined for the scalable path. */
  fontSizeDots?: number;
  /** Canvas-only device-font position nudge in dots (down+, right+). */
  yOffsetDots?: number;
  xOffsetDots?: number;
  /** Canvas-only device-font inter-char spacing in dots (positive loosens). */
  letterSpacingDots?: number;
  /** Canvas-only resolved bitmap device font (A-H); single source for
   *  consumers that need the id beside the metrics (line pitch, bounds). */
  deviceFontId?: string;
}

/** Parser feeds these (no obj at parse time). */
export interface TextMetricsInput {
  content: string;
  fontHeight: number;
  fontWidth: number;
  printerFontName?: string;
  /** Canvas-only ^CW/^CF fallback; not passed by emit/parser. */
  defaultPrinterFontName?: string;
  /** Canvas-only built-in device-font face (A-H); custom uploads win over it.
   *  Omitted by emit/parser so the round-trip stays PrintLab-based. */
  fontFamilyOverride?: string;
  /** Canvas-only bitmap device-font size/scale (A-H snap to magnifications). */
  fontSizeDots?: number;
  scaleXOverride?: number;
  /** Canvas-only: device fonts paint at this weight, so inkWidth must measure
   *  it too (emit/parse omit it and keep the default bold). */
  measureFontStyle?: string;
  /** Canvas-only device-font inter-char spacing folded into inkWidth so the
   *  reverse-box / ^FPR width matches the letter-spaced render. */
  letterSpacingDots?: number;
}

const DEFAULT_FONT_FAMILY = "'PrintLab ZPL', sans-serif";

export function computeTextRenderMetrics(input: TextMetricsInput): TextRenderMetrics {
  const { content, fontHeight, fontWidth, printerFontName, defaultPrinterFontName } = input;
  const effectiveFontName = printerFontName || defaultPrinterFontName;
  const fontFamily =
    input.fontFamilyOverride ??
    (effectiveFontName
      ? (getFontFamily(effectiveFontName) ?? DEFAULT_FONT_FAMILY)
      : DEFAULT_FONT_FAMILY);
  const fontScaleX =
    input.scaleXOverride ?? (fontWidth > 0 ? fontWidth / fontHeight : 1);
  const measureSizeDots =
    input.fontSizeDots ?? fontHeight / ZPL_FONT_HEIGHT_TO_CSS_RATIO;
  const glyphWidthDots = measureInkWidthPx(
    content,
    measureSizeDots,
    fontFamily,
    input.measureFontStyle,
  );
  const spacingDots =
    (input.letterSpacingDots ?? 0) * Math.max(0, content.length - 1);
  const inkWidthDots = (glyphWidthDots + spacingDots) * fontScaleX;
  return { content, fontFamily, fontScaleX, inkWidthDots, fontSizeDots: input.fontSizeDots };
}

/** Ink extent feeding the FO/I and FO/B anchor shift: cell grid for bitmap
 *  device fonts, measured PrintLab width otherwise. The single derivation
 *  shared by emit and parse; one-sided drift breaks byte-exact round-trips
 *  for rotated fields. */
export function anchorInkWidthDots(input: {
  fontId: string | undefined;
  content: string;
  fontHeight: number;
  fontWidth: number;
  printerFontName?: string;
}): number {
  const cellGrid = deviceFontInkWidthDots(
    input.fontId,
    input.fontHeight,
    input.fontWidth,
    input.content,
  );
  if (cellGrid !== null) return cellGrid;
  return computeTextRenderMetrics({
    content: input.content,
    fontHeight: input.fontHeight,
    fontWidth: input.fontWidth,
    printerFontName: input.printerFontName,
  }).inkWidthDots;
}

/** Canvas-only preview font priority: fontId -> printerFontName -> defaultFontId.
 *  Emit/parse omit `label` so round-trip stays PrintLab-based. */
export function getTextRenderMetrics(
  obj: LabelObject,
  fontHeightOverride?: number,
  label?: Pick<LabelConfig, "customFonts" | "defaultFontId">,
): TextRenderMetrics | null {
  if (obj.type !== "text") return null;
  const p = obj.props;
  const fieldFontId = obj.props.fontId;
  const fieldPrinterFontName = obj.props.printerFontName;
  const customName = label
    ? resolvePreviewFontName(label, fieldFontId)
    : undefined;
  const printerFontName = customName ?? fieldPrinterFontName;
  const defaultPrinterFontName = label
    ? resolvePreviewFontName(label, label.defaultFontId)
    : undefined;
  // Canvas-only: gated on `label` so the emit/parse path keeps PrintLab
  // metrics and the round-trip inkWidth matches.
  const deviceId = label
    ? resolveDeviceFontId(fieldFontId, fieldPrinterFontName, label)
    : undefined;
  const fontFamilyOverride = deviceId ? builtinFontFamily(deviceId) : undefined;
  const fontHeight = fontHeightOverride ?? p.fontHeight;
  const device = deviceFontMetrics(deviceId, fontHeight, p.fontWidth);
  return {
    ...computeTextRenderMetrics({
      content: applyDeviceFontCase(deviceId, p.content),
      fontHeight,
      fontWidth: p.fontWidth,
      printerFontName,
      defaultPrinterFontName,
      fontFamilyOverride,
      fontSizeDots: device?.fontSizeDots,
      scaleXOverride: device?.scaleX,
      measureFontStyle: device ? "normal" : undefined,
      letterSpacingDots: device?.letterSpacingDots,
    }),
    yOffsetDots: device?.yOffsetDots,
    xOffsetDots: device?.xOffsetDots,
    letterSpacingDots: device?.letterSpacingDots,
    deviceFontId: deviceId,
  };
}

// ^FB alignment math: Konva's text measurement drifts from Zebra A0;
// compute against fixed advance to match Labelary.

import { dotsToPx, pxToDots } from "./coordinates";
import { applyDeviceFontCase, deviceFontInkWidthDots, deviceFontSnappedHeightDots, deviceFontSnappedWidthDots, effectiveFontHeightDots } from "./labelGeometry/deviceFonts";
import { EM_TOP_ABOVE_CAP } from "./labelGeometry/textPositionTransforms";
import { isAxisSwapped, type ZplRotation } from "../registry/rotation";

export type BlockJustify = "L" | "C" | "R" | "J";

/** A0 default 9x5 dot matrix; fontWidth=0 advances by h*5/9. */
const A0_DEFAULT_ASPECT = 5 / 9;

/** Per-character advance ratios for Font 0 (CG Triumvirate Bold Condensed)
 *  in fontHeight-units. Calibrated empirically against Labelary so right /
 *  center justify lands at the same pixel as the firmware print, where a
 *  uniform 5/9 cell drifts off by 1-2 px on mixed content. Characters not
 *  in the table fall back to the uniform A0 advance. */
const A0_CHAR_ADVANCE: Record<string, number> = {
  '0': 0.48, '1': 0.48, '2': 0.48, '3': 0.48, '4': 0.48,
  '5': 0.48, '6': 0.48, '7': 0.48, '8': 0.48, '9': 0.48,
  '@': 0.90, '*': 0.48, '$': 0.48, '#': 0.48,
  '!': 0.295, '(': 0.295, ')': 0.295, '.': 0.295, ',': 0.295,
  '/': 0.295, '`': 0.295, ';': 0.295, ':': 0.295, "'": 0.296,
  '[': 0.295, ']': 0.295, ' ': 0.295,
  '&': 0.61, '%': 0.903, '+': 0.905, '=': 0.905,
  '<': 1, '>': 1,
  '?': 0.441, '"': 0.481, '-': 0.5, '_': 0.5,
  A: 0.555, B: 0.555, C: 0.535, D: 0.59, E: 0.5,
  F: 0.5, G: 0.59, H: 0.6101, I: 0.277, J: 0.445,
  K: 0.555, L: 0.481, M: 0.755, N: 0.6083, O: 0.57,
  P: 0.555, Q: 0.57, R: 0.59, S: 0.535, T: 0.5,
  U: 0.609, V: 0.535, W: 0.812, X: 0.555, Y: 0.555, Z: 0.498,
  a: 0.461, b: 0.497, c: 0.442, d: 0.497, e: 0.461,
  f: 0.275, g: 0.497, h: 0.497, i: 0.258, j: 0.259,
  k: 0.444, l: 0.2585, m: 0.754, n: 0.498, o: 0.48,
  p: 0.498, q: 0.498, r: 0.333, s: 0.424, t: 0.276,
  u: 0.498, v: 0.442, w: 0.668, x: 0.442, y: 0.444, z: 0.387,
};

export function zebraGlyphAdvanceDots(fontHeight: number, fontWidth: number): number {
  return fontWidth > 0 ? fontWidth : fontHeight * A0_DEFAULT_ASPECT;
}

/** True when a text field prints no glyphs: blank content, or content a
 *  device font's case folding drops entirely (font H strips lowercase).
 *  The one blank decision canvas, bounds and preflight share. */
export function isPrintedBlank(content: string, deviceFontId?: string): boolean {
  return isBlankText(applyDeviceFontCase(deviceFontId, content));
}

/** Line width in the basis the firmware advances: device cells for A-H,
 *  the Font-0 table otherwise. Shared by preflight and the block panel so
 *  their wrap estimate cannot diverge. */
export function blockLineWidthDots(
  line: string,
  fontHeight: number,
  fontWidth: number,
  deviceFontId?: string,
): number {
  return (
    deviceFontInkWidthDots(deviceFontId, fontHeight, fontWidth, line) ??
    zebraLineWidthDots(line, fontHeight, fontWidth)
  );
}

/** ^FB slot a: spec (p.186) says text below the font width does not
 *  print; Labelary in practice wraps per char and still prints, so this
 *  is the shared warning threshold (preflight, panel, canvas), not a
 *  print guarantee. */
export function isBlockTooNarrow(
  blockWidthDots: number,
  fontHeight: number,
  fontWidth: number,
  deviceFontId?: string,
): boolean {
  return (
    blockWidthDots > 0 &&
    blockWidthDots < blockGlyphCellDots(fontHeight, fontWidth, deviceFontId)
  );
}

/** The effective font width (spec's ^FB slot-a threshold): the snapped
 *  cell width for device fonts, else the Font-0 advance. */
export function blockGlyphCellDots(
  fontHeight: number,
  fontWidth: number,
  deviceFontId?: string,
): number {
  return (
    deviceFontSnappedWidthDots(deviceFontId, fontHeight, fontWidth) ??
    zebraGlyphAdvanceDots(fontHeight, fontWidth)
  );
}

/** Display-space positions of each word inside one justify=J line. Caller
 *  passes the line's `startDots` (from blockLineStartDots), the extra gap
 *  (from zebraJustifyGapDots), and per-glyph advance metrics. Returns one
 *  entry per word in source order. */
export function blockJustifyWordPositions(args: {
  words: string[];
  rotation: ZplRotation;
  startDots: { x: number; y: number };
  fontHeight: number;
  fontWidth: number;
  extraGapDots: number;
  /** Word advance in dots; pass the same basis the caller used for the line
   *  width so justified words don't drift on scaled / device fonts. Defaults
   *  to the Font-0 advance table. */
  wordWidthDots?: (word: string) => number;
  /** Single-space advance in dots; pass the same basis as wordWidthDots so the
   *  justified line ends exactly at the block width instead of overshooting by
   *  the gap between the uniform cell and the measured space. Defaults to the
   *  uniform A0 cell (correct for monospaced fonts). */
  spaceWidthDots?: number;
}): { x: number; y: number; text: string }[] {
  const spaceAdvance =
    args.spaceWidthDots ?? zebraGlyphAdvanceDots(args.fontHeight, args.fontWidth);
  const wordWidth =
    args.wordWidthDots ??
    ((w: string) => zebraLineWidthDots(w, args.fontHeight, args.fontWidth));
  let cursorAdv = 0;
  return args.words.map((word) => {
    const adv = blockWordAdvanceDots(args.rotation, cursorAdv);
    const pos = { x: args.startDots.x + adv.dx, y: args.startDots.y + adv.dy, text: word };
    cursorAdv += wordWidth(word) + spaceAdvance + args.extraGapDots;
    return pos;
  });
}

/** ^FB FT-anchor offset: inter-line dots above the last baseline, i.e.
 *  `(blockLines - 1) * lineStep`. Returns 0 when no block is configured. */
export function blockInterLineExtentDots(args: {
  blockWidthDots: number;
  blockLines: number;
  blockLineSpacing: number;
  fontHeight: number;
  deviceFontId?: string;
}): number {
  if (args.blockWidthDots <= 0) return 0;
  return Math.max(
    0,
    (args.blockLines - 1) * blockLineStepDots(args.fontHeight, args.blockLineSpacing, args.deviceFontId),
  );
}

/** Anchor extent of a ^TB field beyond its first line. The firmware pins
 *  the block box at the anchor (bottom edge under FT) and lays the first
 *  line out at the block top exactly like an ^FO field, for Font 0 and
 *  the bitmap fonts alike (Labelary-measured). */
export function tbBlockExtentDots(
  blockHeightDots: number,
  fontHeight: number,
  deviceFontId?: string,
): number {
  const effH = effectiveFontHeightDots(deviceFontId, fontHeight);
  return Math.max(0, blockHeightDots - effH * (1 - EM_TOP_ABOVE_CAP));
}

/** Anchor extent of a block beyond its first line, ^TB or ^FB. The single
 *  tb-vs-fb dispatch shared by generator, parser and the box-match gate;
 *  a one-sided change here shifts anchors silently. tbHeightDots > 0
 *  selects ^TB (the parser's native signal: ^TB is stream state, not a
 *  stored mode). */
export function blockAnchorExtentDots(args: {
  tbHeightDots: number;
  blockWidthDots: number;
  blockLines: number;
  blockLineSpacing: number;
  fontHeight: number;
  deviceFontId?: string;
}): number {
  if (args.tbHeightDots > 0) {
    return tbBlockExtentDots(args.tbHeightDots, args.fontHeight, args.deviceFontId);
  }
  return blockInterLineExtentDots(args);
}

// ZplRotation's single source is registry/rotation; re-exported here for the
// consumers that import it alongside this module's layout helpers.
export type { ZplRotation };

/** Anchor to visual-top-left shift for a rotated single line: the renderer
 *  rotates the node about obj.x/obj.y, so R/I/B move the AABB off the anchor.
 *  Takes the already-rotated footprint. Shared by objectBounds (text bbox) and
 *  the reverse-text ^GB so the box sits on the same footprint the render uses. */
export function rotatedLineOffset(
  rotation: ZplRotation,
  fpWidth: number,
  fpHeight: number,
): { x: number; y: number } {
  switch (rotation) {
    case "R": return { x: -fpWidth, y: 0 };
    case "I": return { x: -fpWidth, y: -fpHeight };
    case "B": return { x: 0, y: -fpHeight };
    case "N":
    default: return { x: 0, y: 0 };
  }
}

const neg = (v: number) => (v === 0 ? 0 : -v);

/** Display-space start of line `lineIndex` inside a per-Text rotated
 *  ^FB block. Per-Text rotation rotates each Text around its own (x, y),
 *  so the offsets must be expressed in display coords. `perpDots` covers
 *  indent + align perpendicular to the line-stacking axis. */
export function blockLineStartDots(
  lineIndex: number,
  rotation: ZplRotation,
  perpDots: number,
  lineStepDots: number,
): { x: number; y: number } {
  const step = lineIndex * lineStepDots;
  switch (rotation) {
    case "N": return { x: perpDots, y: step };
    case "R": return { x: neg(step), y: perpDots };
    case "I": return { x: neg(perpDots), y: neg(step) };
    case "B": return { x: step, y: neg(perpDots) };
  }
}

/** Per-word display-space advance along the line's reading direction
 *  for justify=J word-gap stretch. Mirrors `blockLineStartDots` axis
 *  selection. */
export function blockWordAdvanceDots(
  rotation: ZplRotation,
  advanceDots: number,
): { dx: number; dy: number } {
  switch (rotation) {
    case "N": return { dx: advanceDots, dy: 0 };
    case "R": return { dx: 0, dy: advanceDots };
    case "I": return { dx: -advanceDots, dy: 0 };
    case "B": return { dx: 0, dy: -advanceDots };
  }
}

export function zebraLineWidthDots(
  line: string,
  fontHeight: number,
  fontWidth: number,
): number {
  // Explicit fontWidth: ^A0 with non-zero w is a monospaced cell.
  if (fontWidth > 0) return line.length * fontWidth;
  // Proportional A0: sum per-char advance ratios (calibrated table) so
  // right / center justify lines up with Labelary instead of drifting.
  const fallback = fontHeight * A0_DEFAULT_ASPECT;
  let total = 0;
  for (const c of line) {
    const ratio = A0_CHAR_ADVANCE[c];
    total += ratio !== undefined ? ratio * fontHeight : fallback;
  }
  return total;
}

/** Canvas-only ^FB wrap: honour hard `\n` breaks, then greedy word-wrap each
 *  segment to the block width, char-breaking overlong words. `lineWidthDots`
 *  must measure in the SAME dots the block width uses (caller passes a
 *  rendered-glyph measure) so the wrap matches the preview on scaled / device
 *  fonts. Render-only: never mutates stored content; soft hyphens are dropped. */
export function wrapBlockLines(
  content: string,
  blockWidthDots: number,
  lineWidthDots: (line: string) => number,
): string[] {
  if (blockWidthDots <= 0) return content.replace(/\u00AD/g, "").split("\n");
  const fits = (s: string) => lineWidthDots(s) <= blockWidthDots;
  const out: string[] = [];
  for (const segment of content.split("\n")) {
    const words = segment.replace(/\u00AD/g, "").split(" ").filter((w) => w !== "");
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line === "" ? word : `${line} ${word}`;
      if (line !== "" && !fits(candidate)) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
      // A lone word wider than the block breaks at the character, with no
      // hyphen: the Zebra spec describes an auto-hyphen but Labelary breaks
      // clean, and Labelary is the fidelity target. Do not "fix" this.
      while (!fits(line) && line.length > 1) {
        let n = 1;
        while (n < line.length && fits(line.slice(0, n + 1))) n++;
        out.push(line.slice(0, n));
        line = line.slice(n);
      }
    }
    out.push(line);
  }
  return out;
}

/** L/J start at left; J inner-stretch not visualised. Labelary centers as if
 *  each line carries one trailing space, so a centered line sits half a
 *  space-width left of the geometric center; R/L trim it, so only C shifts. */
export function zebraAlignOffsetDots(
  lineWidthDots: number,
  blockWidthDots: number,
  justify: BlockJustify,
  spaceWidthDots = 0,
): number {
  if (justify === "C")
    return Math.max(0, (blockWidthDots - lineWidthDots - spaceWidthDots) / 2);
  if (justify === "R") return Math.max(0, blockWidthDots - lineWidthDots);
  return 0;
}

/** ^FB slot e: indent lines 2+; line 1 stays flush with the block. */
export function zebraHangingIndentOffsetDots(
  lineIndex: number,
  hangingIndentDots: number,
): number {
  return lineIndex > 0 ? hangingIndentDots : 0;
}

/** ^FB justify=J extra dots per word-gap. Returns 0 on the last line
 *  and on single-word lines (spec: last line left-aligned). */
export function zebraJustifyGapDots(
  lineWidthDots: number,
  blockWidthDots: number,
  wordGapCount: number,
  isLastLine: boolean,
): number {
  if (isLastLine || wordGapCount <= 0) return 0;
  const extra = blockWidthDots - lineWidthDots;
  return extra > 0 ? extra / wordGapCount : 0;
}

/** (n-1) steps plus the last line's own cell: the trailing inter-line
 *  gap doesn't render. */
const stackDots = (lines: number, stepDots: number, lastLineDots: number) =>
  Math.max(0, lines - 1) * stepDots + lastLineDots;

/** Vertical span of n stacked ^FB lines. */
export function blockStackHeightDots(
  lines: number,
  fontHeight: number,
  blockLineSpacing: number,
  deviceFontId?: string,
): number {
  return stackDots(
    lines,
    blockLineStepDots(fontHeight, blockLineSpacing, deviceFontId),
    effectiveFontHeightDots(deviceFontId, fontHeight),
  );
}

/** Vertical span of n wrapped ^TB lines; ^TB steps by its own pitch. */
export function tbStackHeightDots(
  lines: number,
  fontHeight: number,
  deviceFontId?: string,
): number {
  return stackDots(
    lines,
    tbLineStepDots(fontHeight, deviceFontId),
    effectiveFontHeightDots(deviceFontId, fontHeight),
  );
}

/** Inverse of {@link blockStackHeightDots}: how many lines a given stack
 *  height holds. */
export function blockLinesForHeightDots(
  heightDots: number,
  fontHeight: number,
  blockLineSpacing: number,
  deviceFontId?: string,
): number {
  const step = blockLineStepDots(fontHeight, blockLineSpacing, deviceFontId);
  return Math.max(1, Math.round((heightDots + blockLineSpacing) / step));
}

/** Firmware line pitch: device fonts stack by the snapped cell height
 *  (Labelary-measured), Font 0 by the requested height. */
export function blockLineStepDots(
  fontHeight: number,
  blockLineSpacing: number,
  deviceFontId?: string,
): number {
  return effectiveFontHeightDots(deviceFontId, fontHeight) + blockLineSpacing;
}

/** Width of the empty single-line text placeholder, in fontHeight multiples.
 *  Shared by the canvas placeholder rect and objectBounds so the selection
 *  chrome (action bar, align, snap) centers on what is actually drawn. */
export const EMPTY_TEXT_PLACEHOLDER_GLYPHS = 4;

/** A field with no printable content: the canvas draws the placeholder rect and
 *  emit writes an empty ^FD. Single source for the render / bounds / measured
 *  gate so they can't drift on what counts as blank (whitespace trims away). */
export function isBlankText(content: string): boolean {
  return content.trim() === "";
}

/** ^TB line pitch ratio. Unlike ^FB (pitch = fontHeight), ^TB spaces lines at
 *  ~1.25x fontHeight (calibrated against Labelary for the default font). */
export const TB_LINE_HEIGHT_RATIO = 1.25;

/** Device fonts wrap ^TB lines at exactly the snapped cell height
 *  (Labelary-measured); the ratio is the Font-0 path. */
export function tbLineStepDots(fontHeight: number, deviceFontId?: string): number {
  return (
    deviceFontSnappedHeightDots(deviceFontId, fontHeight) ?? fontHeight * TB_LINE_HEIGHT_RATIO
  );
}

/** FB block bbox in Group-local display coords. Rotates with the
 *  block-line-stack direction so the Transformer covers visible glyphs
 *  rather than the unrotated layout footprint. */
export function blockBoundsDots(args: {
  blockWidthDots: number;
  blockLines: number;
  blockLineSpacing: number;
  fontHeight: number;
  rotation?: ZplRotation;
  deviceFontId?: string;
}): { x: number; y: number; width: number; height: number } {
  const blockWidth = args.blockWidthDots;
  const linesExtent =
    args.blockLines > 0
      ? blockStackHeightDots(args.blockLines, args.fontHeight, args.blockLineSpacing, args.deviceFontId)
      : 0;
  switch (args.rotation ?? "N") {
    case "N": return { x: 0,           y: 0,           width: blockWidth,  height: linesExtent };
    case "R": return { x: -linesExtent, y: 0,           width: linesExtent, height: blockWidth };
    case "I": return { x: -blockWidth, y: -linesExtent, width: blockWidth,  height: linesExtent };
    case "B": return { x: 0,           y: -blockWidth, width: linesExtent, height: blockWidth };
  }
}

/** ^TB clip rect in Group-local display coords. The block is width x height
 *  (height is the truncation clip, not a line count); at 90deg rotations the
 *  rotated rect stays axis-aligned, so an AABB suffices. */
export function tbBoundsDots(
  blockWidthDots: number,
  blockHeightDots: number,
  rotation: ZplRotation,
): { x: number; y: number; width: number; height: number } {
  const w = blockWidthDots;
  const h = blockHeightDots;
  switch (rotation) {
    case "N": return { x: 0,   y: 0,   width: w, height: h };
    case "R": return { x: -h,  y: 0,   width: h, height: w };
    case "I": return { x: -w,  y: -h,  width: w, height: h };
    case "B": return { x: 0,   y: -w,  width: h, height: w };
  }
}

/** Frame-mode ^FB live-resize math: convert the group scale into new
 *  blockWidth / blockLines, then pin the anchored screen edge (opposite the
 *  dragged one) so it stays put. Pure so the rotation axis-swap and edge-pin,
 *  the coordinate-bug-prone parts, are testable apart from Konva. `*X`/`*Y` are
 *  the block bbox edges in stage px captured at drag start. */
export function blockReflowGeometry(args: {
  scaleX: number;
  scaleY: number;
  rotation: ZplRotation;
  blockWidthDots: number;
  blockLines: number;
  blockLineSpacing: number;
  fontHeight: number;
  deviceFontId?: string;
  /** Which screen edge the user is dragging; the opposite edge is pinned. */
  activeLeft: boolean;
  activeTop: boolean;
  leftX: number;
  topY: number;
  rightX: number;
  bottomY: number;
  scale: number;
  dpmm: number;
  objectsOffsetX: number;
  labelOffsetY: number;
}): {
  blockWidthDots: number;
  blockLines: number;
  targetXPx: number;
  targetYPx: number;
  modelXDots: number;
  modelYDots: number;
} {
  // R/B read rotated 90deg, so screen X drives blockLines and Y drives
  // blockWidth; swap the scales to the block's own axes.
  const swap = isAxisSwapped(args.rotation);
  const esx = swap ? args.scaleY : args.scaleX;
  const esy = swap ? args.scaleX : args.scaleY;
  const blockWidthDots = Math.max(1, Math.round(args.blockWidthDots * esx));
  const blockLines = Math.max(1, Math.round(args.blockLines * esy));
  const b = blockBoundsDots({
    blockWidthDots,
    blockLines,
    blockLineSpacing: args.blockLineSpacing,
    fontHeight: args.fontHeight,
    deviceFontId: args.deviceFontId,
    rotation: args.rotation,
  });
  const bxPx = dotsToPx(b.x, args.scale, args.dpmm);
  const byPx = dotsToPx(b.y, args.scale, args.dpmm);
  const bwPx = dotsToPx(b.width, args.scale, args.dpmm);
  const bhPx = dotsToPx(b.height, args.scale, args.dpmm);
  const targetXPx = args.activeLeft ? args.rightX - bxPx - bwPx : args.leftX - bxPx;
  const targetYPx = args.activeTop ? args.bottomY - byPx - bhPx : args.topY - byPx;
  return {
    blockWidthDots,
    blockLines,
    targetXPx,
    targetYPx,
    modelXDots: pxToDots(targetXPx - args.objectsOffsetX, args.scale, args.dpmm),
    modelYDots: pxToDots(targetYPx - args.labelOffsetY, args.scale, args.dpmm),
  };
}

/** Frame-mode ^TB live-resize math: like blockReflowGeometry but the second
 *  axis is the clip height in dots, not a line count. Keeps glyphs constant so
 *  the box reflows during the drag instead of stretching the text. */
export function tbReflowGeometry(args: {
  scaleX: number;
  scaleY: number;
  rotation: ZplRotation;
  blockWidthDots: number;
  blockHeightDots: number;
  activeLeft: boolean;
  activeTop: boolean;
  leftX: number;
  topY: number;
  rightX: number;
  bottomY: number;
  scale: number;
  dpmm: number;
  objectsOffsetX: number;
  labelOffsetY: number;
}): {
  blockWidthDots: number;
  blockHeightDots: number;
  targetXPx: number;
  targetYPx: number;
  modelXDots: number;
  modelYDots: number;
} {
  const swap = isAxisSwapped(args.rotation);
  const esx = swap ? args.scaleY : args.scaleX;
  const esy = swap ? args.scaleX : args.scaleY;
  const blockWidthDots = Math.max(1, Math.round(args.blockWidthDots * esx));
  const blockHeightDots = Math.max(1, Math.round(args.blockHeightDots * esy));
  const b = tbBoundsDots(blockWidthDots, blockHeightDots, args.rotation);
  const bxPx = dotsToPx(b.x, args.scale, args.dpmm);
  const byPx = dotsToPx(b.y, args.scale, args.dpmm);
  const bwPx = dotsToPx(b.width, args.scale, args.dpmm);
  const bhPx = dotsToPx(b.height, args.scale, args.dpmm);
  const targetXPx = args.activeLeft ? args.rightX - bxPx - bwPx : args.leftX - bxPx;
  const targetYPx = args.activeTop ? args.bottomY - byPx - bhPx : args.topY - byPx;
  return {
    blockWidthDots,
    blockHeightDots,
    targetXPx,
    targetYPx,
    modelXDots: pxToDots(targetXPx - args.objectsOffsetX, args.scale, args.dpmm),
    modelYDots: pxToDots(targetYPx - args.labelOffsetY, args.scale, args.dpmm),
  };
}

/** Stage point that stays fixed when a glyph-mode ^FB block re-bakes its font.
 *  Advance and stacking axes swap between screen X/Y with rotation, so the pin
 *  resolves per rotation. `edges` are screen-space flags (not rotated).
 *  `centeredStacking` mirrors the Konva centeredScaling the preview used: it
 *  pins the stacking center too, else preview and commit jump on release. */
export function blockGlyphAnchorPoint(args: {
  rect: { x: number; y: number; width: number; height: number };
  rotation: ZplRotation;
  justify: BlockJustify;
  edges: { top: boolean; left: boolean } | null;
  centeredStacking: boolean;
}): { x: number; y: number } {
  const { rect, rotation, justify, edges, centeredStacking } = args;
  const advanceVertical = isAxisSwapped(rotation);
  const advancePositive = rotation === "N" || rotation === "R";
  // J fills the body but left-aligns its last line, so it anchors like L (start).
  const justifyFrac = justify === "C" ? 0.5 : justify === "R" ? 1 : 0;
  const advFrac = advancePositive ? justifyFrac : 1 - justifyFrac;
  const stackCoord = (min: number, size: number, draggedAtStart: boolean) =>
    centeredStacking ? min + size / 2 : draggedAtStart ? min + size : min;
  if (advanceVertical) {
    return {
      x: stackCoord(rect.x, rect.width, !!edges?.left),
      y: rect.y + rect.height * advFrac,
    };
  }
  return {
    x: rect.x + rect.width * advFrac,
    y: stackCoord(rect.y, rect.height, !!edges?.top),
  };
}

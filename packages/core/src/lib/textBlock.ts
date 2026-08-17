import type { TextProps } from "../registry/text";
import { blockLineWidthDots, wrapBlockLines } from "./zebraTextLayout";

/** Shared between manual Tekstblok checkbox and auto-activation. */
export const FB_DEFAULTS = {
  blockWidth: 400,
  blockLineSpacing: 0,
  blockJustify: "L" as const,
} satisfies Partial<TextProps>;

/** ^FB cap upkeep on content edits. blockLines is the maxLines cap (the
 *  box height), so once a block exists it is NOT resynced to the content
 *  on every edit: the canvas wraps to width and soft-wrap overflow is
 *  surfaced as a warning instead. Explicit hard breaks may only grow the
 *  cap. The no-blockWidth branch backfills defaults for imported designs
 *  carrying a bare textMode 'fb'; user edits never reach it (single-line
 *  editors reject newlines for plain text). */
export function deriveBlockTextPatch(
  content: string,
  prev: Pick<TextProps, "blockWidth" | "blockLines">,
  fontHeight: number,
  fontWidth: number,
  deviceFontId?: string,
): Partial<TextProps> {
  const hardLines = content.split("\n").length;
  const patch: Partial<TextProps> = { content };
  if (hardLines > 1 && !prev.blockWidth) {
    patch.blockWidth = FB_DEFAULTS.blockWidth;
    // Initial line cap only; uses the printer-estimate advance (not the
    // rendered-glyph measure the canvas uses). blockLines is a grow-only cap,
    // so a small estimate gap here is harmless.
    patch.blockLines = wrapBlockLines(
      content,
      FB_DEFAULTS.blockWidth,
      (line) => blockLineWidthDots(line, fontHeight, fontWidth, deviceFontId),
    ).length;
    patch.blockLineSpacing = FB_DEFAULTS.blockLineSpacing;
    patch.blockJustify = FB_DEFAULTS.blockJustify;
  } else if (prev.blockWidth && hardLines > (prev.blockLines ?? 1)) {
    patch.blockLines = hardLines;
  }
  return patch;
}

// EM-top-left <-> ZPL anchor (^FO cap-top / ^FT baseline). Applied only
// at the zplGenerator/zplParser boundary; editor interactions skip it.
import { effectiveFontHeightDots } from "./deviceFonts";

interface TextLikeProps {
  fontHeight: number;
  rotation: "N" | "R" | "I" | "B";
  /** Device font id; the pad terms use its snapped cell height. */
  fontId?: string;
}

export const ZPL_FONT_HEIGHT_TO_CSS_RATIO = 1.0;

/** PrintLab ascender ~1.0h vs Zebra CG Triumvirate cap ~0.78h. */
export const EM_TOP_ABOVE_CAP = 0.234;

/** Closes residual PrintLab vs Labelary cap-top mismatch (~0.08h). */
const RENDER_Y_BIAS = 0.08;

function zplAnchorDelta(
  props: TextLikeProps,
  positionType: "FO" | "FT" | undefined,
  inkWidthDots = 0,
  blockExtentDots = 0,
  blockReadingWidthDots = 0,
): { dx: number; dy: number } {
  const effHeight = effectiveFontHeightDots(props.fontId, props.fontHeight);
  const h = effHeight / ZPL_FONT_HEIGHT_TO_CSS_RATIO;
  const pad = effHeight * EM_TOP_ABOVE_CAP;
  const bias = effHeight * RENDER_Y_BIAS;
  const isFT = positionType === "FT";
  // FO I/B anchor at the far reading end of the field: a single line ends at
  // anchor+inkWidth, but an ^FB block ends at anchor+blockWidth (the frame).
  const w = blockReadingWidthDots > 0 ? blockReadingWidthDots : inkWidthDots;
  // FT-anchored ^FB pins the LAST baseline; each 90° rotation swaps the
  // axis and sign of the block-extent shift (derived from Konva's group
  // rotation applied around modelPos, see project_ticket_fb_rotated_ft_anchor).
  const blk = isFT ? blockExtentDots : 0;
  // FO-anchored ^FB: line 0 sits at the anchor and the block stacks toward the
  // reading direction. For R / I that stacking runs negative (left / up), so the
  // block lands one inter-line extent off; bake it into the model the same way
  // FT does. N / B already stack on the anchor's positive side.
  const blkFoRI = isFT ? 0 : blockExtentDots;

  // FO = ascender pad to cap-top; FT adds cap-height to baseline.
  // Bias subtracts here so printed anchor lands where editor displays.
  switch (props.rotation) {
    case "R":
      return isFT ? { dx: -h + bias - blk, dy: 0 } : { dx: -h - pad + bias - blkFoRI, dy: 0 };
    case "I":
      return isFT ? { dx: 0, dy: -h + bias - blk } : { dx: -w, dy: -h - pad + bias - blkFoRI };
    case "B":
      return isFT ? { dx: h - bias + blk, dy: 0 } : { dx: pad - bias, dy: -w };
    case "N":
    default:
      // Unknown rotation falls through to N (malformed-input guard).
      return isFT ? { dx: 0, dy: h - bias + blk } : { dx: 0, dy: pad - bias };
  }
}

/** obj.x/y (Konva render position) → ZPL anchor coordinate. */
export function modelToZplAnchor(
  objectX: number,
  objectY: number,
  props: TextLikeProps,
  positionType: "FO" | "FT" | undefined,
  inkWidthDots = 0,
  blockExtentDots = 0,
  blockReadingWidthDots = 0,
): { x: number; y: number } {
  const d = zplAnchorDelta(props, positionType, inkWidthDots, blockExtentDots, blockReadingWidthDots);
  return { x: objectX + d.dx, y: objectY + d.dy };
}

/** ZPL anchor coordinate (parsed from ^FO/^FT) → obj.x/y storage. */
export function zplAnchorToModel(
  anchorX: number,
  anchorY: number,
  props: TextLikeProps,
  positionType: "FO" | "FT" | undefined,
  inkWidthDots = 0,
  blockExtentDots = 0,
  blockReadingWidthDots = 0,
): { x: number; y: number } {
  const d = zplAnchorDelta(props, positionType, inkWidthDots, blockExtentDots, blockReadingWidthDots);
  return { x: anchorX - d.dx, y: anchorY - d.dy };
}

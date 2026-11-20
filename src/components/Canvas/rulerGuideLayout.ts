import type { StageRulerGuide } from "../../lib/rulerGuides";
import { RULER_SIZE, type RulerProps } from "./Ruler";
import { rulerReadingDots, type RulerAxis } from "./rulerGeometry";

export const RULER_STRIP_TOP = "ruler-strip-top";
export const RULER_STRIP_LEFT = "ruler-strip-left";

const BADGE_GAP = 3;

/** Where a guide's badge and its position field sit, beside the line. */
export const guideBadgeOrigin = ({ vertical, px }: StageRulerGuide) => ({
  x: vertical ? px + BADGE_GAP : RULER_SIZE + BADGE_GAP,
  y: vertical ? RULER_SIZE + BADGE_GAP : px + BADGE_GAP,
});

type RulerPlacement = Pick<
  Required<RulerProps>,
  "labelOffsetX" | "labelOffsetY" | "labelWidthMm" | "labelHeightMm" | "scale" | "horizontalReversed" | "verticalReversed"
>;

/** A vertical guide is read on the top ruler, a level one on the left ruler. */
function guideRulerAxis({ vertical }: StageRulerGuide, ruler: RulerPlacement): RulerAxis {
  return vertical
    ? { originPx: ruler.labelOffsetX, lengthMm: ruler.labelWidthMm, reversed: ruler.horizontalReversed }
    : { originPx: ruler.labelOffsetY, lengthMm: ruler.labelHeightMm, reversed: ruler.verticalReversed };
}

export function guideReadingDots(line: StageRulerGuide, ruler: RulerPlacement, dpmm: number): number {
  return rulerReadingDots(line.px, guideRulerAxis(line, ruler), ruler.scale, dpmm);
}

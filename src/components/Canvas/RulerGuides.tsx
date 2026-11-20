import { Group, Label, Line, Rect, Tag, Text } from "react-konva";
import type { CanvasColors } from "../../hooks/useColorScheme";
import type { StageRulerGuide } from "../../lib/rulerGuides";
import { RULER_FONT, RULER_SIZE } from "./Ruler";
import { guideBadgeOrigin, RULER_STRIP_LEFT, RULER_STRIP_TOP } from "./rulerGuideLayout";

const MARK_PX = 5;

interface LinesProps {
  guides: readonly StageRulerGuide[];
  draft: StageRulerGuide | null;
  canvasWidth: number;
  canvasHeight: number;
  colors: CanvasColors;
}

// A 1 px stroke stays crisp on a half pixel.
const crisp = (px: number) => Math.floor(px) + 0.5;

const points = ({ vertical, px }: StageRulerGuide, width: number, height: number) =>
  vertical ? [crisp(px), RULER_SIZE, crisp(px), height] : [RULER_SIZE, crisp(px), width, crisp(px)];

export function RulerGuideLines({ guides, draft, canvasWidth, canvasHeight, colors }: LinesProps) {
  return (
    <Group listening={false}>
      {guides.map((guide) => (
        <Line
          key={`${guide.vertical}-${guide.px}`}
          name="ruler-guide"
          points={points(guide, canvasWidth, canvasHeight)}
          stroke={colors.rulerGuide}
          strokeWidth={1}
        />
      ))}
      {draft && draft.px >= RULER_SIZE && (
        <Line name="ruler-guide-draft" points={points(draft, canvasWidth, canvasHeight)} stroke={colors.rulerGuide} strokeWidth={1} dash={[4, 3]} />
      )}
    </Group>
  );
}

interface StripsProps {
  canvasWidth: number;
  canvasHeight: number;
}

/** Hit areas over the rulers. Without them a press on a ruler reaches the object that lies under it. */
export function RulerStrips({ canvasWidth, canvasHeight }: StripsProps) {
  return (
    <>
      <Rect name={RULER_STRIP_TOP} x={RULER_SIZE} y={0} width={canvasWidth - RULER_SIZE} height={RULER_SIZE} />
      <Rect name={RULER_STRIP_LEFT} x={0} y={RULER_SIZE} width={RULER_SIZE} height={canvasHeight - RULER_SIZE} />
    </>
  );
}

interface MarksProps {
  guides: readonly StageRulerGuide[];
  draft: StageRulerGuide | null;
  draftText: string;
  colors: CanvasColors;
}

export function RulerGuideMarks({ guides, draft, draftText, colors }: MarksProps) {
  return (
    <Group listening={false}>
      {guides
        // A guide under the other ruler has no place on this one.
        .filter(({ px }) => px >= RULER_SIZE)
        .map(({ vertical, px }) => (
          <Rect
            key={`${vertical}-${px}`}
            name="ruler-guide-mark"
            x={vertical ? crisp(px) - MARK_PX / 2 : RULER_SIZE - MARK_PX}
            y={vertical ? RULER_SIZE - MARK_PX : crisp(px) - MARK_PX / 2}
            width={MARK_PX}
            height={MARK_PX}
            fill={colors.rulerGuide}
          />
        ))}
      {draft && draft.px >= RULER_SIZE && (
        <Label name="ruler-guide-badge" {...guideBadgeOrigin(draft)}>
          <Tag fill={colors.rulerGuide} cornerRadius={3} />
          <Text text={draftText} fill="#ffffff" fontSize={9} fontFamily={RULER_FONT} padding={3} />
        </Label>
      )}
    </Group>
  );
}

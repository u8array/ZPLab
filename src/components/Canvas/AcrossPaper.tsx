import { Group, Rect } from "react-konva";
import { CAPTURE_CHROME } from "../../lib/canvasImage";
import { ACROSS_GAP, type AcrossLayoutPx } from "./acrossLayout";
import { PAPER_SHADOW } from "./paperShadow";

// The paper edge falls between two px, so a pale line would show at the ends of a gap.
const BLEED_PX = 1;

interface Props {
  across: AcrossLayoutPx;
  /** Left edge of the liner in px. */
  linerX: number;
  y: number;
  height: number;
  background: string;
}

/** Splits the label paper into the labels of a row. */
export function AcrossPaper({ across, linerX, y, height, background }: Props) {
  const labels = across.labels.map((l) => ({ x: linerX + l.x, y, width: l.width, height }));
  return (
    <Group name={CAPTURE_CHROME} listening={false}>
      {across.gaps.map((gap) => (
        <Rect key={gap.x} name={ACROSS_GAP} x={linerX + gap.x} y={y - BLEED_PX} width={gap.width} height={height + 2 * BLEED_PX} fill={background} />
      ))}
      {labels.map((rect) => (
        <Rect key={rect.x} {...rect} fill="white" {...PAPER_SHADOW} />
      ))}
      {/* A second pass, so the shadow of one label does not fall on the next. */}
      {labels.map((rect) => (
        <Rect key={rect.x} {...rect} fill="white" />
      ))}
    </Group>
  );
}

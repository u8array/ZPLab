import { Group, Rect, Line, Text } from 'react-konva';
import type { CanvasColors } from '../../hooks/useColorScheme';
import { DARK_COLORS } from '../../hooks/useColorScheme';
import { rulerTicksMm, rulerLabel } from '@zplab/core/lib/units';
import type { Unit } from '@zplab/core/lib/units';
import { rulerValueMm, type RulerAxis } from './rulerGeometry';

export const RULER_SIZE = 20; // px; width/height of the ruler strip
export const RULER_FONT = "'IBM Plex Mono', monospace";

export interface RulerProps {
  labelOffsetX: number;
  labelOffsetY: number;
  labelWidthMm: number;
  labelHeightMm: number;
  scale: number; // px/mm
  canvasWidth: number;
  canvasHeight: number;
  unit?: Unit;
  colors?: CanvasColors;
  /** When true, horizontal ruler labels count down from labelWidthMm to 0 left-to-right. */
  horizontalReversed?: boolean;
  /** When true, vertical ruler labels count down from labelHeightMm to 0 top-to-bottom. */
  verticalReversed?: boolean;
}

export function Ruler({
  labelOffsetX,
  labelOffsetY,
  labelWidthMm,
  labelHeightMm,
  scale,
  canvasWidth,
  canvasHeight,
  unit = 'mm',
  colors = DARK_COLORS,
  horizontalReversed = false,
  verticalReversed = false,
}: RulerProps) {
  const { major, minor } = rulerTicksMm(scale, unit);
  const xAxis: RulerAxis = { originPx: labelOffsetX, lengthMm: labelWidthMm, reversed: horizontalReversed };
  const yAxis: RulerAxis = { originPx: labelOffsetY, lengthMm: labelHeightMm, reversed: verticalReversed };
  const els: React.ReactElement[] = [];

  // ── Backgrounds ───────────────────────────────────────────────
  els.push(
    <Rect key="bg-h" x={0} y={0} width={canvasWidth} height={RULER_SIZE}
      fill={colors.rulerBg} listening={false} />,
    <Rect key="bg-v" x={0} y={0} width={RULER_SIZE} height={canvasHeight}
      fill={colors.rulerBg} listening={false} />,
    <Rect key="bg-corner" x={0} y={0} width={RULER_SIZE} height={RULER_SIZE}
      fill={colors.rulerCorner} listening={false} />,
  );

  // ── Horizontal ruler (top) ─────────────────────────────────────
  // iterate in small steps, snap to minor grid
  const hSteps = Math.ceil(labelWidthMm / minor);
  for (let i = 0; i <= hSteps; i++) {
    const mm = Math.round(i * minor * 1000) / 1000;
    if (mm > labelWidthMm + minor / 2) break;
    const x = labelOffsetX + mm * scale;
    const isMajor = Math.round(mm * 1000) % Math.round(major * 1000) < 1;
    const tickH = isMajor ? 8 : 4;
    els.push(
      <Line key={`hr-${i}`}
        points={[x, RULER_SIZE - tickH, x, RULER_SIZE]}
        stroke={isMajor ? colors.rulerMajorTick : colors.rulerMinorTick}
        strokeWidth={isMajor ? 1 : 0.5}
        listening={false} />,
    );
    // A reversed ruler computes lengthMm - mm, which leaves IEEE-754 noise like 70.00000000000001. Re-round to drop it.
    const displayMm = Math.round(rulerValueMm(mm, xAxis) * 1000) / 1000;
    if (isMajor && displayMm > 0 && displayMm <= labelWidthMm) {
      els.push(
        <Text key={`ht-${i}`}
          x={x + 2} y={RULER_SIZE - 14}
          text={rulerLabel(displayMm, unit)}
          fontSize={8} fill={colors.rulerLabel}
          fontFamily={RULER_FONT}
          listening={false} />,
      );
    }
  }

  // ── Vertical ruler (left) ─────────────────────────────────────
  const vSteps = Math.ceil(labelHeightMm / minor);
  for (let i = 0; i <= vSteps; i++) {
    const mm = Math.round(i * minor * 1000) / 1000;
    if (mm > labelHeightMm + minor / 2) break;
    const y = labelOffsetY + mm * scale;
    const isMajor = Math.round(mm * 1000) % Math.round(major * 1000) < 1;
    const tickW = isMajor ? 8 : 4;
    els.push(
      <Line key={`vr-${i}`}
        points={[RULER_SIZE - tickW, y, RULER_SIZE, y]}
        stroke={isMajor ? colors.rulerMajorTick : colors.rulerMinorTick}
        strokeWidth={isMajor ? 1 : 0.5}
        listening={false} />,
    );
    const displayMm = Math.round(rulerValueMm(mm, yAxis) * 1000) / 1000;
    if (isMajor && displayMm > 0 && displayMm <= labelHeightMm) {
      els.push(
        <Text key={`vt-${i}`}
          x={2} y={y + 2}
          text={rulerLabel(displayMm, unit)}
          fontSize={8} fill={colors.rulerLabel}
          fontFamily={RULER_FONT}
          rotation={0}
          listening={false} />,
      );
    }
  }

  // ── Separator lines ───────────────────────────────────────────
  els.push(
    <Line key="sep-h" points={[RULER_SIZE, RULER_SIZE, canvasWidth, RULER_SIZE]}
      stroke={colors.rulerSeparator} strokeWidth={1} listening={false} />,
    <Line key="sep-v" points={[RULER_SIZE, RULER_SIZE, RULER_SIZE, canvasHeight]}
      stroke={colors.rulerSeparator} strokeWidth={1} listening={false} />,
  );

  return <Group listening={false}>{els}</Group>;
}

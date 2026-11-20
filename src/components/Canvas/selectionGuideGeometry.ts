import { dotsToUnit, unitLabel, type Unit } from "@zplab/core/lib/units";
import { rulerReadingDots, type RulerAxis } from "./rulerGeometry";

export interface GuideAxis extends RulerAxis {
  /** Visible stage px range of the canvas along this axis. */
  fromPx: number;
  toPx: number;
}

export interface GuideReadout {
  /** Stage px per mm. */
  scale: number;
  dpmm: number;
  unit: Unit;
}

interface GuideEdge {
  px: number;
  text: string;
}

export interface AxisGuides {
  /** Tinted ruler span, null when the selection lies outside the view. */
  band: { from: number; to: number } | null;
  near: GuideEdge | null;
  far: GuideEdge | null;
}

/** Edges outside fromPx..toPx are dropped. The band clips to that range. */
export function axisGuides(
  minPx: number,
  maxPx: number,
  axis: GuideAxis,
  { scale, dpmm, unit }: GuideReadout,
): AxisGuides {
  // Rounds through dotsToUnit after snapping to the dot, so a badge reads what the property inputs show.
  const text = (px: number) =>
    `${dotsToUnit(rulerReadingDots(px, axis, scale, dpmm), dpmm, unit)} ${unitLabel(unit)}`;
  const edge = (px: number): GuideEdge | null =>
    px < axis.fromPx || px > axis.toPx ? null : { px, text: text(px) };
  const from = Math.max(minPx, axis.fromPx);
  const to = Math.min(maxPx, axis.toPx);
  return { band: to > from ? { from, to } : null, near: edge(minPx), far: edge(maxPx) };
}

interface BadgeSpan {
  edgePx: number;
  size: number;
}

/** Badge offsets along the axis: near before its edge, far after its edge, kept apart when a clamp pulls one in. */
export function badgeOffsets(
  near: BadgeSpan | null,
  far: BadgeSpan | null,
  axis: GuideAxis,
  gap: number,
): { near: number | null; far: number | null } {
  const clamp = (wanted: number, size: number) => Math.max(axis.fromPx + gap, Math.min(wanted, axis.toPx - size - gap));
  const nearAt = (b: BadgeSpan) => clamp(b.edgePx - b.size - gap, b.size);
  const farAt = (b: BadgeSpan) => clamp(b.edgePx + gap, b.size);
  if (!near || !far) return { near: near && nearAt(near), far: far && farAt(far) };
  // Unclamped they sit two gaps apart. Only a clamp at the view's edge can make them overlap.
  const n = nearAt(near);
  const f = Math.min(Math.max(farAt(far), n + near.size + gap), axis.toPx - far.size - gap);
  return { near: Math.min(n, f - near.size - gap), far: f };
}

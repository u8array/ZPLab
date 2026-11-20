export interface RulerAxis {
  /** Stage px of the label's leading edge on this axis. */
  originPx: number;
  lengthMm: number;
  reversed: boolean;
}

export function rulerValueMm(mm: number, axis: RulerAxis): number {
  return axis.reversed ? axis.lengthMm - mm : mm;
}

export function rulerReadingMm(px: number, axis: RulerAxis, scale: number): number {
  return rulerValueMm((px - axis.originPx) / scale, axis);
}

export function rulerReadingDots(px: number, axis: RulerAxis, scale: number, dpmm: number): number {
  return Math.round(rulerReadingMm(px, axis, scale) * dpmm);
}

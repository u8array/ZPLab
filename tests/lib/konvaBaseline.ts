/** Konva's (non-legacy) line placement: alphabetic baseline at
 *  (fontBoundingBoxAscent - Descent)/2 + lineHeight/2, lineHeight = 1. */
export function konvaBaselineY(
  ctx: { measureText(text: string): TextMetrics },
  fontSizePx: number,
): number {
  const m = ctx.measureText('M');
  const half = (m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2;
  // Ink-box metrics are no substitute (a different quantity, ~2.5px off),
  // so a backend without font-box metrics must fail loudly.
  if (!Number.isFinite(half)) {
    throw new Error('fontBoundingBox metrics unavailable; cannot mirror Konva placement');
  }
  return half + fontSizePx / 2;
}

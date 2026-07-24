/** fieldJustify vocabulary; semantics documented at the schema field. */
export type FieldJustify = 'L' | 'C' | 'R';

/** Origin shift keeping the justified edge fixed for an extent change `delta`
 *  (before minus after). Centre rounds half away from zero (half-up walks a
 *  dot per widen/narrow toggle); `ftFlip` inverts for ^FT I/B's bar offset. */
export function valueAnchorShift(justify: FieldJustify, delta: number, ftFlip: boolean): number {
  if (justify === 'L') return ftFlip ? -delta : 0;
  if (justify === 'R') return ftFlip ? 0 : delta;
  const half = Math.sign(delta) * Math.round(Math.abs(delta) / 2);
  return ftFlip ? -half : half;
}

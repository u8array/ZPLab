import { expect } from 'vitest';
import type { InkBBox } from './darkBBox';

/** Proportional slope (5% of the fixture's own bbox) so
 *  magnification-proportional drift, e.g. a wrong capInkPerMag, trips
 *  on tall cases a flat tolerance would swallow; the noise floor stays
 *  visible at the call site. */
export function toleranceDots(labelaryDim: number, floorDots: number): number {
  return Math.max(floorDots, Math.round(labelaryDim * 0.05));
}

/** Shared 4-axis gate so "systematic drift" cannot diverge between
 *  suites; textBoxMatch opts out on purpose (size-only sweep, no
 *  position gates). */
export function expectBoxMatch(
  local: InkBBox,
  labelary: InkBBox,
  floorDots: number,
  id: string,
): void {
  const wTol = toleranceDots(labelary.width, floorDots);
  const hTol = toleranceDots(labelary.height, floorDots);
  expect(
    Math.abs(local.width - labelary.width),
    `width drift for ${id}: local ${local.width} vs labelary ${labelary.width}`,
  ).toBeLessThanOrEqual(wTol);
  expect(
    Math.abs(local.height - labelary.height),
    `height drift for ${id}: local ${local.height} vs labelary ${labelary.height}`,
  ).toBeLessThanOrEqual(hTol);
  expect(
    Math.abs(local.x - labelary.x),
    `x drift for ${id}: local ${local.x} vs labelary ${labelary.x}`,
  ).toBeLessThanOrEqual(wTol);
  expect(
    Math.abs(local.y - labelary.y),
    `y drift for ${id}: local ${local.y} vs labelary ${labelary.y}`,
  ).toBeLessThanOrEqual(hTol);
}

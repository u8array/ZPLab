import { describe, expect, it } from "vitest";
import { rulerReadingMm, type RulerAxis } from "./rulerGeometry";

const SCALE = 4;
const axis = (over: Partial<RulerAxis> = {}): RulerAxis => ({ originPx: 100, lengthMm: 100, reversed: false, ...over });

describe("rulerReadingMm", () => {
  it("reads the distance from the label's leading edge", () => {
    expect(rulerReadingMm(100, axis(), SCALE)).toBe(0);
    expect(rulerReadingMm(140, axis(), SCALE)).toBe(10);
    expect(rulerReadingMm(60, axis(), SCALE)).toBe(-10);
  });

  it("counts down on a reversed ruler", () => {
    expect(rulerReadingMm(100, axis({ reversed: true }), SCALE)).toBe(100);
    expect(rulerReadingMm(140, axis({ reversed: true }), SCALE)).toBe(90);
  });
});

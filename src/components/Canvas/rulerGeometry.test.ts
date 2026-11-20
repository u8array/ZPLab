import { describe, expect, it } from "vitest";
import { rulerPxAtReading, rulerReadingDots, rulerReadingMm, type RulerAxis } from "./rulerGeometry";

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

describe("rulerPxAtReading", () => {
  it("puts the reading where the ruler shows it, also on a reversed ruler", () => {
    expect(rulerPxAtReading(10, axis(), SCALE)).toBe(140);
    expect(rulerReadingMm(rulerPxAtReading(10, axis({ reversed: true }), SCALE), axis({ reversed: true }), SCALE)).toBe(10);
  });

  it("stops a reading past the ruler at its end", () => {
    expect(rulerPxAtReading(-5, axis(), SCALE)).toBe(100);
    expect(rulerPxAtReading(250, axis(), SCALE)).toBe(500);
  });
});

describe("rulerReadingDots", () => {
  it("reads to the nearest dot", () => {
    expect(rulerReadingDots(141, axis(), SCALE, 8)).toBe(82);
  });
});

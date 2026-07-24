import { describe, it, expect } from "vitest";
import { gs1HriFontDots } from "./barcodeHri";

// In the node lane measureInkWidthPx falls back to len * fontSize * 0.62, so
// the fit arithmetic is deterministic here. GS1_HRI_FONT_SCALE = 1.75.
describe("gs1HriFontDots", () => {
  it("returns the unshrunk base em when bars are not yet measured", () => {
    expect(gs1HriFontDots("0109501101530003", 10, 0)).toBeCloseTo(17.5);
  });

  it("keeps the base em when the text fits the barcode width", () => {
    expect(gs1HriFontDots("01", 10, 1000)).toBeCloseTo(17.5);
  });

  it("shrinks uniformly when the text would overrun the width", () => {
    // gs1Base = 10*1.75 = 17.5; natural = 10 chars * 17.5 * 0.62 = 108.5;
    // target = 0.94 * 100 = 94 → 17.5 * 94 / 108.5.
    const dots = gs1HriFontDots("abcdefghij", 10, 100);
    expect(dots).toBeCloseTo((17.5 * 94) / 108.5, 4);
    expect(dots).toBeLessThan(17.5);
  });
});

import { describe, expect, it } from "vitest";
import { guideReadingDots } from "./rulerGuideLayout";

const ruler = {
  labelOffsetX: 140,
  labelOffsetY: 60,
  labelWidthMm: 100,
  labelHeightMm: 50,
  scale: 4,
  horizontalReversed: false,
  verticalReversed: false,
};

describe("guideReadingDots", () => {
  it("reads a vertical guide on the top ruler and a level one on the left ruler", () => {
    expect(guideReadingDots({ vertical: true, px: 180 }, ruler, 8)).toBe(80);
    expect(guideReadingDots({ vertical: false, px: 180 }, ruler, 8)).toBe(240);
  });

  it("reads from the far edge on a reversed ruler", () => {
    expect(guideReadingDots({ vertical: true, px: 180 }, { ...ruler, horizontalReversed: true }, 8)).toBe(720);
    expect(guideReadingDots({ vertical: false, px: 180 }, { ...ruler, verticalReversed: true }, 8)).toBe(160);
  });
});

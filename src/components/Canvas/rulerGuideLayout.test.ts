import { describe, expect, it } from "vitest";
import { guideLineAtReading, guideReadingDots } from "./rulerGuideLayout";

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

describe("guideLineAtReading", () => {
  it("is the place its ruler shows the reading at", () => {
    expect(guideLineAtReading({ vertical: true, px: 0 }, 10, ruler)).toEqual({ vertical: true, px: 180 });
    expect(guideLineAtReading({ vertical: false, px: 0 }, 10, { ...ruler, verticalReversed: true })).toEqual({ vertical: false, px: 220 });
  });

  it("stops at the end of the ruler", () => {
    expect(guideLineAtReading({ vertical: true, px: 0 }, 9999, ruler).px).toBe(540);
    expect(guideLineAtReading({ vertical: false, px: 0 }, -5, ruler).px).toBe(60);
  });
});

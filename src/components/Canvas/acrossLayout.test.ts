import { describe, it, expect } from "vitest";
import { designAsPageLabel, type LabelConfig } from "@zplab/core/types/LabelConfig";
import { guideSnapLinesDots } from "../../lib/rulerGuides";
import { acrossLayoutPx, withAcrossGuides } from "./acrossLayout";

const liner = (labelsAcross?: LabelConfig["labelsAcross"], over: Partial<LabelConfig> = {}) =>
  designAsPageLabel({ widthMm: 94, heightMm: 30, dpmm: 8, labelsAcross, ...over });

// Labels start at 0, 256 and 512 dots and are 240 wide. At dpmm 8 and scale 8 a dot is a px.
const row = liner({ count: 3, gapMm: 2 });

describe("acrossLayoutPx", () => {
  it("lists the labels and the gaps from the liner edge", () => {
    expect(acrossLayoutPx(row, 8)).toEqual({
      labels: [{ x: 0, width: 240 }, { x: 256, width: 240 }, { x: 512, width: 240 }],
      gaps: [{ x: 240, width: 16 }, { x: 496, width: 16 }],
    });
  });

  it("is null for a single label", () => {
    expect(acrossLayoutPx(liner(), 8)).toBeNull();
  });
});

describe("withAcrossGuides", () => {
  const lines = (label: ReturnType<typeof liner>, x: number[] = []) => guideSnapLinesDots(withAcrossGuides({ x, y: [5] }, label), 8);

  it("adds the edges and centre of every label after the guides", () => {
    // The outer edges and the centre of the middle label are the liner's, which the label rect snaps to.
    expect(lines(row, [10])).toEqual({ x: [80, 120, 240, 256, 496, 512, 632], y: [40] });
  });

  it("gives one line where two labels without a gap meet, and none a dot inside the liner edge", () => {
    // 20.1 mm at 8 dpmm is 161 dots, which two labels share as 80 and 81.
    expect(lines(liner({ count: 2, gapMm: 0 }, { widthMm: 20.1 })).x).toEqual([40, 80, 121]);
  });

  it("moves with the liner under ^LS", () => {
    expect(lines(liner({ count: 3, gapMm: 2 }, { labelShift: 16 })).x[0]).toBe(136);
  });

  it("returns the guides unchanged for a single label", () => {
    const guides = { x: [10], y: [5] };
    expect(withAcrossGuides(guides, liner())).toBe(guides);
  });
});

import { describe, it, expect } from "vitest";
import { acrossGapForWidthMm, acrossLayoutDots, acrossWidthMm, labelsAcrossWithCount } from "./labelsAcross";
import { designAsPageLabel, type LabelConfig } from "../types/LabelConfig";
import { labelRectsDots, offLabelPlacement, ownLabelRectDots } from "./objectBounds";

const liner = (labelsAcross?: LabelConfig["labelsAcross"], over: Partial<LabelConfig> = {}) =>
  designAsPageLabel({ widthMm: 94, heightMm: 30, dpmm: 8, labelsAcross, ...over });

describe("acrossWidthMm", () => {
  it("splits the width the gaps leave", () => {
    expect(acrossWidthMm(liner({ count: 3, gapMm: 2 }))).toBe(30);
  });

  it("is null without a setting or at a count of 1", () => {
    expect(acrossWidthMm(liner())).toBeNull();
    expect(acrossWidthMm(liner({ count: 1, gapMm: 2 }))).toBeNull();
  });

  it("is null where a label rounds to one dot but lies between two dots", () => {
    // 0.53 dots wide. The middle label starts and ends on dot 376.
    const row = liner({ count: 3, gapMm: 46.9 });
    expect(acrossWidthMm(row)).toBeNull();
    expect(acrossLayoutDots(row)).toBeNull();
  });

  it("is null for a row wider than the liner or a label under one dot", () => {
    expect(acrossWidthMm(liner({ count: 3, gapMm: 50 }))).toBeNull();
    // 0.0725 mm at 3 effective dpmm rounds to no dot at all.
    expect(acrossWidthMm(liner({ count: 20, gapMm: 0.45 }, { widthMm: 10, dpmm: 6, jmDensity: "B" }))).toBeNull();
  });
});

describe("acrossLayoutDots", () => {
  it("steps the labels by width plus gap", () => {
    expect(acrossLayoutDots(liner({ count: 3, gapMm: 2 }))).toEqual({
      labelsDots: [{ x: 0, width: 240 }, { x: 256, width: 240 }, { x: 512, width: 240 }],
      gapsDots: [{ x: 240, width: 16 }, { x: 496, width: 16 }],
    });
  });

  it("rounds each edge on its own", () => {
    // 100 mm in three at 8 dpmm: a pitch of 266.67 dots, 267 when rounded once and added twice.
    expect(acrossLayoutDots(liner({ count: 3, gapMm: 0 }, { widthMm: 100 }))?.labelsDots).toEqual([
      { x: 0, width: 267 },
      { x: 267, width: 266 },
      { x: 533, width: 267 },
    ]);
  });

  it("leaves no strip where labels without a gap meet on a fraction of a dot", () => {
    // 20.1 mm at 8 dpmm is 161 dots, which two labels share as 80 and 81.
    expect(acrossLayoutDots(liner({ count: 2, gapMm: 0 }, { widthMm: 20.1 }))?.gapsDots).toEqual([]);
  });

  it("follows the density ^JM halves", () => {
    expect(acrossLayoutDots(liner({ count: 2, gapMm: 2 }, { jmDensity: "B" }))?.labelsDots.map((l) => l.x)).toEqual([0, 192]);
  });

  it("is null for a single label or a row that does not fit", () => {
    expect(acrossLayoutDots(liner())).toBeNull();
    expect(acrossLayoutDots(liner({ count: 3, gapMm: 50 }))).toBeNull();
  });
});

describe("labelsAcrossWithCount", () => {
  it("starts a row with a default gap", () => {
    expect(labelsAcrossWithCount(undefined, 3)).toEqual({ count: 3, gapMm: 2 });
  });

  it("keeps the gap through a count of 1", () => {
    const typed = labelsAcrossWithCount(labelsAcrossWithCount({ count: 3, gapMm: 4 }, 1), 12);
    expect(typed).toEqual({ count: 12, gapMm: 4 });
  });
});

describe("acrossGapForWidthMm", () => {
  it("gives the gap that yields a typed width", () => {
    const row = liner({ count: 3, gapMm: 2 });
    expect(acrossGapForWidthMm(row, 30)).toBe(2);
    expect(acrossWidthMm({ ...row, labelsAcross: { count: 3, gapMm: acrossGapForWidthMm(row, 28) } })).toBe(28);
  });

  it("gives no gap for a width the liner cannot hold", () => {
    expect(acrossGapForWidthMm(liner({ count: 3, gapMm: 2 }), 40)).toBe(0);
  });

  it("gives no gap for a single label", () => {
    expect(acrossGapForWidthMm(liner(), 40)).toBe(0);
  });
});

describe("offLabelPlacement in a row", () => {
  // Labels of 240 dots at 0, 256 and 512, 240 dots high.
  const row = liner({ count: 3, gapMm: 2 });
  const at = (x: number, width: number) => offLabelPlacement({ x, y: 10 }, { x, y: 10, width, height: 20 }, row);

  it("accepts a field inside any label", () => {
    expect(at(10, 100)).toBeNull();
    expect(at(256, 240)).toBeNull();
    expect(at(600, 100)).toBeNull();
  });

  it("flags a field that runs over a label edge as clipped", () => {
    expect(at(200, 50)).toBe("clipped");
    expect(at(250, 50)).toBe("clipped");
    expect(at(200, 100)).toBe("clipped");
  });

  it("flags a field that lies in a gap as outside", () => {
    expect(at(242, 12)).toBe("outside");
  });

  it("flags a field across labels that meet without a gap as clipped", () => {
    expect(offLabelPlacement({ x: 300, y: 10 }, { x: 300, y: 10, width: 200, height: 20 }, liner({ count: 2, gapMm: 0 }))).toBe("clipped");
  });

  it("accepts a field that ends on the edge two labels share", () => {
    const meeting = liner({ count: 2, gapMm: 0 });
    expect(offLabelPlacement({ x: 276, y: 10 }, { x: 276, y: 10, width: 100, height: 20 }, meeting)).toBeNull();
  });

  it("flags a field in a gap as outside though it also runs over the liner's bottom edge", () => {
    expect(offLabelPlacement({ x: 242, y: 230 }, { x: 242, y: 230, width: 12, height: 30 }, row)).toBe("outside");
    expect(offLabelPlacement({ x: 10, y: 230 }, { x: 10, y: 230, width: 12, height: 30 }, row)).toBe("clipped");
  });

  it("reads the labels where ^LS puts the liner", () => {
    const shifted = liner({ count: 3, gapMm: 2 }, { labelShift: 16 });
    expect(offLabelPlacement({ x: 16, y: 10 }, { x: 16, y: 10, width: 240, height: 20 }, shifted)).toBeNull();
    expect(offLabelPlacement({ x: 30, y: 10 }, { x: 30, y: 10, width: 240, height: 20 }, shifted)).toBe("clipped");
  });
});

describe("labelRectsDots", () => {
  it("is the printable area without a row", () => {
    expect(labelRectsDots(liner())).toEqual([{ x: 0, y: 0, width: 752, height: 240 }]);
  });

  it("is every label of a row where ^LS puts the liner", () => {
    expect(labelRectsDots(liner({ count: 3, gapMm: 2 }, { labelShift: 16 })).map((r) => [r.x, r.width])).toEqual([[16, 240], [272, 240], [528, 240]]);
  });
});

describe("ownLabelRectDots", () => {
  const row = liner({ count: 3, gapMm: 2 });
  const own = (x: number, width: number) => ownLabelRectDots(row, { x, y: 0, width, height: 10 }).x;

  it("is the label a box centre lies on", () => {
    expect(own(10, 20)).toBe(0);
    expect(own(300, 20)).toBe(256);
  });

  it("is the nearest label for a centre in a gap or off the liner", () => {
    expect(own(240, 4)).toBe(0);
    expect(own(250, 4)).toBe(256);
    expect(own(200, 100)).toBe(256);
    expect(own(900, 10)).toBe(512);
  });

  it("is the printable area without a row", () => {
    expect(ownLabelRectDots(liner(), { x: 300, y: 0, width: 20, height: 10 })).toEqual({ x: 0, y: 0, width: 752, height: 240 });
  });
});

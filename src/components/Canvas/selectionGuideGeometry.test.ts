import { describe, expect, it } from "vitest";
import { dotsToUnit } from "@zplab/core/lib/units";
import { axisGuides, badgeOffsets, type GuideAxis, type GuideReadout } from "./selectionGuideGeometry";

const MM: GuideReadout = { scale: 4, dpmm: 8, unit: "mm" };
const axis = (over: Partial<GuideAxis> = {}): GuideAxis => ({
  originPx: 100,
  lengthMm: 100,
  reversed: false,
  fromPx: 20,
  toPx: 620,
  ...over,
});

describe("axisGuides", () => {
  it("labels both edges in the canvas unit", () => {
    const g = axisGuides(140, 300, axis(), MM);
    expect(g.near).toEqual({ px: 140, text: "10 mm" });
    expect(g.far).toEqual({ px: 300, text: "50 mm" });
    expect(g.band).toEqual({ from: 140, to: 300 });
  });

  it("reads every dot like the property inputs at any zoom", () => {
    const wide = axis({ originPx: 61.5, fromPx: -Infinity, toPx: Infinity });
    for (const dpmm of [6, 8, 12, 24]) {
      for (const unit of ["mm", "cm", "in"] as const) {
        for (const scale of [1.9, 4, 7.3]) {
          for (let dots = 0; dots <= 800; dots++) {
            const px = wide.originPx + (dots / dpmm) * scale;
            const text = axisGuides(px, px, wide, { scale, dpmm, unit }).near?.text;
            expect(text, `${dots} dots at ${dpmm} dpmm, scale ${scale}`).toBe(`${dotsToUnit(dots, dpmm, unit)} ${unit}`);
          }
        }
      }
    }
  });

  it("swaps the readings on a reversed ruler, not the edges", () => {
    const g = axisGuides(140, 300, axis({ reversed: true }), MM);
    expect(g.near).toEqual({ px: 140, text: "90 mm" });
    expect(g.far).toEqual({ px: 300, text: "50 mm" });
  });

  it("drops an edge scrolled out of view and clips the band to the ruler", () => {
    const g = axisGuides(-50, 300, axis(), MM);
    expect(g.near).toBeNull();
    expect(g.far?.px).toBe(300);
    expect(g.band).toEqual({ from: 20, to: 300 });
  });

  it("has no band when the selection lies outside the view", () => {
    const g = axisGuides(700, 900, axis(), MM);
    expect(g).toEqual({ band: null, near: null, far: null });
  });
});

describe("badgeOffsets", () => {
  const badge = (edgePx: number) => ({ edgePx, size: 40 });

  it("puts the near badge before its edge and the far badge after", () => {
    expect(badgeOffsets(badge(300), badge(400), axis(), 2)).toEqual({ near: 258, far: 402 });
  });

  it("keeps a lone badge inside the view", () => {
    expect(badgeOffsets(badge(30), null, axis(), 2)).toEqual({ near: 22, far: null });
    expect(badgeOffsets(null, badge(610), axis(), 2)).toEqual({ near: null, far: 578 });
  });

  it("pushes the far badge after a near badge clamped at the view start", () => {
    expect(badgeOffsets(badge(30), badge(40), axis(), 2)).toEqual({ near: 22, far: 64 });
  });

  it("pushes the near badge before a far badge clamped at the view end", () => {
    expect(badgeOffsets(badge(600), badge(610), axis(), 2)).toEqual({ near: 536, far: 578 });
  });
});

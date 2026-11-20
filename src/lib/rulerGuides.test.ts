import { describe, it, expect } from "vitest";
import type { ViewRotation } from "@zplab/core/registry/rotation";
import { guideMmOnDot, guideNear, guideSnapLinesDots, guideSnapLinesStage, guidesAfterDrop, guidesAfterEdit, guideToStage, stageRulerGuides, stageToGuide, withGuide, withoutGuide, NO_RULER_GUIDES, type RulerGuideView } from "./rulerGuides";
import { axisReversal, isAxisSwapped } from "../components/Canvas/rotationGeometry";
import { rulerReadingMm } from "../components/Canvas/rulerGeometry";

const LABEL = { widthMm: 100, heightMm: 60 };
const ROTATIONS: ViewRotation[] = [0, 90, 180, 270];

/** The view as the test lays it out: the label centred on a pivot, 4 px per mm. */
function view(rotation: ViewRotation): RulerGuideView {
  const scale = 4;
  const originX = 220;
  const originY = 130;
  return { originX, originY, centerX: originX + (LABEL.widthMm * scale) / 2, centerY: originY + (LABEL.heightMm * scale) / 2, scale, rotation };
}

/** What the ruler along a stage axis reads at `px`. */
function rulerReading(vertical: boolean, px: number, v: RulerGuideView): number {
  const swapped = isAxisSwapped(v.rotation);
  const reversal = axisReversal(v.rotation);
  const visualWidthMm = swapped ? LABEL.heightMm : LABEL.widthMm;
  const visualHeightMm = swapped ? LABEL.widthMm : LABEL.heightMm;
  return vertical
    ? rulerReadingMm(px, { originPx: v.centerX - (visualWidthMm * v.scale) / 2, lengthMm: visualWidthMm, reversed: reversal.horizontal }, v.scale)
    : rulerReadingMm(px, { originPx: v.centerY - (visualHeightMm * v.scale) / 2, lengthMm: visualHeightMm, reversed: reversal.vertical }, v.scale);
}

describe("guideToStage", () => {
  it("draws an x guide upright and a y guide level, swapped at a quarter turn", () => {
    for (const rotation of ROTATIONS) {
      const swapped = rotation === 90 || rotation === 270;
      expect(guideToStage({ axis: "x", mm: 10 }, view(rotation)).vertical).toBe(!swapped);
      expect(guideToStage({ axis: "y", mm: 10 }, view(rotation)).vertical).toBe(swapped);
    }
  });

  it("puts every guide where the ruler reads its mm, at each view rotation", () => {
    for (const rotation of ROTATIONS) {
      const v = view(rotation);
      for (const guide of [{ axis: "x", mm: 12.5 }, { axis: "x", mm: 0 }, { axis: "y", mm: 47 }, { axis: "y", mm: 60 }] as const) {
        const stage = guideToStage(guide, v);
        expect(rulerReading(stage.vertical, stage.px, v), `${guide.axis} ${guide.mm} at ${rotation}`).toBeCloseTo(guide.mm, 9);
      }
    }
  });

  it("round-trips through stageToGuide", () => {
    for (const rotation of ROTATIONS) {
      const v = view(rotation);
      for (const guide of [{ axis: "x", mm: 33.25 }, { axis: "y", mm: 8 }] as const) {
        const back = stageToGuide(guideToStage(guide, v), v);
        expect(back.axis).toBe(guide.axis);
        expect(back.mm).toBeCloseTo(guide.mm, 9);
      }
    }
  });
});

describe("guide edits", () => {
  it("adds a guide once and removes it by position", () => {
    const one = withGuide(NO_RULER_GUIDES, { axis: "x", mm: 10 });
    expect(one).toEqual({ x: [10], y: [] });
    expect(withGuide(one, { axis: "x", mm: 10 })).toBe(one);
    expect(withGuide(one, { axis: "y", mm: 10 })).toEqual({ x: [10], y: [10] });
    expect(withoutGuide(one, { axis: "x", mm: 10 })).toEqual(NO_RULER_GUIDES);
    expect(withoutGuide(one, { axis: "y", mm: 10 })).toBe(one);
  });

  it("rounds a position to the dot grid at the density", () => {
    expect(guideMmOnDot(10.06, 8)).toBe(10);
    expect(guideMmOnDot(10.07, 8)).toBe(10.125);
    expect(guideMmOnDot(10.03, 24)).toBeCloseTo(10 + 1 / 24, 9);
  });
});

describe("guideNear", () => {
  const guides = { x: [10, 12], y: [10] };

  it("finds the nearest guide in the pressed line's direction within the tolerance", () => {
    const v = view(0);
    const at = (mm: number) => ({ vertical: true, px: v.originX + mm * v.scale });
    expect(guideNear(guides, [at(10.5)], v, 4)).toEqual({ axis: "x", mm: 10 });
    expect(guideNear(guides, [at(11.5)], v, 4)).toEqual({ axis: "x", mm: 12 });
    expect(guideNear(guides, [at(14)], v, 4)).toBeUndefined();
    expect(guideNear(guides, [{ vertical: false, px: v.originY + 10 * v.scale + 3 }], v, 4)).toEqual({ axis: "y", mm: 10 });
  });

  it("follows the view rotation, an x guide lies level at a quarter turn", () => {
    const v = view(90);
    const stage = guideToStage({ axis: "x", mm: 12 }, v);
    expect(stage.vertical).toBe(false);
    expect(guideNear(guides, [{ vertical: false, px: stage.px + 1 }], v, 4)).toEqual({ axis: "x", mm: 12 });
  });

  it("takes the nearer of two crossings", () => {
    const v = view(0);
    const upright = { vertical: true, px: v.originX + 12 * v.scale + 3 };
    const level = { vertical: false, px: v.originY + 10 * v.scale + 1 };
    expect(guideNear(guides, [upright, level], v, 4)).toEqual({ axis: "y", mm: 10 });
    expect(guideNear(guides, [], v, 4)).toBeUndefined();
  });
});

describe("guides as snap lines", () => {
  const guides = { x: [10], y: [5, 20] };

  it("return model dots", () => {
    expect(guideSnapLinesDots(guides, 8)).toEqual({ x: [80], y: [40, 160] });
  });

  it("return whole dots at another density", () => {
    expect(guideSnapLinesDots({ x: [10.125], y: [] }, 12)).toEqual({ x: [122], y: [] });
  });

  it("return stage lines for a resize, axes swapped at a quarter turn", () => {
    const upright = guideSnapLinesStage(guides, view(0));
    expect(upright).toEqual({ x: [220 + 40], y: [130 + 20, 130 + 80] });
    // The pivot is (420, 250): the y guides stand upright right of it, the x guide lies level above it.
    expect(guideSnapLinesStage(guides, view(90))).toEqual({ x: [420 + 100, 420 + 40], y: [250 - 160] });
  });
});

describe("guidesAfterDrop", () => {
  const v = view(0);
  const canvas = { from: 20, width: 800, height: 600 };
  const upright = (px: number) => ({ vertical: true, px });
  const placed = { x: [10], y: [] };

  it("places a new guide on a dot and moves a dragged guide", () => {
    expect(guidesAfterDrop(NO_RULER_GUIDES, undefined, upright(v.originX + 10.06 * v.scale), v, 8, canvas)).toEqual(placed);
    expect(guidesAfterDrop(placed, { axis: "x", mm: 10 }, upright(v.originX + 20 * v.scale), v, 8, canvas)).toEqual({ x: [20], y: [] });
  });

  it("takes the dragged guide away on a ruler and off the canvas, places none from there", () => {
    for (const px of [19, -40, 801]) {
      expect(guidesAfterDrop(placed, { axis: "x", mm: 10 }, upright(px), v, 8, canvas)).toEqual(NO_RULER_GUIDES);
      expect(guidesAfterDrop(placed, undefined, upright(px), v, 8, canvas)).toBe(placed);
    }
    expect(guidesAfterDrop(NO_RULER_GUIDES, undefined, { vertical: false, px: 601 }, v, 8, canvas)).toBe(NO_RULER_GUIDES);
    for (const px of [20, 800]) {
      expect(guidesAfterDrop(NO_RULER_GUIDES, undefined, upright(px), v, 8, canvas).x).toHaveLength(1);
    }
  });

  it("judges the drop on the dot the guide lands on", () => {
    // At 1 dpmm a dot is 4 px wide here, with dots at 16, 20 and 800.
    expect(guidesAfterDrop(NO_RULER_GUIDES, undefined, upright(18.5), v, 1, canvas)).toEqual({ x: [-50], y: [] });
    expect(guidesAfterDrop(NO_RULER_GUIDES, undefined, upright(801.5), v, 1, canvas)).toEqual({ x: [145], y: [] });
    expect(guidesAfterDrop(NO_RULER_GUIDES, undefined, upright(17.9), v, 1, canvas)).toBe(NO_RULER_GUIDES);
  });
});

describe("stageRulerGuides", () => {
  it("leaves the moving guide out of the returned lines", () => {
    const v = view(0);
    expect(stageRulerGuides({ x: [10, 20], y: [] }, v, { axis: "x", mm: 10 })).toEqual([{ vertical: true, px: v.originX + 20 * v.scale }]);
  });
});

describe("guidesAfterEdit", () => {
  const guides = { x: [10, 20], y: [10] };
  const v = view(0);
  const upright = (mm: number) => ({ vertical: true, px: v.originX + mm * v.scale });

  it("moves the edited guide to the typed position", () => {
    expect(guidesAfterEdit(guides, { axis: "x", mm: 10 }, upright(30.07), v, 8)).toEqual({ x: [20, 30.125], y: [10] });
  });

  it("merges into a guide that already sits there", () => {
    expect(guidesAfterEdit(guides, { axis: "x", mm: 10 }, upright(20), v, 8)).toEqual({ x: [20], y: [10] });
  });
});

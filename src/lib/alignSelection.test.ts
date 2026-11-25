import { describe, it, expect } from "vitest";

import { ObjectRegistry, type LeafObject } from "@zplab/core/registry";
import type { PageLabel } from "@zplab/core/types/LabelConfig";
import { barBoxDots, objectBoundsDots } from "@zplab/core/lib/objectBounds";
import { computeAlignDeltas } from "./align";
import { buildAlignSelection } from "./alignSelection";

const label = { widthMm: 100, heightMm: 150, dpmm: 8 } as PageLabel;

const code128 = {
  id: "bc",
  type: "code128",
  x: 100,
  y: 100,
  positionType: "FO",
  props: { ...ObjectRegistry.code128.defaultProps, moduleWidth: 2, height: 80, printInterpretation: true },
} as LeafObject;

const rect = {
  id: "rect",
  type: "box",
  x: 400,
  y: 100,
  positionType: "FO",
  props: { ...ObjectRegistry.box.defaultProps, width: 60, height: 80 },
} as LeafObject;

// Module width 2 hangs a 21-dot interpretation line below 80-dot bars.
const measured = new Map([
  ["bc", { width: 200, height: 101, barHeightDots: 80, barLeftDots: 0, barTopDots: 0, uprightBarWDots: 200, uprightBarHDots: 80 }],
]);

describe("buildAlignSelection", () => {
  it("aligns a barcode by its bars when asked for the bar box", () => {
    const sel = buildAlignSelection([code128, rect], ["bc", "rect"], label, measured, "selection", barBoxDots);
    expect(sel?.boxes.find((b) => b.id === "bc")).toEqual({ id: "bc", x: 100, y: 100, width: 200, height: 80 });
    const deltas = computeAlignDeltas(sel!.boxes, sel!.targets[0]!.frame, "vmiddle");
    expect(deltas.map((d) => [d.id, d.dy])).toEqual([["bc", 0], ["rect", 0]]);
  });

  it("spaces by the full box when asked for it", () => {
    const sel = buildAlignSelection([code128, rect], ["bc", "rect"], label, measured, "selection", objectBoundsDots);
    expect(sel?.boxes.find((b) => b.id === "bc")).toEqual({ id: "bc", x: 100, y: 100, width: 200, height: 101 });
  });

  it("takes the key object's box as the reference", () => {
    const sel = buildAlignSelection([rect, code128], ["rect", "bc"], label, measured, "key", barBoxDots);
    expect(sel?.targets.map((t) => t.frame)).toEqual([{ x: 100, y: 100, width: 200, height: 80 }]);
  });

  it("skips locked and hidden objects and returns null without a movable one", () => {
    const locked = { ...rect, locked: true } as LeafObject;
    expect(buildAlignSelection([locked], ["rect"], label, measured, "selection", barBoxDots)).toBeNull();
    const sel = buildAlignSelection([locked, code128], ["rect", "bc"], label, measured, "selection", barBoxDots);
    expect(sel?.boxes.map((b) => b.id)).toEqual(["bc"]);
  });

  it("takes the label of a row the selection lies on as the label reference", () => {
    // 100 mm in two with a gap of 4 mm: labels of 384 dots at 0 and 416.
    const row = { ...label, labelsAcross: { count: 2, gapMm: 4 } } as PageLabel;
    const right = { ...rect, x: 500 } as LeafObject;
    expect(buildAlignSelection([right], ["rect"], row, measured, "label", barBoxDots)?.targets[0]?.frame).toMatchObject({ x: 416, width: 384 });
    const left = { ...rect, x: 100 } as LeafObject;
    expect(buildAlignSelection([left], ["rect"], row, measured, "label", barBoxDots)?.targets[0]?.frame).toMatchObject({ x: 0, width: 384 });
  });

  it("insets that label by the safe area", () => {
    const row = { ...label, safeAreaMm: 2, labelsAcross: { count: 2, gapMm: 4 } } as PageLabel;
    const right = { ...rect, x: 500 } as LeafObject;
    expect(buildAlignSelection([right], ["rect"], row, measured, "label", barBoxDots)?.targets[0]?.frame).toMatchObject({ x: 432, width: 352 });
  });

  describe("in a row of two labels of 384 dots at 0 and 416", () => {
    const row = { ...label, labelsAcross: { count: 2, gapMm: 4 } } as PageLabel;
    const at = (id: string, x: number) => ({ ...rect, id, x }) as LeafObject;
    const frame = {
      id: "frame",
      type: "box",
      x: 0,
      y: 0,
      positionType: "FO",
      props: { ...ObjectRegistry.box.defaultProps, width: 800, height: 1200 },
    } as LeafObject;
    const lefts = (objs: LeafObject[]) => {
      const sel = buildAlignSelection(objs, objs.map((o) => o.id), row, measured, "label", barBoxDots);
      return sel?.targets.flatMap((t) => computeAlignDeltas(t.boxes, t.frame, "left")).map((d) => [d.id, d.dx]);
    };

    it("aligns every object to the label it lies on", () => {
      expect(lefts([at("a", 100), at("b", 500)])).toEqual([["a", -100], ["b", -84]]);
    });

    it("leaves a frame across the liner out of the label reference", () => {
      expect(lefts([frame, at("a", 500), at("b", 600)])).toEqual([["a", -84], ["b", -184]]);
    });

    it("tidies the content of each label inside it", () => {
      const objs = [at("a", 100), at("b", 500), at("c", 600)];
      const sel = buildAlignSelection(objs, ["a", "b", "c"], row, measured, "selection", barBoxDots);
      expect(sel?.labels.map((t) => [t.boxes.map((b) => b.id), t.frame.x])).toEqual([[["a"], 0], [["b", "c"], 416]]);
    });

    it("uses one frame for the selection and the key reference", () => {
      const objs = [at("a", 100), at("b", 500)];
      expect(buildAlignSelection(objs, ["a", "b"], row, measured, "selection", barBoxDots)?.targets).toHaveLength(1);
      expect(buildAlignSelection(objs, ["a", "b"], row, measured, "key", barBoxDots)?.targets).toHaveLength(1);
    });
  });
});

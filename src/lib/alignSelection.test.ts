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
    const deltas = computeAlignDeltas(sel!.boxes, sel!.ref!, "vmiddle");
    expect(deltas.map((d) => [d.id, d.dy])).toEqual([["bc", 0], ["rect", 0]]);
  });

  it("spaces by the full box when asked for it", () => {
    const sel = buildAlignSelection([code128, rect], ["bc", "rect"], label, measured, "selection", objectBoundsDots);
    expect(sel?.boxes.find((b) => b.id === "bc")).toEqual({ id: "bc", x: 100, y: 100, width: 200, height: 101 });
  });

  it("takes the key object's box as the reference", () => {
    const sel = buildAlignSelection([rect, code128], ["rect", "bc"], label, measured, "key", barBoxDots);
    expect(sel?.ref).toEqual({ x: 100, y: 100, width: 200, height: 80 });
  });

  it("skips locked and hidden objects and returns null without a movable one", () => {
    const locked = { ...rect, locked: true } as LeafObject;
    expect(buildAlignSelection([locked], ["rect"], label, measured, "selection", barBoxDots)).toBeNull();
    const sel = buildAlignSelection([locked, code128], ["rect", "bc"], label, measured, "selection", barBoxDots);
    expect(sel?.boxes.map((b) => b.id)).toEqual(["bc"]);
  });
});

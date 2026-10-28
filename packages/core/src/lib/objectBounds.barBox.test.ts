import { describe, it, expect } from "vitest";

import { ObjectRegistry, type LeafObject } from "../registry";
import type { LabelObject } from "../types/Group";
import type { PageLabel } from "../types/LabelConfig";
import { barBoxDots, objectBoundsDots, selectionUnionDots, type MeasuredFootprint, type ObjectBoundsCtx } from "./objectBounds";

const label = { widthMm: 100, heightMm: 150, dpmm: 8 } as PageLabel;
const ctx = (measured: Record<string, MeasuredFootprint> = {}): ObjectBoundsCtx => ({
  label,
  measured: new Map(Object.entries(measured)),
});

function barcode(id: string, type: string, rotation: string, positionType: "FO" | "FT" = "FO", props: object = {}): LeafObject {
  return {
    id,
    type,
    x: 40,
    y: 160,
    positionType,
    props: { ...(ObjectRegistry[type as keyof typeof ObjectRegistry].defaultProps as object), moduleWidth: 2, height: 80, printInterpretation: true, rotation, ...props },
  } as LeafObject;
}

/** The renderer's record for 200x80 upright bars with a 21-dot line on the zone side. */
const code128Record = (rotation: string): MeasuredFootprint => ({
  width: rotation === "R" || rotation === "B" ? 101 : 200,
  height: rotation === "R" || rotation === "B" ? 200 : 101,
  barHeightDots: rotation === "R" || rotation === "B" ? 200 : 80,
  barLeftDots: rotation === "R" ? 21 : 0,
  barTopDots: rotation === "I" ? 21 : 0,
  uprightBarWDots: 200,
  uprightBarHDots: 80,
});

describe("barBoxDots", () => {
  // ^FO is the bars' own top-left, so the bar box starts at the field origin in
  // every rotation while the full box grows away from it on the zone side.
  it.each([
    ["N", { x: 40, y: 160, width: 200, height: 101 }, { x: 40, y: 160, width: 200, height: 80 }],
    ["R", { x: 19, y: 160, width: 101, height: 200 }, { x: 40, y: 160, width: 80, height: 200 }],
    ["I", { x: 40, y: 139, width: 200, height: 101 }, { x: 40, y: 160, width: 200, height: 80 }],
    ["B", { x: 40, y: 160, width: 101, height: 200 }, { x: 40, y: 160, width: 80, height: 200 }],
  ])("^FO code128 %s: the bars start at the field origin", (rotation, ink, bars) => {
    const obj = barcode("bc", "code128", rotation);
    const c = ctx({ bc: code128Record(rotation) });
    expect(objectBoundsDots(obj, c)).toEqual(ink);
    expect(barBoxDots(obj, c)).toEqual(bars);
  });

  it("^FT code128 N: the bars end on the baseline and the line hangs below it", () => {
    const obj = barcode("bc", "code128", "N", "FT");
    const c = ctx({ bc: code128Record("N") });
    expect(objectBoundsDots(obj, c)).toEqual({ x: 40, y: 80, width: 200, height: 101 });
    expect(barBoxDots(obj, c)).toEqual({ x: 40, y: 80, width: 200, height: 80 });
  });

  it("logmars prints its line above, so the bars sit below the zone", () => {
    const obj = barcode("lm", "logmars", "N");
    const c = ctx({ lm: { width: 200, height: 100, barHeightDots: 80, barLeftDots: 0, barTopDots: 20, uprightBarWDots: 200, uprightBarHDots: 80 } });
    expect(objectBoundsDots(obj, c)).toEqual({ x: 40, y: 140, width: 200, height: 100 });
    expect(barBoxDots(obj, c)).toEqual({ x: 40, y: 160, width: 200, height: 80 });
  });

  it("ean13 measures the bars only, since the guard zone is reserved even with the line off", () => {
    const obj = barcode("ean", "ean13", "N", "FO", { printInterpretation: false });
    const c = ctx({ ean: { width: 190, height: 93, barHeightDots: 80, barLeftDots: 0, barTopDots: 0, uprightBarWDots: 190, uprightBarHDots: 80 } });
    expect(barBoxDots(obj, c)).toEqual({ x: 40, y: 160, width: 190, height: 80 });
  });

  it("equals the full box without a line and before the renderer published a record", () => {
    const silent = barcode("bc", "code128", "N", "FO", { printInterpretation: false });
    const c = ctx({ bc: { width: 200, height: 80, barHeightDots: 80, barLeftDots: 0, barTopDots: 0, uprightBarWDots: 200, uprightBarHDots: 80 } });
    expect(barBoxDots(silent, c)).toEqual(objectBoundsDots(silent, c));
    const fresh = barcode("bc", "code128", "N");
    expect(barBoxDots(fresh, ctx())).toEqual(objectBoundsDots(fresh, ctx()));
  });

  it("leaves non-barcodes untouched", () => {
    const text = { id: "t", type: "text", x: 10, y: 10, positionType: "FO", props: { ...ObjectRegistry.text.defaultProps, text: "abc" } } as LeafObject;
    expect(barBoxDots(text, ctx())).toEqual(objectBoundsDots(text, ctx()));
  });

  it("unions the bar boxes of a group and of a selection", () => {
    const a = barcode("a", "code128", "N");
    const b = { ...barcode("b", "code128", "N"), x: 400, y: 300 } as LeafObject;
    const group = { id: "g", type: "group", x: 0, y: 0, children: [a, b] } as unknown as LabelObject;
    const c = ctx({ a: code128Record("N"), b: code128Record("N") });
    const bars = { x: 40, y: 160, width: 560, height: 220 };
    expect(barBoxDots(group, c)).toEqual(bars);
    expect(selectionUnionDots([group], ["g"], c, barBoxDots)).toEqual(bars);
    expect(selectionUnionDots([a, b], ["a", "b"], c, barBoxDots)).toEqual(bars);
    expect(selectionUnionDots([a, b], ["a", "b"], c)).toEqual({ ...bars, height: 241 });
  });
});

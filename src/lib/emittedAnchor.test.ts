import { describe, expect, it } from "vitest";
import { emittedAnchorDots } from "@zplab/core/lib/emittedAnchor";
import type { ObjectBoundsCtx } from "@zplab/core/lib/objectBounds";
import type { LabelObject } from "@zplab/core/types/Group";
import type { PageLabel } from "@zplab/core/types/LabelConfig";
import type { LeafObject } from "@zplab/core/registry";

const label = { widthMm: 100, heightMm: 50, dpmm: 8 } as PageLabel;
const ctx: ObjectBoundsCtx = { label };

const leaf = (type: string, x: number, y: number, props: object, extra: object = {}): LeafObject =>
  ({ id: "x", type, x, y, rotation: 0, props, ...extra }) as LabelObject as LeafObject;

describe("emittedAnchorDots", () => {
  it("barcodes emit at the model coord (the ZPL anchor)", () => {
    const bc = leaf(
      "code128",
      60,
      80,
      { content: "X", height: 100, moduleWidth: 2, printInterpretation: false, checkDigit: false, rotation: "N" },
      { positionType: "FT" },
    );
    expect(emittedAnchorDots(bc, ctx)).toEqual({ x: 60, y: 80 });
  });

  it("an ^FO box emits its top-left verbatim", () => {
    const box = leaf("box", 10, 20, { width: 100, height: 50, thickness: 2, filled: false, color: "B", rounding: 0 });
    expect(emittedAnchorDots(box, ctx)).toEqual({ x: 10, y: 20 });
  });

  it("an ^FT box anchors the bottom-left corner", () => {
    const box = leaf(
      "box",
      10,
      20,
      { width: 100, height: 50, thickness: 2, filled: false, color: "B", rounding: 0 },
      { positionType: "FT" },
    );
    expect(emittedAnchorDots(box, ctx)).toEqual({ x: 10, y: 70 });
  });

  it("an ^FT right-justified box anchors the bottom-right corner", () => {
    const box = leaf(
      "box",
      10,
      20,
      { width: 100, height: 50, thickness: 2, filled: false, color: "B", rounding: 0 },
      { positionType: "FT", fieldJustify: "R" },
    );
    expect(emittedAnchorDots(box, ctx)).toEqual({ x: 110, y: 70 });
  });

  it("an ^FO line emits at its bbox top-left, not the endpoint", () => {
    // angle 180 runs left from the endpoint: emitted ^FO x = obj.x - length, not obj.x.
    const line = leaf("line", 50, 100, { angle: 180, length: 200, thickness: 4, color: "B" });
    expect(emittedAnchorDots(line, ctx)).toEqual({ x: -150, y: 100 });
  });

  it("an ^FO N text emits at the model x (cap-top transform leaves x unchanged)", () => {
    const txt = leaf("text", -118, 216, { content: "Text", fontHeight: 188, fontWidth: 188, rotation: "N" }, {
      positionType: "FO",
    });
    expect(emittedAnchorDots(txt, ctx).x).toBe(-118);
  });
});

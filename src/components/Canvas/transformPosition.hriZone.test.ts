import { describe, it, expect, afterEach } from "vitest";
import { modelPositionFromRenderedTopLeft, renderedTopLeftFromModel } from "./transformPosition";
import { setMeasuredBounds, clearMeasuredBounds } from "../../lib/measuredBoundsCache";
import type { LeafObject } from "@zplab/core/registry";

const code128 = (rotation: string): LeafObject =>
  ({
    id: "bc",
    type: "code128",
    x: 40,
    y: 100,
    rotation: 0,
    positionType: "FO",
    props: { content: "12345", height: 100, moduleWidth: 2, printInterpretation: true, rotation },
  }) as unknown as LeafObject;

afterEach(() => clearMeasuredBounds("bc"));

describe("^FO barcode with an HRI zone", () => {
  it("round-trips model -> rendered -> model", () => {
    // Inverted: the zone sits above the bars, so the render draws 21 dots up.
    setMeasuredBounds("bc", {
      width: 246, height: 121, barHeightDots: 100,
      barLeftDots: 0, barTopDots: 21, uprightBarWDots: 246, uprightBarHDots: 100,
    });
    const obj = code128("I");
    const rendered = renderedTopLeftFromModel(obj);
    expect(rendered.y).toBe(79);
    expect(modelPositionFromRenderedTopLeft(obj, rendered.x, rendered.y)).toEqual({ x: 40, y: 100 });
  });

  it("round-trips on the x axis when the symbol is rotated", () => {
    setMeasuredBounds("bc", {
      width: 121, height: 246, barHeightDots: 100,
      barLeftDots: 21, barTopDots: 0, uprightBarWDots: 246, uprightBarHDots: 100,
    });
    const obj = code128("R");
    const rendered = renderedTopLeftFromModel(obj);
    expect(rendered.x).toBe(19);
    expect(modelPositionFromRenderedTopLeft(obj, rendered.x, rendered.y)).toEqual({ x: 40, y: 100 });
  });

  it("leaves a barcode without a zone where it is", () => {
    setMeasuredBounds("bc", {
      width: 246, height: 100, barHeightDots: 100,
      barLeftDots: 0, barTopDots: 0, uprightBarWDots: 246, uprightBarHDots: 100,
    });
    const obj = code128("N");
    expect(renderedTopLeftFromModel(obj)).toEqual({ x: 40, y: 100 });
  });
});

describe("a right-justified field", () => {
  const rightText = (): LeafObject =>
    ({
      id: "bc", type: "text", x: 400, y: 50, rotation: 0, positionType: "FO",
      fieldJustify: "R",
      props: { content: "rechts", fontHeight: 30, fontWidth: 0, rotation: "N" },
    }) as unknown as LeafObject;

  it("round-trips its anchor through a resize commit", () => {
    setMeasuredBounds("bc", { width: 120, height: 30 });
    const obj = rightText();
    const rendered = renderedTopLeftFromModel(obj);
    // Drawn one width left of the anchor, like the renderer and the bounds.
    expect(rendered.x).toBe(280);
    expect(modelPositionFromRenderedTopLeft(obj, rendered.x, rendered.y)).toEqual({ x: 400, y: 50 });
  });
});

describe("a right-justified symbol", () => {
  const symbol = (width: number, height: number, rotation = "N"): LeafObject =>
    ({
      id: "sym", type: "symbol", x: 400, y: 50, rotation: 0, positionType: "FO",
      fieldJustify: "R",
      props: { symbol: "A", width, height, rotation },
    }) as unknown as LeafObject;

  it("round-trips its anchor without a measured footprint", () => {
    const obj = symbol(40, 40);
    const rendered = renderedTopLeftFromModel(obj);
    expect(rendered.x).toBe(360);
    expect(modelPositionFromRenderedTopLeft(obj, rendered.x, rendered.y)).toEqual({ x: 400, y: 50 });
  });

  it("uses its width on a quarter turn too, because the ^GS box does not turn", () => {
    const obj = symbol(60, 20, "R");
    expect(renderedTopLeftFromModel(obj).x).toBe(340);
    expect(modelPositionFromRenderedTopLeft(obj, 340, 50)).toEqual({ x: 400, y: 50 });
  });
});

describe("a right-justified field with nothing in it", () => {
  const blank = (): LeafObject =>
    ({
      id: "empty", type: "text", x: 300, y: 40, rotation: 0, positionType: "FO",
      fieldJustify: "R",
      props: { content: "", fontHeight: 30, fontWidth: 0, rotation: "N" },
    }) as unknown as LeafObject;

  it("keeps its anchor across a commit, though nothing was measured", () => {
    const obj = blank();
    const rendered = renderedTopLeftFromModel(obj);
    expect(rendered.x).toBeLessThan(300);
    expect(modelPositionFromRenderedTopLeft(obj, rendered.x, rendered.y)).toEqual({ x: 300, y: 40 });
  });
});

describe("branches that return before the fall-through", () => {
  const rightJustified = (type: string, positionType: "FO" | "FT"): LeafObject =>
    ({
      id: "code", type, x: 400, y: 50, rotation: 0, positionType, fieldJustify: "R",
      props: { content: "HELLO", magnification: 5, dimension: 6, quality: 200, rotation: "N", height: 60, moduleWidth: 2 },
    }) as unknown as LeafObject;

  it("shifts an ^FO qrcode and a ^FT 2D code like every other anchored field", () => {
    for (const [type, pos] of [["qrcode", "FO"], ["qrcode", "FT"], ["datamatrix", "FT"]] as const) {
      const obj = rightJustified(type, pos);
      setMeasuredBounds("code", {
        width: 200, height: 200, barHeightDots: 200,
        barLeftDots: 0, barTopDots: 0, uprightBarWDots: 200, uprightBarHDots: 200,
      });
      const rendered = renderedTopLeftFromModel(obj);
      expect(modelPositionFromRenderedTopLeft(obj, rendered.x, rendered.y).x, `${type} ${pos}`).toBe(400);
      clearMeasuredBounds("code");
    }
  });

  it("anchors a quarter-turned ^FT symbol by the width its box actually has", () => {
    // The committed pair is upright; on a turn the box is 120 wide, not 400,
    // and objectBounds shifts by the box.
    setMeasuredBounds("code", {
      width: 120, height: 400, barHeightDots: 400,
      barLeftDots: 0, barTopDots: 0, uprightBarWDots: 400, uprightBarHDots: 120,
    });
    const obj = {
      id: "code", type: "pdf417", x: 500, y: 300, rotation: 0, positionType: "FT", fieldJustify: "R",
      props: { content: "HELLO", rotation: "R", height: 120, moduleWidth: 2, rowHeight: 4 },
    } as unknown as LeafObject;
    const rendered = renderedTopLeftFromModel(obj);
    expect(modelPositionFromRenderedTopLeft(obj, rendered.x, rendered.y, 400, 120).x).toBe(500);
    clearMeasuredBounds("code");
  });

  it("inverts a resize with the width being committed, not the stale one", () => {
    setMeasuredBounds("bc", { width: 120, height: 30 });
    const obj = {
      id: "bc", type: "text", x: 400, y: 50, rotation: 0, positionType: "FO", fieldJustify: "R",
      props: { content: "rechts", fontHeight: 30, fontWidth: 0, rotation: "N" },
    } as unknown as LeafObject;
    // Grown to 180: the commit has to add back the new width, not the cached one.
    expect(modelPositionFromRenderedTopLeft(obj, 220, 50, 180).x).toBe(400);
  });
});

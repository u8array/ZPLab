import { describe, it, expect } from "vitest";
import { objectBoundsDots, rightAnchorShiftDots } from "./objectBounds";
import { computePreflight } from "./preflight";
import type { LabelObject } from "../types/Group";
import type { PageLabel } from "../types/LabelConfig";

const label = { widthMm: 100, heightMm: 50, dpmm: 8 } as PageLabel;
const ctx = { label };

const text = (extra: Record<string, unknown> = {}, props: Record<string, unknown> = {}): LabelObject =>
  ({
    id: "t", type: "text", x: 776, y: 25, rotation: 0,
    props: { content: "ROESTEREI SEIT 1998", fontHeight: 20, fontWidth: 0, rotation: "N", ...props },
    ...extra,
  }) as LabelObject;

describe("a right-justified field's x is the printed right edge", () => {
  it("puts the box left of the anchor, where the print lands", () => {
    const plain = objectBoundsDots(text(), ctx);
    const right = objectBoundsDots(text({ fieldJustify: "R" }), ctx);
    expect(right.width).toBeCloseTo(plain.width, 5);
    expect(right.x + right.width).toBeCloseTo(776, 5);
  });

  it("leaves a left-justified field alone", () => {
    expect(objectBoundsDots(text(), ctx).x).toBe(776);
  });

  it("keeps 1D barcodes and graphics on their left edge, which their emit converts", () => {
    const bc = { id: "b", type: "code128", x: 100, y: 10, rotation: 0, fieldJustify: "R",
      props: { content: "123", height: 50, moduleWidth: 2, rotation: "N" } } as unknown as LabelObject;
    expect(rightAnchorShiftDots(bc, 200)).toBe(0);
    const box = { id: "g", type: "box", x: 100, y: 10, rotation: 0, fieldJustify: "R",
      props: { width: 200, height: 50 } } as unknown as LabelObject;
    expect(rightAnchorShiftDots(box, 200)).toBe(0);
  });

  it("shifts a ^GS symbol too, which emits through the same anchor echo", () => {
    const symbol = { id: "s", type: "symbol", x: 300, y: 10, rotation: 0, fieldJustify: "R",
      props: { symbol: "A", width: 30, height: 30, rotation: "N" } } as unknown as LabelObject;
    expect(rightAnchorShiftDots(symbol, 30)).toBe(30);
    expect(objectBoundsDots(symbol, ctx).x).toBe(270);
  });

  it("leaves a ^FB block alone, where the block width owns the justification", () => {
    expect(rightAnchorShiftDots(text({ fieldJustify: "R" }, { blockWidth: 300 }), 200)).toBe(0);
  });
});

describe("a serial field whose block props lie dormant", () => {
  it("anchors from the right, like the single line it emits as", () => {
    // Serial mode resolves to "normal"; blockWidth stays behind but unused, so
    // the field is not a block and its x still means the right edge.
    const serial = text({ fieldJustify: "R" }, { serial: { start: "1", step: 1 }, blockWidth: 300 });
    const box = objectBoundsDots(serial, ctx);
    expect(box.x + box.width).toBeCloseTo(776, 5);
  });
});

describe("a right-justified field hanging off the home edge", () => {
  // Its ink runs left of the anchor, so an anchor that is on the label says
  // nothing: without a box test the whole field reported clean.
  it("is reported off-label, exactly as the left-justified twin is", () => {
    const small = { widthMm: 37.5, heightMm: 25, dpmm: 8 } as never;
    const text = (justify: "L" | "R") =>
      ({
        id: "t", type: "text", x: 100, y: 20, rotation: 0, fieldJustify: justify,
        props: { content: "HELLO WORLD LONG", fontHeight: 40, fontWidth: 0, rotation: "N" },
      }) as never;
    const kinds = (justify: "L" | "R") =>
      computePreflight([text(justify)], { label: small }, "mm").map((f) => f.kind);
    expect(kinds("L")).toContain("offLabelClipped");
    expect(kinds("R")).toContain("offLabelClipped");
  });
});

describe("a right-justified field off the bottom edge", () => {
  // The home-edge shortcut must not downgrade a field that is also fully below
  // the label to "clipped"; nothing of it prints.
  it("is outside, not clipped, when it also hangs off the home edge", () => {
    const small = { widthMm: 50, heightMm: 30, dpmm: 8 } as never; // 400x240 dots
    const text = {
      id: "t", type: "text", x: 5, y: 500, rotation: 0, fieldJustify: "R",
      props: { content: "HELLO", fontHeight: 30, fontWidth: 0, rotation: "N" },
    } as never;
    expect(computePreflight([text], { label: small }, "mm").map((f) => f.kind))
      .toContain("offLabelOutside");
  });
});

describe("a right-justified ^FT graphic hanging off the home edge", () => {
  // Graphics keep model x on the LEFT and convert on emit (^FT x+w,y+h,1), so
  // their ink runs left of the anchor just like a right-justified text field's.
  // The anchor test alone reported the whole box clean.
  it("is reported off-label, like the left-justified twin", () => {
    const label = { widthMm: 100, heightMm: 50, dpmm: 8 } as never;
    const box = (justify?: "R") =>
      ({
        id: "b", type: "box", x: -50, y: 20, rotation: 0,
        positionType: "FT", ...(justify ? { fieldJustify: justify } : {}),
        props: { width: 100, height: 50, thickness: 2, color: "B", rounding: 0 },
      }) as never;
    const kinds = (justify?: "R") =>
      computePreflight([box(justify)], { label }, "mm").map((f) => f.kind);
    // Left-justified anchors at the negative x itself (nothing prints);
    // right-justified anchors at x+w, which is ON the label, so only the box
    // test catches the half that hangs off. Both must be flagged.
    expect(kinds()).toContain("offLabelOutside");
    expect(kinds("R")).toContain("offLabelClipped");
  });
});

describe("a runaway ^GF bytes-per-row", () => {
  it("does not report an 8-million-dot box", () => {
    const label = { widthMm: 60, heightMm: 40, dpmm: 8 } as never;
    const img = {
      id: "g", type: "image", x: 0, y: 0, rotation: 0,
      props: { imageId: "", widthDots: 8, rawGf: "^GFA,,,1000000," },
    } as never;
    const box = objectBoundsDots(img, { label });
    expect(box.width).toBeLessThan(100000);
  });
});

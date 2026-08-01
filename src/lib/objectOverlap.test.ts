import { describe, expect, it } from "vitest";
import { computeOverlaps, leafBoxesDots } from "@zplab/core/lib/objectOverlap";
import type { ObjectBoundsCtx } from "@zplab/core/lib/objectBounds";
import type { PageLabel } from "@zplab/core/types/LabelConfig";
import type { LeafObject } from "@zplab/core/registry";

const label = { widthMm: 100, heightMm: 50, dpmm: 8 } as PageLabel;
const ctx: ObjectBoundsCtx = { label };

const box = (id: string, x: number, y: number, width: number, height: number) =>
  ({
    id, type: "box", x, y, rotation: 0,
    props: { width, height, thickness: 3, filled: false, color: "B", rounding: 0 },
  }) as LeafObject;

const boxesOf = (...leaves: LeafObject[]) => leafBoxesDots(leaves, ctx);

describe("computeOverlaps", () => {
  it("reports the intersection rect for two overlapping boxes", () => {
    const boxes = boxesOf(box("a", 0, 0, 100, 100), box("b", 60, 60, 100, 100));
    expect(computeOverlaps(boxes)).toEqual([
      { a: "a", b: "b", x: 60, y: 60, width: 40, height: 40, approx: false },
    ]);
  });

  it("returns nothing for disjoint or edge-touching boxes", () => {
    const boxes = boxesOf(
      box("a", 0, 0, 50, 50),
      box("b", 200, 200, 50, 50),
      // Shares the x=50 edge with a: zero-area, not an overlap.
      box("c", 50, 0, 50, 50),
    );
    expect(computeOverlaps(boxes)).toEqual([]);
  });

  it("flags approx when a barcode footprint is involved", () => {
    const bc = {
      id: "bc", type: "code128", x: 10, y: 10, rotation: 0,
      props: {
        content: "12345", height: 80, moduleWidth: 2,
        printInterpretation: false, checkDigit: false, rotation: "N",
      },
    } as LeafObject;
    const boxes = boxesOf(box("frame", 0, 0, 400, 200), bc);
    const [overlap] = computeOverlaps(boxes);
    expect(overlap?.approx).toBe(true);
  });

  it("a measured footprint makes a barcode exact (bounds + approx)", () => {
    const bc = {
      id: "bc", type: "code128", x: 10, y: 10, rotation: 0,
      props: {
        content: "12345", height: 80, moduleWidth: 2,
        printInterpretation: false, checkDigit: false, rotation: "N",
      },
    } as LeafObject;
    const measured = new Map([["bc", { width: 321, height: 88 }]]);
    const [entry] = leafBoxesDots([bc], { label, measured });
    expect(entry?.approx).toBe(false);
    expect(entry?.box.width).toBe(321);
    expect(entry?.box.height).toBe(88);
  });

  it("flags single-line text as approx (headless font estimate), block text exact", () => {
    const single = {
      id: "t", type: "text", x: 0, y: 0, rotation: 0,
      props: { content: "Hi", fontHeight: 30, fontWidth: 0, rotation: "N" },
    } as LeafObject;
    const block = {
      id: "b", type: "text", x: 0, y: 0, rotation: 0,
      props: { content: "Hi", fontHeight: 30, fontWidth: 0, rotation: "N", mode: "fb", blockWidth: 200 },
    } as LeafObject;
    expect(leafBoxesDots([single], ctx)[0]?.approx).toBe(true);
    expect(leafBoxesDots([block], ctx)[0]?.approx).toBe(false);
  });

  it("flags an image without heightDots as approx (square guess), with it exact", () => {
    const guess = {
      id: "i1", type: "image", x: 0, y: 0, rotation: 0,
      props: { imageId: "a", widthDots: 90, threshold: 128 },
    } as LeafObject;
    const exact = {
      id: "i2", type: "image", x: 0, y: 0, rotation: 0,
      props: { imageId: "a", widthDots: 90, heightDots: 40, threshold: 128 },
    } as LeafObject;
    expect(leafBoxesDots([guess], ctx)[0]?.approx).toBe(true);
    expect(leafBoxesDots([exact], ctx)[0]?.approx).toBe(false);
  });

  it("emits one entry per intersecting pair (n objects → pairs)", () => {
    const boxes = boxesOf(
      box("a", 0, 0, 100, 100),
      box("b", 10, 10, 100, 100),
      box("c", 20, 20, 100, 100),
    );
    expect(computeOverlaps(boxes).map((o) => [o.a, o.b])).toEqual([
      ["a", "b"],
      ["a", "c"],
      ["b", "c"],
    ]);
  });
});

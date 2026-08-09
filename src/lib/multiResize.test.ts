import { describe, it, expect } from "vitest";
import { projectedAnchorXDots, projectMultiResize } from "./multiResize";
import type { LeafObject } from "@zplab/core/registry";

const ident = (v: number) => v;
const bbox = { x: 100, y: 100, width: 200, height: 100 };

function leaf(id: string, type: string, x: number, y: number, props: object): LeafObject {
  return { id, type, x, y, rotation: 0, props } as unknown as LeafObject;
}

describe("projectMultiResize", () => {
  it("reprojects positions linearly to the new bbox", () => {
    // Anchor at 25% / 50% of the bbox stays at 25% / 50% after scaling.
    const changes = projectMultiResize(
      [leaf("t1", "text", 150, 150, { content: "x" })],
      bbox,
      { x: bbox.x, y: bbox.y },
      2,
      0.5,
      ident,
    );
    expect(changes).toEqual([{ id: "t1", x: 200, y: 125 }]);
  });

  it("keeps a barcode's props untouched (position only)", () => {
    const changes = projectMultiResize(
      [leaf("b1", "code128", 300, 100, { content: "1", moduleWidth: 3, height: 80 })],
      bbox,
      { x: bbox.x, y: bbox.y },
      1.5,
      1,
      ident,
    );
    expect(changes).toEqual([{ id: "b1", x: 400, y: 100 }]);
  });

  it("scales box geometry through its registry commit (clamped, snapped)", () => {
    const changes = projectMultiResize(
      [leaf("s1", "box", 100, 100, { width: 100, height: 60, thickness: 8, filled: false, color: "B", rounding: 0 })],
      bbox,
      { x: bbox.x, y: bbox.y },
      0.5,
      0.5,
      ident,
    );
    expect(changes).toEqual([
      { id: "s1", x: 100, y: 100, props: { width: 50, height: 30 } },
    ]);
  });

  it("does not scale thickness", () => {
    const [change] = projectMultiResize(
      [leaf("s1", "box", 100, 100, { width: 100, height: 60, thickness: 8, filled: false, color: "B", rounding: 0 })],
      bbox,
      { x: bbox.x, y: bbox.y },
      3,
      3,
      ident,
    );
    expect(change?.props).not.toHaveProperty("thickness");
  });

  it("reprojects a line endpoint into new angle and length", () => {
    // Horizontal line stretched x2 horizontally stays horizontal, doubles.
    const [h] = projectMultiResize(
      [leaf("l1", "line", 100, 100, { angle: 0, length: 100, thickness: 2, color: "B" })],
      bbox,
      { x: bbox.x, y: bbox.y },
      2,
      1,
      ident,
    );
    expect(h?.props).toEqual({ angle: 0, length: 200, thickness: 2 });
    // A 45 degree line under x-only scaling flattens toward the x axis.
    const [d] = projectMultiResize(
      [leaf("l2", "line", 100, 100, { angle: 45, length: 100, thickness: 2, color: "B" })],
      bbox,
      { x: bbox.x, y: bbox.y },
      2,
      1,
      ident,
    );
    expect(d?.props?.angle).toBeCloseTo(27, 0);
    expect(d?.props?.length).toBe(158);
  });

  // Same invariant as the endpoint/panel commits: t > length would land in
  // the ^GB t-promotion regime and print a t x t block.
  it("caps line thickness to the shrunken length", () => {
    const [c] = projectMultiResize(
      [leaf("l1", "line", 100, 100, { angle: 0, length: 100, thickness: 40, color: "B" })],
      bbox,
      { x: bbox.x, y: bbox.y },
      0.25,
      1,
      ident,
    );
    expect(c?.props).toEqual({ angle: 0, length: 25, thickness: 25 });
  });

  it("ellipse honors lockAspect via its registry commit", () => {
    const [c] = projectMultiResize(
      [leaf("e1", "ellipse", 120, 120, { width: 80, height: 80, thickness: 3, filled: false, color: "B", lockAspect: true })],
      bbox,
      { x: bbox.x, y: bbox.y },
      2,
      1.5,
      ident,
    );
    // lockAspect collapses to the smaller factor on both axes.
    expect(c?.props).toEqual({ width: 120, height: 120 });
  });

  // Left-anchor drag: the origin moves, the right edge stays pinned.
  it("keeps the opposite edge fixed when the origin moves", () => {
    const changes = projectMultiResize(
      [leaf("t1", "text", 300, 100, { content: "x" })],
      bbox,
      { x: 0, y: 100 },
      1.5,
      1,
      ident,
    );
    // Anchor at the right bbox edge (x=300): 0 + 200 * 1.5 = 300, unchanged.
    expect(changes).toEqual([{ id: "t1", x: 300, y: 100 }]);
  });

});

describe("a right-justified member of the selection", () => {
  // Its model x IS the printed right edge while the union bbox is ink space, so
  // projecting the raw x walked the field right by its own box width and out of
  // the selection frame.
  it("keeps its ink edge flush with a left-anchored twin", () => {
    const symbol = leaf("s", "symbol", 400, 100, { width: 120, height: 40, symbol: "A", rotation: "N" });
    (symbol as unknown as { fieldJustify: string }).fieldJustify = "R";
    const box = leaf("b", "box", 280, 100, { width: 200, height: 40, thickness: 2, filled: false, color: "B", rounding: 0 });
    // Both ink left edges sit at 280, so the union starts there; pin that edge.
    const union = { x: 280, y: 100, width: 200, height: 40 };
    const changes = projectMultiResize([symbol, box], union, { x: union.x, y: union.y }, 2, 1, ident);
    // The box stays at 280, and the symbol's ink left edge (x - width) must stay
    // 280 too, i.e. its model x stays 400.
    expect(changes.find((c) => c.id === "b")?.x).toBe(280);
    expect((changes.find((c) => c.id === "s")?.x ?? 0) - 120).toBe(280);
  });
});

describe("a right-justified member whose width was never measured", () => {
  // Its ink edge is unknown, so projecting its model x would move it in the
  // wrong space. Keeping x loses the resize for that member; guessing lost its
  // position by a full ink width and persisted that.
  it("keeps its x rather than projecting the wrong space", () => {
    const qr = leaf("q", "qrcode", 500, 100, { content: "X", magnification: 5, errorCorrection: "M", model: 2, rotation: "N" });
    (qr as unknown as { fieldJustify: string }).fieldJustify = "R";
    const [c] = projectMultiResize([qr], bbox, { x: 0, y: bbox.y }, 2, 1, ident);
    expect(c?.x).toBe(500);
  });

  it("still projects it once a measurement exists", () => {
    const qr = leaf("q", "qrcode", 500, 100, { content: "X", magnification: 5, errorCorrection: "M", model: 2, rotation: "N" });
    (qr as unknown as { fieldJustify: string }).fieldJustify = "R";
    const [c] = projectMultiResize([qr], bbox, { x: 0, y: bbox.y }, 2, 1, ident, () => 200);
    // Ink edge 500-200=300 projects to (300-100)*2 = 400, anchor back to 600.
    expect(c?.x).toBe(600);
  });
});

// The transformer's live preview projects projectedAnchorXDots and lets the
// render offset ride along unscaled; the commit projects the same quantity and
// carries the anchor back. Pinning the shared rule keeps the drag from showing
// one position and the release committing another.
describe("the quantity a resize projects", () => {
  const rightSymbol = () => {
    const s = leaf("s", "symbol", 400, 100, { width: 120, height: 40, symbol: "A", rotation: "N" });
    (s as unknown as { fieldJustify: string }).fieldJustify = "R";
    return s;
  };

  it("is the ink edge for a right-anchored field and the model x otherwise", () => {
    expect(projectedAnchorXDots(rightSymbol())).toBe(280);
    expect(projectedAnchorXDots(leaf("t", "text", 400, 100, { content: "x" }))).toBe(400);
  });

  it("is null exactly when the commit holds the leaf still", () => {
    const qr = leaf("q", "qrcode", 500, 100, { content: "X", magnification: 5, errorCorrection: "M", model: 2, rotation: "N" });
    (qr as unknown as { fieldJustify: string }).fieldJustify = "R";
    expect(projectedAnchorXDots(qr)).toBeNull();
    expect(projectMultiResize([qr], bbox, { x: 0, y: bbox.y }, 2, 1, ident)[0]?.x).toBe(500);
  });

  it("lands the live preview and the commit on the same rendered x", () => {
    const s = rightSymbol();
    const union = { x: 280, y: 100, width: 200, height: 40 };
    const fx = 2;
    const proj = projectedAnchorXDots(s)!;
    const live = union.x + (proj - union.x) * fx + (s.x - 120 - proj);
    const committed = projectMultiResize([s], union, { x: union.x, y: union.y }, fx, 1, ident)[0]!.x;
    expect(live).toBe(committed - 120);
  });
});

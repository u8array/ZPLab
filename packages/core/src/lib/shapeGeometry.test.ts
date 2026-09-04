import { describe, it, expect } from "vitest";
import { boxCornerRadii, outlineInset, diagonalPolygonPoints } from "./shapeGeometry";

describe("outlineInset", () => {
  it("returns the unmodified bbox for a filled shape", () => {
    expect(outlineInset(100, 60, 5, true)).toEqual({
      offset: 0,
      width: 100,
      height: 60,
      renderFilled: true,
    });
  });

  it("insets by t/2 on every side for a typical outline", () => {
    expect(outlineInset(100, 60, 6, false)).toEqual({
      offset: 3,
      width: 94,
      height: 54,
      renderFilled: false,
    });
  });

  it("clamps to solid when 2t reaches min(w, h) (firmware behaviour)", () => {
    // min(20, 100) = 20, 2*10 = 20 → clamp triggers.
    expect(outlineInset(100, 20, 10, false)).toEqual({
      offset: 0,
      width: 100,
      height: 20,
      renderFilled: true,
    });
  });

  it("does not clamp one dot below the threshold", () => {
    // min(20, 100) = 20, 2*9 = 18 → outline still renders.
    expect(outlineInset(100, 20, 9, false)).toMatchObject({
      renderFilled: false,
    });
  });

  it("clamps zero-or-negative inset dimensions to 0", () => {
    // Pathological case: thickness larger than the bbox triggers clamp
    // first, so we get the filled values, never negative width/height.
    const result = outlineInset(10, 10, 50, false);
    expect(result.width).toBeGreaterThanOrEqual(0);
    expect(result.height).toBeGreaterThanOrEqual(0);
    expect(result.renderFilled).toBe(true);
  });
});

describe("diagonalPolygonPoints", () => {
  it("places the conceptual line endpoints on the same long edge (L orientation)", () => {
    // Line top-left → bottom-right, slope +. Both endpoints should appear
    // verbatim among the four polygon vertices and sit on the *left*
    // long edge (smaller x at each y).
    const pts = diagonalPolygonPoints(100, 100, 200, 200, 10);
    expect(pts).toEqual([
      100, 100,
      110, 100,
      210, 200,
      200, 200,
    ]);
  });

  it("uses the +x-shifted parallel edge for R orientation (slash)", () => {
    // Line top-right → bottom-left, slope −. The line endpoints
    // (200, 100) and (100, 200) lie on the same long edge of the
    // returned parallelogram.
    const pts = diagonalPolygonPoints(200, 100, 100, 200, 10);
    expect(pts).toEqual([
      200, 100,
      210, 100,
      110, 200,
      100, 200,
    ]);
  });

  it("normalises arbitrary endpoint order to a canonical bbox", () => {
    // (300, 300) → (100, 100) is the same diagonal as (100, 100) →
    // (300, 300); helper should produce the same set of vertices.
    const forward = diagonalPolygonPoints(100, 100, 300, 300, 6);
    const reverse = diagonalPolygonPoints(300, 300, 100, 100, 6);
    // Sort vertex pairs lexicographically so order-insensitive compare.
    const pairs = (flat: number[]) => {
      const out: [number, number][] = [];
      for (let i = 0; i < flat.length; i += 2) out.push([flat[i]!, flat[i + 1]!]);
      return out.sort(([ax, ay], [bx, by]) => ax - bx || ay - by);
    };
    expect(pairs(forward)).toEqual(pairs(reverse));
  });

  it("returns 8 numbers (4 vertices × 2 coords)", () => {
    expect(diagonalPolygonPoints(0, 0, 50, 50, 3)).toHaveLength(8);
  });
});

describe("boxCornerRadii", () => {
  // ZD230 and Labelary, diagonal-measured: one pixel step is 3.4 dots of radius.
  it.each([
    [200, 200, 4, 1, 13.7, 13.7],
    [200, 200, 4, 2, 27.3, 23.9],
    [200, 200, 4, 4, 51.2, 47.8],
    [200, 200, 4, 6, 75.1, 71.7],
    [200, 200, 4, 8, 99.0, 95.6],
    [400, 200, 4, 4, 51.2, 47.8],
    [200, 200, 40, 2, 27.3, 17.1],
    [200, 200, 40, 4, 51.2, 30.7],
    [200, 200, 40, 8, 99.0, 58.0],
    [10, 200, 50, 8, 23.9, 0],
  ])("w=%i h=%i t=%i r=%i matches the printer within one step", (w, h, t, r, outer, inner) => {
    const got = boxCornerRadii(w, h, t, r);
    expect(Math.abs(got.outer - outer)).toBeLessThan(3.5);
    expect(Math.abs(got.inner - inner)).toBeLessThan(3.5);
  });

  it("is the guide's formula outside: rounding/8 of half the shorter side", () => {
    expect(boxCornerRadii(400, 200, 4, 8).outer).toBe(100);
    expect(boxCornerRadii(400, 200, 4, 1).outer).toBe(12.5);
  });

  it("rounds the inner edge from the inset rectangle, not concentrically", () => {
    // Concentric would give 50 - 40 = 10; the printer draws 30.
    expect(boxCornerRadii(200, 200, 40, 4).inner).toBe(30);
    expect(boxCornerRadii(200, 200, 100, 4).inner).toBe(0);
  });

  it("rounds the box ^GB draws: a side never below the border, the border never below 1", () => {
    // ^GB10,200,50 prints a 50-wide bar; the radius follows the printed width.
    expect(boxCornerRadii(10, 200, 50, 8).outer).toBe(25);
    expect(boxCornerRadii(200, 200, 0, 4).inner).toBe(boxCornerRadii(200, 200, 1, 4).inner);
  });

  it("clamps the rounding index to 0..8", () => {
    expect(boxCornerRadii(200, 200, 4, 12).outer).toBe(100);
    expect(boxCornerRadii(200, 200, 4, -1).outer).toBe(0);
  });
});

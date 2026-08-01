import { describe, it, expect } from "vitest";
import { snapToGrid, gridSnapDelta, smartSnapDelta, labelSnapRectDots } from "./dragGeometry";
import type { BoundingBoxDots } from "@zplab/core/lib/objectBounds";
import type { SnapRect } from "../../lib/snapGuides";
import type { PageLabel } from "@zplab/core/types/LabelConfig";

describe("labelSnapRectDots", () => {
  it("is the plain printable area without ^LS", () => {
    expect(labelSnapRectDots({ widthMm: 10, heightMm: 5, dpmm: 8 } as PageLabel)).toEqual({
      id: "_lbl", x: 0, y: 0, width: 80, height: 40,
    });
  });

  it("accounts for the ^LS shift: content shifts left, window starts at +shift", () => {
    expect(labelSnapRectDots({ widthMm: 10, heightMm: 5, dpmm: 8, labelShift: 12 } as PageLabel)).toEqual({
      id: "_lbl", x: 12, y: 0, width: 80, height: 40,
    });
  });
});

describe("snapToGrid", () => {
  it("rounds to the nearest grid multiple", () => {
    expect(snapToGrid(11, 8)).toBe(8);
    expect(snapToGrid(13, 8)).toBe(16);
    expect(snapToGrid(-3, 8)).toBe(-0);
  });

  it("is identity when the grid is off (<= 0)", () => {
    expect(snapToGrid(13, 0)).toBe(13);
    expect(snapToGrid(13, -8)).toBe(13);
  });
});

describe("gridSnapDelta", () => {
  const box = (x: number, y: number, width = 50, height = 50): BoundingBoxDots => ({ x, y, width, height });

  it("snaps the top-left and ignores the box size", () => {
    const small = gridSnapDelta(box(11, 13, 10, 10), 8);
    const large = gridSnapDelta(box(11, 13, 999, 999), 8);
    // One delta for the whole drag: size must not change it.
    expect(small).toEqual({ dx: -3, dy: 3 });
    expect(large).toEqual(small);
  });

  it("returns zero when already on grid", () => {
    expect(gridSnapDelta(box(16, 24), 8)).toEqual({ dx: 0, dy: 0 });
  });

  it("returns zero delta when the grid is off", () => {
    expect(gridSnapDelta(box(11, 13), 0)).toEqual({ dx: 0, dy: 0 });
  });
});

describe("smartSnapDelta", () => {
  const rect = (id: string, x: number, y: number, width = 40, height = 40): SnapRect => ({ id, x, y, width, height });

  it("aligns the dragged left edge to another object's left edge within threshold", () => {
    // Dragged at x=103, other at x=100 → snaps left by 3.
    const dragged = rect("sel", 103, 300);
    const others = [rect("a", 100, 100)];
    const { dx, guides } = smartSnapDelta(dragged, others, undefined, 6);
    expect(dx).toBe(-3);
    expect(guides.length).toBeGreaterThan(0);
  });

  it("returns no delta and no guides when nothing is within threshold", () => {
    const dragged = rect("sel", 500, 500);
    const others = [rect("a", 100, 100)];
    const res = smartSnapDelta(dragged, others, undefined, 6);
    expect(res).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it("snaps to the label center", () => {
    const label = rect("_lbl", 0, 0, 200, 200);
    // Dragged 40-wide box; centering it puts its left at 80. Start at 83 → dx -3.
    const dragged = rect("sel", 83, 300, 40, 40);
    const { dx } = smartSnapDelta(dragged, [], label, 6);
    expect(dx).toBe(-3);
  });
});

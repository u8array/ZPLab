import { describe, expect, it } from "vitest";
import { safeAreaRectDots, safeAreaRectsDots } from "./safeArea";
import type { PageLabel } from "@zplab/core/types/LabelConfig";

const base = { widthMm: 100, heightMm: 50, dpmm: 8 } as PageLabel;

describe("safeAreaRectDots", () => {
  it("insets the label rect by the margin in dots", () => {
    // 2mm * 8dpmm = 16 dots; 100mm->800, 50mm->400.
    expect(safeAreaRectDots({ ...base, safeAreaMm: 2 })).toEqual({
      x: 16,
      y: 16,
      width: 800 - 32,
      height: 400 - 32,
    });
  });

  it("returns null when the margin is unset", () => {
    expect(safeAreaRectDots(base)).toBeNull();
  });

  it("returns null when the margin is zero", () => {
    expect(safeAreaRectDots({ ...base, safeAreaMm: 0 })).toBeNull();
  });

  it("returns null when the inset collapses the rect", () => {
    // 30mm inset on a 50mm-tall label leaves negative height.
    expect(safeAreaRectDots({ ...base, safeAreaMm: 30 })).toBeNull();
  });

  it("insets the ^LS printable rect (^LS shifts content left, window at +shift)", () => {
    // labelShift 80: printable rect x=80, width=800; inset 16 each side.
    expect(safeAreaRectDots({ ...base, safeAreaMm: 2, labelShift: 80 })).toEqual({
      x: 80 + 16,
      y: 16,
      width: 800 - 32,
      height: 400 - 32,
    });
  });
});

describe("safeAreaRectsDots", () => {
  it("insets every label of a row", () => {
    // 100 mm in two with a gap of 4 mm: labels of 384 dots at 0 and 416.
    const row = { ...base, safeAreaMm: 2, labelsAcross: { count: 2, gapMm: 4 } };
    expect(safeAreaRectsDots(row)).toEqual([
      { x: 16, y: 16, width: 352, height: 368 },
      { x: 432, y: 16, width: 352, height: 368 },
    ]);
  });

  it("is the one inset without a row", () => {
    expect(safeAreaRectsDots({ ...base, safeAreaMm: 2 })).toEqual([{ x: 16, y: 16, width: 768, height: 368 }]);
  });

  it("is empty without a safe area", () => {
    expect(safeAreaRectsDots(base)).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { resolveDefaultSizeDots } from "@zplab/core/lib/resolveDefaultSize";
import type { PageLabel } from "@zplab/core/types/LabelConfig";
const labelAt = (dpmm: number): PageLabel =>
  ({ widthMm: 100, heightMm: 50, dpmm }) as PageLabel;

describe("resolveDefaultSizeDots", () => {
  it("passes a dots-shape through unchanged regardless of dpmm", () => {
    const dots = { width: 200, height: 40 };
    expect(resolveDefaultSizeDots(dots, labelAt(8))).toEqual({ width: 200, height: 40 });
    expect(resolveDefaultSizeDots(dots, labelAt(12))).toEqual({ width: 200, height: 40 });
  });

  it("converts mm-shape to dots at the label's dpmm", () => {
    const mm = { widthMm: 28.14, heightMm: 26.91 };
    // mmToDots rounds, so spell out the expected integer dot values.
    expect(resolveDefaultSizeDots(mm, labelAt(8))).toEqual({ width: 225, height: 215 });
    expect(resolveDefaultSizeDots(mm, labelAt(12))).toEqual({ width: 338, height: 323 });
  });

  it("keeps the physical footprint constant across dpmm (no drift)", () => {
    const mm = { widthMm: 28.14, heightMm: 26.91 };
    const at8 = resolveDefaultSizeDots(mm, labelAt(8));
    const at12 = resolveDefaultSizeDots(mm, labelAt(12));
    // dots / dpmm == mm: rounded-trip stays within 0.1 mm of the input
    expect(at8.width / 8).toBeCloseTo(28.14, 1);
    expect(at12.width / 12).toBeCloseTo(28.14, 1);
  });
});

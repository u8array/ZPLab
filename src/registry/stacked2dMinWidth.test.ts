import { describe, it, expect } from "vitest";
import { pdf417 } from "@zplab/core/registry/pdf417";
import { codablock } from "@zplab/core/registry/codablock";
import { micropdf417 } from "@zplab/core/registry/micropdf417";

const ctx = { sx: 0.1, sy: 1, snap: (v: number) => v, nodeHeight: 0, anchor: null };
const leaf = (type: string, props: object) =>
  ({ id: type, type, x: 0, y: 0, rotation: 0, props }) as never;
const mw = (r: unknown) => (r as { moduleWidth: number }).moduleWidth;

// ^BY module width floor is 2 for ^B7 (spec p.82) and CODABLOCK A (p.92), but
// the general 1 for everything else. A hard horizontal shrink must not drop below.
describe("stacked-2D ^BY moduleWidth minimum on resize commit", () => {
  it("PDF417 clamps moduleWidth to 2", () => {
    const obj = leaf("pdf417", { content: "x", rowHeight: 2, securityLevel: 0, columns: 0, moduleWidth: 4, rotation: "N" });
    expect(mw(pdf417.commitTransform?.(obj, ctx))).toBe(2);
    expect(pdf417.propSpecs.moduleWidth.min).toBe(2);
  });

  it("CODABLOCK clamps moduleWidth to 2", () => {
    const obj = leaf("codablock", { content: "x", moduleWidth: 4, rowHeight: 2, securityLevel: "Y", rotation: "N" });
    expect(mw(codablock.commitTransform?.(obj, ctx))).toBe(2);
    expect(codablock.propSpecs.moduleWidth.min).toBe(2);
  });

  it("MicroPDF417 keeps the general floor of 1", () => {
    const obj = leaf("micropdf417", { content: "x", rowHeight: 2, mode: 0, moduleWidth: 4, rotation: "N" });
    expect(mw(micropdf417.commitTransform?.(obj, ctx))).toBe(1);
    expect(micropdf417.propSpecs.moduleWidth.min).toBe(1);
  });
});

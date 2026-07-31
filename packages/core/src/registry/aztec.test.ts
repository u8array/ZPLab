import { describe, expect, it } from "vitest";
import { aztecBwipOptions } from "../lib/barcodeDims";
import { getEntry, type LeafObject } from ".";
import type { LabelObject } from "../types/Group";
import type { LabelConfig } from "../types/LabelConfig";

const pctx = { label: { widthMm: 100, heightMm: 100, dpmm: 8 } as LabelConfig, unit: "mm" } as const;

const az = (ecLevel: number): LeafObject =>
  ({ id: "a", type: "aztec", x: 0, y: 0, rotation: 0,
     props: { content: "1234567890", magnification: 4, ecLevel, rotation: "N" } } as LabelObject as LeafObject);

describe("aztec ecLevel preflight", () => {
  it("flags percent values below the encoder band (1-4)", () => {
    expect(getEntry("aztec")!.preflight!(az(1), pctx)).toEqual([{ kind: "aztecEcLevelOutOfRange", detail: "1 (valid 5-95)" }]);
    expect(getEntry("aztec")!.preflight!(az(4), pctx)).toEqual([{ kind: "aztecEcLevelOutOfRange", detail: "4 (valid 5-95)" }]);
  });

  it("flags percent values above the encoder band (96-99)", () => {
    expect(getEntry("aztec")!.preflight!(az(96), pctx)).toEqual([{ kind: "aztecEcLevelOutOfRange", detail: "96 (valid 5-95)" }]);
    expect(getEntry("aztec")!.preflight!(az(99), pctx)).toEqual([{ kind: "aztecEcLevelOutOfRange", detail: "99 (valid 5-95)" }]);
  });

  it("accepts the band edges 5 and 95", () => {
    expect(getEntry("aztec")!.preflight!(az(5), pctx)).toEqual([]);
    expect(getEntry("aztec")!.preflight!(az(95), pctx)).toEqual([]);
  });

  it("never flags the special layer/rune domains", () => {
    for (const ec of [0, 101, 104, 201, 232, 300]) {
      expect(getEntry("aztec")!.preflight!(az(ec), pctx)).toEqual([]);
    }
  });

  it("flags the undefined zones between the domains (100, 105-200, 233-299)", () => {
    // The UI range is a continuous 0-300, so these are enterable; the preview
    // silently auto-sizes and printer behavior is undefined, hence the warning.
    for (const ec of [100, 105, 150, 200, 233, 299]) {
      expect(getEntry("aztec")!.preflight!(az(ec), pctx)).toEqual([
        { kind: "aztecEcLevelOutOfRange", detail: `${ec} (valid 5-95)` },
      ]);
    }
  });
});

describe("aztecBwipOptions maps to the encoder's real 5-95 band", () => {
  it("keeps in-band percents on eclevel", () => {
    expect(aztecBwipOptions(5)).toEqual({ bcid: "azteccodecompact", eclevel: 5 });
    expect(aztecBwipOptions(95)).toEqual({ bcid: "azteccodecompact", eclevel: 95 });
  });

  it("drops out-of-band percents to auto sizing (no eclevel that would throw)", () => {
    for (const ec of [1, 4, 96, 99]) {
      expect(aztecBwipOptions(ec)).toEqual({ bcid: "azteccodecompact" });
    }
  });

  it("preserves the special layer/rune mappings", () => {
    expect(aztecBwipOptions(300)).toEqual({ bcid: "azteccode", format: "rune" });
    expect(aztecBwipOptions(201)).toEqual({ bcid: "azteccode", format: "full", layers: 1 });
    expect(aztecBwipOptions(101)).toEqual({ bcid: "azteccodecompact", layers: 1 });
    expect(aztecBwipOptions(0)).toEqual({ bcid: "azteccodecompact" });
  });
});

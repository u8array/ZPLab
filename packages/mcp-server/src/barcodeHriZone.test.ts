import { describe, it, expect } from "vitest";
import { HRI_LINE_TYPES, barcodeTextZoneDots, hriZoneDots } from "@zplab/core/lib/barcodeHri";
import { registerSidecarFootprintMeasurer } from "./footprint";
import { createDraft } from "./tools";

registerSidecarFootprintMeasurer();

/** Measured footprint height of one barcode, with the interpretation line on
 *  or off, through the same kernel the canvas uses. */
function height(type: string, printInterpretation: boolean): number {
  const content: Record<string, string> = {
    code11: "12345", interleaved2of5: "1234", msi: "12345", codabar: "A12345B",
    industrial2of5: "12345", standard2of5: "12345",
  };
  const r = createDraft({
    widthMm: 100, heightMm: 60, dpmm: 8,
    objects: [{
      type, x: 10, y: 10,
      props: { content: content[type] ?? "12345", height: 100, moduleWidth: 2, printInterpretation },
    }],
  });
  if (!r.ok) throw new Error(`${type}: ${r.errors.join()}`);
  return r.bounds[0]!.height;
}

describe("HRI zone", () => {
  it("adds the measured band for every type that prints an interpretation line", () => {
    // An independent constant, or the loop would only compare the kernel
    // against itself; ^B4 has its own measured band and is pinned below.
    const zone = hriZoneDots(2);
    for (const type of HRI_LINE_TYPES) {
      if (type === "code49") continue;
      expect(height(type, true) - height(type, false), `${type} zone`).toBe(zone);
    }
  });

  it("reserves ^B4's measured band on the side the line prints", () => {
    // ZD230 at mw 2/3/4: 26/35/44 above the bars, 20/27/34 below.
    for (const [mw, above, below] of [[2, 26, 20], [3, 35, 27], [4, 44, 34]] as const) {
      const zone = (printInterpretationAbove: boolean) =>
        barcodeTextZoneDots({
          id: "z", type: "code49", x: 0, y: 0,
          props: { moduleWidth: mw, printInterpretation: true, printInterpretationAbove },
        } as never);
      expect(zone(true), `mw ${mw} above`).toBe(above);
      expect(zone(false), `mw ${mw} below`).toBe(below);
    }
  });

  it("leaves a type outside the set alone", () => {
    expect(height("pdf417", true)).toBe(height("pdf417", false));
  });
});

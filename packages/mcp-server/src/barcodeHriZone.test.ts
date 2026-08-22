import { describe, it, expect } from "vitest";
import { HRI_LINE_TYPES, hriZoneDots } from "@zplab/core/lib/barcodeHri";
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
    const zone = hriZoneDots(2);
    for (const type of HRI_LINE_TYPES) {
      expect(height(type, true) - height(type, false), `${type} zone`).toBe(zone);
    }
  });

  it("leaves a type outside the set alone", () => {
    expect(height("pdf417", true)).toBe(height("pdf417", false));
  });
});

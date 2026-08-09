import { describe, it, expect } from "vitest";

import { BARCODE_1D_TYPES, ObjectRegistry, type LeafObject } from "../registry";
import { barcodeTextZoneDots, hriZoneDots } from "./barcodeHri";

describe("hriZoneDots", () => {
  // Labelary, 6 and 8 dpmm, ^BC and ^B3: total ink height minus the bar height.
  it("matches the measured line height per module width", () => {
    expect([1, 2, 3, 4, 5].map(hriZoneDots)).toEqual([14, 21, 28, 35, 42]);
  });

  it("treats a fractional module like the dot grid does", () => {
    expect(hriZoneDots(2.4)).toBe(21);
    expect(hriZoneDots(0)).toBe(14);
  });
});

/** 1D symbologies whose firmware prints an interpretation line that no zone is
 *  reserved for yet. Shrinking this set needs measurements, never a copied
 *  formula: a guessed band moves every box by an invented number. */
const UNMEASURED_HRI_ZONE: ReadonlySet<string> = new Set([
  "plessey",
  "planet",
  "postal",
  "code49",
  "gs1databar",
]);

describe("HRI zone coverage", () => {
  // The zone tests iterate HRI_LINE_TYPES itself, so only an outside-in sweep
  // catches a symbology that was never added to it.
  it("classifies every 1D symbology, or names it as unmeasured", () => {
    for (const type of BARCODE_1D_TYPES) {
      const entry = ObjectRegistry[type as keyof typeof ObjectRegistry];
      if (!entry) continue;
      const leaf = {
        id: type,
        type,
        x: 0,
        y: 0,
        props: { ...(entry.defaultProps as object), printInterpretation: true, moduleWidth: 2 },
      } as LeafObject;
      const zone = barcodeTextZoneDots(leaf);
      if (UNMEASURED_HRI_ZONE.has(type)) {
        expect(zone, `${type} is listed as unmeasured but now reserves a zone`).toBe(0);
      } else {
        expect(zone, `${type} prints an HRI line with no zone reserved`).toBeGreaterThan(0);
      }
    }
  });
});

describe("a GS1-128's interpretation band", () => {
  const leaf = (gs1: boolean, moduleWidth: number, content = "(01)09501101530003") =>
    ({
      id: "b", type: "code128", x: 0, y: 0, rotation: 0,
      props: { content, height: 60, moduleWidth, printInterpretation: true, gs1 },
    }) as never;

  it("is taller than the plain one, because the HRI font is scaled up", () => {
    // The renderer draws GS1 HRI at up to GS1_HRI_FONT_SCALE of the plain em,
    // so reserving the plain band let the line run outside the published bbox.
    for (const mw of [2, 5]) {
      expect(barcodeTextZoneDots(leaf(true, mw))).toBeGreaterThan(barcodeTextZoneDots(leaf(false, mw)));
    }
  });

  it("covers the band Labelary prints, at every measured module width", () => {
    // Measured at 8 dpmm as ink below the bars: 21 / 34 / 52 / 66 / 82.
    // The reserved band must never read short, or the HRI runs off the media
    // while the report calls the field clean.
    const measured: Record<number, number> = { 1: 21, 2: 34, 3: 52, 4: 66, 5: 82 };
    for (const [mw, dots] of Object.entries(measured)) {
      expect(barcodeTextZoneDots(leaf(true, Number(mw))), `mw ${mw}`).toBeGreaterThanOrEqual(dots);
    }
  });

  it("does not read the content", () => {
    // Reading it meant measuring it, and the measure falls back to a per-glyph
    // estimate without a canvas, so headless and browser reserved differently.
    const long = leaf(true, 3, "(01)09501101020917(10)ABC123(21)SERIAL987654(11)260101");
    expect(barcodeTextZoneDots(long)).toBe(barcodeTextZoneDots(leaf(true, 3)));
  });

  it("leaves a non-GS1 code128 exactly where it was", () => {
    expect(barcodeTextZoneDots(leaf(false, 3))).toBe(hriZoneDots(3));
  });
});

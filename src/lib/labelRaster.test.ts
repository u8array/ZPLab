import { describe, expect, it } from "vitest";
import { labelDots, monoFromPrinterBitmap, monoFromRgba } from "./labelRaster";

describe("labelRaster", () => {
  it("sizes the raster in physical head dots, which a half-density format does not change", () => {
    expect(labelDots({ widthMm: 100, heightMm: 150, dpmm: 8 })).toEqual({ width: 800, height: 1200 });
    expect(labelDots({ widthMm: 100, heightMm: 150, dpmm: 8, jmDensity: "B" })).toEqual({ width: 800, height: 1200 });
  });

  it("crops the printer's head raster to the label like the preview does, keeping the bits where they were", () => {
    // A 32-dot head with a 16-dot label: the firmware centres, so the label starts at column 8.
    const mono = new Uint8Array(4 * 2);
    mono[0] = 0b00000000; mono[1] = 0b11000000; mono[2] = 0b00000011; mono[3] = 0b00000000;
    mono[4] = 0b00000000; mono[5] = 0b00000001; mono[6] = 0b10000000; mono[7] = 0b00000000;
    const raster = monoFromPrinterBitmap({ width: 32, height: 2, mono }, { width: 16, height: 2 });
    expect([raster.width, raster.height]).toEqual([16, 2]);
    expect([...raster.mono].map((b) => b.toString(2).padStart(8, "0"))).toEqual(["11000000", "00000011", "00000001", "10000000"]);
  });

  it("thresholds pixels at mid grey, pads rows to whole bytes and reads transparency as paper", () => {
    const px = (r: number, g: number, b: number, a = 255) => [r, g, b, a];
    const row = [px(0, 0, 0), px(255, 255, 255), px(100, 100, 100), px(200, 200, 200), px(0, 0, 0, 0), px(0, 0, 0, 128), px(0, 0, 255), px(255, 0, 0), px(0, 0, 0)];
    const data = new Uint8ClampedArray(row.flat());
    const raster = monoFromRgba(data, 9, 1);
    expect(raster.mono.length).toBe(2);
    expect([...raster.mono].map((b) => b.toString(2).padStart(8, "0"))).toEqual(["10100111", "10000000"]);
  });
});

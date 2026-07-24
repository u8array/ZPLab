import { describe, expect, it } from "vitest";
import {
  drawBarRects,
  plesseyBarRects,
  plesseyModuleRuns,
  postalBarRects,
  postalTallFlags,
  zebraWidthBarText,
} from "./barcodeRawGeometry";

describe("zebraWidthBarText", () => {
  it("uppercases Plessey content like firmware", () => {
    expect(zebraWidthBarText("plessey", "12ab")).toBe("12AB");
    expect(zebraWidthBarText("plessey", "")).toBe("0");
  });

  it("pads PLANET like firmware (11/13 digits) and strips non-digits", () => {
    expect(zebraWidthBarText("planet", "12345678")).toBe("00012345678");
    expect(zebraWidthBarText("planet", "123456789012")).toBe("0123456789012");
    expect(zebraWidthBarText("planet", "1a2b3")).toBe("00000000123");
  });

  it("passes POSTNET content through verbatim so invalid chars surface as encode errors", () => {
    // bwip postnet throws on non-digits; stripping here would silently
    // encode a different (shorter) barcode instead of flagging the input.
    expect(zebraWidthBarText("postal", "ABC12")).toBe("ABC12");
    expect(zebraWidthBarText("postal", "12345")).toBe("12345");
    expect(zebraWidthBarText("postal", "")).toBe("0");
  });
});

describe("drawBarRects", () => {
  it("fills exactly the given rects, no seam", () => {
    const calls: number[][] = [];
    drawBarRects({ fillRect: (...a: number[]) => calls.push(a) }, [
      { x: 0, y: 0, w: 2, h: 100 },
      { x: 5, y: 60, w: 2, h: 40 },
    ]);
    expect(calls).toEqual([
      [0, 0, 2, 100],
      [5, 60, 2, 40],
    ]);
  });
});

// bwip raw output pinned for the Labelary fixture contents (engine-free so
// this lane stays type-checked; visualRegression covers the live engine).
// bwipjs.raw({bcid:"plessey", text:"12345678"})[0].sbs
const PLESSEY_SBS_12345678 = [
  3, 2, 3, 2, 1, 4, 3, 2, 3, 2, 1, 4, 1, 4, 1, 4, 1, 4, 3, 2, 1, 4, 1, 4, 3, 2,
  3, 2, 1, 4, 1, 4, 1, 4, 1, 4, 3, 2, 1, 4, 3, 2, 1, 4, 3, 2, 1, 4, 1, 4, 3, 2,
  3, 2, 1, 4, 3, 2, 3, 2, 3, 2, 1, 4, 1, 4, 1, 4, 1, 4, 3, 2, 3, 2, 1, 4, 3, 2,
  3, 2, 3, 2, 1, 4, 1, 4, 3, 2, 5, 4, 1, 4, 1, 2, 3, 2, 3,
];
// bwipjs.raw({bcid:"postnet", text:"12345"})[0].bhs
const POSTNET_BHS_12345 = [
  0.125, 0.05, 0.05, 0.05, 0.125, 0.125, 0.05, 0.05, 0.125, 0.05, 0.125, 0.05,
  0.05, 0.125, 0.125, 0.05, 0.05, 0.125, 0.05, 0.05, 0.125, 0.05, 0.125, 0.05,
  0.125, 0.05, 0.05, 0.125, 0.05, 0.125, 0.05, 0.125,
];

describe("plessey width remap", () => {
  it("maps the Labelary fixture content to 147 modules (294 dots at ^BY2,2)", () => {
    const runs = plesseyModuleRuns(PLESSEY_SBS_12345678, 2);
    expect(runs.length % 2).toBe(1); // starts and ends on a bar
    expect(runs.reduce((a, b) => a + b, 0)).toBe(147);
  });

  it("maps each BWIPP element width to its ^BY module count", () => {
    expect(plesseyModuleRuns([1, 2, 3, 4, 5], 2)).toEqual([1, 1, 2, 2, 3]);
  });

  it("throws on an element width outside BWIPP's plessey alphabet", () => {
    expect(() => plesseyModuleRuns([7], 2)).toThrow(/unmapped/);
  });

  it("emits one rect per bar with cumulative x", () => {
    const { rects, width } = plesseyBarRects([1, 2, 3], 2, 2, 100);
    expect(rects).toEqual([
      { x: 0, y: 0, w: 2, h: 100 },
      { x: 4, y: 0, w: 4, h: 100 },
    ]);
    expect(width).toBe(8);
  });
});

describe("postal bar geometry", () => {
  it("renders the POSTNET fixture at Labelary geometry (32 bars, 157 dots)", () => {
    const { rects, width } = postalBarRects(POSTNET_BHS_12345, 2, 100);
    expect(rects).toHaveLength(32); // 5 digits + check + 2 frame bars
    expect(width).toBe(157); // 31 * 5 + 2
    // Frame bars are tall; shorts sit bottom-aligned at 40% height.
    expect(rects[0]).toEqual({ x: 0, y: 0, w: 2, h: 100 });
    const short = rects.find((r) => r.h !== 100);
    expect(short).toMatchObject({ y: 60, h: 40 });
  });

  it("classifies bwip bhs heights into tall and short", () => {
    expect(postalTallFlags([0.125, 0.05, 0.125])).toEqual([true, false, true]);
  });

  it("integer-aligns the raster at odd module scales without cumulative drift", () => {
    // pitch 2.5 * 3 = 7.5: per-bar rounding alternates 8/7 steps instead of
    // drawing at x.5 (sub-pixel AA); shortH rounds when height % 5 != 0.
    const { rects, width } = postalBarRects([0.125, 0.05, 0.125, 0.05], 3, 94);
    expect(rects.map((r) => r.x)).toEqual([0, 8, 15, 23]);
    expect(rects[1]).toMatchObject({ y: 56, h: 38 });
    expect(width).toBe(26); // round(3 * 7.5) + 3
    expect(rects.every((r) => Number.isInteger(r.x) && Number.isInteger(r.y) && Number.isInteger(r.h))).toBe(true);
  });
});

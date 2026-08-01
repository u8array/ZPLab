import { describe, expect, it } from "vitest";
import bwipjs from "bwip-js/generic";
import { maxicodeMissingScm, maxicodeScmOwnedByPreflight } from "./maxicode";
import { getEntry, type LeafObject } from ".";
import { getDisplaySize, measureBarcodeFootprintDotsWith, type BwipEngine } from "../lib/barcodeDims";
import { pxToDots } from "../lib/coordinates";
import { resolveDefaultSizeDots } from "../lib/resolveDefaultSize";
import type { LabelObject } from "../types/Group";
import type { LabelConfig } from "../types/LabelConfig";

const engine = bwipjs as unknown as BwipEngine;
/** bwip's maxicode bitmap at BWIP_SCALE; pinned by src/test/maxicodeBitmap.test.ts. */
const BWIP_CANVAS = { width: 210, height: 200 };
const pctx = { label: { widthMm: 100, heightMm: 100, dpmm: 8 } as LabelConfig, unit: "mm" } as const;

const mc = (mode: 2 | 3 | 4 | 5 | 6, content: string): LeafObject =>
  ({ id: "m", type: "maxicode", x: 0, y: 0, rotation: 0, props: { mode, content } } as LabelObject as LeafObject);

const GS = "\x1d";

describe("maxicodeMissingScm", () => {
  it("flags a mode 2/3 payload with no field separator", () => {
    expect(maxicodeMissingScm({ mode: 2, content: "1234567890" })).toBe(true);
    expect(maxicodeMissingScm({ mode: 3, content: "ABCDEF" })).toBe(true);
  });

  it("passes a payload that carries a separator (bwip decides subtler errors)", () => {
    expect(maxicodeMissingScm({ mode: 2, content: `12345${GS}840${GS}001${GS}x` })).toBe(false);
  });

  it("never flags modes 4/5/6 (no carrier message requirement)", () => {
    expect(maxicodeMissingScm({ mode: 4, content: "1234567890" })).toBe(false);
    expect(maxicodeMissingScm({ mode: 5, content: "x" })).toBe(false);
    expect(maxicodeMissingScm({ mode: 6, content: "x" })).toBe(false);
  });
});

describe("maxicodeScmOwnedByPreflight", () => {
  it("owns only literal marker-free content", () => {
    expect(maxicodeScmOwnedByPreflight("1234567890", { mode: 2, content: "1234567890" })).toBe(true);
  });

  it("leaves bound content to renderFailed: markers in the raw string keep the alarm", () => {
    // The producer never fires for «scm», so suppressing here too would hide
    // the broken symbol behind a neutral placeholder on every surface.
    expect(maxicodeScmOwnedByPreflight("«scm»", { mode: 2, content: "1234567890" })).toBe(false);
  });

  it("never owns a resolved value that carries a separator", () => {
    expect(maxicodeScmOwnedByPreflight("12345", { mode: 2, content: `12345${GS}840${GS}001` })).toBe(false);
  });
});

describe("maxicode preflight producer", () => {
  it("flags a configured mode 2 payload without a carrier message", () => {
    expect(getEntry("maxicode")!.preflight!(mc(2, "1234567890"), pctx)).toEqual([{ kind: "maxicodeModeMissingScm" }]);
  });

  it("stays silent for a blank field (emptyContent owns it) and for mode 4", () => {
    expect(getEntry("maxicode")!.preflight!(mc(2, "  "), pctx)).toEqual([]);
    expect(getEntry("maxicode")!.preflight!(mc(4, "1234567890"), pctx)).toEqual([]);
  });

  it("stays silent when a separator is present", () => {
    expect(getEntry("maxicode")!.preflight!(mc(3, `123${GS}840${GS}001`), pctx)).toEqual([]);
  });

  it("stays silent for marker content (resolved-value validation owns it)", () => {
    expect(getEntry("maxicode")!.preflight!(mc(2, "«scm»"), pctx)).toEqual([]);
  });
});

describe("maxicode footprint tracks dpmm (fixed physical size)", () => {
  it("measures the calibrated footprint at 8 dpmm", () => {
    const dim = measureBarcodeFootprintDotsWith(engine, mc(4, "1234567890"), 8)!;
    // Visually calibrated dots (INK_DOTS_8DPMM), pinned so a drift fails here.
    expect([dim.w, dim.h]).toEqual([202, 192]);
  });

  it("scales proportionally at 12 dpmm", () => {
    const dim = measureBarcodeFootprintDotsWith(engine, mc(4, "1234567890"), 12)!;
    expect([dim.w, dim.h]).toEqual([303, 288]);
  });

  // Guards the mmToDots quantization: an unquantised mm->px->dots path loses a
  // ULP and flips a dot at some zoom levels whenever mm*dpmm lands near a tie.
  it("stays zoom-stable at 12 dpmm and agrees with the palette default size", () => {
    const def = resolveDefaultSizeDots(getEntry("maxicode")!.defaultSize, { dpmm: 12 } as LabelConfig);
    expect([def.width, def.height]).toEqual([303, 288]);
    for (const scale of [0.65, 0.75, 0.77, 1, 1.29, 1.5, 3]) {
      const d = getDisplaySize(mc(4, "1234567890"), BWIP_CANVAS, scale, 12);
      expect([pxToDots(d.w, scale, 12), pxToDots(d.h, scale, 12)]).toEqual([303, 288]);
    }
  });

  it("crops bwip's dead bitmap margin so the drawn ink fills the footprint", () => {
    const d = getDisplaySize(mc(4, "1234567890"), BWIP_CANVAS, 8, 8);
    expect(d.bitmapCrop).toEqual({ x: 0, y: 1, width: 209, height: 198 });
  });
});

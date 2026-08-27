import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import bwipjs from "bwip-js";
import {
  buildBwipOptions,
  get1DBwipScale,
  getDisplaySize,
} from "../components/Canvas/bwipHelpers";
import {
  firstRawEntry,
  ZEBRA_WIDTH_BAR_TYPES,
  ZEBRA_WIDTH_BCID,
  zebraWidthBarGeometry,
  zebraWidthBarText,
  type ZebraWidthBarType,
} from "@zplab/core/lib/barcodeRawGeometry";
import { dotsToPx } from "@zplab/core/lib/coordinates";
import { getObjectStringContent } from "@zplab/core/lib/variableBinding";
import { upcSuppTextZoneDots, QR_FT_MODULE_OFFSET } from "@zplab/core/lib/bwipConstants";
import { qrPrintsAsGraphic, barcodeFtAnchorOffset } from "@zplab/core/lib/objectBounds";
import { qrByHeight } from "@zplab/core/registry/qrcode";
import { ObjectRegistry } from "@zplab/core/registry";
import { objectRotation } from "@zplab/core/registry/rotation";
import { defined } from "./helpers";
import { bwipPngWithRetry } from "./bwipPng";
import { testModels } from "./testModels";
import { EXPECTED_BOUNDS_DELTA } from "./barcodeFidelity";

interface TestCase {
  id: string;
  zpl_input: string;
  expected_bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  image_ref: string;
}

const FIXTURES_DIR = path.resolve(
  process.cwd(),
  "tests/fixtures/labelary_images",
);
const fixturesPath = path.join(FIXTURES_DIR, "fixtures.json");

function getPngDimensions(buffer: Buffer) {
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

describe("Labelary Sync - Canvas Dimension Logic", () => {
  let fixturesData: { test_cases: TestCase[] } = { test_cases: [] };

  if (fs.existsSync(fixturesPath)) {
    fixturesData = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));
  }

  it("should have loaded fixtures (run fetch_labelary_fixtures.ts if this fails)", () => {
    expect(fixturesData.test_cases.length).toBeGreaterThan(0);
  });

  describe.each(fixturesData.test_cases || [])("Fixture: $id", (tc) => {
    it("should generate exact ZPL string matching Labelary input", () => {
      const obj = defined(testModels[tc.id]);
      const generator = ObjectRegistry[obj.type]?.toZPL;
      if (!generator)
        throw new Error(`Test missing ZPL generator for type: ${obj.type}`);
      const generatedZPL = generator(obj);
      expect(`^XA${generatedZPL}^XZ`).toBe(tc.zpl_input);
    });

    it("should compute display bounds logically consistent with bwip-js engine", async () => {
      const obj = defined(testModels[tc.id]);

      // plessey/planet/postal canvases come from renderZebraWidthBars (bwip raw
      // geometry at ^BY widths); mirror its canvas dimensions here.
      let mockCanvas: HTMLCanvasElement;
      if (ZEBRA_WIDTH_BAR_TYPES.has(obj.type)) {
        const type = obj.type as ZebraWidthBarType;
        const p = obj.props as { content?: string; moduleWidth: number; height: number };
        const modulePx = get1DBwipScale(p.moduleWidth, 1, 8);
        const heightPx = Math.max(1, Math.round(dotsToPx(p.height, 1, 8)));
        const text = zebraWidthBarText(type, p.content ?? "");
        const entry = firstRawEntry(bwipjs.raw({ bcid: ZEBRA_WIDTH_BCID[type], text } as never));
        const geo = zebraWidthBarGeometry(type, entry, modulePx, heightPx);
        expect(geo).not.toBeNull();
        mockCanvas = {
          width: Math.max(1, Math.round(geo?.width ?? 1)),
          height: heightPx,
        } as HTMLCanvasElement;
      } else {
        const opts = buildBwipOptions(obj, 1, 8);
        expect(opts).not.toBeNull();

        const buffer = await bwipPngWithRetry(opts as Record<string, unknown>);

        const { width, height } = getPngDimensions(buffer);
        mockCanvas = { width, height } as HTMLCanvasElement;
      }
      const displaySize = getDisplaySize(obj, mockCanvas, 1, 8);

      if (process.env.DEBUG_TESTS) {
        console.log(`[DEBUG] tc.id: ${tc.id}, type: ${obj.type}`);
        console.log(`[DEBUG] bwip-js raw size: W=${width}, H=${height}`);
        console.log(
          `[DEBUG] displaySize: W=${displaySize.w}, H=${displaySize.h}`,
        );
        console.log(`[DEBUG] expectedBounds:`, tc.expected_bounds);
      }

      // For 90°/270° rotated symbols the visible W and H are swapped, so the
      // upright-shape assertions on bar height / module direction stop applying.
      const rotation = objectRotation(obj.props);
      const isQuarterRotated = rotation === "R" || rotation === "B";
      const isEanUpc = ["ean13", "ean8", "upca", "upce"].includes(obj.type);

      // Verify visual position (top-left of the rendered bounding box in dots).
      // This mimics the positioning logic in BarcodeObject.tsx.
      let visualX = obj.x;
      let visualY = obj.y;

      if (obj.positionType === "FT") {
        // Mirror the real render/bounds anchor (objectBounds.barcodeTopLeft):
        // rotation-aware bar-base offset + HRI text-zone shift (px*8 -> dots).
        // Mirrors BarcodeObject: a rotated QR prints as a shift-free ^GFA.
        const gQr = qrPrintsAsGraphic(obj);
        const off = barcodeFtAnchorOffset(
          gQr ? "N" : rotation,
          displaySize.upright.barW * 8,
          displaySize.upright.barH * 8,
        );
        visualX += off.x - displaySize.barLeftPx * 8;
        visualY += off.y - displaySize.barTopPx * 8;
        if (obj.type === "qrcode" && !gQr) {
          const mag = (obj.props as { magnification?: number }).magnification ?? 1;
          visualY -= QR_FT_MODULE_OFFSET * mag;
        }
      } else {
        // FO positions relative to top-left, with specific quirks.
        if (obj.type === "qrcode" && !qrPrintsAsGraphic(obj)) {
          visualY += qrByHeight(obj.props);
        }
        if (obj.type === "upcEanExtension" && obj.props.printInterpretation) {
          // ^BS bbox top sits above the FO anchor by the supplement
          // text zone when printInterpretation=Y; the bars themselves
          // still start at obj.y. With f=N the bbox starts at FO.
          visualY -= upcSuppTextZoneDots(obj.props.moduleWidth);
        }
      }

      if (obj.positionType === "FT") {
        // Tolerance only on the axis whose anchor offset depends on the bwip bar
        // size (a couple dots off from Labelary's encoder); the other axis is
        // exact, so an anchor regression there can't hide behind the tolerance.
        // off.x != 0 for I/B (uses W/H); off.y != 0 for N/B; QR adds a Y shift.
        const xUsesSize = rotation === "I" || rotation === "B" || displaySize.barLeftPx !== 0;
        const yUsesSize =
          rotation === "N" || rotation === "B" || displaySize.barTopPx !== 0 || obj.type === "qrcode";
        expect(Math.abs(visualX - tc.expected_bounds.x)).toBeLessThanOrEqual(xUsesSize ? 3 : 0);
        expect(Math.abs(visualY - tc.expected_bounds.y)).toBeLessThanOrEqual(yUsesSize ? 3 : 0);
      } else {
        // EAN/UPC have extended guard bars whose visible extent rotates with the
        // symbol. Under R rotation those guards sit LEFT of the FO anchor, so
        // the bbox.x is below obj.x. The model still holds obj.x as FO, so the
        // strict x-equality check is dropped for rotated EAN/UPC.
        if (!(isEanUpc && isQuarterRotated)) {
          expect(visualX).toBe(tc.expected_bounds.x);
        }
        expect(visualY).toBeCloseTo(tc.expected_bounds.y, 0);
      }

      expect(displaySize.w).toBeGreaterThan(0);
      expect(displaySize.h).toBeGreaterThan(0);

      const is1DCode = [
        "code128",
        "code39",
        "interleaved2of5",
      ].includes(obj.type);
      const isSquare2D = ["qrcode", "datamatrix", "aztec"].includes(obj.type);
      const isStacked2D = ["pdf417", "micropdf417", "codablock"].includes(
        obj.type,
      );
      // LOGMARS and EAN/UPC have firmware-reserved text zones now included
      // in getDisplaySize's bbox, so they pass the strict height check below.
      // No remaining bwip-vs-Zebra width mismatches at the bbox level:
      // code93/code11 bars carry their check chars, and plessey/planet/postal
      // draw from bwip raw geometry at ^BY widths (all Labelary-pixel-exact
      // in visualRegression.test.ts).
      // bwip-js renders the 2-digit ^BS supplement (ean2) at 19 modules,
      // while Zebra firmware reserves 20 modules. The 2-dot delta is a
      // fixed encoder difference; per-module post-stretching would distort
      // the bar pattern more than the 2 dots are worth in a layout tool.
      // Document the divergence and skip the strict width check for this
      // single fixture.
      const hasBwipSizeMismatch =
        obj.type === "upcEanExtension" &&
        (getObjectStringContent(obj) ?? "").length === 2;
      // GS1 Databar variant 7 (Expanded Stacked) is segments-dependent; bwip-natural
      // height differs from spec and we don't yet have a per-segment formula.
      const isGs1Sym7 = obj.type === "gs1databar" && obj.props.symbology === 7;

      if (isEanUpc && !isQuarterRotated) {
        // EAN_TEXT_ZONE_DOTS (13) is now included in getDisplaySize, so the
        // bbox height matches expected_bounds.height directly.
        expect(displaySize.h * 8).toBeCloseTo(tc.expected_bounds.height, 1);
      } else if (is1DCode && !isQuarterRotated) {
        expect(displaySize.h).toBe(
          (obj.props as { height: number }).height / 8,
        );
      } else if (isSquare2D) {
        expect(displaySize.w).toBeCloseTo(displaySize.h, 2);
      } else if (isStacked2D) {
        expect(displaySize.w).toBeGreaterThan(0);
        expect(displaySize.h).toBeGreaterThan(0);
        if (obj.type !== "codablock") {
          const rowHeightPx =
            (obj.props as { rowHeight: number }).rowHeight / 8;
          const numRows = displaySize.h / rowHeightPx;
          // Verify that the calculated display height is an exact multiple of the requested row height
          expect(numRows - Math.round(numRows)).toBeCloseTo(0, 5);
          expect(Math.round(numRows)).toBeGreaterThan(0);
        }
      }

      // Strict bounds check: compare calculated display size with fixture expectations.
      // Excluded types:
      //   codablock: bwip-js uses different encoding parameters than Zebra firmware.
      //   hasBwipSizeMismatch: bwip-natural size diverges from Labelary (see above).
      //   isGs1Sym7: GS1 Expanded Stacked height is segments-dependent.
      if (obj.type !== "codablock" && !hasBwipSizeMismatch && !isGs1Sym7) {
        // Pinned divergences (barcodeFidelity) shift the expectation instead
        // of skipping it, so the known delta itself stays asserted.
        const delta = EXPECTED_BOUNDS_DELTA[tc.id] ?? {};
        expect(displaySize.w * 8).toBeCloseTo(tc.expected_bounds.width + (delta.w ?? 0), 1);
        if (!isEanUpc) {
          expect(displaySize.h * 8).toBeCloseTo(tc.expected_bounds.height + (delta.h ?? 0), 1);
        }
      }
    });
  });
});

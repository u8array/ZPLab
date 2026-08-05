import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import bwipjs from "bwip-js";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { createCanvas, loadImage, type Canvas, type Image } from "@napi-rs/canvas";
import { testCases } from "../../tests/fixtures/testCases";
import { testModels } from "./testModels";
import { defined } from "./helpers";
import { bwipPngWithRetry } from "./bwipPng";
import { inkBounds } from "./pngInk";
import {
  BOUNDS_ONLY_TESTS,
  EXPECTED_BOUNDS_DELTA,
  NO_REFERENCE_TESTS,
} from "./barcodeFidelity";
import {
  buildBwipOptions,
  get1DBwipScale,
  getDisplaySize,
} from "../components/Canvas/bwipHelpers";
import {
  drawBarRects,
  firstRawEntry,
  ZEBRA_WIDTH_BAR_TYPES,
  ZEBRA_WIDTH_BCID,
  zebraWidthBarGeometry,
  zebraWidthBarText,
  type ZebraWidthBarType,
} from "@zplab/core/lib/barcodeRawGeometry";
import { dotsToPx } from "@zplab/core/lib/coordinates";
import { QR_FO_Y_OFFSET_DOTS, QR_FT_MODULE_OFFSET, upcSuppTextZoneDots } from "@zplab/core/lib/bwipConstants";
import { barcodeFtAnchorOffset, isBarcode } from "@zplab/core/lib/objectBounds";

const FIXTURES_DIR = path.resolve(
  process.cwd(),
  "tests/fixtures/labelary_images",
);
const DIFF_DIR = path.resolve(process.cwd(), "tests/fixtures/__diffs__");

// Ensure diff dir exists
if (!fs.existsSync(DIFF_DIR)) {
  fs.mkdirSync(DIFF_DIR, { recursive: true });
}


describe("Visual Regression - bwip-js vs Labelary", () => {
  it("should have test cases", () => {
    expect(testCases.length).toBeGreaterThan(0);
  });

  describe.each(testCases)("Visual Test: $id", (tc) => {
    const boundsOnly = BOUNDS_ONLY_TESTS.has(tc.id);
    const noReference = NO_REFERENCE_TESTS.has(tc.id);

    /** Render the case exactly like the pixel path and return both images. */
    async function renderLocal() {
      const obj = defined(testModels[tc.id]);

      const fixturePath = path.join(FIXTURES_DIR, tc.image_ref);
      if (!fs.existsSync(fixturePath)) {
        throw new Error(`Fixture not found: ${fixturePath}`);
      }

      // 1. Render the barcode (scale=8, dpmm=8 matches Labelary 8dpmm; px == dots).
      // plessey/planet/postal draw from bwip raw geometry at ^BY widths, mirroring
      // renderZebraWidthBars; everything else goes through the bwip PNG.
      let bwipImage: Image | Canvas;
      if (ZEBRA_WIDTH_BAR_TYPES.has(obj.type)) {
        const type = obj.type as ZebraWidthBarType;
        const p = obj.props as { content?: string; moduleWidth: number; height: number };
        const modulePx = get1DBwipScale(p.moduleWidth, 8, 8);
        const heightPx = Math.max(1, Math.round(dotsToPx(p.height, 8, 8)));
        const text = zebraWidthBarText(type, p.content ?? "");
        const entry = firstRawEntry(bwipjs.raw({ bcid: ZEBRA_WIDTH_BCID[type], text } as never));
        const geo = zebraWidthBarGeometry(type, entry, modulePx, heightPx);
        expect(geo).not.toBeNull();
        if (!geo) throw new Error("unreachable");
        const rawCanvas = createCanvas(Math.max(1, Math.round(geo.width)), heightPx);
        const rawCtx = rawCanvas.getContext("2d");
        rawCtx.fillStyle = "#000000";
        drawBarRects(rawCtx, geo.rects);
        bwipImage = rawCanvas;
      } else {
        const opts = buildBwipOptions(obj, 8, 8);
        expect(opts).not.toBeNull();
        const localBwipBuffer = await bwipPngWithRetry(opts as Record<string, unknown>);
        bwipImage = await loadImage(localBwipBuffer);
      }

      // 2. Create blank 812x812 canvas
      const canvasWidth = 812;
      const canvasHeight = 812;
      const canvas = createCanvas(canvasWidth, canvasHeight);
      const ctx = canvas.getContext("2d");

      // Fill with white
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // Calculate display size
      // We pass the bwipImage as a mock canvas to get its internal dimensions
      const displaySize = getDisplaySize(
        obj,
        bwipImage as unknown as HTMLCanvasElement,
        8,
        8,
      );

      // Zebra firmware renders ^FO-positioned QR codes with a +10 dot Y offset.
      // Match production BarcodeObject.tsx behaviour. UPC/EAN supplements
      // render the human-readable digits ABOVE the bars, so the bitmap's
      // top edge sits text-zone above the FO anchor.
      const drawY =
        obj.type === "qrcode"
          ? obj.y + QR_FO_Y_OFFSET_DOTS
          : obj.type === "upcEanExtension" && obj.props.printInterpretation
            ? obj.y - upcSuppTextZoneDots(obj.props.moduleWidth)
            : obj.y;
      // bwip now always renders upright. Apply the rotated-Group
      // transform via the 2D ctx so the test matches what Konva paints
      // in the renderer: bitmap drawn at its bar sub-rect inside the
      // upright bbox, then rotated to land at the FO.
      const crop = displaySize.bitmapCrop ?? {
        x: 0,
        y: 0,
        width: bwipImage.width,
        height: bwipImage.height,
      };
      const ub = displaySize.upright;
      const rot = obj.props.rotation;
      ctx.save();
      // Translate to the rotated bbox top-left (= FO - rotated bar offset),
      // then apply rotatedGroupTransform-equivalent rotation around that.
      // FT barcodes anchor at the rotation-aware bar base (mirrors the render);
      // FO uses drawY above. px == dots here (getDisplaySize scale 8, dpmm 8).
      const ftOff =
        obj.positionType === "FT" && isBarcode(obj)
          ? barcodeFtAnchorOffset(rot, ub.barW, ub.barH)
          : { x: 0, y: 0 };
      const ftQrShift =
        obj.positionType === "FT" && obj.type === "qrcode"
          ? QR_FT_MODULE_OFFSET * (obj.props as { magnification: number }).magnification
          : 0;
      const bboxTopLeftX = obj.x + ftOff.x - displaySize.barLeftPx;
      const bboxTopLeftY = drawY + ftOff.y - ftQrShift - displaySize.barTopPx;
      ctx.translate(bboxTopLeftX, bboxTopLeftY);
      if (rot === "R") {
        ctx.translate(ub.h, 0);
        ctx.rotate(Math.PI / 2);
      } else if (rot === "I") {
        ctx.translate(ub.w, ub.h);
        ctx.rotate(Math.PI);
      } else if (rot === "B") {
        ctx.translate(0, ub.w);
        ctx.rotate(-Math.PI / 2);
      }
      ctx.drawImage(
        bwipImage,
        crop.x, crop.y, crop.width, crop.height,
        ub.barLeftPx, ub.barTopPx, ub.barW, ub.barH,
      );
      ctx.restore();

      const labelaryRef = PNG.sync.read(fs.readFileSync(fixturePath));
      const localPng = PNG.sync.read(canvas.toBuffer("image/png"));

      expect(labelaryRef.width).toBe(canvasWidth);
      expect(labelaryRef.height).toBe(canvasHeight);

      return { labelaryRef, localPng, canvas, canvasWidth, canvasHeight };
    }

    // Only the applicable mode is registered so the suite's skip count stays
    // meaningful. noReference keeps a visible it.skip (documents the missing
    // reference in the run output); boundsOnly swaps the test body entirely,
    // so its pixel mode is not registered at all.
    const pixelIt = noReference ? it.skip : boundsOnly ? null : it;
    pixelIt?.("should visually match Labelary output", async () => {
      const { labelaryRef, localPng, canvas, canvasWidth, canvasHeight } = await renderLocal();

      const diff = new PNG({ width: canvasWidth, height: canvasHeight });

      const numDiffPixels = pixelmatch(
        labelaryRef.data,
        localPng.data,
        diff.data,
        canvasWidth,
        canvasHeight,
        { threshold: 0.1 },
      );

      // With printInterpretation disabled, we expect a near-perfect visual match
      // of just the barcode itself. Allow only a very small tolerance (<0.1%)
      // for minor anti-aliasing or rendering artifacts.
      const ALLOWED_TOLERANCE = 500;
      if (numDiffPixels > ALLOWED_TOLERANCE) {
        const diffPath = path.join(DIFF_DIR, `${tc.id}_diff.png`);
        fs.writeFileSync(diffPath, PNG.sync.write(diff));

        // Also save the local generated image for easier manual comparison
        const localPath = path.join(DIFF_DIR, `${tc.id}_local.png`);
        fs.writeFileSync(localPath, canvas.toBuffer("image/png"));
      }

      expect(numDiffPixels).toBeLessThanOrEqual(ALLOWED_TOLERANCE);
    });

    const boundsIt = boundsOnly && !noReference ? it : null;
    boundsIt?.("should match Labelary ink bounds", async () => {
      const { labelaryRef, localPng, canvas } = await renderLocal();

      const ref = inkBounds(labelaryRef);
      const local = inkBounds(localPng);
      expect(ref).not.toBeNull();
      expect(local).not.toBeNull();
      if (!ref || !local) throw new Error("unreachable");

      // Dots at 8dpmm; placement and footprint must match even when the
      // inner cell pattern legitimately differs. Known divergences enter as
      // pinned signed deltas, not widened tolerances: the asserted value is
      // the residual after the expected shift, so failures show exactly the
      // unexplained dots per axis.
      const expected = EXPECTED_BOUNDS_DELTA[tc.id] ?? {};
      const TOL = 3;
      const residual = {
        x: local.x - ref.x,
        y: local.y - ref.y,
        w: local.w - ref.w - (expected.w ?? 0),
        h: local.h - ref.h - (expected.h ?? 0),
      };
      try {
        expect(Math.abs(residual.x)).toBeLessThanOrEqual(TOL);
        expect(Math.abs(residual.y)).toBeLessThanOrEqual(TOL);
        expect(Math.abs(residual.w)).toBeLessThanOrEqual(TOL);
        expect(Math.abs(residual.h)).toBeLessThanOrEqual(TOL);
      } catch (err) {
        fs.writeFileSync(
          path.join(DIFF_DIR, `${tc.id}_local.png`),
          canvas.toBuffer("image/png"),
        );
        throw err;
      }
    });
  });
});

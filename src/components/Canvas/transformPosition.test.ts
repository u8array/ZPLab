import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { committedUprightBarDots, modelPositionFromRenderedTopLeft, renderedTopLeftFromModel } from "./transformPosition";
import { setMeasuredBounds, clearMeasuredBounds } from "../../lib/measuredBoundsCache";
import { QR_FO_Y_OFFSET_DOTS, QR_FT_MODULE_OFFSET } from "@zplab/core/lib/bwipConstants";
import type { LabelObject } from "@zplab/core/types/Group";
import type { LeafObject } from "@zplab/core/registry";
import type { ZplRotation } from "@zplab/core/registry/rotation";

const qrFo: LabelObject = {
  id: "q1",
  type: "qrcode",
  x: 0,
  y: 0,
  rotation: 0,
  positionType: "FO",
  props: { content: "x", magnification: 4, errorCorrection: "Q", model: 2, rotation: "N" },
};

const ellipse: LabelObject = {
  id: "e1",
  type: "ellipse",
  x: 0,
  y: 0,
  rotation: 0,
  props: { width: 150, height: 100, thickness: 3, filled: false, color: "B" },
};

describe("modelPositionFromRenderedTopLeft", () => {
  it("subtracts QR FO Y offset for QR codes with positionType=FO", () => {
    expect(modelPositionFromRenderedTopLeft(qrFo, 100, 200)).toEqual({
      x: 100,
      y: 200 - QR_FO_Y_OFFSET_DOTS,
    });
  });

  it("subtracts QR FO Y offset when positionType is undefined (defaults to FO)", () => {
    const obj = { ...qrFo, positionType: undefined };
    expect(modelPositionFromRenderedTopLeft(obj, 100, 200)).toEqual({
      x: 100,
      y: 200 - QR_FO_Y_OFFSET_DOTS,
    });
  });

  it("inverts the QR FT firmware module shift (lockstep with the render)", () => {
    // Render shifts a QR ^FT up by 3*magnification dots; the resize inverse adds
    // it back so the commit matches the render (no measured entry -> no bar shift).
    const obj: LabelObject = { ...qrFo, positionType: "FT" };
    expect(modelPositionFromRenderedTopLeft(obj, 100, 200)).toEqual({
      x: 100,
      y: 200 + QR_FT_MODULE_OFFSET * 4,
    });
  });

  it("uses the committed magnification for the QR FT shift on resize", () => {
    // Resizing a ^FT QR from magnification 4 -> 5 must invert with the new shift
    // (3*5), not the stale prop (3*4), else the code jumps 3 dots on release.
    const obj: LabelObject = { ...qrFo, positionType: "FT" };
    expect(modelPositionFromRenderedTopLeft(obj, 100, 200, undefined, undefined, 5)).toEqual({
      x: 100,
      y: 200 + QR_FT_MODULE_OFFSET * 5,
    });
  });

  it("returns rendered position unchanged for ellipse", () => {
    expect(modelPositionFromRenderedTopLeft(ellipse, 50, 80)).toEqual({
      x: 50,
      y: 80,
    });
  });

  it("preserves x for QR codes (only Y is offset)", () => {
    expect(modelPositionFromRenderedTopLeft(qrFo, -7, 17).x).toBe(-7);
  });

  it("is idempotent under repeated application for non-QR types", () => {
    const once = modelPositionFromRenderedTopLeft(ellipse, 10, 20);
    const twice = modelPositionFromRenderedTopLeft(ellipse, once.x, once.y);
    expect(twice).toEqual(once);
  });
});

describe("committedUprightBarDots (resize axis swap)", () => {
  // Upright bars 200x100, dragged sx=1.5 (wider), sy=1.2 (taller).
  it("N/I scale width by sx and height by sy (no swap)", () => {
    expect(committedUprightBarDots("N", 1.5, 1.2, 200, 100)).toEqual({ w: 300, h: 120 });
    expect(committedUprightBarDots("I", 1.5, 1.2, 200, 100)).toEqual({ w: 300, h: 120 });
  });
  it("R/B swap: width (moduleWidth axis) scales by sy, height by sx", () => {
    expect(committedUprightBarDots("R", 1.5, 1.2, 200, 100)).toEqual({ w: 240, h: 150 });
    expect(committedUprightBarDots("B", 1.5, 1.2, 200, 100)).toEqual({ w: 240, h: 150 });
  });
});

describe("FT barcode rotation anchor (render <-> model lockstep)", () => {
  // Upright bars 200x100, published by the renderer.
  const bc = (rotation: ZplRotation): LeafObject => ({
    id: "bc-rot",
    type: "code128",
    x: 400,
    y: 300,
    rotation: 0,
    positionType: "FT",
    props: { content: "X", height: 100, moduleWidth: 2, printInterpretation: false, checkDigit: false, rotation },
  }) as LeafObject;
  beforeEach(() => {
    setMeasuredBounds("bc-rot", { width: 1, height: 1, uprightBarWDots: 200, uprightBarHDots: 100 });
  });
  afterEach(() => clearMeasuredBounds("bc-rot"));

  for (const rotation of ["N", "R", "I", "B"] as const) {
    it(`round-trips ${rotation} (resize commit stays on the FT anchor)`, () => {
      const obj = bc(rotation);
      const tl = renderedTopLeftFromModel(obj);
      expect(modelPositionFromRenderedTopLeft(obj, tl.x, tl.y)).toEqual({ x: 400, y: 300 });
    });
  }

  it("rotation moves the rendered top-left (not N-only)", () => {
    expect(renderedTopLeftFromModel(bc("N"))).toEqual({ x: 400, y: 200 });
    expect(renderedTopLeftFromModel(bc("R"))).toEqual({ x: 400, y: 300 });
    expect(renderedTopLeftFromModel(bc("I"))).toEqual({ x: 200, y: 300 });
    expect(renderedTopLeftFromModel(bc("B"))).toEqual({ x: 300, y: 100 });
  });

  it("uses the committed upright bar size for the anchor, not the cache", () => {
    // I offset.x = -W. Default uses cached W (200); a resize passes the committed
    // upright width (e.g. 260 after a moduleWidth-changing, snapped resize).
    const obj = bc("I");
    expect(modelPositionFromRenderedTopLeft(obj, 0, 0).x).toBe(200); // 0 - (-200)
    expect(modelPositionFromRenderedTopLeft(obj, 0, 0, 260, 100).x).toBe(260); // 0 - (-260)
  });

  it("B anchor uses committed W and H (no screen-axis swap in the helper)", () => {
    // B offset = (-H, -W); committed upright dims are passed directly (the commit
    // already applied the R/B axis swap when computing the props).
    const obj = bc("B");
    // off(B) = (-H, -W) = (-260, -120); model = rendered - off.
    expect(modelPositionFromRenderedTopLeft(obj, 0, 0, 120, 260)).toEqual({ x: 260, y: 120 });
  });

  it("includes the HRI text-zone offset (barLeft/barTop) like the render", () => {
    setMeasuredBounds("bc-zone", {
      width: 1, height: 1, uprightBarWDots: 200, uprightBarHDots: 100, barLeftDots: 10, barTopDots: 15,
    });
    const obj = {
      id: "bc-zone", type: "ean13", x: 400, y: 300, rotation: 0, positionType: "FT",
      props: { content: "4006381333931", moduleWidth: 2, height: 100, printInterpretation: true, checkDigit: false, rotation: "N" },
    } as unknown as LeafObject;
    // N off = (0,-100); minus the zone (10,15): rendered TL = (390, 185).
    const tl = renderedTopLeftFromModel(obj);
    expect(tl).toEqual({ x: 390, y: 185 });
    // and it still inverts back to the field anchor.
    expect(modelPositionFromRenderedTopLeft(obj, tl.x, tl.y)).toEqual({ x: 400, y: 300 });
    clearMeasuredBounds("bc-zone");
  });

  // The fix is barcode-wide, not 1D-only: 2D and stacked FT barcodes must
  // round-trip too (regression: they committed the rendered top-left).
  const otherType = (type: string, props: object) => {
    const o = { id: `t-${type}`, type, x: 400, y: 300, rotation: 0, positionType: "FT", props } as unknown as LeafObject;
    setMeasuredBounds(o.id, { width: 1, height: 1, uprightBarWDots: 120, uprightBarHDots: 120 });
    return o;
  };
  it("round-trips a 2D FT barcode (qrcode, incl. firmware shift) for all rotations", () => {
    for (const rotation of ["N", "R", "I", "B"] as const) {
      const o = otherType("qrcode", { content: "x", magnification: 4, errorCorrection: "Q", model: 2, rotation });
      const tl = renderedTopLeftFromModel(o);
      expect(modelPositionFromRenderedTopLeft(o, tl.x, tl.y)).toEqual({ x: 400, y: 300 });
      clearMeasuredBounds(o.id);
    }
  });
  it("round-trips a stacked FT barcode (pdf417) for all rotations", () => {
    for (const rotation of ["N", "R", "I", "B"] as const) {
      const o = otherType("pdf417", { content: "x", rotation });
      const tl = renderedTopLeftFromModel(o);
      expect(modelPositionFromRenderedTopLeft(o, tl.x, tl.y)).toEqual({ x: 400, y: 300 });
      clearMeasuredBounds(o.id);
    }
  });
});

import { describe, expect, it } from "vitest";
import { convertPositionType, supportsPositionToggle } from "./positionConvert";
import { objectBoundsDots, type ObjectBoundsCtx } from "@zplab/core/lib/objectBounds";
import { QR_FT_MODULE_OFFSET } from "@zplab/core/lib/bwipConstants";
import { QR_BY_DEFAULT_HEIGHT } from "@zplab/core/registry/qrcode";
import type { PageLabel } from "@zplab/core/types/LabelConfig";
import type { LabelObject } from "@zplab/core/types/Group";
import type { LeafObject } from "@zplab/core/registry";
import type { ZplRotation } from "@zplab/core/registry/rotation";

const label = { widthMm: 100, heightMm: 50, dpmm: 8 } as PageLabel;
const ctx = (measured?: ObjectBoundsCtx["measured"]): ObjectBoundsCtx => ({ label, measured });

function leaf<T extends LeafObject["type"]>(
  type: T,
  x: number,
  y: number,
  props: Extract<LeafObject, { type: T }>["props"],
  extra: Partial<LabelObject> = {},
): LeafObject {
  return { id: `${type}-${x}-${y}`, type, x, y, rotation: 0, props, ...extra } as LeafObject;
}

function flipped(obj: LeafObject, target: "FO" | "FT", c: ObjectBoundsCtx): LeafObject {
  const patch = convertPositionType(obj, target, c);
  expect(patch).not.toBeNull();
  return { ...obj, ...patch } as LeafObject;
}

describe("convertPositionType", () => {
  it("returns null when the object already has the target anchor", () => {
    const box = leaf("box", 10, 20, { width: 200, height: 100, thickness: 3, filled: false, color: "B", rounding: 0 });
    expect(convertPositionType(box, "FO", ctx())).toBeNull();
    const ft = { ...box, positionType: "FT" } as LeafObject;
    expect(convertPositionType(ft, "FT", ctx())).toBeNull();
  });

  it("refuses to convert a symbol (^GS emits an uncompensated, unverified ^FT anchor)", () => {
    const sym = leaf("symbol", 20, 30, { symbol: "B", height: 40, width: 40, rotation: "N" });
    expect(convertPositionType(sym, "FT", ctx())).toBeNull();
    expect(supportsPositionToggle("symbol")).toBe(false);
    expect(supportsPositionToggle("code128")).toBe(true);
    expect(supportsPositionToggle("text")).toBe(true);
  });

  it("text and graphics flip flag-only: model coordinates are anchor-independent", () => {
    const cases: LeafObject[] = [
      leaf("text", 40, 60, { content: "Hi", fontHeight: 30, fontWidth: 0, rotation: "N" }),
      leaf("box", 10, 20, { width: 200, height: 100, thickness: 3, filled: false, color: "B", rounding: 0 }),
      leaf("ellipse", 5, 5, { width: 150, height: 80, thickness: 3, filled: false, color: "B" }),
      leaf("line", 300, 50, { angle: 180, length: 200, thickness: 4, color: "B" }),
      leaf("image", 4, 8, { imageId: "a", widthDots: 90, threshold: 128 }),
    ];
    for (const obj of cases) {
      const patch = convertPositionType(obj, "FT", ctx());
      expect(patch, obj.type).toEqual({ positionType: "FT", x: obj.x, y: obj.y });
      const back = convertPositionType({ ...obj, ...patch } as LeafObject, "FO", ctx());
      expect(back, obj.type).toEqual({ positionType: "FO", x: obj.x, y: obj.y });
    }
  });

  it("code128 N: FO->FT anchors at the bar base (y shifts by bar height)", () => {
    const bc = leaf("code128", 100, 200, { content: "123", height: 80, moduleWidth: 2, rotation: "N", printInterpretation: true, checkDigit: false });
    const measured = new Map([[bc.id, { width: 220, height: 110, uprightBarWDots: 220, uprightBarHDots: 80 }]]);
    const patch = convertPositionType(bc, "FT", ctx(measured));
    expect(patch).toEqual({ positionType: "FT", x: 100, y: 280 });
  });

  it("barcode: visual bounds are invariant across the flip for every rotation", () => {
    for (const rotation of ["N", "R", "I", "B"] as ZplRotation[]) {
      const bc = leaf("code128", 100, 200, { content: "123", height: 80, moduleWidth: 2, rotation, printInterpretation: true, checkDigit: false });
      const measured = new Map([[bc.id, { width: 220, height: 110, uprightBarWDots: 220, uprightBarHDots: 80 }]]);
      const before = objectBoundsDots(bc, ctx(measured));
      const ft = flipped(bc, "FT", ctx(measured));
      expect(objectBoundsDots(ft, ctx(measured)), `FT ${rotation}`).toEqual(before);
      const back = flipped(ft, "FO", ctx(measured));
      expect(objectBoundsDots(back, ctx(measured)), `FO ${rotation}`).toEqual(before);
      expect({ x: back.x, y: back.y }).toEqual({ x: bc.x, y: bc.y });
    }
  });

  it("qrcode: flip compensates both firmware shifts, bounds stay put", () => {
    const qr = leaf("qrcode", 50, 70, { content: "Q", magnification: 4, errorCorrection: "M", model: 2, rotation: "N" });
    const measured = new Map([[qr.id, { width: 100, height: 100, uprightBarWDots: 100, uprightBarHDots: 100 }]]);
    const before = objectBoundsDots(qr, ctx(measured));
    const ft = flipped(qr, "FT", ctx(measured));
    expect(objectBoundsDots(ft, ctx(measured))).toEqual(before);
    // FO renders y + effective ^BY height; FT renders y - uprightH - QR_FT_MODULE_OFFSET*mag.
    expect(ft.y).toBe(70 + QR_BY_DEFAULT_HEIGHT + 100 + QR_FT_MODULE_OFFSET * 4);
    const back = flipped(ft, "FO", ctx(measured));
    expect({ x: back.x, y: back.y }).toEqual({ x: qr.x, y: qr.y });
  });

  it("barcode with HRI zone offsets (barLeft/barTop) still round-trips exactly", () => {
    const bc = leaf("code128", 100, 200, { content: "123", height: 80, moduleWidth: 2, rotation: "N", printInterpretation: true, checkDigit: false });
    const measured = new Map([
      [bc.id, { width: 220, height: 110, barLeftDots: 6, barTopDots: 24, uprightBarWDots: 220, uprightBarHDots: 80 }],
    ]);
    const before = objectBoundsDots(bc, ctx(measured));
    const ft = flipped(bc, "FT", ctx(measured));
    expect(objectBoundsDots(ft, ctx(measured))).toEqual(before);
    const back = flipped(ft, "FO", ctx(measured));
    expect({ x: back.x, y: back.y }).toEqual({ x: bc.x, y: bc.y });
  });

  it("flips FO<->FT bounds-preserving with a pinned non-default byHeight", () => {
    const qr = leaf("qrcode", 100, 200, { content: "x", magnification: 5, errorCorrection: "M", model: 2, rotation: "N", byHeight: 50 } as never);
    const measured = new Map([[qr.id, { width: 120, height: 120 }]]);
    const before = objectBoundsDots(qr, ctx(measured));
    const ft = flipped(qr, "FT", ctx(measured));
    expect(objectBoundsDots(ft, ctx(measured))).toEqual(before);
    const back = flipped(ft, "FO", ctx(measured));
    expect({ x: back.x, y: back.y }).toEqual({ x: qr.x, y: qr.y });
  });

  it("unmeasured barcode falls back to prop height, matching the bounds fallback", () => {
    const bc = leaf("code128", 100, 200, { content: "123", height: 80, moduleWidth: 2, rotation: "N", printInterpretation: true, checkDigit: false });
    const before = objectBoundsDots(bc, ctx());
    const ft = flipped(bc, "FT", ctx());
    expect(objectBoundsDots(ft, ctx())).toEqual(before);
  });
});

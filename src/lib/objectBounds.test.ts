import { describe, expect, it } from "vitest";
import { objectBoundsDots, selectionUnionDots, barcodeFtAnchorOffset, offLabelPlacement, type ObjectBoundsCtx } from "@zplab/core/lib/objectBounds";
import type { ZplRotation } from "@zplab/core/registry/rotation";
import { QR_FT_MODULE_OFFSET } from "@zplab/core/lib/bwipConstants";
import type { PageLabel } from "@zplab/core/types/LabelConfig";
import type { LabelObject } from "@zplab/core/types/Group";
import type { LeafObject } from "@zplab/core/registry";

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

describe("objectBoundsDots", () => {
  it("box: raw prop footprint at origin", () => {
    const box = leaf("box", 10, 20, { width: 200, height: 100, thickness: 3, filled: false, color: "B", rounding: 0 });
    expect(objectBoundsDots(box, ctx())).toEqual({ x: 10, y: 20, width: 200, height: 100 });
  });

  it("ellipse: raw prop footprint at origin", () => {
    const e = leaf("ellipse", 5, 5, { width: 150, height: 80, thickness: 3, filled: false, color: "B" });
    expect(objectBoundsDots(e, ctx())).toEqual({ x: 5, y: 5, width: 150, height: 80 });
  });

  it("image: heightDots when present, else square from width", () => {
    const withH = leaf("image", 0, 0, { imageId: "a", widthDots: 120, heightDots: 60, threshold: 128 });
    expect(objectBoundsDots(withH, ctx())).toEqual({ x: 0, y: 0, width: 120, height: 60 });
    const noH = leaf("image", 4, 8, { imageId: "a", widthDots: 90, threshold: 128 });
    expect(objectBoundsDots(noH, ctx())).toEqual({ x: 4, y: 8, width: 90, height: 90 });
  });

  it("image: measured footprint (cached aspect) overrides the heightDots fallback", () => {
    const cached = leaf("image", 1, 1, { imageId: "a", widthDots: 120, threshold: 128 });
    const measured = new Map([[cached.id, { width: 120, height: 40 }]]);
    expect(objectBoundsDots(cached, ctx(measured))).toEqual({ x: 1, y: 1, width: 120, height: 40 });
  });

  it("image: a rotated field swaps the footprint axes (no measured)", () => {
    const up = leaf("image", 0, 0, { imageId: "a", widthDots: 200, heightDots: 100, threshold: 128 } as never);
    const rot = leaf("image", 0, 0, { imageId: "a", widthDots: 200, heightDots: 100, threshold: 128, rotation: "R" } as never);
    expect(objectBoundsDots(up, ctx())).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(objectBoundsDots(rot, ctx())).toEqual({ x: 0, y: 0, width: 100, height: 200 });
  });

  it("image: storedAs/rawGf ignore rotation (emit upright, so bounds don't swap)", () => {
    const stored = leaf("image", 0, 0, { imageId: "a", widthDots: 200, heightDots: 100, threshold: 128, rotation: "R", storedAs: { device: "R", name: "L" } } as never);
    const raw = leaf("image", 0, 0, { imageId: "a", widthDots: 200, heightDots: 100, threshold: 128, rotation: "R", rawGf: "^GFA,0,0,0," } as never);
    expect(objectBoundsDots(stored, ctx())).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(objectBoundsDots(raw, ctx())).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  it("line: horizontal bbox uses thickness on thin axis", () => {
    const ln = leaf("line", 10, 50, { angle: 0, length: 200, thickness: 4, color: "B" });
    expect(objectBoundsDots(ln, ctx())).toEqual({ x: 10, y: 50, width: 200, height: 4 });
  });

  it("line: 180deg extends left of the origin", () => {
    const ln = leaf("line", 300, 50, { angle: 180, length: 200, thickness: 4, color: "B" });
    const b = objectBoundsDots(ln, ctx());
    expect(b.x).toBeCloseTo(100, 6);
    expect(b.width).toBeCloseTo(200, 6);
    expect(b.height).toBe(4);
  });

  it("line: diagonal optical bbox includes the ^GD horizontal shear", () => {
    // 3-4-5: angle ~36.87deg, length 100 -> dx 80, dy 60. ^GD shears the band
    // horizontally by thickness, so the optical width is dx + t = 82.
    const ln = leaf("line", 0, 0, { angle: Math.atan2(60, 80) * 180 / Math.PI, length: 100, thickness: 2, color: "B" });
    const b = objectBoundsDots(ln, ctx());
    expect(b.x).toBeCloseTo(0, 6);
    expect(b.y).toBeCloseTo(0, 6);
    expect(b.width).toBeCloseTo(82, 6);
    expect(b.height).toBeCloseTo(60, 6);
  });

  it("symbol: bbox stays w x h regardless of rotation", () => {
    const s = leaf("symbol", 7, 9, { symbol: "A", width: 40, height: 30, rotation: "R" });
    expect(objectBoundsDots(s, ctx())).toEqual({ x: 7, y: 9, width: 40, height: 30 });
  });

  it("text single-line, empty content: placeholder footprint, not zero width", () => {
    // The canvas draws a 4-glyph placeholder rect for blank text; the bounds
    // must match it so the action bar centers on what is drawn.
    const t = leaf("text", 50, 30, { content: "", fontHeight: 40, fontWidth: 0, rotation: "N" });
    expect(objectBoundsDots(t, ctx())).toEqual({ x: 50, y: 30, width: 160, height: 40 });
  });

  it("text single-line, empty content (R): placeholder footprint swaps axes", () => {
    const t = leaf("text", 50, 30, { content: "  ", fontHeight: 40, fontWidth: 0, rotation: "R" });
    const b = objectBoundsDots(t, ctx());
    expect(b.width).toBe(40);
    expect(b.height).toBe(160);
  });

  it("text ^FB block (N): blockBoundsDots footprint shifted to model space", () => {
    // lineStep = 40 + 10 = 50; linesExtent = (3-1)*50 + 40 = 140.
    const t = leaf("text", 50, 30, {
      content: "x", fontHeight: 40, fontWidth: 0, rotation: "N",
      blockWidth: 160, blockLines: 3, blockLineSpacing: 10, blockJustify: "L",
    });
    expect(objectBoundsDots(t, ctx())).toEqual({ x: 50, y: 30, width: 160, height: 140 });
  });

  it("text ^TB block (N): extent uses blockHeight, not the line count", () => {
    const t = leaf("text", 50, 30, {
      content: "x", fontHeight: 40, fontWidth: 0, rotation: "N",
      textMode: "tb", blockWidth: 160, blockHeight: 120,
    });
    expect(objectBoundsDots(t, ctx())).toEqual({ x: 50, y: 30, width: 160, height: 120 });
  });

  it("text ^TB block (R): axes swap with the clip height", () => {
    const t = leaf("text", 50, 30, {
      content: "x", fontHeight: 40, fontWidth: 0, rotation: "R",
      textMode: "tb", blockWidth: 160, blockHeight: 120,
    });
    expect(objectBoundsDots(t, ctx())).toEqual({ x: -70, y: 30, width: 120, height: 160 });
  });

  it("text ^FB block (R): axes swap and negative x shift fold into model space", () => {
    // R: x = -linesExtent (-140), y = 0, width = linesExtent (140), height = blockWidth (160).
    const t = leaf("text", 50, 30, {
      content: "x", fontHeight: 40, fontWidth: 0, rotation: "R",
      blockWidth: 160, blockLines: 3, blockLineSpacing: 10, blockJustify: "L",
    });
    expect(objectBoundsDots(t, ctx())).toEqual({ x: -90, y: 30, width: 140, height: 160 });
  });

  it("single-line text: measured cache supplies the rotated footprint", () => {
    const t = leaf("text", 12, 24, { content: "Hello", fontHeight: 30, fontWidth: 0, rotation: "N" });
    const measured = new Map([[t.id, { width: 77, height: 30 }]]);
    expect(objectBoundsDots(t, ctx(measured))).toEqual({ x: 12, y: 24, width: 77, height: 30 });
  });

  it("single-line text: rotated footprint size is verbatim, top-left shifts for R", () => {
    const t = leaf("text", 12, 24, { content: "Hello", fontHeight: 30, fontWidth: 0, rotation: "R" });
    const measured = new Map([[t.id, { width: 30, height: 77 }]]); // already rotated
    // Size used verbatim (not re-rotated); R rotates about the anchor, so the
    // visual top-left moves left by the rotated width (mirrors blockBoundsDots).
    expect(objectBoundsDots(t, ctx(measured))).toEqual({ x: -18, y: 24, width: 30, height: 77 });
  });

  it("single-line text: B rotates about the anchor, top-left moves up", () => {
    const t = leaf("text", 12, 24, { content: "Hello", fontHeight: 30, fontWidth: 0, rotation: "B" });
    const measured = new Map([[t.id, { width: 30, height: 77 }]]); // already rotated
    expect(objectBoundsDots(t, ctx(measured))).toEqual({ x: 12, y: -53, width: 30, height: 77 });
  });

  it("single-line text: I rotates about the anchor, top-left moves left and up", () => {
    const t = leaf("text", 12, 24, { content: "Hello", fontHeight: 30, fontWidth: 0, rotation: "I" });
    const measured = new Map([[t.id, { width: 77, height: 30 }]]); // already rotated
    expect(objectBoundsDots(t, ctx(measured))).toEqual({ x: -65, y: -6, width: 77, height: 30 });
  });

  it("single-line text: fallback estimate swaps axes for R", () => {
    const t = leaf("text", 0, 0, { content: "AB", fontHeight: 30, fontWidth: 0, rotation: "R" });
    const b = objectBoundsDots(t, ctx());
    expect(b.width).toBe(30);
    expect(b.height).toBeCloseTo(33.3, 6);
  });

  it("single-line text: fallback estimate from Font-0 advance when unmeasured", () => {
    // A advance 0.555, B 0.555 -> (0.555 + 0.555) * 30 = 33.3.
    const t = leaf("text", 0, 0, { content: "AB", fontHeight: 30, fontWidth: 0, rotation: "N" });
    const b = objectBoundsDots(t, ctx());
    expect(b.width).toBeCloseTo(33.3, 6);
    expect(b.height).toBe(30);
  });

  it("serial text: measured cache then fallback", () => {
    const s = leaf("text", 3, 3, { content: "001", fontHeight: 30, fontWidth: 0, rotation: "N", serial: { increment: 1, zplMode: "SN" } });
    const measured = new Map([[s.id, { width: 44, height: 30 }]]);
    expect(objectBoundsDots(s, ctx(measured))).toEqual({ x: 3, y: 3, width: 44, height: 30 });
    // No measurement: 0/0/1 advance 0.48 each -> 1.44 * 30 = 43.2.
    const b = objectBoundsDots(s, ctx());
    expect(b.width).toBeCloseTo(43.2, 6);
    expect(b.height).toBe(30);
  });

  it("serial text with dormant block props uses single-line bounds, not the stale blockWidth", () => {
    // Serial resolves to 'normal'; its leftover ^FB props must not drive bounds.
    const s = leaf("text", 3, 3, {
      content: "001", fontHeight: 30, fontWidth: 0, rotation: "N",
      serial: { increment: 1, zplMode: "SN" },
      blockWidth: 160, blockLines: 3, blockLineSpacing: 10, blockJustify: "L",
    });
    const measured = new Map([[s.id, { width: 44, height: 30 }]]);
    expect(objectBoundsDots(s, ctx(measured))).toEqual({ x: 3, y: 3, width: 44, height: 30 });
  });

  it("barcode (FO): measured footprint at the origin", () => {
    const bc = leaf("code128", 20, 40, { content: "123", moduleWidth: 2, height: 80, printInterpretation: true } as never);
    const measured = new Map([[bc.id, { width: 150, height: 80 }]]);
    expect(objectBoundsDots(bc, ctx(measured))).toEqual({ x: 20, y: 40, width: 150, height: 80 });
  });

  it("barcode (FO, no measured): registry fallback swaps axes for a rotated field", () => {
    // Without a measured entry the upright registry defaultSize is used; a
    // rotated (R/B) barcode must report the swapped bbox, like singleLineEstimate.
    const up = leaf("code128", 0, 0, { content: "123", moduleWidth: 2, height: 80, printInterpretation: true } as never);
    const rot = leaf("code128", 0, 0, { content: "123", moduleWidth: 2, height: 80, rotation: "R", printInterpretation: true } as never);
    const u = objectBoundsDots(up, ctx());
    const r = objectBoundsDots(rot, ctx());
    expect(r.width).toBe(u.height);
    expect(r.height).toBe(u.width);
  });

  it("barcode (FT 1D): top sits one bar-height above the baseline", () => {
    const bc = leaf(
      "code128", 20, 100,
      { content: "123", moduleWidth: 2, height: 80, printInterpretation: true } as never,
      { positionType: "FT" },
    );
    const measured = new Map([[bc.id, { width: 150, height: 80 }]]);
    // FT baseline at y=100; visual top = 100 - 80 = 20.
    expect(objectBoundsDots(bc, ctx(measured))).toEqual({ x: 20, y: 20, width: 150, height: 80 });
  });

  // ZD230-measured (^IS/^HY preview, 8 dpmm): `^FT100,300^BD4,1,1` prints its
  // ink bottom row exactly on y=300, so the full 199-dot footprint sits above
  // the baseline, same as `^FO100,101`.
  it("barcode (FT maxicode): the whole 199-dot footprint sits above the baseline", () => {
    const mc = leaf("maxicode", 100, 300, { content: "1234567890", mode: 4 }, { positionType: "FT" });
    const measured = new Map([
      [mc.id, { width: 209, height: 199, uprightBarWDots: 209, uprightBarHDots: 199 }],
    ]);
    expect(objectBoundsDots(mc, ctx(measured))).toEqual({ x: 100, y: 101, width: 209, height: 199 });
  });

  it("barcode (FT 1D with HRI zone): top shifts by BAR height, not the full footprint", () => {
    // ean13: bar height 80, measured footprint 93 (13-dot HRI text zone below bars).
    const bc = leaf(
      "ean13", 20, 100,
      { content: "4006381333931", moduleWidth: 2, height: 80, printInterpretation: true } as never,
      { positionType: "FT" },
    );
    const measured = new Map([[bc.id, { width: 150, height: 93 }]]);
    // top = baseline 100 - barHeight 80 = 20 (NOT 100 - 93); bbox keeps full height 93.
    expect(objectBoundsDots(bc, ctx(measured))).toEqual({ x: 20, y: 20, width: 150, height: 93 });
  });

  it("barcode (FT rotated R): anchors at the field origin (R offset is zero)", () => {
    // R: the bar base/left edge maps to the bbox top-left, so no shift at all,
    // regardless of size. (The old N-style code wrongly shifted it up by the bar.)
    const bc = leaf(
      "code128", 20, 100,
      { content: "123", moduleWidth: 2, height: 80, rotation: "R", printInterpretation: true } as never,
      { positionType: "FT" },
    );
    const measured = new Map([[bc.id, { width: 40, height: 200, uprightBarWDots: 200, uprightBarHDots: 40 }]]);
    expect(objectBoundsDots(bc, ctx(measured))).toEqual({ x: 20, y: 100, width: 40, height: 200 });
  });

  it("barcode (FO with above-HRI zone): top shifts up by the text-zone offset", () => {
    // logmars: text zone above the bars (barTopDots), bbox top-left sits above FO.
    const bc = leaf(
      "logmars", 20, 40,
      { content: "ABC", moduleWidth: 2, height: 80, printInterpretation: true } as never,
    );
    const measured = new Map([[bc.id, { width: 150, height: 95, barTopDots: 15 }]]);
    expect(objectBoundsDots(bc, ctx(measured))).toEqual({ x: 20, y: 25, width: 150, height: 95 });
  });

  it("barcode (FO rotated, text zone left): top-left shifts left by the text-zone offset", () => {
    // Rotated EAN/UPC: HRI text zone sits left of the bars (barLeftDots).
    const bc = leaf(
      "ean13", 20, 40,
      { content: "4006381333931", moduleWidth: 2, height: 80, rotation: "R", printInterpretation: true } as never,
    );
    const measured = new Map([[bc.id, { width: 95, height: 150, barLeftDots: 15 }]]);
    expect(objectBoundsDots(bc, ctx(measured))).toEqual({ x: 5, y: 40, width: 95, height: 150 });
  });

  it("barcode (FT rotated I, text-zone offsets): anchor uses bar width plus zone offsets", () => {
    const bc = leaf(
      "ean13", 20, 100,
      { content: "4006381333931", moduleWidth: 2, height: 80, rotation: "I", printInterpretation: true } as never,
      { positionType: "FT" },
    );
    const measured = new Map([[bc.id, { width: 150, height: 95, uprightBarWDots: 130, uprightBarHDots: 80, barLeftDots: 10, barTopDots: 15 }]]);
    // I offset = (-uprightBarW, 0): x = 20 - 130 - 10 = -120; y = 100 + 0 - 15 = 85.
    expect(objectBoundsDots(bc, ctx(measured))).toEqual({ x: -120, y: 85, width: 150, height: 95 });
  });

  it("barcode: registry fallback when unmeasured", () => {
    const bc = leaf("code128", 0, 0, { content: "123", moduleWidth: 2, height: 80, printInterpretation: true } as never);
    const b = objectBoundsDots(bc, ctx());
    // code128 defaultSize is in dots; non-zero footprint proves the fallback path.
    expect(b.width).toBeGreaterThan(0);
    expect(b.height).toBeGreaterThan(0);
  });

  it("qrcode (FO): +10 dot firmware Y artifact", () => {
    const qr = leaf("qrcode", 10, 10, { content: "x", magnification: 5, errorCorrection: "M" } as never);
    const measured = new Map([[qr.id, { width: 120, height: 120 }]]);
    expect(objectBoundsDots(qr, ctx(measured))).toEqual({ x: 10, y: 20, width: 120, height: 120 });
  });
});

describe("groups and selection union", () => {
  const box = leaf("box", 0, 0, { width: 100, height: 50, thickness: 3, filled: false, color: "B", rounding: 0 });
  const ellipse = leaf("ellipse", 200, 100, { width: 80, height: 80, thickness: 3, filled: false, color: "B" });
  const group: LabelObject = {
    id: "g1", type: "group", x: 0, y: 0, rotation: 0,
    children: [box, ellipse],
  } as LabelObject;

  it("group: union of all leaf bboxes", () => {
    // box spans (0,0)-(100,50); ellipse (200,100)-(280,180).
    expect(objectBoundsDots(group, ctx())).toEqual({ x: 0, y: 0, width: 280, height: 180 });
  });

  it("selectionUnionDots: mixed leaf + group selection", () => {
    const lone = leaf("box", 300, 300, { width: 20, height: 20, thickness: 3, filled: false, color: "B", rounding: 0 });
    const objects: LabelObject[] = [group, lone];
    const u = selectionUnionDots(objects, ["g1", lone.id], ctx());
    expect(u).toEqual({ x: 0, y: 0, width: 320, height: 320 });
  });

  it("selectionUnionDots: a group id resolves to one bbox", () => {
    const objects: LabelObject[] = [group];
    expect(selectionUnionDots(objects, ["g1"], ctx())).toEqual({ x: 0, y: 0, width: 280, height: 180 });
  });

  it("selectionUnionDots: null for empty or unknown ids", () => {
    expect(selectionUnionDots([group], [], ctx())).toBeNull();
    expect(selectionUnionDots([group], ["missing"], ctx())).toBeNull();
  });
});

describe("barcode ^FT rotation anchor", () => {
  // Regression for the bug where rotated ^FT barcodes were anchored N-only and
  // came out offset (only imported barcodes use ^FT; the editor creates ^FO).
  it("barcodeFtAnchorOffset rotates the FT anchor (bar base, left) per rotation", () => {
    expect(barcodeFtAnchorOffset("N", 200, 100)).toEqual({ x: 0, y: -100 });
    expect(barcodeFtAnchorOffset("R", 200, 100)).toEqual({ x: 0, y: 0 });
    expect(barcodeFtAnchorOffset("I", 200, 100)).toEqual({ x: -200, y: 0 });
    expect(barcodeFtAnchorOffset("B", 200, 100)).toEqual({ x: -100, y: -200 });
  });

  // Upright bars 200x100; the measured footprint is already rotated.
  const bc = (rotation: ZplRotation, footW: number, footH: number) => {
    const o = leaf(
      "code128",
      400,
      300,
      { content: "X", height: 100, moduleWidth: 2, printInterpretation: false, checkDigit: false, rotation },
      { positionType: "FT" },
    );
    const measured = new Map([
      [o.id, { width: footW, height: footH, uprightBarWDots: 200, uprightBarHDots: 100 }],
    ]);
    return objectBoundsDots(o, ctx(measured));
  };

  it("anchors a rotated ^FT barcode to the field, not the N corner", () => {
    expect(bc("N", 200, 100)).toEqual({ x: 400, y: 200, width: 200, height: 100 });
    expect(bc("R", 100, 200)).toEqual({ x: 400, y: 300, width: 100, height: 200 });
    expect(bc("I", 200, 100)).toEqual({ x: 200, y: 300, width: 200, height: 100 });
    expect(bc("B", 100, 200)).toEqual({ x: 300, y: 100, width: 100, height: 200 });
  });

  it("^FO barcodes ignore the FT anchor offset (origin is rotation-independent)", () => {
    const o = leaf(
      "code128", 400, 300,
      { content: "X", height: 100, moduleWidth: 2, printInterpretation: false, checkDigit: false, rotation: "B" },
      { positionType: "FO" },
    );
    const measured = new Map([[o.id, { width: 100, height: 200, uprightBarWDots: 200, uprightBarHDots: 100 }]]);
    expect(objectBoundsDots(o, ctx(measured))).toEqual({ x: 400, y: 300, width: 100, height: 200 });
  });

  it("QR ^FT composes the firmware module shift with the anchor offset", () => {
    const o = leaf(
      "qrcode", 400, 300,
      { content: "x", magnification: 4, errorCorrection: "Q", model: 2, rotation: "N" },
      { positionType: "FT" },
    );
    const measured = new Map([[o.id, { width: 80, height: 80, uprightBarWDots: 80, uprightBarHDots: 80 }]]);
    // y = obj.y - uprightBarH - QR_FT_MODULE_OFFSET * magnification
    expect(objectBoundsDots(o, ctx(measured))).toMatchObject({ x: 400, y: 300 - 80 - QR_FT_MODULE_OFFSET * 4 });
  });

  it("before dims publish, the anchor uses the same fallback width as the bbox", () => {
    // code128 fallbackSize = 300x120; height anchor uses props.height (100).
    const fp = (rotation: "N" | "R" | "I" | "B") =>
      objectBoundsDots(
        leaf("code128", 400, 300,
          { content: "X", height: 100, moduleWidth: 2, printInterpretation: false, checkDigit: false, rotation },
          { positionType: "FT" }),
        ctx(),
      );
    // R offset is (0,0); N shifts up by props.height.
    expect(fp("R")).toMatchObject({ x: 400, y: 300 });
    expect(fp("N")).toMatchObject({ x: 400, y: 200 });
    // I/B depend on width: pre-publish they fall back to the bbox width (300)
    // so x is not stuck at the field origin (would desync from the rendered box).
    expect(fp("I")).toMatchObject({ x: 100, y: 300 }); // x = 400 - 300
    expect(fp("B")).toMatchObject({ x: 300, y: 0 }); // x = 400 - 100, y = 300 - 300
  });
});

describe("offLabelPlacement", () => {
  // printable rect for this label = 800 x 400 dots at origin. Signature is
  // (emittedAnchor, visualBox, label): near edges read the anchor, far the box.
  const at = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

  it("null when the box is fully within the printable rect", () => {
    expect(offLabelPlacement({ x: 10, y: 10 }, at(10, 10, 100, 50), label)).toBeNull();
  });
  it("null on an exact fit to the label rect", () => {
    expect(offLabelPlacement({ x: 0, y: 0 }, at(0, 0, 800, 400), label)).toBeNull();
  });
  it("clipped when crossing the right edge with part inside", () => {
    expect(offLabelPlacement({ x: 750, y: 10 }, at(750, 10, 100, 50), label)).toBe("clipped");
  });
  it("clipped when crossing the bottom edge with part inside", () => {
    expect(offLabelPlacement({ x: 0, y: 350 }, at(0, 350, 100, 100), label)).toBe("clipped");
  });
  it("outside when entirely past the right edge", () => {
    expect(offLabelPlacement({ x: 900, y: 10 }, at(900, 10, 50, 50), label)).toBe("outside");
  });
  it("outside when flush against the right edge with no overlap", () => {
    // Right edge is 800; a box starting exactly at 800 touches but never overlaps.
    expect(offLabelPlacement({ x: 800, y: 10 }, at(800, 10, 50, 50), label)).toBe("outside");
  });

  // Near edges (left/top) read the ANCHOR: a negative emitted origin is off the
  // printable area / out of ZPL range -> hard `outside`, never the softer clipped.
  it("outside when the anchor sits in negative space", () => {
    expect(offLabelPlacement({ x: -100, y: -100 }, at(-100, -100, 50, 50), label)).toBe("outside");
  });
  it("outside when the anchor is left of the origin", () => {
    expect(offLabelPlacement({ x: -50, y: 10 }, at(-50, 10, 100, 50), label)).toBe("outside");
  });
  it("outside when the anchor is above the origin", () => {
    expect(offLabelPlacement({ x: 10, y: -20 }, at(10, -20, 50, 50), label)).toBe("outside");
  });

  // The founding case: a VALID positive anchor whose body extends back over the
  // near edge (rotated/sized field) is NOT flagged -> matches what the printer
  // renders. The box top is negative but the anchor is on-label.
  it("null when a positive anchor's body extends past the top edge", () => {
    expect(offLabelPlacement({ x: 60, y: 80 }, at(60, -120, 300, 120), label)).toBeNull();
  });
  it("null when a positive anchor's body extends past the left edge", () => {
    expect(offLabelPlacement({ x: 200, y: 50 }, at(-40, 50, 300, 60), label)).toBeNull();
  });

  it("respects the half-dot epsilon at the far edge", () => {
    expect(offLabelPlacement({ x: 0, y: 0 }, at(0, 0, 800.4, 400), label)).toBeNull(); // 0.4 tolerated
    expect(offLabelPlacement({ x: 0, y: 0 }, at(0, 0, 800.6, 400), label)).toBe("clipped"); // 0.6 flagged
  });

  it("uses the ^LS printable window (^LS shifts content left, window moves right)", () => {
    const shifted = { ...label, labelShift: 80 };
    // ^LS80 shifts content left by 80, so the valid model window is [80, 880].
    // An anchor at x=10 now sits left of the window origin -> outside.
    expect(offLabelPlacement({ x: 10, y: 10 }, at(10, 10, 50, 50), shifted)).toBe("outside");
    expect(offLabelPlacement({ x: 10, y: 10 }, at(10, 10, 50, 50), label)).toBeNull();
    // The right edge extends to 880: a box at 810..860 is now inside.
    expect(offLabelPlacement({ x: 810, y: 0 }, at(810, 0, 50, 50), shifted)).toBeNull();
    expect(offLabelPlacement({ x: 810, y: 0 }, at(810, 0, 50, 50), label)).toBe("outside");
  });
});

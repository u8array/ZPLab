import { describe, expect, it, beforeEach } from "vitest";
import { CALIBRATION_CLAMP, LAYOUT_LABEL_FIELDS, rescaleDesign, rescaleParamsFor, rescaleWouldChange } from "./densityRescale";
import { useLabelStore } from "../store/labelStore";
import type { LabelObject, Page } from "@zplab/core/types/Group";
import type { LeafObject } from "@zplab/core/registry";
import type { LabelConfig } from "@zplab/core/types/LabelConfig";

const label: LabelConfig = { widthMm: 100, heightMm: 50, dpmm: 8 };

function leaf<T extends LeafObject["type"]>(
  id: string,
  type: T,
  x: number,
  y: number,
  props: Extract<LeafObject, { type: T }>["props"],
  extra: Partial<LabelObject> = {},
): Extract<LeafObject, { type: T }> {
  return { id, type, x, y, rotation: 0, props, ...extra } as Extract<LeafObject, { type: T }>;
}

const page = (...objects: LabelObject[]): Page[] => [{ objects }];

describe("rescaleDesign", () => {
  it("is a no-op when the density is unchanged (just stamps dpmm)", () => {
    const pages = page(leaf("b", "box", 10, 20, { width: 100, height: 50, thickness: 2, filled: false, color: "B", rounding: 0 }));
    const r = rescaleDesign(pages, label, 8, 8, { dpmm: 8 });
    expect(r.pages).toBe(pages);
    expect(r.warnings).toEqual([]);
    expect(r.label.dpmm).toBe(8);
  });

  it("scales position and box dimensions by the density ratio", () => {
    const box = leaf("b", "box", 10, 20, { width: 100, height: 50, thickness: 2, filled: false, color: "B", rounding: 4 });
    const r = rescaleDesign(page(box), label, 8, 12, { dpmm: 12 }); // factor 1.5
    const out = r.pages[0]!.objects[0] as typeof box;
    expect(out.x).toBe(15);
    expect(out.y).toBe(30);
    expect(out.props.width).toBe(150);
    expect(out.props.height).toBe(75);
    expect(out.props.thickness).toBe(3);
    expect(out.props.rounding).toBe(4); // ^GB corner index (0-8), not a dot value
    expect(r.label.dpmm).toBe(12);
    expect(r.warnings).toEqual([]);
  });

  it("scales label dimensions in mm are kept (physical size constant)", () => {
    const r = rescaleDesign(page(), label, 8, 12, { dpmm: 12 });
    expect(r.label.widthMm).toBe(100);
    expect(r.label.heightMm).toBe(50);
  });

  it("clamps barcode moduleWidth to 10 and warns", () => {
    const bc = leaf("c", "code128", 0, 0, { content: "X", height: 80, moduleWidth: 8, printInterpretation: false, checkDigit: false, rotation: "N" } as never);
    const r = rescaleDesign(page(bc), label, 8, 24, { dpmm: 24 }); // factor 3 -> 24 clamps to 10
    const out = r.pages[0]!.objects[0] as typeof bc;
    expect((out.props as { moduleWidth: number }).moduleWidth).toBe(10);
    expect((out.props as { height: number }).height).toBe(240);
    expect(r.warnings).toContainEqual({ id: "c", name: "code128", type: "code128", prop: "moduleWidth", reason: "moduleClamped" });
  });

  it("does not warn when moduleWidth scales within range", () => {
    const bc = leaf("c", "code128", 0, 0, { content: "X", height: 80, moduleWidth: 2, printInterpretation: false, checkDigit: false, rotation: "N" } as never);
    const r = rescaleDesign(page(bc), label, 8, 12, { dpmm: 12 }); // factor 1.5 -> mw 3
    const out = r.pages[0]!.objects[0] as typeof bc;
    expect((out.props as { moduleWidth: number }).moduleWidth).toBe(3);
    expect(r.warnings).toEqual([]);
  });

  it("clamps QR magnification to 10 and warns", () => {
    const qr = leaf("q", "qrcode", 0, 0, { content: "QA,hi", magnification: 5, errorCorrection: "Q", model: 2, rotation: "N" } as never);
    const r = rescaleDesign(page(qr), label, 8, 24, { dpmm: 24 }); // factor 3 -> 15 clamps to 10
    const out = r.pages[0]!.objects[0] as typeof qr;
    expect((out.props as { magnification: number }).magnification).toBe(10);
    expect(r.warnings.some((w) => w.reason === "magnificationClamped")).toBe(true);
  });

  it("enforces pdf417 module width minimum of 2", () => {
    const pdf = leaf("p", "pdf417", 0, 0, { content: "x", moduleWidth: 2, rowHeight: 6, securityLevel: 0, columns: 0, rotation: "N" } as never);
    const r = rescaleDesign(page(pdf), label, 12, 8, { dpmm: 8 }); // factor ~0.667 -> 1.33 rounds to 1, clamps to 2
    const out = r.pages[0]!.objects[0] as typeof pdf;
    expect((out.props as { moduleWidth: number }).moduleWidth).toBe(2);
    expect(r.warnings.some((w) => w.reason === "moduleClamped")).toBe(true);
  });

  it("floors image widthDots at 8 and warns", () => {
    const img = leaf("i", "image", 0, 0, { imageId: "a", widthDots: 16, threshold: 128 } as never);
    const r = rescaleDesign(page(img), label, 24, 8, { dpmm: 8 }); // factor 1/3 -> 5.33 floors to 8
    const out = r.pages[0]!.objects[0] as typeof img;
    expect((out.props as { widthDots: number }).widthDots).toBe(8);
    expect(r.warnings.some((w) => w.reason === "imageFloor")).toBe(true);
  });

  it("drops the stale GFA cache when an editable image is rescaled", () => {
    const img = leaf("i", "image", 0, 0, { imageId: "a", widthDots: 100, threshold: 128, _gfaCache: "^GFA,old" } as never);
    const r = rescaleDesign(page(img), label, 8, 16, { dpmm: 16 }); // factor 2
    const out = r.pages[0]!.objects[0] as typeof img;
    expect((out.props as { widthDots: number }).widthDots).toBe(200);
    expect((out.props as { _gfaCache?: string })._gfaCache).toBeUndefined();
  });

  it("locks the footprint of a verbatim (rawGf) graphic and warns it cannot rescale", () => {
    const img = leaf("i", "image", 10, 0, { imageId: "", widthDots: 100, heightDots: 50, threshold: 128, rawGf: "^GFA,raw" } as never);
    const r = rescaleDesign(page(img), label, 8, 16, { dpmm: 16 }); // factor 2
    const out = r.pages[0]!.objects[0] as typeof img;
    expect((out.props as { widthDots: number }).widthDots).toBe(100); // box locked
    expect((out.props as { heightDots: number }).heightDots).toBe(50);
    expect(out.x).toBe(20); // position still scales
    expect(r.warnings.some((w) => w.reason === "imageFixed")).toBe(true);
  });

  it("locks the footprint of a recall (storedAs) image", () => {
    const img = leaf("i", "image", 0, 0, { imageId: "", widthDots: 100, threshold: 128, storedAs: { device: "R", name: "LOGO" } } as never);
    const r = rescaleDesign(page(img), label, 8, 16, { dpmm: 16 });
    const out = r.pages[0]!.objects[0] as typeof img;
    expect((out.props as { widthDots: number }).widthDots).toBe(100);
    expect(r.warnings.some((w) => w.reason === "imageFixed")).toBe(true);
  });

  it("floors image heightDots at 8 and warns (symmetric with widthDots)", () => {
    const img = leaf("i", "image", 0, 0, { imageId: "a", widthDots: 90, heightDots: 18, threshold: 128 } as never);
    const r = rescaleDesign(page(img), label, 24, 8, { dpmm: 8 }); // factor 1/3 -> heightDots 6 floors to 8
    const out = r.pages[0]!.objects[0] as typeof img;
    expect((out.props as { heightDots: number }).heightDots).toBe(8);
    expect(r.warnings.some((w) => w.prop === "heightDots" && w.reason === "imageFloor")).toBe(true);
  });

  it("clamps DataMatrix dimension to 12 and warns", () => {
    const dm = leaf("d", "datamatrix", 0, 0, { content: "x", dimension: 6, quality: 200, rotation: "N", gs1: false } as never);
    const r = rescaleDesign(page(dm), label, 8, 24, { dpmm: 24 }); // factor 3 -> 18 clamps to 12
    const out = r.pages[0]!.objects[0] as typeof dm;
    expect((out.props as { dimension: number }).dimension).toBe(12);
    expect(r.warnings.some((w) => w.reason === "dimensionClamped")).toBe(true);
  });

  it("does not warn when a downscaled module prop rounds back into range", () => {
    // mag 1 * 0.5 = 0.5 -> rounds to 1 (already the min), so no real clamp occurred.
    // Guards the off-by-one where the pre-round ideal (0.5 < min) falsely warned.
    const qr = leaf("q", "qrcode", 0, 0, { content: "QA,hi", magnification: 1, errorCorrection: "Q", model: 2, rotation: "N" } as never);
    const r = rescaleDesign(page(qr), label, 24, 12, { dpmm: 12 }); // factor 0.5
    expect((r.pages[0]!.objects[0] as typeof qr).props as { magnification: number }).toMatchObject({ magnification: 1 });
    expect(r.warnings).toEqual([]);
  });

  it("scales tlc39 microPdfRowHeight along with the rest of the symbol", () => {
    const tlc = leaf("x", "tlc39", 0, 0, { content: "1,2", moduleWidth: 2, height: 40, microPdfRowHeight: 4, rotation: "N" } as never);
    const r = rescaleDesign(page(tlc), label, 8, 16, { dpmm: 16 }); // factor 2
    const out = r.pages[0]!.objects[0] as typeof tlc;
    expect((out.props as { microPdfRowHeight: number }).microPdfRowHeight).toBe(8);
    expect((out.props as { height: number }).height).toBe(80);
  });

  it("warns on device-font snap for fonts A-H but not font 0", () => {
    const a = leaf("t1", "text", 0, 0, { content: "x", fontHeight: 30, fontWidth: 0, fontId: "A", rotation: "N" } as never);
    const z = leaf("t2", "text", 0, 0, { content: "x", fontHeight: 30, fontWidth: 0, fontId: "0", rotation: "N" } as never);
    const r = rescaleDesign(page(a, z), label, 8, 12, { dpmm: 12 });
    expect(r.warnings.filter((w) => w.reason === "deviceFontSnap").map((w) => w.id)).toEqual(["t1"]);
  });

  it("scales negative ^FB line spacing preserving its sign", () => {
    const t = leaf("t", "text", 0, 0, { content: "x", fontHeight: 20, fontWidth: 0, fontId: "0", rotation: "N", textMode: "fb", blockWidth: 200, blockLines: 3, blockLineSpacing: -8 } as never);
    const r = rescaleDesign(page(t), label, 8, 16, { dpmm: 16 }); // factor 2
    const out = r.pages[0]!.objects[0] as typeof t;
    expect((out.props as { blockLineSpacing: number }).blockLineSpacing).toBe(-16);
  });

  it("rounds negative object coordinates and line spacing sign-symmetrically at factor 0.5", () => {
    const t = leaf("t", "text", -25, -25, { content: "x", fontHeight: 20, fontWidth: 0, fontId: "0", rotation: "N", textMode: "fb", blockWidth: 200, blockLines: 3, blockLineSpacing: -25 } as never);
    const r = rescaleDesign(page(t), label, 8, 4, { dpmm: 4 });
    const out = r.pages[0]!.objects[0] as typeof t;
    expect(out.x).toBe(-13);
    expect(out.y).toBe(-13);
    expect((out.props as { blockLineSpacing: number }).blockLineSpacing).toBe(-13);
  });

  it("keeps fontWidth 0 (auto) as 0 and scales fontHeight", () => {
    const t = leaf("t", "text", 0, 0, { content: "x", fontHeight: 20, fontWidth: 0, fontId: "0", rotation: "N" } as never);
    const r = rescaleDesign(page(t), label, 8, 16, { dpmm: 16 }); // factor 2
    const out = r.pages[0]!.objects[0] as typeof t;
    expect((out.props as { fontHeight: number }).fontHeight).toBe(40);
    expect((out.props as { fontWidth: number }).fontWidth).toBe(0);
  });

  it("recurses into groups, scaling leaves but not group coordinates", () => {
    const child = leaf("b", "box", 10, 10, { width: 40, height: 20, thickness: 2, filled: false, color: "B", rounding: 0 });
    const group = { id: "g", type: "group", x: 5, y: 5, rotation: 0, children: [child] } as unknown as LabelObject;
    const r = rescaleDesign(page(group), label, 8, 16, { dpmm: 16 }); // factor 2
    const outGroup = r.pages[0]!.objects[0] as { x: number; children: LabelObject[] };
    expect(outGroup.x).toBe(5); // group coord untouched
    const outChild = outGroup.children[0] as typeof child;
    expect(outChild.x).toBe(20);
    expect(outChild.props.width).toBe(80);
  });

  it("scales layout-affecting label dot fields but leaves calibration fields", () => {
    const cfg: LabelConfig = { widthMm: 100, heightMm: 50, dpmm: 8, labelHomeX: 10, labelHomeY: 20, defaultFontHeight: 30, defaultFontWidth: 0, labelTop: 100, maxLabelLength: 1200 };
    const r = rescaleDesign(page(), cfg, 8, 16, { dpmm: 16 }); // factor 2
    expect(r.label.labelHomeX).toBe(20);
    expect(r.label.labelHomeY).toBe(40);
    expect(r.label.defaultFontHeight).toBe(60);
    expect(r.label.labelTop).toBe(100); // calibration unchanged
    expect(r.label.maxLabelLength).toBe(1200); // calibration unchanged
  });

  it("scales calibration fields when includeCalibrationFields is set (^JM path)", () => {
    const cfg: LabelConfig = { widthMm: 100, heightMm: 50, dpmm: 8, labelShift: -12, labelTop: 40, maxLabelLength: 1200, slewDotRows: 30 };
    const r = rescaleDesign(page(), cfg, 8, 4, {}, true);
    expect(r.label.labelShift).toBe(-6);
    expect(r.label.labelTop).toBe(20);
    expect(r.label.maxLabelLength).toBe(1200); // ^ML is physical (ZD230): a ^JM switch must not rescale it
    expect(r.label.slewDotRows).toBe(15);
    expect(r.warnings).toEqual([]);
  });

  it("rounds negative calibration values sign-symmetrically (^LS ±25 at factor 0.5)", () => {
    const neg: LabelConfig = { widthMm: 100, heightMm: 50, dpmm: 8, labelShift: -25 };
    const pos: LabelConfig = { widthMm: 100, heightMm: 50, dpmm: 8, labelShift: 25 };
    // ±12.5 must round to ±13; Math.round(-12.5) = -12 would bias negatives up.
    expect(rescaleDesign(page(), neg, 8, 4, {}, true).label.labelShift).toBe(-13);
    expect(rescaleDesign(page(), pos, 8, 4, {}, true).label.labelShift).toBe(13);
  });

  it("clamps ^LT past its ±120 range and warns", () => {
    const cfg: LabelConfig = { widthMm: 100, heightMm: 50, dpmm: 8, labelTop: 100 };
    const r = rescaleDesign(page(), cfg, 8, 16, {}, true);
    expect(r.label.labelTop).toBe(120);
    expect(r.warnings).toContainEqual({ id: "label", name: "labelTop", type: "label", prop: "labelTop", reason: "calibrationClamped" });
  });

  const pinnedWarning = { id: "label", name: "", type: "label", prop: "", reason: "pinnedPageLabelFields" as const };

  it("warns that a ^JM-pinned page's shared label dot fields shift its physical output", () => {
    const cfg: LabelConfig = { widthMm: 100, heightMm: 50, dpmm: 8, labelHomeX: 10 };
    const box = leaf("p", "box", 100, 40, { width: 200, height: 80, thickness: 2, filled: false, color: "B", rounding: 0 });
    const pages: Page[] = [{ objects: [box], jmDensity: "B" }];
    const r = rescaleDesign(pages, cfg, 8, 4, { jmDensity: "B" }, true);
    expect(r.warnings).toContainEqual(pinnedWarning);
  });

  it("does not warn about pinned label fields when no page is pinned", () => {
    const cfg: LabelConfig = { widthMm: 100, heightMm: 50, dpmm: 8, labelHomeX: 10 };
    const r = rescaleDesign(page(), cfg, 8, 4, { jmDensity: "B" }, true);
    expect(r.warnings).not.toContainEqual(pinnedWarning);
  });

  it("does not warn about pinned label fields when every set field is an explicit 0", () => {
    const cfg: LabelConfig = { widthMm: 100, heightMm: 50, dpmm: 8, labelTop: 0, labelShift: 0 };
    const box = leaf("p", "box", 100, 40, { width: 200, height: 80, thickness: 2, filled: false, color: "B", rounding: 0 });
    const pages: Page[] = [{ objects: [box], jmDensity: "B" }];
    const r = rescaleDesign(pages, cfg, 8, 4, { jmDensity: "B" }, true);
    expect(r.warnings).not.toContainEqual(pinnedWarning);
  });
});

describe("rescaleWouldChange", () => {
  it("is true when a page has objects", () => {
    const pages = page(leaf("b", "box", 0, 0, { width: 10, height: 10, thickness: 1, filled: false, color: "B", rounding: 0 }));
    expect(rescaleWouldChange(pages, label, false, { dpmm: 12 })).toBe(true);
  });

  it("is false for an empty design with no scalable label fields", () => {
    expect(rescaleWouldChange(page(), label, false, { dpmm: 12 })).toBe(false);
    expect(rescaleWouldChange(page(), label, true, { jmDensity: 'B' })).toBe(false);
  });

  it("gates only the ^JM path on a calibration-only design", () => {
    const cfg: LabelConfig = { widthMm: 100, heightMm: 50, dpmm: 8, labelTop: 40 };
    expect(rescaleWouldChange(page(), cfg, false, { dpmm: 12 })).toBe(false);
    expect(rescaleWouldChange(page(), cfg, true, { jmDensity: 'B' })).toBe(true);
  });

  it("is false for explicitly zeroed fields (they scale to themselves)", () => {
    const cfg: LabelConfig = {
      widthMm: 100, heightMm: 50, dpmm: 8,
      labelTop: 0, labelShift: 0, defaultFontWidth: 0, labelHomeX: 0, defaultFontHeight: 0,
    };
    expect(rescaleWouldChange(page(), cfg, false, { dpmm: 12 })).toBe(false);
    expect(rescaleWouldChange(page(), cfg, true, { jmDensity: 'B' })).toBe(false);
    // and the transform agrees: no field moves off zero.
    const r = rescaleDesign(page(), cfg, 8, 4, {}, true);
    expect(r.label).toEqual(cfg);
  });

  it("is true on both paths when a layout label field is set", () => {
    const cfg: LabelConfig = { widthMm: 100, heightMm: 50, dpmm: 8, labelHomeX: 10 };
    expect(rescaleWouldChange(page(), cfg, false, { dpmm: 12 })).toBe(true);
    expect(rescaleWouldChange(page(), cfg, true, { jmDensity: 'B' })).toBe(true);
  });

  it("is false when the pending ^JM leaves the effective density alone", () => {
    const cfg: LabelConfig = { widthMm: 100, heightMm: 50, dpmm: 8, labelHomeX: 10 };
    expect(rescaleWouldChange(page(), cfg, true, { jmDensity: "A" })).toBe(false);
  });

  it("is false when every object page is pinned by its own ^JM override", () => {
    const box = leaf("b", "box", 10, 10, { width: 10, height: 10, thickness: 1, filled: false, color: "B", rounding: 0 });
    const pages: Page[] = [{ objects: [box], jmDensity: "B" }];
    expect(rescaleWouldChange(pages, label, true, { jmDensity: "B" })).toBe(false);
  });
});

describe("rescaleDensity store action", () => {
  const box = () =>
    leaf("b", "box", 10, 20, { width: 100, height: 50, thickness: 2, filled: false, color: "B", rounding: 0 });

  beforeEach(() => {
    useLabelStore.setState({
      label: { widthMm: 100, heightMm: 50, dpmm: 8 },
      pages: [{ objects: [box()] }],
      currentPageIndex: 0,
      selectedIds: [],
      previewMode: { status: "idle" },
    });
    useLabelStore.temporal.getState().clear();
  });

  const firstBox = () => useLabelStore.getState().pages[0]!.objects[0] as ReturnType<typeof box>;

  it("rescales label + objects in a single undo step", () => {
    useLabelStore.getState().rescaleDensity(16); // factor 2

    expect(useLabelStore.getState().label.dpmm).toBe(16);
    expect(firstBox().props.width).toBe(200);
    expect(firstBox().x).toBe(20);
    expect(useLabelStore.temporal.getState().pastStates.length).toBe(1);
  });

  it("is a no-op when the target density equals the current one", () => {
    useLabelStore.getState().rescaleDensity(8);
    expect(firstBox().props.width).toBe(100);
    expect(useLabelStore.temporal.getState().pastStates.length).toBe(0);
  });

  it("does nothing under the preview lock", () => {
    useLabelStore.setState({ previewMode: { status: "loading" } });
    useLabelStore.getState().rescaleDensity(16);
    expect(useLabelStore.getState().label.dpmm).toBe(8);
    expect(firstBox().props.width).toBe(100);
  });

  it("stamps a preset's size alongside the dpmm while rescaling dots", () => {
    useLabelStore.getState().rescaleDensity(16, { widthMm: 50, heightMm: 25 });
    const l = useLabelStore.getState().label;
    expect(l.dpmm).toBe(16);
    expect(l.widthMm).toBe(50);
    expect(l.heightMm).toBe(25);
    expect(firstBox().props.width).toBe(200);
  });
});

describe("rescaleParamsFor with a preset configPatch", () => {
  it("folds the extra size fields into the dpmm patch", () => {
    const p = rescaleParamsFor(
      { kind: "dpmm", toDpmm: 12, configPatch: { widthMm: 62, heightMm: 29 } },
      label,
    );
    expect(p.patch).toEqual({ dpmm: 12, widthMm: 62, heightMm: 29 });
    expect(p.includeCalibrationFields).toBe(false);
  });

  it("leaves the plain dpmm patch untouched when no configPatch rides along", () => {
    expect(rescaleParamsFor({ kind: "dpmm", toDpmm: 12 }, label).patch).toEqual({ dpmm: 12 });
  });
});

describe("rescaleJmDensity (store)", () => {
  beforeEach(() => {
    useLabelStore.setState({
      previewMode: { status: 'idle' },
      label: { ...label },
      pages: page(leaf("b", "box", 100, 40, { width: 200, height: 80, thickness: 2, filled: false, color: "B", rounding: 0 })),
    } as never);
  });

  it("halves dot values when switching to B (physical size preserved)", () => {
    useLabelStore.getState().rescaleJmDensity("B");
    const s = useLabelStore.getState();
    expect(s.label.jmDensity).toBe("B");
    expect(s.label.dpmm).toBe(8);
    const o = s.pages[0]!.objects[0] as { x: number; props: { width: number } };
    expect(o.x).toBe(50);
    expect(o.props.width).toBe(100);
  });

  it("rescales label + objects in a single undo step", () => {
    useLabelStore.temporal.getState().clear();
    useLabelStore.getState().rescaleJmDensity("B");
    expect(useLabelStore.temporal.getState().pastStates.length).toBe(1);
  });

  it("a no-ratio switch (unset to A) only stamps the mode", () => {
    useLabelStore.getState().rescaleJmDensity("A");
    const s = useLabelStore.getState();
    expect(s.label.jmDensity).toBe("A");
    expect((s.pages[0]!.objects[0] as { x: number }).x).toBe(100);
  });

  it("leaves a page pinned by its own ^JM override unscaled", () => {
    const pinned = leaf("p", "box", 100, 40, { width: 200, height: 80, thickness: 2, filled: false, color: "B", rounding: 0 });
    useLabelStore.setState({
      pages: [{ objects: [pinned], jmDensity: "B" }, ...useLabelStore.getState().pages],
    } as never);
    useLabelStore.getState().rescaleJmDensity("B");
    const s = useLabelStore.getState();
    // The pinned page already printed at B, so only the page that followed the
    // design halves; scaling both would double-scale the override.
    expect((s.pages[0]!.objects[0] as { x: number }).x).toBe(100);
    expect((s.pages[1]!.objects[0] as { x: number }).x).toBe(50);
  });

  it("scales calibration fields on the ratio switch (same head reinterpreted)", () => {
    useLabelStore.setState({ label: { ...label, labelTop: 40, maxLabelLength: 1200 } } as never);
    useLabelStore.getState().rescaleJmDensity("B");
    const s = useLabelStore.getState();
    expect(s.label.labelTop).toBe(20);
    expect(s.label.maxLabelLength).toBe(1200); // ^ML physical: unchanged by ^JM
  });
});

// Both lists derive from LABEL_CONFIG_FIELDS; pin the shape so a table typo
// cannot silently drop a field from the rescale or widen its bounds.
describe("derived label field sets", () => {
  it("keeps the layout fields and their floors", () => {
    expect(LAYOUT_LABEL_FIELDS).toEqual([
      { prop: "labelHomeX", min: 0 },
      { prop: "labelHomeY", min: 0 },
      { prop: "defaultFontHeight", min: 1 },
      { prop: "defaultFontWidth", min: 0 },
    ]);
  });

  it("keeps the calibration fields and their clamps", () => {
    expect(CALIBRATION_CLAMP).toEqual([
      { prop: "labelShift", min: -Infinity, max: Infinity },
      { prop: "labelTop", min: -120, max: 120 },
      { prop: "slewDotRows", min: 0, max: 32000 },
    ]);
  });
});

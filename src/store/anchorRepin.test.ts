import { describe, it, expect, afterEach } from "vitest";
import { applyObjectChanges, NON_EMITTING_PROP_KEYS } from "./labelStore.internals";
import { registerBarcodeWidthProber, unregisterBarcodeWidthProber, probeBarcodeFootprint } from "./anchorRepin";
import { stampDirtyLeaves } from "./dirtyTracking";
import { valueAnchorShift } from "@zplab/core/lib/valueAnchor";
import type { LabelObject } from "@zplab/core/types/Group";

// Fake probe: width tracks content length, axes swap under R rotation.
const probe = (o: LabelObject) => {
  const p = (o as { props: { content: string; rotation?: string } }).props;
  const w = p.content.length * 10;
  return p.rotation === "R" ? { w: 30, h: w } : { w, h: 30 };
};

const barcode = (over: object = {}, props: object = {}): LabelObject =>
  ({
    id: "b1",
    type: "code128",
    x: 100,
    y: 50,
    fieldJustify: "R",
    props: { content: "AB", height: 100, moduleWidth: 2, rotation: "N", ...props },
    ...over,
  }) as unknown as LabelObject;

describe("anchorRepin", () => {
  afterEach(() => registerBarcodeWidthProber(null));

  it("keeps the right edge fixed when the content widens", () => {
    registerBarcodeWidthProber(probe);
    const next = applyObjectChanges(barcode(), { props: { content: "ABCD" } });
    // Width 20 -> 40: origin moves left by the full delta.
    expect(next.x).toBe(80);
    expect(next.y).toBe(50);
  });

  it("splits an odd delta away from zero for a centre justify", () => {
    // Odd delta (-7) so a plain Math.round(delta/2) regression turns red.
    const oddProbe = (o: LabelObject) => {
      const c = (o as { props: { content: string } }).props.content;
      return { w: c === "ABCD" ? 27 : 20, h: 30 };
    };
    registerBarcodeWidthProber(oddProbe);
    const next = applyObjectChanges(barcode({ fieldJustify: "C" }), { props: { content: "ABCD" } });
    expect(next.x).toBe(96);
  });

  it("does nothing for L/absent justify or a width-neutral edit", () => {
    registerBarcodeWidthProber(probe);
    expect(applyObjectChanges(barcode({ fieldJustify: "L" }), { props: { content: "ABCD" } }).x).toBe(100);
    expect(applyObjectChanges(barcode({ fieldJustify: undefined }), { props: { content: "ABCD" } }).x).toBe(100);
    expect(applyObjectChanges(barcode(), { props: { height: 80 } }).x).toBe(100);
  });

  it("skips edits that position the object themselves (transformer commits)", () => {
    registerBarcodeWidthProber(probe);
    const next = applyObjectChanges(barcode(), { x: 200, props: { content: "ABCD" } });
    expect(next.x).toBe(200);
  });

  it("shifts y instead of x when the rotation swaps the axes", () => {
    registerBarcodeWidthProber(probe);
    const next = applyObjectChanges(barcode({}, { rotation: "R" }), { props: { content: "ABCD" } });
    expect(next.x).toBe(100);
    expect(next.y).toBe(30);
  });

  it("skips rotation changes (footprint axes swap, extents not comparable)", () => {
    registerBarcodeWidthProber(probe);
    const next = applyObjectChanges(barcode(), { props: { rotation: "R" } });
    expect(next.x).toBe(100);
    expect(next.y).toBe(50);
  });

  it("is inert without a registered prober (headless)", () => {
    const next = applyObjectChanges(barcode(), { props: { content: "ABCD" } });
    expect(next.x).toBe(100);
  });

  it("ignores non-1D types even with a hand-crafted justify (JSON/MCP)", () => {
    registerBarcodeWidthProber(probe);
    const qr = barcode({ type: "qrcode" });
    expect(applyObjectChanges(qr, { props: { content: "ABCD" } }).x).toBe(100);
  });

  it("centre widen/narrow toggle returns exactly (no half-up walk)", () => {
    // Odd delta (7) exposes Math.round's half-up asymmetry.
    const oddProbe = (o: LabelObject) => {
      const c = (o as { props: { content: string } }).props.content;
      return { w: c === "long" ? 27 : 20, h: 30 };
    };
    registerBarcodeWidthProber(oddProbe);
    const widened = applyObjectChanges(barcode({ fieldJustify: "C" }, { content: "shrt" }), {
      props: { content: "long" },
    });
    const back = applyObjectChanges(widened, { props: { content: "shrt" } });
    expect(back.x).toBe(100);
  });

  it("inverts the shift under ^FT with rotation I (bar-width-dependent origin)", () => {
    registerBarcodeWidthProber(probe);
    const ftI = barcode({ positionType: "FT" }, { rotation: "I" });
    // FT+I already pins the right edge; correct shift is 0.
    expect(applyObjectChanges(ftI, { props: { content: "ABCD" } }).x).toBe(100);
    const ftIL = barcode({ positionType: "FT", fieldJustify: "L" }, { rotation: "I" });
    // Holding the LEFT edge under FT+I needs the full delta.
    expect(applyObjectChanges(ftIL, { props: { content: "ABCD" } }).x).toBe(120);
  });
});

describe("prober registry", () => {
  afterEach(() => registerBarcodeWidthProber(null));

  it("a stale unregister cannot null a successor registration", () => {
    const a = () => ({ w: 1, h: 1 });
    const b = () => ({ w: 2, h: 2 });
    registerBarcodeWidthProber(a);
    registerBarcodeWidthProber(b);
    unregisterBarcodeWidthProber(a);
    expect(probeBarcodeFootprint({} as LabelObject)).toEqual({ w: 2, h: 2 });
  });
});

describe("NON_EMITTING_PROP_KEYS", () => {
  it("membership lock: exactly the editor-only, never-emitted prop keys", () => {
    expect([...NON_EMITTING_PROP_KEYS].sort()).toEqual(["preSerialContent"]);
  });
});

describe("valueAnchorShift", () => {
  it("is symmetric for centre (away-from-zero halves)", () => {
    expect(valueAnchorShift("C", 7, false)).toBe(4);
    expect(valueAnchorShift("C", -7, false)).toBe(-4);
  });

  it("applies the FT I/B inversion", () => {
    expect(valueAnchorShift("R", 10, true)).toBe(0);
    expect(valueAnchorShift("L", 10, true)).toBe(-10);
    expect(valueAnchorShift("C", 10, true)).toBe(-5);
  });
});

describe("dirty semantics of fieldJustify", () => {
  const asPage = (leaf: LabelObject) => ({ id: "p1", objects: [leaf] });
  const stamp = (before: LabelObject, after: LabelObject) =>
    (stampDirtyLeaves(
      [asPage(before)] as Parameters<typeof stampDirtyLeaves>[0],
      [asPage(after)] as Parameters<typeof stampDirtyLeaves>[1],
    )[0]!.objects[0] as { dirty?: boolean }).dirty;

  it("a 1D justify toggle does not stamp dirty (no z emitted yet; overlay survives)", () => {
    const leaf = barcode();
    expect(stamp(leaf, { ...leaf, fieldJustify: "C" } as LabelObject)).toBeUndefined();
  });

  it("a graphic justify change stamps dirty (graphicAnchor emits it)", () => {
    const box = barcode({ type: "box", fieldJustify: "L" });
    expect(stamp(box, { ...box, fieldJustify: "R" } as LabelObject)).toBe(true);
  });

  it("a content change still stamps dirty", () => {
    const leaf = barcode();
    const changed = { ...leaf, props: { ...(leaf as { props: object }).props, content: "XYZ" } } as LabelObject;
    expect(stamp(leaf, changed)).toBe(true);
  });
});

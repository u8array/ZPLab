import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bwipjs from "bwip-js/generic";
import { registerSidecarFootprintMeasurer } from "./footprint.js";
import { importZpl, exportZpl, buildCurrentDesignResult, validateDraft } from "./tools.js";
import { withFootprintBinding } from "./footprint.js";
import { measureFootprintDots } from "@zplab/core/lib/footprintProber";
import { registerFootprintMeasurer } from "@zplab/core/lib/footprintProber";
import { measureBarcodeFootprintDotsWith, type BwipEngine } from "@zplab/core/lib/barcodeDims";
import { EAN_TEXT_ZONE_DOTS } from "@zplab/core/lib/bwipConstants";
import type { LeafObject } from "@zplab/core/registry";

const engine: BwipEngine = bwipjs as unknown as BwipEngine;

const leaf = (type: string, props: object): LeafObject =>
  ({ id: "t", type, x: 0, y: 0, props }) as unknown as LeafObject;

beforeAll(() => registerSidecarFootprintMeasurer());
afterAll(() => registerFootprintMeasurer(null));

describe("sidecar footprint kernel", () => {
  it("code128 width matches the raw encodation module count", () => {
    // Same forced-Code-B raw stream buildBwipOptions emits for plain ASCII.
    const rawB = "^104" + [..."123"].map((c) => `^${String(c.charCodeAt(0) - 32).padStart(3, "0")}`).join("");
    const [sym] = engine.raw({ bcid: "code128", text: rawB, raw: true }) as { sbs?: number[] }[];
    const modules = (sym?.sbs ?? []).reduce((a, b) => a + b, 0);
    expect(modules).toBeGreaterThan(0);
    const fp = measureBarcodeFootprintDotsWith(
      engine,
      leaf("code128", { content: "123", height: 100, moduleWidth: 2, printInterpretation: false, checkDigit: false, rotation: "N" }),
      8,
    );
    expect(fp).toEqual({ w: modules * 2, h: 100 });
  });

  it("ean13 measures the spec 95 modules plus the reserved text zone", () => {
    const fp = measureBarcodeFootprintDotsWith(
      engine,
      leaf("ean13", { content: "4006381333931", height: 80, moduleWidth: 3, printInterpretation: true, checkDigit: false, rotation: "N" }),
      8,
    );
    expect(fp).toEqual({ w: 95 * 3, h: 80 + EAN_TEXT_ZONE_DOTS });
  });

  it("plessey and tlc39 special paths measure without a canvas", () => {
    const plessey = measureBarcodeFootprintDotsWith(
      engine,
      leaf("plessey", { content: "12345", height: 60, moduleWidth: 2, printInterpretation: false, checkDigit: false, rotation: "N" }),
      8,
    );
    expect(plessey?.w).toBeGreaterThan(0);
    const tlc39 = measureBarcodeFootprintDotsWith(
      engine,
      leaf("tlc39", { content: "123456,S00001", height: 40, moduleWidth: 2, wideRatio: 2, microPdfModuleWidth: 2, microPdfRowHeight: 4, printInterpretation: false, checkDigit: false, rotation: "N" }),
      8,
    );
    expect(tlc39?.w).toBeGreaterThan(0);
    expect(tlc39?.h).toBeGreaterThan(40);
  });

  it("a rotated 1D swaps the footprint axes", () => {
    const props = { content: "123", height: 100, moduleWidth: 2, printInterpretation: false, checkDigit: false, rotation: "R" };
    const n = measureBarcodeFootprintDotsWith(engine, leaf("code128", { ...props, rotation: "N" }), 8);
    const r = measureBarcodeFootprintDotsWith(engine, leaf("code128", props), 8);
    expect(r).toEqual({ w: n!.h, h: n!.w });
  });
});

describe("MCP import/export with the sidecar measurer", () => {
  it("import_zpl normalises a ^FT z=1 1D barcode and enables the gate", () => {
    const fp = measureBarcodeFootprintDotsWith(
      engine,
      leaf("code128", { content: "123", height: 100, moduleWidth: 2, printInterpretation: true, checkDigit: false, rotation: "N" }),
      8,
    );
    const r = importZpl("^XA^FT300,150,1^BCN,100,Y,N,N^FD123^FS^XZ", 8);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const label = r.designFile.label as { emit1dZJustify?: boolean };
    expect(label.emit1dZJustify).toBe(true);
    const obj = (r.designFile.pages as { objects: { x: number; fieldJustify?: string }[] }[])[0]!.objects[0]!;
    expect(obj.fieldJustify).toBe("R");
    expect(obj.x).toBe(300 - fp!.w);
  });

  it("get_current_design resolves markers before measuring the anchor", () => {
    // Default (15 chars) is wider than the code128 sample fallback (8 chars):
    // resolved anchor = 100 (on-label), unresolved would be negative (outside).
    const r = importZpl("^XA^PW800^FT100,150,1^BCN,100,Y,N,N^FN1^FD123456789012345^FS^XZ", 8);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const out = buildCurrentDesignResult({ designFile: r.designFile } as never);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.warnings.filter((w) => w.kind.startsWith("offLabel"))).toEqual([]);
  });

  it("reports the print-true barcode box even when the app measured its zoom view", () => {
    // Same zoom/kernel shadowing as tools.test.ts's buildCurrentDesignResult
    // case; here mw 2 and mw 3 both collapse to 1 screen pixel at zoom 1.
    const r = importZpl("^XA^PW800^FO10,10^BCN,100,Y,N,N^FD12345678901234567890^FS^XZ", 8);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const id = (r.designFile.pages as { objects: { id: string }[] }[])[0]!.objects[0]!.id;
    const headless = validateDraft(r.designFile);
    expect(headless.ok).toBe(true);
    if (!headless.ok) return;
    const truth = headless.bounds.find((b) => b.objectId === id)!;
    const out = buildCurrentDesignResult({
      designFile: r.designFile,
      measured: { [id]: { width: 539, height: 100 } },
    } as never);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const reported = out.bounds.find((b) => b.objectId === id)!;
    expect(reported.width).toBe(truth.width);
    expect(reported.width).not.toBe(539);
  });

  it("withFootprintBinding restores an outer binding when a nested scope exits", () => {
    const label = { secondaryClockOffset: undefined, tertiaryClockOffset: undefined };
    const vars = (val: string) => [{ id: "v1", name: "v", fnNumber: 1, defaultValue: val }];
    const bound = leaf("code128", {
      content: "«v»", height: 100, moduleWidth: 2,
      printInterpretation: false, checkDigit: false, rotation: "N",
    });
    const widthUnder = (val: string) =>
      withFootprintBinding(label, vars(val), () => {
        withFootprintBinding(label, vars("XX"), () => undefined);
        return measureFootprintDots(bound, 8)?.w;
      });
    const literal = (val: string) =>
      measureBarcodeFootprintDotsWith(engine, leaf("code128", {
        content: val, height: 100, moduleWidth: 2,
        printInterpretation: false, checkDigit: false, rotation: "N",
      }), 8)?.w;
    expect(widthUnder("1234567890")).toBe(literal("1234567890"));
  });

  it("regenerated export restores the original anchored bytes", () => {
    const r = importZpl("^XA^FT300,150,1^BCN,100,Y,N,N^FD123^FS^XZ", 8);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Drop the overlay so the bytes must come from gated regeneration.
    const pages = r.designFile.pages as { overlay?: unknown }[];
    delete pages[0]!.overlay;
    const out = exportZpl(r.designFile);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.zpl).toContain("^FT300,150,1");
  });
});

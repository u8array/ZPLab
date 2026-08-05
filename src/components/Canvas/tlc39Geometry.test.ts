// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import bwipjs from "bwip-js/browser";
import {
  measureBarcodeFootprintDotsWith,
  tlc39Code39Runs,
  tlc39MicroPdfDims,
  type BwipEngine,
} from "@zplab/core/lib/barcodeDims";
import type { LeafObject } from "@zplab/core/registry";

type LabelObject = LeafObject;

describe("tlc39 composite geometry (ZD230-measured 2026-08-03)", () => {
  const engine = bwipjs as unknown as BwipEngine;
  const tlc = (over: object): LeafObject => ({
    id: "1", type: "tlc39", x: 0, y: 0, rotation: 0,
    props: { content: "123456,SXYZ789", moduleWidth: 2, wideRatio: 2, height: 60,
             microPdfModuleWidth: 2, microPdfRowHeight: 4, rotation: "N", ...over },
  } as LabelObject as LeafObject);

  it("matches the device raster for the linked composite", () => {
    // ^BTN,2,2.0,60,2,4 with 123456,SXYZ789: ink 250x98 dots (code39 125
    // modules incl 10-module stop gap; mpdf 4x6; overhang 12 = h1/5).
    expect(measureBarcodeFootprintDotsWith(engine, tlc({}), 8)).toEqual({ w: 250, h: 98 });
    // w1=4 probe: 500x100 (mpdf keeps w2=2; gap and indent scale with w1).
    expect(measureBarcodeFootprintDotsWith(engine, tlc({ moduleWidth: 4 }), 8))
      .toEqual({ w: 500, h: 100 });
  });

  it("renders the ECI-only form as a plain Code 39 (no tall stop, no T)", () => {
    // Device: 206x60 for ^FD123456 (103 modules, gap 1, no linkage).
    expect(measureBarcodeFootprintDotsWith(engine, tlc({ content: "123456" }), 8))
      .toEqual({ w: 206, h: 60 });
  });

  it("derives the MicroPDF rows from the serial (min 6, never 4x4)", () => {
    // Device: 7 chars -> 6 rows, 23 chars -> 8 rows, 20 digits -> 6 rows.
    const h = (content: string) =>
      measureBarcodeFootprintDotsWith(engine, tlc({ content }), 8)!.h;
    expect(h("123456,SXYZ789")).toBe(98);
    expect(h("123456,12345678901234567890")).toBe(98);
    expect(h("123456,ABCDEFGHIJKLMNOPQRSTUVW")).toBe(106);
  });

  it("returns null when no linked version fits (capacity edge stays visible)", () => {
    // 260 comma-laden bytes exceed even 4x44 byte capacity (150); the
    // renderer then badges the unlinked stand-in as approximated.
    expect(tlc39MicroPdfDims(engine, "A,".repeat(130))).toBeNull();
  });

  it("escalates and flags when BWIPP's pick diverges from the Table-5 target", () => {
    // Alphanumeric serials use the same target derivation as byte content.
    const mpdf = tlc39MicroPdfDims(engine, "ABCDEFGHIJKLMNOPQRSTUV")!; // 22 = 4x6 alpha cap
    expect(mpdf.targetRows).toBe(6);
    expect(mpdf.approximated).toBe(mpdf.rows !== 6);
  });

  it("scales the wide bars with r1 (device: 152 modules at r1=3)", () => {
    expect(measureBarcodeFootprintDotsWith(engine, tlc({ wideRatio: 3 }), 8)!.w).toBe(304);
  });

  it("renders the derived MicroPDF version, not bwip's auto pick", () => {
    // 15 rows target; bwip's auto pick would draw 10 and stretch it.
    const mpdf = tlc39MicroPdfDims(engine, "ABCDEFGHIJKLMNOPQRSTUVWXY,ABCDEFGHIJKLMN")!;
    expect(mpdf.rows).toBe(15);
    expect(mpdf.dims.height / (2 * 2)).toBe(15);
  });

  it("keeps rows and dims from the same render when BWIPP rejects the byte estimate", () => {
    // Estimate says 6 rows, BWIPP needs 8; the print may sit a version below.
    const mpdf = tlc39MicroPdfDims(engine, "E0(IW7A((1E_Y")!;
    expect(mpdf.rows).toBe(8);
    expect(mpdf.dims.height / (2 * 2)).toBe(8);
    expect(mpdf.approximated).toBe(true);
    // Footprint and layout size to the firmware target, not the escalated
    // drawn version: the print-true bounds stay, the bitmap gets squeezed.
    expect(mpdf.targetRows).toBe(6);
    expect(measureBarcodeFootprintDotsWith(engine, tlc({ content: "123456,E0(IW7A((1E_Y" }), 8)!.h)
      .toBe(6 * 4 + 2 + 60 + 12);
    expect(tlc39MicroPdfDims(engine, "SXYZ789")!.approximated).toBe(false);
  });

  it("emits the device's exact Code 39 module runs (ZD230 bar decode)", () => {
    // Decoded from the p1 probe raster: full *123456*, 10-module gap, lone
    // linkage T.
    const geo = tlc39Code39Runs(engine, "123456", 2, true)!;
    expect(geo.tallFromModule).toBe(113);
    expect(geo.runs).toEqual([
      1,2,1,1,2,1,2,1,1,1, 2,1,1,2,1,1,1,1,2,1, 1,1,2,2,1,1,1,1,2,1,
      2,1,2,2,1,1,1,1,1,1, 1,1,1,2,2,1,1,1,2,1, 2,1,1,2,2,1,1,1,1,1,
      1,1,2,2,2,1,1,1,1,1, 1,2,1,1,2,1,2,1,1, 10, 1,1,1,1,2,1,2,2,1,
    ]);
  });

  it("scales both module widths on a horizontal resize", async () => {
    // ^BT carries two widths (w1 Code 39, w2 MicroPDF).
    const { ObjectRegistry } = await import("@zplab/core/registry");
    const out = ObjectRegistry.tlc39.commitTransform!(
      tlc({}) as never,
      { sx: 2, sy: 1, snap: (v: number) => v, nodeHeight: 0, anchor: null } as never,
    ) as { moduleWidth: number; microPdfModuleWidth: number };
    expect(out.moduleWidth).toBe(4);
    expect(out.microPdfModuleWidth).toBe(4);
  });

  it("reproduces every ZD230 probe raster through the import path", async () => {
    // Ink bounds from the ^IS/^HY device rasters; h1=100 accepts the known
    // 1-dot overhang drift (device 147, round(h1/5) gives 146).
    const { parseZPL } = await import("@zplab/core/lib/zplParser");
    const probes: [zpl: string, w: number, h: number][] = [
      ["^XA^FO50,50^BTN,2,2.0,60,2,4^FD123456,SXYZ789^FS^XZ", 250, 98],
      ["^XA^FO50,50^BTN,2,2.0,100,2,4^FD123456,SXYZ789^FS^XZ", 250, 146],
      ["^XA^FO50,50^BTN,2,2.0,60,2,4^FD123456^FS^XZ", 206, 60],
      ["^XA^FO50,50^BTN,4,2.0,60,2,4^FD123456,SXYZ789^FS^XZ", 500, 100],
      ["^XA^FO50,50^BTN,2,2.0,60,2,4^FD123456,ABCDEFGHIJKLMNOPQRSTUVW^FS^XZ", 250, 106],
      ["^XA^FO50,50^BTN,2,2.0,60,2,4^FD123456,ABCDEFGHIJKLMNOPQRSTUVWXY,ABCDEFGHIJKLMN^FS^XZ", 250, 134],
      ["^XA^FO50,50^BTN,2,3.0,60,2,4^FD123456,SXYZ789^FS^XZ", 304, 98],
    ];
    for (const [zpl, w, h] of probes) {
      const leaf = parseZPL(zpl, 8).pages[0]!.objects[0] as LeafObject;
      expect(measureBarcodeFootprintDotsWith(engine, leaf, 8), zpl).toEqual({ w, h });
    }
  });
});

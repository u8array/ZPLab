import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import bwipjs from "bwip-js/browser";
import { bwipRetryOptions, measureBarcodeFootprintDotsWith, type BwipEngine } from "@zplab/core/lib/barcodeDims";
import { buildBwipOptions, dataMatrixMinFitIndex, getDisplaySize, getEanUpcHriFragments } from "./bwipHelpers";
import type { LeafObject } from "@zplab/core/registry";
import { dmSizePairs, type DataMatrixProps } from "@zplab/core/registry/datamatrix";
import { placeholderContentFor, samplePropsFor } from "@zplab/core/registry/placeholderContent";
import { ZD230_QA_123 } from "../../test/qrFixtures";
type LabelObject = LeafObject;

describe("getEanUpcHriFragments", () => {
  it("returns the floated system digit left of the bars (negative module x)", () => {
    const frags = getEanUpcHriFragments("ean13", "5901234123457");
    expect(frags.length).toBe(13);
    expect(frags[0]?.char).toBe("5");
    expect(frags[0]?.xModule).toBeLessThan(0);
  });

  it("floats the UPC-A system digit left of the bars and the check digit right", () => {
    const frags = getEanUpcHriFragments("upca", "01234567890");
    expect(frags.length).toBe(12);
    expect(frags[0]?.xModule).toBeLessThan(0);
    expect(frags.at(-1)?.xModule).toBeGreaterThan(frags[10]!.xModule);
  });

  it("accepts 6-digit UPC-E content (system digit pre-padded)", () => {
    const frags = getEanUpcHriFragments("upce", "123456");
    expect(frags.length).toBeGreaterThan(0);
  });

  it("accepts the 8-digit UPC-E HRI form the canvas actually passes", () => {
    // App calls with formatUpceHri output (NS + 6 data + check).
    const frags = getEanUpcHriFragments("upce", "01234565");
    expect(frags.length).toBe(8);
  });
});

describe("rotation pipeline", () => {
  // Minimal code128 fixture; only the props used by buildBwipOptions/
  // getDisplaySize matter for these checks.
  const baseCode128 = (rotation: "N" | "R" | "I" | "B"): LabelObject =>
    ({
      id: "1",
      type: "code128",
      x: 0,
      y: 0,
      rotation: 0,
      props: {
        content: "ABC",
        height: 100,
        moduleWidth: 2,
        printInterpretation: false,
        checkDigit: false,
        rotation,
      },
    }) as LabelObject;

  it("never sets a bwip rotate option (Konva handles visual rotation)", () => {
    // bwip-js always renders upright now; the renderer wraps the
    // bitmap in an inner rotated Group via rotatedGroupTransform. A
    // rotate option in opts would double-rotate the result.
    for (const rot of ["N", "R", "I", "B"] as const) {
      expect(buildBwipOptions(baseCode128(rot), 1, 8)?.rotate).toBeUndefined();
    }
  });

  it("resolves UPC/EAN supplement bcid by content length", () => {
    const supplement = (content: string): LabelObject =>
      ({
        id: 's',
        type: 'upcEanExtension',
        x: 0,
        y: 0,
        rotation: 0,
        props: {
          content,
          height: 80,
          moduleWidth: 2,
          printInterpretation: true,
          checkDigit: false,
          rotation: 'N',
        },
      }) as LabelObject;
    // 2-digit content selects the ean2 bcid; everything else (5-digit,
    // empty fallback) renders as ean5.
    expect(buildBwipOptions(supplement('42'), 1, 8)?.bcid).toBe('ean2');
    expect(buildBwipOptions(supplement('51999'), 1, 8)?.bcid).toBe('ean5');
    expect(buildBwipOptions(supplement(''), 1, 8)?.bcid).toBe('ean5');
  });

  it("swaps display W and H for quarter rotations", () => {
    // bwip-js always produces an upright bitmap now; getDisplaySize
    // swaps W/H itself for R/B to report the rotated screen footprint.
    const uprightCanvas = { width: 200, height: 100 } as HTMLCanvasElement;
    const upright = getDisplaySize(baseCode128("N"), uprightCanvas, 1, 8);
    const rotR = getDisplaySize(baseCode128("R"), uprightCanvas, 1, 8);
    const rotB = getDisplaySize(baseCode128("B"), uprightCanvas, 1, 8);
    expect(rotR.w).toBe(upright.h);
    expect(rotR.h).toBe(upright.w);
    expect(rotB.w).toBe(upright.h);
    expect(rotB.h).toBe(upright.w);
  });

  it("leaves dimensions untouched for I (180°)", () => {
    const fakeCanvas = { width: 200, height: 100 } as HTMLCanvasElement;
    const upright = getDisplaySize(baseCode128("N"), fakeCanvas, 1, 8);
    const inverted = getDisplaySize(baseCode128("I"), fakeCanvas, 1, 8);
    expect(inverted).toEqual(upright);
  });
});

describe("getDisplaySize gs1databar sym 7 fallback", () => {
  // Sym 7 (Expanded Stacked) cannot be Labelary-cross-validated due to a
  // parens-AI input-format mismatch between bwip-js and Zebra firmware.
  // The implementation falls back to bwip-natural canvas height. This test
  // pins that behavior; any change must be intentional and accompanied
  // by a documented strategy for the missing ground truth.
  it("derives height from canvas dims (bwip-natural), not from a spec table", () => {
    const obj: LabelObject = {
      id: "1",
      type: "gs1databar",
      x: 0,
      y: 0,
      rotation: 0,
      props: {
        content: "0112345678901231",
        magnification: 2,
        symbology: 7,
        segments: 22,
        rotation: "N",
      },
    };
    // Canvas height varies per content+segments; we use a representative
    // value that bwip-js produced for a 16-char content at default
    // segments. The exact pixel size isn't load-bearing; what matters is
    // the formula, which derives from `ch`.
    const ch = 73;
    const cw = 100;
    const fakeCanvas = { width: cw, height: ch } as HTMLCanvasElement;
    const result = getDisplaySize(obj, fakeCanvas, 1, 8);
    // bwipSc = max(1, round(dotsToPx(2, 1, 8))) = round(0.25) = 1; modulePx = 0.25
    // h = (ch / 1) * 0.25 = 18.25
    expect(result.h).toBeCloseTo(18.25, 2);
  });
});

describe("buildBwipOptions gs1databar Expanded fallback", () => {
  const obj = (content: string): LabelObject => ({
    id: "1",
    type: "gs1databar",
    x: 0,
    y: 0,
    rotation: 0,
    props: {
      content,
      magnification: 2,
      symbology: 6,
      segments: 22,
      rotation: "N",
    },
  });

  it("keeps an unparseable fragment verbatim (no guessed element string)", () => {
    // 11 digits after AI 01 segment nothing; the wire ships it raw, so the
    // canvas must not invent a (99) wrap that renders a different symbol.
    const opts = buildBwipOptions(obj("0112345678901"), 1, 8);
    expect(opts?.text).toBe("0112345678901");
  });

  it("still measures a footprint for blank/unparseable Expanded (GS1 sample)", () => {
    // The honest encode failure must fall back to the GS1 sample, not null:
    // MCP footprint and the canvas sample path depend on it.
    const engine = bwipjs as unknown as BwipEngine;
    for (const content of ["", "0112345678901"]) {
      expect(measureBarcodeFootprintDotsWith(engine, obj(content), 8), content).not.toBeNull();
    }
  });

  it("keeps valid AI 01 GTIN-14 input on the standard wrap path", () => {
    const opts = buildBwipOptions(obj("0112345678901231"), 1, 8);
    expect(opts?.text).toBe("(01)12345678901231");
  });
});

describe("buildBwipOptions GS1 canvas == wire (plan-derived)", () => {
  const c128 = (content: string): LabelObject =>
    ({ id: "1", type: "code128", x: 0, y: 0, rotation: 0,
       props: { content, height: 100, moduleWidth: 2, printInterpretation: false,
                printInterpretationAbove: false, checkDigit: false, rotation: "N", gs1: true },
     }) as LabelObject;

  it("renders unparseable GS1-128 content as the raw mode-D stream, not a guess", () => {
    // `0112345` ships verbatim (leading FNC1 only); the old element-string
    // guess rendered (01)00000000123457, a symbol the printer never prints.
    const opts = buildBwipOptions(c128("0112345"), 1, 8);
    expect(opts?.bcid).toBe("code128");
    expect(opts?.parsefnc).toBe(true);
    expect(opts?.text).toBe("^FNC10112345");
  });

  it("encodes a GS-after-fixed-AI DataMatrix payload instead of alarming", () => {
    // Legal input the catalog cannot segment; the `_1` wire prints it, so the
    // canvas must encode the equivalent raw FNC1 stream.
    const gs = String.fromCharCode(0x1d);
    const dm = { id: "d", type: "datamatrix", x: 0, y: 0, rotation: 0,
      props: { content: `0112345678901231${gs}10ABC`, gs1: true, dimension: 20, quality: 200, rotation: "N" },
    } as LabelObject;
    const opts = buildBwipOptions(dm, 1, 8);
    expect(opts?.bcid).toBe("datamatrix");
    expect(opts?.parsefnc).toBe(true);
    expect(opts?.text).toBe(`^FNC10112345678901231^FNC110ABC`);
  });
});

describe("buildBwipOptions datamatrix GS1 mode", () => {
  const dm = (content: string, gs1: boolean, extra: Partial<DataMatrixProps> = {}): LabelObject => ({
    id: "1",
    type: "datamatrix",
    x: 0,
    y: 0,
    rotation: 0,
    props: { content, dimension: 5, quality: 200, rotation: "N", gs1, ...extra },
  });

  it("GS1 mode switches bcid and feeds the (AI) element string", () => {
    const opts = buildBwipOptions(dm("0109501101530003", true), 1, 8);
    expect(opts?.bcid).toBe("gs1datamatrix");
    expect(opts?.text).toBe("(01)09501101530003");
  });

  it("plain mode keeps the datamatrix bcid and raw content", () => {
    const opts = buildBwipOptions(dm("DM123", false), 1, 8);
    expect(opts?.bcid).toBe("datamatrix");
    expect(opts?.text).toBe("DM123");
  });

  it("rectangular switches to the rectangular bcids", () => {
    expect(buildBwipOptions(dm("DM123", false, { aspectRatio: 2 }), 1, 8)?.bcid)
      .toBe("datamatrixrectangular");
    expect(buildBwipOptions(dm("0109501101530003", true, { aspectRatio: 2 }), 1, 8)?.bcid)
      .toBe("gs1datamatrixrectangular");
  });

  it("ranks forceable sizes by content fit (smaller sizes disabled)", () => {
    // GS1 GTIN doesn't fit 8×18 (auto picks 8×32 → index 1); tiny plain
    // content fits the smallest square (10×10 → index 0).
    const gs1Rect = dm("0109501101530003", true, { aspectRatio: 2 }).props as DataMatrixProps;
    expect(dataMatrixMinFitIndex(gs1Rect, dmSizePairs(gs1Rect))).toBe(1);
    const tiny = dm("1", false).props as DataMatrixProps;
    expect(dataMatrixMinFitIndex(tiny, dmSizePairs(tiny))).toBe(0);
  });

  it("sample fallback drops a forced size so the fallback render cannot fail", () => {
    // The GS1 sample does not fit a forced 8×18; sampleProps reverts to auto.
    const forced = dm("", true, { aspectRatio: 2, columns: 18, rows: 8 });
    expect(buildBwipOptions(forced, 1, 8)?.version).toBe("8x18");
    const sample = placeholderContentFor(forced.type, forced.props) ?? "";
    const withSample = {
      ...forced,
      props: { ...samplePropsFor(forced.type, forced.props), content: sample },
    } as LabelObject;
    expect(buildBwipOptions(withSample, 1, 8)?.version).toBeUndefined();
  });

  it("disables nothing when the content cannot be auto-encoded at all", () => {
    // Oversized content fails at every size, a content problem the
    // preflight reports; the size list must stay usable.
    const oversized = dm("X".repeat(200), false, { aspectRatio: 2 }).props as DataMatrixProps;
    expect(dataMatrixMinFitIndex(oversized, dmSizePairs(oversized))).toBe(0);
    // Unsegmentable GS1 content still encodes (raw FNC1 path, matching the
    // `_1` wire), so the fit is real, not the fallback.
    const invalidGs1 = dm("01095011015300031", true).props as DataMatrixProps;
    expect(dataMatrixMinFitIndex(invalidGs1, dmSizePairs(invalidGs1))).toBeGreaterThan(0);
  });

  it("forces a firmware-valid c/r pair via version; unknown pairs auto-size", () => {
    expect(buildBwipOptions(dm("DM123", false, { columns: 22, rows: 22 }), 1, 8)?.version)
      .toBe("22x22");
    expect(buildBwipOptions(dm("DM123", false, { aspectRatio: 2, columns: 18, rows: 8 }), 1, 8)?.version)
      .toBe("8x18");
    // 13x13 is not an ECC 200 size; preview falls back to auto-sizing.
    expect(buildBwipOptions(dm("DM123", false, { columns: 13, rows: 13 }), 1, 8)?.version)
      .toBeUndefined();
  });
});

describe("buildBwipOptions aztec ecLevel mapping", () => {
  const az = (ecLevel: number): LabelObject => ({
    id: "1",
    type: "aztec",
    x: 0,
    y: 0,
    rotation: 0,
    props: { content: "TEST1234", magnification: 4, ecLevel, rotation: "N" },
  });

  it("maps the ecLevel domain to bwip bcid/format/size options", () => {
    // Default + EC% start compact (firmware-preferred); full-range is the
    // bwipRetryOptions fallback once content outgrows 4 compact layers.
    expect(buildBwipOptions(az(0), 1, 8)).toMatchObject({ bcid: "azteccodecompact" });
    expect(buildBwipOptions(az(0), 1, 8)).not.toHaveProperty("format");
    expect(buildBwipOptions(az(50), 1, 8)).toMatchObject({ bcid: "azteccodecompact", eclevel: 50 });
    expect(buildBwipOptions(az(101), 1, 8)).toMatchObject({ bcid: "azteccodecompact", layers: 1 });
    expect(buildBwipOptions(az(104), 1, 8)).toMatchObject({ bcid: "azteccodecompact", layers: 4 });
    expect(buildBwipOptions(az(201), 1, 8)).toMatchObject({ bcid: "azteccode", format: "full", layers: 1 });
    expect(buildBwipOptions(az(210), 1, 8)).toMatchObject({ bcid: "azteccode", format: "full", layers: 10 });
    expect(buildBwipOptions(az(232), 1, 8)).toMatchObject({ bcid: "azteccode", format: "full", layers: 32 });
    expect(buildBwipOptions(az(300), 1, 8)).toMatchObject({ bcid: "azteccode", format: "rune" });
  });

  it("falls back to full-range beyond compact's 4-layer capacity", () => {
    // ^B0 auto sizing spans full-range; pinning compact failed >~89 chars on
    // a symbol the printer prints fine.
    const engine = bwipjs as unknown as BwipEngine;
    const long = { ...az(0), props: { ...az(0).props, content: "A".repeat(120) } } as LeafObject;
    const opts = buildBwipOptions(long, 1, 8)!;
    expect(() => engine.raw(opts)).toThrow();
    const retry = bwipRetryOptions(opts);
    expect(retry).toMatchObject({ bcid: "azteccode" });
    expect(() => engine.raw(retry!)).not.toThrow();
    // ZD230-measured 2026-08-03: 120 chars -> 37x37 full-range, matching the
    // retried bwip symbol exactly (mag 4: 148x148 dots ink).
    const big = measureBarcodeFootprintDotsWith(engine, long, 8);
    expect(big).toEqual({ w: 37 * 4, h: 37 * 4 });
  });

  it("keeps a forced compact layer count hard (no fallback: the firmware pins it too)", () => {
    const opts = buildBwipOptions(az(101), 1, 8)!;
    expect(bwipRetryOptions(opts)).toBeNull();
  });

  it("rounds a non-integer ecLevel so bwip never gets a float layer count", () => {
    expect(buildBwipOptions(az(210.4), 1, 8)).toMatchObject({ format: "full", layers: 10 });
    expect(buildBwipOptions(az(Number.NaN), 1, 8)).toMatchObject({ bcid: "azteccodecompact" });
  });
});

describe("buildBwipOptions micropdf417 ^BF mode", () => {
  const mp = (mode: number): LabelObject => ({
    id: "1",
    type: "micropdf417",
    x: 0,
    y: 0,
    rotation: 0,
    props: { content: "12", moduleWidth: 2, rowHeight: 8, mode, rotation: "N" },
  });

  it("forces the mode's fixed columns/rows version (Table 5)", () => {
    expect(buildBwipOptions(mp(0), 1, 8)).toMatchObject({ columns: 1, rows: 11 });
    expect(buildBwipOptions(mp(23), 1, 8)).toMatchObject({ columns: 4, rows: 6 });
    expect(buildBwipOptions(mp(33), 1, 8)).toMatchObject({ columns: 4, rows: 4 });
    // Out-of-band mode falls to the spec default 0.
    expect(buildBwipOptions(mp(34), 1, 8)).toMatchObject({ columns: 1, rows: 11 });
    expect(buildBwipOptions(mp(Number.NaN), 1, 8)).toMatchObject({ columns: 1, rows: 11 });
  });

  it("retries without rows when BWIPP rejects a version the ^BF table allows", () => {
    // 1x11 holds 8 digits per Table 5, but BWIPP rejects "1234" there; the
    // retry keeps the mode's column class and lets the rows grow.
    const engine = bwipjs as unknown as BwipEngine;
    const gap = { ...mp(0), props: { ...mp(0).props, content: "1234" } } as LeafObject;
    const opts = buildBwipOptions(gap, 1, 8)!;
    expect(() => engine.raw(opts)).toThrow();
    const retry = bwipRetryOptions(opts)!;
    expect(retry).toMatchObject({ columns: 1 });
    expect(retry).not.toHaveProperty("rows");
    expect(() => engine.raw(retry)).not.toThrow();
  });

  it("derives byte capacity from the exact ISO EC codewords", async () => {
    // Rounded percent shares were off by one codeword at some boundaries
    // (4x44: 126 data codewords, byte cap 150, not 151).
    const { micropdf417ByteCapacity } = await import("@zplab/core/registry/micropdf417");
    expect(micropdf417ByteCapacity(4, 44)).toBe(150);
    expect(micropdf417ByteCapacity(1, 11)).toBe(3);
    expect(micropdf417ByteCapacity(4, 15)).toBe(45);
  });

  it("yields no options when content exceeds the mode capacity BWIPP would still encode", () => {
    // 4x44 byte capacity is 150; BWIPP accepts 151 bytes anyway, the printer
    // prints nothing (mode-capacity class, ZD230-measured).
    const over = { ...mp(32), props: { ...mp(32).props, content: "!".repeat(151) } } as LeafObject;
    expect(buildBwipOptions(over, 1, 8)).toBeNull();
    const atCap = { ...mp(32), props: { ...mp(32).props, content: "!".repeat(150) } } as LeafObject;
    expect(buildBwipOptions(atCap, 1, 8)).not.toBeNull();
  });

  it("rates non-alphanumeric content against the byte capacity, not the alpha column", () => {
    // "A,A,A," is 6 chars (alpha cap 6) but byte-compacts on the firmware;
    // mode 0 holds 3 bytes and the options builder gates capacity, so that
    // content yields no options at all. Pure alnum at the cap stays a
    // legitimate BWIPP-gap retry.
    const over = { ...mp(0), props: { ...mp(0).props, content: "A,A,A," } } as LeafObject;
    expect(buildBwipOptions(over, 1, 8)).toBeNull();
    const alnum = { ...mp(0), props: { ...mp(0).props, content: "ABCDE1" } } as LeafObject;
    expect(bwipRetryOptions(buildBwipOptions(alnum, 1, 8)!)).not.toBeNull();
  });

  it("stops past the mode's Table-5 capacity (ZD230 prints nothing there)", () => {
    // ^BFN,8,0 with 20 digits renders an EMPTY label; a fallback symbol
    // here would be pure fiction.
    const over = { ...mp(0), props: { ...mp(0).props, content: "12345678901234567890" } } as LeafObject;
    expect(buildBwipOptions(over, 1, 8)).toBeNull();
  });

  it("matches the ZD230 raster for a mode-pinned symbol", () => {
    // ^BY2^BFN,8,23^FD1234 -> ink 198x48 dots (4 cols x 99 modules x 2,
    // 6 rows x 8); mode 0 "1234" -> 76x88 (1x11, which BWIPP rejects; the
    // retry renders 1x14, three rows taller, known limit).
    const engine = bwipjs as unknown as BwipEngine;
    const m23 = measureBarcodeFootprintDotsWith(engine, mp(23) as LeafObject, 8);
    expect(m23).toEqual({ w: 198, h: 48 });
    const gap = { ...mp(0), props: { ...mp(0).props, content: "1234" } } as LeafObject;
    expect(measureBarcodeFootprintDotsWith(engine, gap, 8)).toEqual({ w: 76, h: 88 });
  });

  it("badges an approximated encode as previewApproximate, silent when exact", async () => {
    // mode 0 "1234": the drawn bitmap is a taller auto version squeezed into
    // the 11-row footprint (the raw-level gap is pinned above); the verdict
    // is injected because jsdom cannot host bwip's canvas render.
    const { barcodeEncodeFindings } = await import("./barcodePreflight");
    const gap = { ...mp(0), props: { ...mp(0).props, content: "1234" } } as LeafObject;
    const out = barcodeEncodeFindings([gap], 1, 8, { variables: [], active: null },
      () => ({ error: null, approximated: true }));
    expect(out).toEqual([
      { objectId: "1", kind: "previewApproximate", severity: "warning" },
    ]);
    expect(barcodeEncodeFindings([mp(23)], 1, 8, { variables: [], active: null },
      () => ({ error: null, approximated: false }))).toEqual([]);
  });

  it("footprint tracks the ^BF mode", () => {
    const engine = bwipjs as unknown as BwipEngine;
    const a = measureBarcodeFootprintDotsWith(engine, mp(0) as LeafObject, 8);
    const b = measureBarcodeFootprintDotsWith(engine, mp(23) as LeafObject, 8);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.w).not.toBe(b!.w);
    expect(a!.h).not.toBe(b!.h);
  });
});

describe("msiCheckDigits mirrors bwip's encoded checks", () => {
  it("appends the exact digits bwip encodes (bar-pattern equality)", async () => {
    const { msiCheckDigits } = await import("@zplab/core/lib/barcodeCheckDigits");
    const engine = bwipjs as unknown as BwipEngine;
    const sbs = (opts: object) =>
      ((engine.raw(opts) as { sbs?: number[] }[])[0]?.sbs ?? []).join("");
    // Spec-valid lengths only (^BM ^FD caps at 14 digits).
    for (const text of ["12345678", "1234567", "80523", "9".repeat(14)]) {
      for (const [mode, checktype] of [["B", undefined], ["C", "mod1010"], ["D", "mod1110"]] as const) {
        const withCheck = sbs({ bcid: "msi", text, includecheck: true, ...(checktype && { checktype }) });
        expect(sbs({ bcid: "msi", text: text + msiCheckDigits(text, mode) }), `${text}/${mode}`)
          .toBe(withCheck);
      }
    }
  });

  it("stays a digit (BigInt) beyond the spec cap where floats would drift", async () => {
    const { msiCheckDigits } = await import("@zplab/core/lib/barcodeCheckDigits");
    expect(msiCheckDigits("9".repeat(34), "B")).toMatch(/^\d$/);
  });
});

describe("buildBwipOptions bar-encoded check digits (ZD230-measured)", () => {
  const bar = (type: string, checkDigit: boolean): LeafObject => ({
    id: "1",
    type,
    x: 0,
    y: 0,
    rotation: 0,
    props: { content: "1234", height: 60, moduleWidth: 2, printInterpretation: false,
             printInterpretationAbove: false, checkDigit, rotation: "N" },
  } as LabelObject as LeafObject);

  it("maps msiCheckMode to bwip's double-check variants", () => {
    const msiCD = (mode: "C" | "D") => ({ ...bar("msi", true),
      props: { ...bar("msi", true).props, msiCheckMode: mode } }) as LeafObject;
    expect(buildBwipOptions(msiCD("C"), 1, 8)).toMatchObject({ includecheck: true, checktype: "mod1010" });
    expect(buildBwipOptions(msiCD("D"), 1, 8)).toMatchObject({ includecheck: true, checktype: "mod1110" });
    expect(buildBwipOptions(bar("msi", true), 1, 8)).not.toHaveProperty("checktype");
  });

  it("mirrors ^BM/^B3/^B2 e into the bars via includecheck", () => {
    // MSI A=73 vs B=89 modules, Code 39 +16, I2of5 +18.
    for (const type of ["msi", "code39", "interleaved2of5"]) {
      expect(buildBwipOptions(bar(type, true), 1, 8), type).toMatchObject({ includecheck: true });
      expect(buildBwipOptions(bar(type, false), 1, 8), type).not.toHaveProperty("includecheck");
    }
  });

  it("keeps codabar free of includecheck (spec-fixed e=N, device-confirmed no-op)", () => {
    const opts = buildBwipOptions({ ...bar("codabar", true), props: { ...bar("codabar", true).props, content: "A1234B" } } as LeafObject, 1, 8);
    expect(opts).not.toHaveProperty("includecheck");
  });

  it("keeps ^BC e ignored (device: e=Y adds nothing on free content)", () => {
    expect(buildBwipOptions(bar("code128", true), 1, 8)).not.toHaveProperty("includecheck");
  });
});

describe("getDisplaySize coverage (ZPL-first policy)", () => {
  // Static parse of the core kernel: every barcode type registered via BCID
  // must have an explicit `case "type":` in getUprightDisplaySize, otherwise
  // the default fallback returns bwip-natural pixels and silently violates
  // the ZPL-first sizing policy.
  it("every BCID-registered type has an explicit case (no silent default)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      resolve(here, "../../../packages/core/src/lib/barcodeDims.ts"),
      "utf-8",
    );

    const bcidBlock = /const BCID:[^=]*=\s*\{([\s\S]*?)\};/.exec(src);
    expect(bcidBlock, "BCID literal not found in source").toBeTruthy();
    const bcidKeys = [...(bcidBlock?.[1] ?? "").matchAll(/^\s*(\w+):\s*"/gm)]
      .map((m) => m[1] ?? "");

    const fnBlock = /function getUprightDisplaySize\([\s\S]*?^\}/m.exec(src);
    expect(fnBlock, "getUprightDisplaySize body not found").toBeTruthy();
    const caseLabels = [...(fnBlock?.[0] ?? "").matchAll(/case "(\w+)":/g)]
      .map((m) => m[1] ?? "");

    const missing = bcidKeys.filter((k) => !caseLabels.includes(k));
    expect(missing, `Missing explicit case for: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("buildBwipOptions code128 escape handling", () => {
  const code128 = (content: string): LabelObject =>
    ({
      id: "1",
      type: "code128",
      x: 0,
      y: 0,
      rotation: 0,
      props: {
        content,
        height: 100,
        moduleWidth: 2,
        printInterpretation: false,
        checkDigit: false,
        rotation: "N",
      },
    }) as LabelObject;

  it("uses raw Subset-B mode for plain ASCII content (existing behaviour)", () => {
    const opts = buildBwipOptions(code128("ABC123"), 1, 8);
    expect(opts?.raw).toBe(true);
    expect(opts?.parsefnc).toBeUndefined();
    expect(typeof opts?.text).toBe("string");
    expect((opts?.text as string).startsWith("^104")).toBe(true);
  });

  it("renders an escape stream from the firmware's Table-2 read (raw symbols)", () => {
    // >5 is CODE C (99), then digit pairs: 6 literals + 9 symbols, exactly
    // the compaction the firmware prints.
    const opts = buildBwipOptions(code128("STRSTR>52316094000242201"), 1, 8);
    expect(opts?.raw).toBe(true);
    expect(opts?.text).toBe(
      "^104^051^052^050^051^052^050^099^023^016^009^040^000^024^022^001",
    );
  });

  it("renders a verbatim FNC1 stream as the firmware does", () => {
    const opts = buildBwipOptions(code128(">:AB>8CD"), 1, 8);
    expect(opts?.text).toBe("^104^033^034^102^035^036");
  });

  it("renders typed >< as the literal ^ the printer encodes", () => {
    const opts = buildBwipOptions(code128("A><B"), 1, 8);
    expect(opts?.text).toBe("^104^033^062^034");
  });

  it("interprets the emitted payload, not the model content", () => {
    // The printer reads the fdPlainEscape form: bare > becomes >0, so `>:`
    // never acts as a start code here.
    const opts = buildBwipOptions(code128("A>B>:C"), 1, 8);
    expect(opts?.text).toBe("^104^033^030^034^035");
  });
});


describe("qrcode canvas fidelity (ZPL firmware parity)", () => {
  const qr = (errorCorrection: "L" | "M" | "Q" | "H"): LabelObject =>
    ({
      id: "1",
      type: "qrcode",
      x: 0,
      y: 0,
      rotation: 0,
      props: { content: "123", magnification: 8, errorCorrection, model: 2, rotation: "N" },
    }) as LabelObject;

  it("pins the requested eclevel (BWIPP would silently raise it)", () => {
    const opts = buildBwipOptions(qr("Q"), 1, 8);
    expect(opts?.eclevel).toBe("Q");
    expect(opts?.fixedeclevel).toBe(true);
  });

  // Shared hardware fixture; see src/test/qrFixtures.ts.

  // Through the production builder, so reverting fixedeclevel turns these red.
  const rawMatrix = async (obj: LabelObject) => {
    const bwipjs = (await import("bwip-js/browser")).default;
    const opts = buildBwipOptions(obj, 1, 8);
    if (!opts) throw new Error("no options");
    const [sym] = bwipjs.raw(opts as never) as {
      pixx: number;
      pixy: number;
      pixs: number[];
    }[];
    if (!sym) throw new Error("no symbol");
    const rows: string[] = [];
    for (let y = 0; y < sym.pixy; y++) {
      let r = "";
      for (let x = 0; x < sym.pixx; x++) r += sym.pixs[y * sym.pixx + x] ? "#" : ".";
      rows.push(r);
    }
    return rows;
  };

  it("matches the ZD230 print module-for-module at EC Q", async () => {
    const rows = await rawMatrix(qr("Q"));
    expect(rows).toEqual(ZD230_QA_123);
  });

  it("renders each eclevel distinctly (no silent raise)", async () => {
    const l = await rawMatrix(qr("L"));
    const h = await rawMatrix(qr("H"));
    expect(l).not.toEqual(h);
  });
});

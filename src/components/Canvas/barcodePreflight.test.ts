import { describe, it, expect } from "vitest";
import { barcodeEncodeFindings, resolveForEncode, type EncodeEnv } from "./barcodePreflight";
import type { LabelObject } from "@zplab/core/types/Group";
import type { LeafObject } from "@zplab/core/registry";

const bar = (id: string, content = "X"): LeafObject =>
  ({ id, type: "code128", x: 0, y: 0, rotation: 0,
     props: { content, height: 50, moduleWidth: 2, printInterpretation: false, checkDigit: false, rotation: "N" } } as LabelObject as LeafObject);

const noEnv: EncodeEnv = { variables: [], active: null };

describe("barcodeEncodeFindings", () => {
  it("maps an encode error to a renderFailed finding over all given leaves", () => {
    const leaves = [bar("a"), bar("b")];
    // Inject the encoder so the mapping is tested without the DOM bwip encoder;
    // this also proves a hidden-but-exported leaf is checked (no visibility gate).
    const out = barcodeEncodeFindings(leaves, 1, 8, noEnv, (l) => (l.id === "a" ? "too much data" : null));
    expect(out).toEqual([
      { objectId: "a", kind: "renderFailed", severity: "error", detail: "too much data" },
    ]);
  });

  it("returns nothing when every leaf encodes", () => {
    expect(barcodeEncodeFindings([bar("a")], 1, 8, noEnv, () => null)).toEqual([]);
  });

  it("skips a literal-blank payload: computePreflight's emptyContent owns it, no bogus renderFailed", () => {
    // Regression: a fresh blank UPC-A reported "EAN/UPC encode failed" on top
    // of the emptyContent warning (the raw renderer has no dummy fallback).
    // Literal blank (raw content "") emits nothing here (no double emptyContent).
    const out = barcodeEncodeFindings([bar("a", "")], 1, 8, noEnv, () => "EAN/UPC encode failed");
    expect(out).toEqual([]);
  });

  it("flags a bound field whose marker resolves empty as emptyContent, not renderFailed", () => {
    // Bound to an empty default: raw content "«d»" is non-empty so
    // computePreflight sees no emptyContent; the canvas shows the placeholder,
    // so this producer surfaces the emptiness to keep panel and canvas in sync.
    const env: EncodeEnv = {
      variables: [{ id: "v", name: "d", fnNumber: 1, defaultValue: "" }],
      active: null,
    };
    const out = barcodeEncodeFindings([bar("a", "«d»")], 1, 8, env, () => "EAN/UPC encode failed");
    expect(out).toEqual([
      { objectId: "a", kind: "emptyContent", severity: "warning" },
    ]);
  });

  it("ignores non-barcode leaves: a bound TEXT resolving empty stays quiet", () => {
    // Regression (GPT finding): the resolved-empty emptyContent must not leak
    // to text; a bound text field is configured and its canvas box is honest.
    const textLeaf = {
      id: "t", type: "text", x: 0, y: 0, rotation: 0,
      props: { content: "«d»", fontHeight: 30, fontWidth: 0, rotation: "N" },
    } as LabelObject as LeafObject;
    const env: EncodeEnv = {
      variables: [{ id: "v", name: "d", fnNumber: 1, defaultValue: "" }],
      active: null,
    };
    const out = barcodeEncodeFindings([textLeaf], 1, 8, env, () => "never");
    expect(out).toEqual([]);
  });

  it("still checks a bound field whose resolved payload is non-empty", () => {
    const env: EncodeEnv = {
      variables: [{ id: "v", name: "d", fnNumber: 1, defaultValue: "0201" }],
      active: null,
    };
    const out = barcodeEncodeFindings([bar("a", "«d»")], 1, 8, env, () => "bad");
    expect(out).toEqual([
      { objectId: "a", kind: "renderFailed", severity: "error", detail: "bad" },
    ]);
  });

  const maxi = (mode: 2 | 3 | 4, content: string): LeafObject =>
    ({ id: "m", type: "maxicode", x: 0, y: 0, rotation: 0, props: { mode, content } } as LabelObject as LeafObject);

  it("does not emit renderFailed for a mode 2/3 MaxiCode missing its carrier message (the producer owns it)", () => {
    // Regression: this used to double-report (renderFailed here + a red canvas
    // box); the missing-SCM finding from computePreflight is the single source.
    expect(barcodeEncodeFindings([maxi(2, "1234567890")], 1, 8, noEnv, () => "bwipp.maxicodeExpectedCountryCode")).toEqual([]);
  });

  it("does not emit renderFailed for static unparsed GS1 content (gs1ContentUnparsed owns it)", () => {
    const c128gs1 = (content: string): LeafObject =>
      ({ id: "g", type: "code128", x: 0, y: 0, rotation: 0,
         props: { content, height: 100, moduleWidth: 2, printInterpretation: false,
                  printInterpretationAbove: false, checkDigit: false, rotation: "N", gs1: true },
       } as LabelObject as LeafObject);
    expect(barcodeEncodeFindings([c128gs1("NOTGS1AT@ALL")], 1, 8, noEnv, () => "bwipp.GS1error")).toEqual([]);
    // Marker content keeps the encode check (no static warning exists there).
    const env: EncodeEnv = {
      variables: [{ id: "v", name: "gtin", fnNumber: 1, defaultValue: "NOTGS1" }],
      active: null,
    };
    expect(barcodeEncodeFindings([c128gs1("01«gtin»")], 1, 8, env, () => "bwipp.GS1error"))
      .toHaveLength(1);
    // DM is excluded from the suppression (its warning never fires).
    const gs = String.fromCharCode(0x1d);
    const dm = { id: "d", type: "datamatrix", x: 0, y: 0, rotation: 0,
      props: { content: `0112345678901231${gs}10ABC`, gs1: true, dimension: 20, quality: 200, rotation: "N" },
    } as LabelObject as LeafObject;
    expect(barcodeEncodeFindings([dm], 1, 8, noEnv, () => "bwipp.someError")).toHaveLength(1);
  });

  it("keeps renderFailed for a BOUND MaxiCode whose value has no separator (the producer never sees it)", () => {
    // The core producer skips marker content, so the resolved-value failure
    // must surface here; skipping both sides would hide the broken symbol.
    const env: EncodeEnv = {
      variables: [{ id: "v", name: "scm", fnNumber: 1, defaultValue: "1234567890" }],
      active: null,
    };
    const out = barcodeEncodeFindings([maxi(2, "«scm»")], 1, 8, env, () => "bwipp.maxicodeExpectedCountryCode");
    expect(out).toEqual([
      { objectId: "m", kind: "renderFailed", severity: "error", detail: "bwipp.maxicodeExpectedCountryCode" },
    ]);
  });

  it("still surfaces other MaxiCode encode errors as renderFailed", () => {
    // A separator is present (not the clearly-missing case): a genuine encode
    // failure stays a renderFailed, unchanged.
    const out = barcodeEncodeFindings([maxi(2, "12\x1d34")], 1, 8, noEnv, () => "some other error");
    expect(out).toEqual([
      { objectId: "m", kind: "renderFailed", severity: "error", detail: "some other error" },
    ]);
  });
});

describe("resolveForEncode", () => {
  it("resolves markers like the canvas preview so the check encodes what prints", () => {
    // Raw GS1 content `1100«d»` is 4+7 chars and would flag AI 11 as too long;
    // resolved it is the valid 6-digit date payload.
    const env: EncodeEnv = {
      variables: [{ id: "v", name: "d", fnNumber: 1, defaultValue: "0201" }],
      active: null,
    };
    const resolved = resolveForEncode(bar("a", "1100«d»"), env);
    expect((resolved.props as { content: string }).content).toBe("11000201");
  });

  it("is identity-preserving for marker-free content (keeps the encode cache hot)", () => {
    const leaf = bar("a", "12345678");
    expect(resolveForEncode(leaf, noEnv)).toBe(leaf);
  });

  it("reflects the variable default in the resolved content, so the cache key (resolved string) re-encodes when a bound default changes", () => {
    const leaf = bar("a", "1100«d»");
    const short = resolveForEncode(leaf, { variables: [{ id: "v", name: "d", fnNumber: 1, defaultValue: "0201" }], active: null });
    const long = resolveForEncode(leaf, { variables: [{ id: "v", name: "d", fnNumber: 1, defaultValue: "020199" }], active: null });
    expect((short.props as { content: string }).content).toBe("11000201");
    expect((long.props as { content: string }).content).toBe("1100020199");
  });
});

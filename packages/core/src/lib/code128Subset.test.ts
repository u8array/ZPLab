import { describe, expect, it } from "vitest";
import bwipjs from "bwip-js/generic";
import {
  code128ControlBwipRaw,
  code128ControlFd,
  code128FdToBytes,
  code128FdToDisplayText,
  code128FdToSymbols,
  code128PlainFd,
  code128SymbolsToFd,
  planCode128Symbols,
} from "./code128Subset";
import { measureBarcodeFootprintDotsWith, resolveForMeasure, type BwipEngine } from "./barcodeDims";
import type { LeafObject } from "../registry";
import type { LabelObject } from "../types/Group";

const engine = bwipjs as unknown as BwipEngine;

const HT = "\x09";
const LF = "\x0A";
const CR = "\x0D";
const GS = "\x1D";
const FS = "\x1C";

/** ZD230- and Labelary-measured reference: 178 modules (356 dots at ^BY2). */
const REFERENCE = `AB${HT}CD${CR}${LF}EF${GS}${FS}GH`;

describe("planCode128Symbols", () => {
  it("keeps an all-Subset-A payload switch-free", () => {
    // ZD230-verified payload from the hardware probe (spec p.96-98 values).
    expect(code128SymbolsToFd(planCode128Symbols(REFERENCE)!))
      .toBe(">933347335367774373893923940");
  });

  it("starts in the subset the first exclusive character needs", () => {
    expect(code128ControlFd(`ab${HT}CD`)).toBe(">:ab>7733536");
    expect(code128ControlFd(`AB${HT}cd`)).toBe(">9333473>6cd");
  });

  it("escapes the Subset B literals that would terminate the field", () => {
    expect(code128ControlFd(`A>B^C~D${HT}`)).toBe(">:A>0B><C>=D>773");
  });

  it("rejects a character no subset carries", () => {
    expect(planCode128Symbols("ä")).toBeNull();
    expect(code128ControlFd(`ä${HT}`)).toBeNull();
  });

  it("returns null without a control byte (the plain path stays untouched)", () => {
    expect(code128ControlFd("ABC123")).toBeNull();
    expect(code128ControlBwipRaw("ABC123")).toBeNull();
  });
});

describe("code128FdToBytes", () => {
  it("round-trips every emitted invocation form", () => {
    for (const text of [
      REFERENCE,
      `${HT}${CR}${LF}${GS}${FS}`,
      `${HT}ABC123`,
      `ABC123${HT}`,
      `AB${HT}cd${CR}EF`,
      `ab${HT}CD`,
      `1234567890${GS}12345`,
      `A>B^C~D${HT}E`,
    ]) {
      expect(code128FdToBytes(code128ControlFd(text)!), JSON.stringify(text)).toBe(text);
    }
  });

  it("decodes a foreign Subset C stream and its switch to A", () => {
    expect(code128FdToBytes(">;12345678>773")).toBe(`12345678${HT}`);
  });

  it("treats a start-code-less payload as Subset B (spec p.98)", () => {
    expect(code128FdToBytes("ABC")).toBe("ABC");
  });

  it("bails on escapes the model cannot represent", () => {
    expect(code128FdToBytes(">:AB>8CD")).toBeNull(); // FNC1
    expect(code128FdToBytes(">9AB")).toBeNull(); // non-digit pair in Subset A
  });

  it("reads >6/>7 per source subset, where they mean FNC 4 (Table 2)", () => {
    expect(code128FdToBytes(">:AB>6CD>773")).toBeNull(); // >6 from B
    expect(code128FdToBytes(">93334>773")).toBeNull(); // >7 from A
    expect(code128FdToBytes(">;1234>6AB")).toBe("1234AB"); // >6 from C switches
  });

  it("decodes the literal escapes in Subset A too (Table 2 A column)", () => {
    expect(code128FdToBytes(">9>0><>=>1")).toBe(">^\x1E\x1F");
    expect(code128FdToBytes(">:>0><>=>1")).toBe(">^~\x7F");
  });
});

describe("code128FdToSymbols", () => {
  it("reads the Table-2 escapes at their spec values", () => {
    expect(code128FdToSymbols(">:AB>8CD")).toEqual([104, 33, 34, 102, 35, 36]); // FNC1
    expect(code128FdToSymbols("A>2B")).toEqual([104, 33, 96, 34]); // FNC3
    expect(code128FdToSymbols("A>3B")).toEqual([104, 33, 97, 34]); // FNC2
  });

  it("compacts a >5 Code C switch into digit pairs like the firmware", () => {
    expect(code128FdToSymbols("STRSTR>52316094000242201")).toEqual([
      104, 51, 52, 50, 51, 52, 50, 99, 23, 16, 9, 40, 0, 24, 22, 1,
    ]);
    expect(code128FdToSymbols(">;12345678>773")).toEqual([105, 12, 34, 56, 78, 101, 73]);
  });

  it("keeps FNC4 (the >6/>7 reverse direction) in the symbol", () => {
    expect(code128FdToSymbols(">:AB>6CD")).toEqual([104, 33, 34, 100, 35, 36]);
    expect(code128FdToSymbols(">93334>773")).toEqual([103, 33, 34, 101, 73]);
  });

  it("applies SHIFT to exactly one value", () => {
    expect(code128FdToSymbols(">:A>473B")).toEqual([104, 33, 98, 73, 34]);
  });

  it("clears SHIFT on a subset switch and ignores >5/SHIFT inside C", () => {
    expect(code128FdToSymbols(">4>6AB")).toEqual([104, 98, 100, 33, 34]);
    expect(code128FdToSymbols(">;>5")).toEqual([105]);
    expect(code128FdToSymbols(">;>412")).toEqual([105, 12]);
  });

  it("clears SHIFT on an FNC symbol too", () => {
    expect(code128FdToSymbols(">:A>4>2B")).toEqual([104, 33, 98, 96, 34]);
    expect(code128FdToSymbols(">:A>4>8B")).toEqual([104, 33, 98, 102, 34]);
  });

  it("reads typed >< / >= as the literals the printer encodes", () => {
    expect(code128FdToSymbols("A><B>=C")).toEqual([104, 33, 62, 34, 94, 35]);
  });

  it("swallows an invalid escape like the firmware (ZD230 bare >)", () => {
    expect(code128FdToSymbols("A>zB")).toEqual([104, 33, 34]);
  });

  it("reads pairs leniently like the firmware (spec p.99 ignore rules)", () => {
    expect(code128FdToSymbols(">;123")).toEqual([105, 12]); // unpaired digit dropped
    expect(code128FdToSymbols(">;12x34")).toEqual([105, 12, 34]); // noninteger at D1 ignored
    expect(code128FdToSymbols(">;1x23")).toEqual([105, 23]); // noninteger at D2 kills the pair
    expect(code128FdToSymbols(">9AB")).toEqual([103]);
    expect(code128FdToSymbols(">996")).toEqual([103, 96]); // pairs 96-99 are FNC/switch values
  });

  it("renders the spec p.104 GS1-128 example", () => {
    expect(code128FdToSymbols(">;>80204017773003486100008535>8910001>837252")).toEqual([
      105, 102, 2, 4, 1, 77, 73, 0, 34, 86, 10, 0, 8, 53, 102, 91, 0, 1, 102, 37, 25,
    ]);
  });

  it("bails only on a byte no subset carries", () => {
    expect(code128FdToSymbols("ä>5")).toBeNull();
  });
});

describe("code128FdToDisplayText", () => {
  it("decodes an escape stream to the interpretation-line data (spec p.98 Fig 3/4)", () => {
    expect(code128FdToDisplayText(">:CODE128")).toBe("CODE128");
    expect(code128FdToDisplayText(">:AB>8CD")).toBe("ABCD");
    expect(code128FdToDisplayText(">;12345678>773")).toBe("12345678\t");
  });

  it("is a fixed point for the escaped form of typed text", () => {
    for (const typed of ["A>B", "A^B~C", "(10)A>B", "QTY 5"]) {
      expect(code128FdToDisplayText(code128PlainFd(typed))).toBe(typed);
    }
  });
});

describe("code128PlainFd", () => {
  it("escapes a bare > so the firmware cannot read it as an invocation", () => {
    expect(code128PlainFd("A>B")).toBe("A>0B");
    expect(code128PlainFd("A>")).toBe("A>0");
  });

  it("leaves a valid invocation code alone (unmodelled import stays verbatim)", () => {
    expect(code128PlainFd(">9336534")).toBe(">9336534");
    expect(code128PlainFd("A>0B")).toBe("A>0B");
    expect(code128PlainFd(">:AB>8CD")).toBe(">:AB>8CD");
  });

  it("escapes ^ and ~ as invocation literals (the ^FH hex form drops them, ZD230)", () => {
    expect(code128PlainFd("A^B~C")).toBe("A><B>=C");
    expect(code128PlainFd(">^")).toBe(">0><");
    expect(code128PlainFd("^>")).toBe("><>0");
  });
});

describe("printed vs rendered module count", () => {
  const code128 = (content: string): LeafObject =>
    ({
      id: "b", type: "code128", x: 0, y: 0, rotation: 0, positionType: "FO",
      props: {
        content, height: 100, moduleWidth: 2, printInterpretation: false,
        printInterpretationAbove: false, checkDigit: false, rotation: "N",
      },
    }) as LabelObject as LeafObject;

  /** Symbols = plan + check + stop; stop carries 2 modules more than the rest. */
  const plannedModules = (text: string) => 11 * (planCode128Symbols(text)!.length + 1) + 13;

  it("pins the hardware reference at 178 modules", () => {
    expect(plannedModules(REFERENCE)).toBe(178);
  });

  it("renders every control-byte payload at exactly the planned module count", () => {
    for (const text of [
      REFERENCE,
      `${HT}${CR}${LF}${GS}${FS}`,
      `${HT}ABC123`,
      `ABC123${HT}`,
      `AB${HT}cd${CR}EF`,
      `ab${HT}CD`,
      `1234567890${GS}12345`,
      `A>B^C~D${HT}E`,
    ]) {
      // moduleWidth 2: one module renders as 2 dots.
      const dots = measureBarcodeFootprintDotsWith(engine, code128(text), 8);
      expect(dots?.w, JSON.stringify(text)).toBe(plannedModules(text) * 2);
    }
  });

  /** Start + one symbol per character + check, stop carries 2 modules more. */
  const plainModules = (chars: number) => 11 * (chars + 2) + 13;

  it("renders a literal > as the one symbol the escaped emit encodes", () => {
    expect(code128PlainFd("A>B")).toBe("A>0B");
    const dots = measureBarcodeFootprintDotsWith(engine, code128("A>B"), 8);
    expect(dots?.w).toBe(plainModules(3) * 2);
  });

  it("drops the control bytes a template payload cannot print", () => {
    // The ^FE path keeps the ^FH escape, whose C0 bytes the firmware strips
    // from the symbol; the preview must show the same symbol.
    const obj = code128("A«sku»B«ctrl:TAB»");
    const variables = [{ id: "v1", name: "sku", fnNumber: 1, defaultValue: "X" }];
    const resolved = resolveForMeasure(obj as LabelObject, variables);
    expect((resolved as { props: { content: string } }).props.content).toBe("AXB");
    const dots = measureBarcodeFootprintDotsWith(engine, resolved as LeafObject, 8);
    expect(dots?.w).toBe(plainModules(3) * 2);
  });
});

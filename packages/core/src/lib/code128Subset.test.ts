import { describe, expect, it } from "vitest";
import bwipjs from "bwip-js/generic";
import {
  code128ControlBwipRaw,
  code128ControlFd,
  code128FdToBytes,
  code128SymbolsToFd,
  planCode128Symbols,
} from "./code128Subset";
import { measureBarcodeFootprintDotsWith, type BwipEngine } from "./barcodeDims";
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
});

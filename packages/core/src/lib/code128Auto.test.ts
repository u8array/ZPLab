import { describe, expect, it } from "vitest";
import bwipjs from "bwip-js/generic";
import { planCode128AutoSymbols } from "./code128Subset";
import { measureBarcodeFootprintDotsWith, type BwipEngine } from "./barcodeDims";
import { code128 } from "../registry/code128";
import { parseZPL } from "./zplParser";
import type { LeafObject } from "../registry";
import type { Code128Props } from "../registry/code128";

const engine = bwipjs as unknown as BwipEngine;

const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;

const leaf = (content: string, extra: Partial<Code128Props> = {}): LeafObject =>
  ({
    id: "b", type: "code128", x: 0, y: 0, rotation: 0, positionType: "FO",
    props: {
      content, height: 100, moduleWidth: 2, printInterpretation: false,
      printInterpretationAbove: false, checkDigit: false, rotation: "N", ...extra,
    },
  }) as LeafObject;

/** Start + data symbols + check at 11 modules each, stop at 13. */
const modules = (dataSymbols: number) => 11 * (dataSymbols + 2) + 13;

const firstProps = (zpl: string): Code128Props =>
  (parseZPL(zpl, 8).pages[0]?.objects[0] as LeafObject & { props: Code128Props }).props;

describe("planCode128AutoSymbols (^BC mode A)", () => {
  it("packs an even digit string into Subset C from the start", () => {
    expect(planCode128AutoSymbols("123456")).toEqual([START_C, 12, 34, 56]);
  });

  it("starts in C and drops to B for the last digit of an odd run", () => {
    expect(planCode128AutoSymbols("0240018268623")).toEqual(
      [START_C, 2, 40, 1, 82, 68, 62, CODE_B, 19],
    );
  });

  it("keeps short digit runs in B", () => {
    expect(planCode128AutoSymbols("A12B")).toEqual([START_B, 33, 17, 18, 34]);
    expect(planCode128AutoSymbols("123")).toEqual([START_B, 17, 18, 19]);
  });

  it("uses C for a two-digit payload", () => {
    expect(planCode128AutoSymbols("42")).toEqual([START_C, 42]);
  });

  it("switches into C mid-payload, leaving the first digit of an odd run in B", () => {
    expect(planCode128AutoSymbols("AB12345")).toEqual(
      [START_B, 33, 34, 17, CODE_C, 23, 45],
    );
    expect(planCode128AutoSymbols("AB1234CD")).toEqual(
      [START_B, 33, 34, CODE_C, 12, 34, CODE_B, 35, 36],
    );
  });

  it("returns null for control bytes so the plain plan takes over", () => {
    expect(planCode128AutoSymbols("A\x09B")).toBeNull();
    expect(planCode128AutoSymbols("")).toBeNull();
  });
});

describe("Code 128 mode A emit, import and canvas width", () => {
  it("emits m=A and omits it for the default mode", () => {
    expect(code128.toZPL(leaf("0240018268623", { mode: "A" }) as never))
      .toContain("^BCN,100,N,N,N,A^FD0240018268623^FS");
    expect(code128.toZPL(leaf("0240018268623") as never))
      .toContain("^BCN,100,N,N,N^FD0240018268623^FS");
  });

  it("lets GS1 mode win over mode A", () => {
    const zpl = code128.toZPL(leaf("0104012345678901", { mode: "A", gs1: true }) as never);
    expect(zpl).toContain("^BCN,100,N,N,N,D");
    expect(zpl).not.toContain(",A");
  });

  it("imports ^BC..,A as mode A and a bare ^BC without it", () => {
    expect(firstProps("^XA^FO10,10^BY2^BCN,80,Y,N,N,A^FD0240018268623^FS^XZ").mode).toBe("A");
    expect(firstProps("^XA^FO10,10^BY2^BCN,80,Y,N,N^FD0240018268623^FS^XZ").mode).toBeUndefined();
  });

  it("renders mode A at the Subset C width instead of Subset B", () => {
    const text = "0240018268623";
    const auto = measureBarcodeFootprintDotsWith(engine, leaf(text, { mode: "A" }), 8);
    const plain = measureBarcodeFootprintDotsWith(engine, leaf(text), 8);
    expect(auto?.w).toBe(modules(planCode128AutoSymbols(text)!.length - 1) * 2);
    expect(auto?.w).toBe(246);
    expect(plain?.w).toBe(356);
  });
});

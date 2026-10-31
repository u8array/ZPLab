import { describe, expect, it } from "vitest";
import bwipjs from "bwip-js/generic";
import { planCode128AutoSymbols } from "./code128Subset";
import { measureBarcodeFootprintDotsWith, resolveForMeasure, type BwipEngine } from "./barcodeDims";
import { importZplText } from "./zplImportService";
import { generateBatchZpl, generateMultiPageZPL } from "./zplGenerator";
import { dropPageOverlays } from "./pageOverlay";
import { pageLabelConfig, type LabelObject, type Page } from "../types/Group";
import { slotEncodingConflicts } from "./slotConflicts";
import { code128 } from "../registry/code128";
import { ctrlParityFor } from "../registry";
import { parseZPL } from "./zplParser";
import type { LeafObject } from "../registry";
import type { Code128Props } from "../registry/code128";

const label = { widthMm: 70, heightMm: 40, dpmm: 8 };

const engine = bwipjs as unknown as BwipEngine;

const START_A = 103;
const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;
const SHIFT = 98;

const leaf = (content: string, extra: Partial<Code128Props> = {}): LeafObject & { props: Code128Props } =>
  ({
    id: "b", type: "code128", x: 0, y: 0, rotation: 0, positionType: "FO",
    props: {
      content, height: 100, moduleWidth: 2, printInterpretation: false,
      printInterpretationAbove: false, checkDigit: false, rotation: "N", ...extra,
    },
  }) as LeafObject & { props: Code128Props };

const firstProps = (zpl: string): Code128Props =>
  (parseZPL(zpl, 8).pages[0]?.objects[0] as LeafObject & { props: Code128Props }).props;
const importedProps = (zpl: string): Code128Props =>
  (importZplText(zpl, 8).pages[0]?.objects[0] as LeafObject & { props: Code128Props }).props;

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
    expect(planCode128AutoSymbols("A12345B")).toEqual([START_B, 33, 17, CODE_C, 23, 45, CODE_B, 34]);
    expect(planCode128AutoSymbols("AB1234CD")).toEqual(
      [START_B, 33, 34, CODE_C, 12, 34, CODE_B, 35, 36],
    );
  });

  it("takes a control byte through Subset A", () => {
    expect(planCode128AutoSymbols("A\tB")).toEqual([START_A, 33, 73, 34]);
  });

  it("shifts from Subset B for a single control byte", () => {
    expect(planCode128AutoSymbols("a\tb")).toEqual([START_B, 65, SHIFT, 73, 66]);
  });

  it("returns null for no data or a byte above DEL", () => {
    expect(planCode128AutoSymbols("")).toBeNull();
    expect(planCode128AutoSymbols("ä")).toBeNull();
  });
});

describe("Code 128 mode A emit, import and canvas width", () => {
  it("emits m=A and omits it for the default mode", () => {
    expect(code128.toZPL(leaf("0240018268623", { mode: "A" })))
      .toContain("^BCN,100,N,N,N,A^FD0240018268623^FS");
    expect(code128.toZPL(leaf("0240018268623")))
      .toContain("^BCN,100,N,N,N^FD0240018268623^FS");
  });

  it("lets GS1 mode win over mode A", () => {
    const zpl = code128.toZPL(leaf("0104012345678901", { mode: "A", gs1: true }));
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
    expect(auto?.w).toBe(246);
    expect(plain?.w).toBe(356);
  });
});

describe("one ^BC m for emit, canvas and parser", () => {
  const widthOf = (content: string, extra: Partial<Code128Props> = {}) => measureBarcodeFootprintDotsWith(engine, leaf(content, extra), 8)?.w;

  it("lets GS1 win in the canvas as it does in the emit", () => {
    expect(widthOf("(01)04012345678901", { gs1: true })).toBe(268);
    expect(widthOf("(01)04012345678901", { mode: "A", gs1: true })).toBe(widthOf("(01)04012345678901", { gs1: true }));
  });

  // ZD230 V89.21.46Z, ^BY2: m=A reads no Table-2 escape, every byte is literal and packed by Annex E.
  it("reads the payload literally under m=A, as the printer does", () => {
    expect(code128.toZPL(leaf(">;123", { mode: "A" }))).toContain("^BCN,100,N,N,N,A^FD>;123^FS");
    expect(widthOf(">;123", { mode: "A" })).toBe(180);
    expect(widthOf("0240018268623", { mode: "A" })).toBe(246);
    expect(widthOf(">812345678901", { mode: "A" })).toBe(246);
    expect(widthOf("A>0B", { mode: "A" })).toBe(158);
    expect(widthOf("AB>4CD", { mode: "A" })).toBe(202);
    expect(widthOf(">:>4", { mode: "A" })).toBe(158);
    expect(widthOf("12345", { mode: "A" })).toBe(158);
    expect(widthOf("AB12345", { mode: "A" })).toBe(202);
  });

  it("packs AB12345 one symbol wider under m=N, as the printer does", () => {
    expect(widthOf("AB12345")).toBe(224);
  });

  it("leaves a bound default literal under m=A, on emit and on import", () => {
    const variables = [{ id: "v", name: "v", fnNumber: 1, defaultValue: "A>B" }];
    const zpl = generateMultiPageZPL(label, [{ objects: [leaf("X«v»Y", { mode: "A" })] }], variables);
    expect(zpl).toContain("A>B");
    expect(zpl).not.toContain(">0");
    expect(importedProps("^XA^FO10,10^BY2^BCN,80,Y,N,N,A^FN1^FDA>0B^FS^XZ").mode).toBe("A");
    expect(importZplText("^XA^FO10,10^BY2^BCN,80,Y,N,N,A^FN1^FDA>0B^FS^XZ", 8).variables[0]?.defaultValue).toBe("A>0B");
  });

  it("takes ^, ~ and a control byte through ^FH under m=A and through the invocation form under m=N", () => {
    expect(code128.toZPL(leaf("A^B", { mode: "A" }))).toContain("^FH_^FDA_5EB^FS");
    expect(code128.toZPL(leaf("A~B", { mode: "A" }))).toContain("^FH_^FDA_7EB^FS");
    expect(code128.toZPL(leaf("A«ctrl:TAB»B", { mode: "A" }))).toContain("^FH_^FDA_09B^FS");
    expect(widthOf("A^B", { mode: "A" })).toBe(136);
    expect(widthOf("A~B", { mode: "A" })).toBe(136);
    expect(widthOf("A«ctrl:TAB»B", { mode: "A" })).toBe(136);
    expect(code128.toZPL(leaf("A^B"))).toContain("^FDA><B^FS");
  });

  it("turns a bound control chip into its byte under m=A, on the emit, the batch recall, the canvas and the import", () => {
    const variables = [{ id: "v", name: "v", fnNumber: 1, defaultValue: "A«ctrl:TAB»B" }];
    const bound = leaf("«v»", { mode: "A" });
    expect(ctrlParityFor(bound)).toBe("byte");
    expect(code128.toZPL(bound, { label, variables })).toContain("^FN1^FH_^FDA_09B^FS");
    const batch = generateBatchZpl(pageLabelConfig(label, {}), [bound], variables, { headers: ["v"], rows: [["A«ctrl:TAB»B"]] }, { bindings: { v: "v" } });
    expect(batch).toContain("^FN1^FH_^FDA_09B^FS");
    expect((resolveForMeasure(bound as LabelObject, variables) as typeof bound).props.content).toBe("A\tB");
    expect(importZplText("^XA^FO10,10^BY2^BCN,80,Y,N,N,A^FN1^FH_^FDA_09B^FS^XZ", 8).variables[0]?.defaultValue).toBe("A«ctrl:TAB»B");
  });

  it("reports a slot an m=A field shares with a text field, which prints the chip as text", () => {
    const variables = [{ id: "v", name: "v", fnNumber: 1, defaultValue: "A«ctrl:TAB»B" }];
    const text = { id: "t", type: "text", x: 0, y: 0, rotation: 0, positionType: "FO", props: { content: "«v»", font: "0", fontSize: 30 } } as unknown as LabelObject;
    expect([...slotEncodingConflicts([leaf("«v»", { mode: "A" }), text], variables).fns]).toEqual([1]);
    expect([...slotEncodingConflicts([leaf("«v»", { mode: "A" }), { ...leaf("«v»", { mode: "A" }), id: "c" }], variables).fns]).toEqual([]);
  });

  it("keeps m=A on a serial field", () => {
    expect(code128.toZPL(leaf("123456", { mode: "A", serial: { increment: 1, zplMode: "SN" } }))).toContain("^BCN,100,N,N,N,A^");
  });

  it("emits no mode D for a non-boolean gs1 flag from a hand-edited design", () => {
    const zpl = code128.toZPL(leaf("(10)AB", { gs1: 1 as unknown as boolean }));
    expect(zpl).toContain("^BCN,100,N,N,N^");
    expect(zpl).not.toContain(">8");
  });

  it("resolves the chip for the bwip fallback under m=A as for the plan", () => {
    expect(widthOf("ä«ctrl:TAB»", { mode: "A" })).toBe(widthOf("ä\t", { mode: "A" }));
  });

  it("maps m=D to gs1 and reports an m the design cannot hold", () => {
    const d = firstProps("^XA^FO10,10^BY2^BCN,80,Y,N,N,D^FD>;0104012345678901^FS^XZ");
    expect([d.gs1, d.mode]).toEqual([true, undefined]);
    expect(importedProps("^XA^FO10,10^BY2^BCN,80,Y,N,N, u^FD123^FS^XZ").mode).toBeUndefined();
    expect(importZplText("^XA^FO10,10^BY2^BCN,80,Y,N,N, u^FD123^FS^XZ", 8).report.partial).toEqual(["^BC"]);
    expect(importZplText("^XA^FO10,10^BY2^BCN,80,Y,N,N,N^FD123^FS^XZ", 8).report.partial).toEqual([]);
  });

  it("imports a literal m=A payload as typed and re-emits it unchanged, and a bare ^BC the same way", () => {
    expect(importedProps("^XA^FO10,10^BY2^BCN,80,Y,N,N,A^FD>;123^FS^XZ").content).toBe(">;123");
    const r = importZplText("^XA^FO10,10^BY2^BCN,80,Y,N,N,A^FD>;123^FS^XZ", 8);
    expect(generateMultiPageZPL(label, dropPageOverlays(r.pages), r.variables)).toContain("^BCN,80,Y,N,N,A^FD>;123^FS");
    expect(importedProps("^XA^FO10,10^BY2^BCN,80,Y,N,N^FD>;123^FS^XZ").content).toBe(">;123");
  });

  it("keeps m=A on a template field and in a stored format with its recalls", () => {
    const fn = importZplText("^XA^FO10,10^BY2^BCN,80,Y,N,N,A^FN1^FS^XZ", 8);
    expect(importedProps("^XA^FO10,10^BY2^BCN,80,Y,N,N,A^FN1^FS^XZ").mode).toBe("A");
    expect(generateMultiPageZPL(label, dropPageOverlays(fn.pages), fn.variables)).toContain("^BCN,80,Y,N,N,A^FN1");
    const NL = String.fromCharCode(10);
    const r = importZplText(["^XA^DFR:A.ZPL^FS^FO10,10^BY2^BCN,80,Y,N,N,A^FN1^FS^XZ", "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^XZ"].join(NL), 8);
    const page = r.pages[0] as Page;
    const batch = generateBatchZpl(pageLabelConfig(label, page), page.objects, r.variables, r.batch!.dataset, r.batch!.columnMapping);
    expect(batch).toContain("^DFR:A.ZPL");
    expect(batch).toContain("^BCN,80,Y,N,N,A");
  });

  it("regenerates an imported m=A once the overlay is gone", () => {
    const r = importZplText("^XA^FO10,10^BY2^BCN,80,Y,N,N,A^FD0240018268623^FS^XZ", 8);
    expect(generateMultiPageZPL(label, dropPageOverlays(r.pages), r.variables)).toContain("^BCN,80,Y,N,N,A");
  });
});

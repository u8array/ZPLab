import { describe, expect, it } from "vitest";
import { ObjectRegistry, ctrlParityFor, type LeafObject, type LeafType } from "../registry";
import type { CtrlParity } from "./markerResolve";
import { generateBatchZpl } from "./zplGenerator";
import { importZplText } from "./zplImportService";
import { resolveForMeasure } from "./barcodeDims";
import { slotEncodingConflicts } from "./slotConflicts";
import { pageLabelConfig } from "../types/Group";

type Leaf = LeafObject & { props: { content: string } };

const label = { widthMm: 70, heightMm: 40, dpmm: 8 };
const variables = [{ id: "v", name: "v", fnNumber: 1, defaultValue: "A«ctrl:TAB»B" }];
const leafOf = (type: LeafType, content: string, extra: object = {}): Leaf =>
  ({ id: `${type}:${content}`, type, x: 0, y: 0, rotation: 0, positionType: "FO", props: { ...ObjectRegistry[type].defaultProps, content, ...extra } }) as Leaf;
const bound = (type: LeafType): Leaf => leafOf(type, "«v»");
const template = (type: LeafType): Leaf => leafOf(type, "x«v»y");
const text = bound("text");
const ctrlTypes = (Object.keys(ObjectRegistry) as LeafType[]).filter((t) => ObjectRegistry[t].controlChars === true);
const gs1CtrlTypes = ctrlTypes.filter((t) => ObjectRegistry[t].gs1Capable === true);

// The roster test fails on a controlChars type without a row here.
const EXPECTED = {
  aztec: { boundField: "^FN1^FH_^FDA_09B^FS", parity: "byte", templateConflict: false },
  code128: { boundField: "^FN1^FD>9337334^FS", parity: "byteOutsideTemplate", templateConflict: false },
  datamatrix: { boundField: "^FN1^FH_^FDA_09B^FS", parity: "byte", templateConflict: false },
  micropdf417: { boundField: "^FN1^FH_^FDA_09B^FS", parity: "byte", templateConflict: false },
  pdf417: { boundField: "^FN1^FH_^FDA_09B^FS", parity: "byte", templateConflict: false },
  // A QR lone bind writes its EC prefix into the slot, which a template of its kind prints as payload.
  qrcode: { boundField: "^FN1^FH_^FDQA,A_09B^FS", parity: "byte", templateConflict: true },
} as const satisfies Partial<Record<LeafType, { boundField: string; parity: CtrlParity; templateConflict: boolean }>>;
const expected = (type: LeafType) => EXPECTED[type as keyof typeof EXPECTED];

describe("a bound control chip on every controlChars type", () => {
  it("the controlChars roster is the five 2D symbologies and Code 128, two of them GS1 capable", () => {
    expect([...ctrlTypes].sort()).toEqual(Object.keys(EXPECTED).sort());
    expect([...gs1CtrlTypes].sort()).toEqual(["code128", "datamatrix"]);
  });

  it.each(ctrlTypes)("%s emits and recalls the chip as its byte, the canvas resolves it and the import restores the chip", (type) => {
    const leaf = bound(type);
    const { boundField } = expected(type);
    const zpl = ObjectRegistry[type].toZPL(leaf, { label, variables });
    expect(zpl).toContain(boundField);
    const batch = generateBatchZpl(pageLabelConfig(label, {}), [leaf], variables, { headers: ["v"], rows: [["A«ctrl:TAB»B"]] }, { bindings: { v: "v" } });
    expect(batch).toContain(boundField);
    expect(resolveForMeasure(leaf, variables).props.content).toBe("A\tB");
    expect(importZplText(`^XA${zpl}^XZ`, 8).variables[0]?.defaultValue).toBe("A«ctrl:TAB»B");
  });

  it.each(ctrlTypes)("%s reports the parity its table row names", (type) => {
    expect(ctrlParityFor(bound(type))).toBe(expected(type).parity);
  });

  it.each(gs1CtrlTypes)("%s keeps the chip literal under GS1, in its parity, its emit, the canvas and an import", (type) => {
    const leaf = leafOf(type, "«v»", { gs1: true });
    expect(ctrlParityFor(leaf)).toBe("literal");
    const zpl = ObjectRegistry[type].toZPL(leaf, { label, variables });
    expect(zpl).toContain("ctrl:TAB");
    expect(resolveForMeasure(leaf, variables).props.content).toBe("A«ctrl:TAB»B");
    expect(importZplText(`^XA${zpl}^XZ`, 8).variables[0]?.defaultValue).toBe("A«ctrl:TAB»B");
  });

  it.each(ctrlTypes)("%s conflicts over a slot with a text field, not with a lone bind of its kind, and with a template of its kind per its table row", (type) => {
    expect([...slotEncodingConflicts([bound(type), text], variables).fns]).toEqual([1]);
    expect([...slotEncodingConflicts([bound(type), { ...bound(type), id: "second" }], variables).fns]).toEqual([]);
    expect([...slotEncodingConflicts([bound(type), template(type)], variables).fns]).toEqual(expected(type).templateConflict ? [1] : []);
  });

  it.each(ctrlTypes)("%s as a template agrees with a text template and with a block-text lone bind, which both leave the slot raw", (type) => {
    const fbText = leafOf("text", "«v»", { textMode: "fb", blockWidth: 200 });
    expect([...slotEncodingConflicts([template(type), template("text")], variables).fns]).toEqual([]);
    expect([...slotEncodingConflicts([fbText, template(type)], variables).fns]).toEqual([]);
  });

  it("a Code 128 m=N template drops the byte an Aztec lone bind writes, so the slot conflicts", () => {
    expect([...slotEncodingConflicts([bound("aztec"), template("code128")], variables).fns]).toEqual([1]);
    expect([...slotEncodingConflicts([bound("aztec"), leafOf("code128", "x«v»y", { mode: "A" })], variables).fns]).toEqual([]);
  });
});

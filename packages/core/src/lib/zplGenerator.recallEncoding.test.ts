import { describe, expect, it } from "vitest";
import { generateBatchZpl, generateMultiPageZPL } from "./zplGenerator";
import { pageLabelConfig } from "../types/Group";
import type { LabelObject } from "../types/Group";
import type { LabelConfig } from "../types/LabelConfig";

const label: LabelConfig = { widthMm: 50, heightMm: 30, dpmm: 8 };
const block = (id: string, marker: string, mode: "tb" | "fb", y: number): LabelObject =>
  ({ id, type: "text", x: 10, y, rotation: 0, props: { content: `«${marker}»`, fontHeight: 30, fontWidth: 0, rotation: "N", textMode: mode, blockWidth: 200, blockHeight: 100, blockLines: 2 } }) as unknown as LabelObject;
const objects = [block("t", "name", "tb", 10), block("f", "note", "fb", 60)];
const variables = [{ id: "n", name: "name", fnNumber: 1, defaultValue: "a<b" }, { id: "o", name: "note", fnNumber: 2, defaultValue: "x\ny" }];

describe("block escaping on recall values", () => {
  it("encodes a row value for a ^TB or ^FB field the way the field's own default is encoded", () => {
    const single = generateMultiPageZPL(label, [{ objects }], variables);
    expect(single).toContain("^FN1^FDa<<>b^FS");
    expect(single).toContain("^FN2^FDx\\&y^FS");
    const dataset = { headers: ["name", "note"], rows: [["c<d", "p\nq"]] };
    const batch = generateBatchZpl(pageLabelConfig(label, { storedFormatPath: "E:JOB.ZPL" }), objects, variables, dataset, { bindings: { n: "name", o: "note" } });
    const recall = batch.split("^XF")[1] ?? "";
    expect(recall).toContain("^FN1^FDc<<>d^FS");
    expect(recall).toContain("^FN2^FDp\\&q^FS");
  });
});

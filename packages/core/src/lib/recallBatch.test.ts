import { describe, it, expect } from "vitest";
import { importZplText } from "./zplImportService";
import { generateBatchZpl, generateMultiPageZPL } from "./zplGenerator";
import { prepareSourceApply, type SourceDocumentState } from "./zplSourceEdit";
import type { LabelConfig, PageLabel } from "../types/LabelConfig";
import type { LabelObject } from "../types/Group";

const label: LabelConfig = { widthMm: 50, heightMm: 30, dpmm: 8 };
const obj = (id: string, type: string, props: object, y = 10): LabelObject =>
  ({ id, type, x: 10, y, rotation: 0, props: { rotation: "N", ...props } }) as never;
const variables = [
  { id: "n", name: "name", fnNumber: 1, defaultValue: "Default" },
  { id: "s", name: "sku", fnNumber: 2, defaultValue: "0000" },
  { id: "u", name: "url", fnNumber: 3, defaultValue: "https://x" },
];
const objects = [
  obj("t", "text", { content: "«name»", fontHeight: 30, fontWidth: 0 }),
  obj("c", "code128", { content: "«sku»", height: 60, moduleWidth: 2, printInterpretation: false, checkDigit: false }, 60),
  obj("q", "qrcode", { content: "«url»", model: 2, magnification: 4, errorCorrection: "M" }, 140),
];
const dataset = { headers: ["name", "sku", "url"], rows: [["Alpha", "A1>B", "https://a.example/1"], ["Beta", "", "https://b.example/2?x=y"]] };
const mapping = { bindings: { n: "name", s: "sku", u: "url" } };
const NL = String.fromCharCode(10);
const template = (path: string, fields: string) => `^XA^DF${path}^FS${fields}^XZ`;
const FIELD = "^FO10,10^A0N,30,30^FN1^FDx^FS";

describe("^XF recall blocks fold into rows of their ^DF template", () => {
  it("round-trips the batch export: one template page, the rows as a dataset bound by slot", () => {
    const zpl = generateBatchZpl({ ...label, storedFormatPath: "E:JOB.ZPL" } as PageLabel, objects, variables, dataset, mapping);
    const r = importZplText(zpl, 8);
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0]?.storedFormatPath).toBe("E:JOB.ZPL");
    expect(r.report.findings.filter((f) => f.kind === "unknown")).toEqual([]);
    expect(r.batch?.dataset.headers).toEqual(["field_1", "field_2", "field_3"]);
    expect(r.batch?.dataset.rows).toEqual(dataset.rows);
    expect(r.batch?.dataset.source).toMatchObject({ kind: "zpl", formatPath: "E:JOB.ZPL", rowCount: 2 });
    const byName = Object.fromEntries(r.variables.map((v) => [v.name, v.id]));
    expect(r.batch?.columnMapping.bindings).toEqual({ [byName.field_1 ?? ""]: "field_1", [byName.field_2 ?? ""]: "field_2", [byName.field_3 ?? ""]: "field_3" });
  });

  it("decodes a row value exactly as the field's own ^FD would, across barcode, text and hex fields", () => {
    const fields = [
      "^FO10,10^BXN,,200,,,,_^FN1^FS",
      "^FO10,80^BY2^B9N,60,Y,N^FN2^FS",
      "^FO10,165^A0N,30,0^FB200,2,0,L,0^FN3^FS",
      "^FO10,220^A0N,30,30^FH^FN4^FS",
    ].join("");
    const values = ["_1010950110153000310LOT2", "0654321", "x\\&y", "a_5fb"];
    const inline = importZplText(`^XA${fields.replace(/\^FN(\d)\^FS/g, (_, n: string) => `^FN${n}^FD${values[Number(n) - 1] ?? ""}^FS`)}^XZ`, 8);
    const recall = `^XA^XFE:JOB.ZPL^FS^FN1^FD${values[0]}^FS^FN2^FD${values[1]}^FS^FN3^FD${values[2]}^FS^FH^FN4^FD${values[3]}^FS^XZ`;
    const r = importZplText([template("E:JOB.ZPL", fields), recall].join(NL), 8);
    expect(r.batch?.dataset.rows).toEqual([inline.variables.map((v) => v.defaultValue)]);
    expect(r.batch?.dataset.rows[0]).toEqual(["010950110153000310LOT2", "654321", "x\ny", "a_b"]);
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0]?.overlay).toBeDefined();
  });

  it("prints the template's own ^FD for a slot the block leaves out and keeps the bytes of an embedded slot", () => {
    const fields = "^FO10,10^A0N,30,30^FN1^FDdef^FS^FO10,60^A0N,30,30^FE^FDLot: #2#^FS";
    const r = importZplText([template("R:A.ZPL", fields), "^XA^XFR:A.ZPL^FS^FN2^FDtwo^FS^XZ"].join(NL), 8);
    expect(r.batch?.dataset.rows).toEqual([["def", "two"]]);
    expect(r.report.findings.map((f) => f.kind)).not.toContain("partial");
  });

  it("matches a bare recall name to the template on any device and leaves a foreign recall as a raw block", () => {
    const rows = ["^XA^XFLBL^FS^FN1^FDone^FS^XZ", "^XA^XFE:LBL.ZPL^FN1^FDtwo^FS^XZ", "^XA^XFR:OTHER.ZPL^FS^FN1^FDthree^FS^XZ"];
    const r = importZplText([template("E:LBL.ZPL", FIELD), ...rows].join(NL), 8);
    expect(r.batch?.dataset.rows).toEqual([["one"], ["two"]]);
    expect(r.pages).toHaveLength(2);
    expect(r.pages[1]?.objects).toEqual([]);
    expect(r.report.findings.filter((f) => f.kind === "partial").map((f) => [f.command, f.loss, f.pageIndex])).toEqual([["^XFR:OTHER.ZPL", "recallFormat", 1]]);
  });

  it("folds only a block that holds nothing but the recall and its slots, and only after the template", () => {
    const stateful = importZplText([template("R:A.ZPL", FIELD), "^XA^FO5,5^GB10,10,1^FS^XFR:A.ZPL^FS^FN1^FDone^FS^XZ"].join(NL), 8);
    expect(stateful.batch).toBeUndefined();
    expect(stateful.pages).toHaveLength(2);
    expect(stateful.pages[1]?.objects).toHaveLength(1);
    expect(stateful.pages[1]?.overlay).toBeDefined();
    expect(stateful.variables.map((v) => v.defaultValue)).toEqual(["x", "one"]);
    // The block keeps its own bytes, so the re-export still prints the box beside the format.
    expect(generateMultiPageZPL(label, stateful.pages, stateful.variables)).toContain("^GB10,10,1^FS^XFR:A.ZPL^FS^FN1^FDone^FS");
    expect(stateful.report.findings.some((f) => f.loss === "recallFormat" && f.pageIndex === 1)).toBe(true);
    const early = importZplText(["^XA^XFR:A.ZPL^FS^FN1^FDone^FS^XZ", template("R:A.ZPL", FIELD)].join(NL), 8);
    expect(early.batch).toBeUndefined();
    expect(early.report.findings.some((f) => f.loss === "recallFormat" && f.pageIndex === 0)).toBe(true);
  });

  it("keeps recall blocks as pages when they recall different templates or a block carries its own fields", () => {
    const two = importZplText([template("R:A.ZPL", FIELD), template("R:B.ZPL", FIELD), "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^XZ", "^XA^XFR:B.ZPL^FS^FN1^FDtwo^FS^XZ"].join(NL), 8);
    expect(two.batch).toBeUndefined();
    expect(two.pages).toHaveLength(4);
    expect(two.pages[2]?.objects).toEqual([]);
    const mixed = importZplText([template("R:A.ZPL", FIELD), "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^FO10,60^A0N,20,20^FDextra^FS^XZ"].join(NL), 8);
    expect(mixed.batch).toBeUndefined();
    expect(mixed.pages).toHaveLength(2);
    expect(mixed.pages[1]?.objects.map((o) => o.type)).toEqual(["text"]);
    expect(mixed.report.findings.some((f) => f.loss === "recallFormat")).toBe(true);
  });

  it("keeps the recall pages when the template declares no slot, so no label vanishes", () => {
    const r = importZplText([template("R:A.ZPL", "^FO10,10^A0N,30,30^FDstatic^FS"), "^XA^XFR:A.ZPL^FS^XZ", "^XA^XFR:A.ZPL^FS^XZ"].join(NL), 8);
    expect(r.batch).toBeUndefined();
    expect(r.pages).toHaveLength(3);
    // The recall pages keep their own bytes for a verbatim re-export, so they show no replayed field.
    expect(r.pages.map((p) => p.objects.length)).toEqual([1, 0, 0]);
    expect(r.pages.slice(1).every((p) => p.overlay !== undefined)).toBe(true);
    expect(r.report.findings.filter((f) => f.loss === "recallFormat").map((f) => f.pageIndex)).toEqual([1, 2]);
  });

  it("addresses findings by the pages the import returns, not by the stream's blocks", () => {
    const rows = ["^XA^XFR:A.ZPL^FS^FN1^FDone^FS^XZ", "^XA^XFR:A.ZPL^FS^FN1^FDtwo^FS^XZ", "^XA^XFR:A.ZPL^FS^FN1^FDthree^FS^FO10,90^A0N,20,20^FDextra^FS^XZ"];
    const r = importZplText([template("R:A.ZPL", FIELD), ...rows].join(NL), 8);
    expect(r.pages).toHaveLength(2);
    expect(r.batch?.dataset.rows).toEqual([["one"], ["two"]]);
    expect(r.report.findings.filter((f) => f.loss === "recallFormat").map((f) => f.pageIndex)).toEqual([1]);
  });

  it("reports a second ^XF and a slot the format never declares, and keeps such blocks as pages", () => {
    const second = importZplText([template("R:A.ZPL", FIELD), "^XA^XFR:A.ZPL^FS^XFE:LOGO.ZPL^FS^FN1^FDone^FS^XZ"].join(NL), 8);
    expect(second.batch).toBeUndefined();
    expect(second.pages).toHaveLength(2);
    expect(second.report.findings.filter((f) => f.kind === "partial").map((f) => f.command)).toEqual(expect.arrayContaining(["^XFE:LOGO.ZPL", "^XFR:A.ZPL"]));
    const stray = importZplText([template("R:A.ZPL", FIELD), "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^FN7^FDghost^FS^XZ"].join(NL), 8);
    expect(stray.batch).toBeUndefined();
    expect(stray.pages).toHaveLength(2);
    expect(stray.report.findings.some((f) => f.kind === "partial" && f.command === "^FN7" && f.loss === "recallSlot")).toBe(true);
  });

  it("does not fold a block that has bytes behind its ^XZ", () => {
    const r = importZplText([template("R:A.ZPL", FIELD), "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^XZ^FO200,200^A0N,20,20^FDstray^FS", "^XA^XFR:A.ZPL^FS^FN1^FDtwo^FS^XZ"].join(NL), 8);
    expect(r.batch?.dataset.rows).toEqual([["two"]]);
    expect(r.pages).toHaveLength(2);
    expect(r.pages[1]?.objects).toHaveLength(1);
  });

  it("keeps a block's value for a slot the format names but leaves untyped, exactly as an inline field would", () => {
    const r = importZplText([template("R:A.ZPL", "^CF0,50,50^FN1^FS"), "^XA^XFR:A.ZPL^FS^FN1^FDa^FS^XZ"].join(NL), 8);
    const inline = importZplText("^XA^CF0,50,50^FN1^FDa^FS^XZ", 8);
    expect(r.variables.map((v) => v.defaultValue)).toEqual(inline.variables.map((v) => v.defaultValue));
    expect(r.report.findings.some((f) => f.loss === "recallSlot")).toBe(false);
  });

  it("warns about a control byte in a row value that truncates the field, as the inline field would", () => {
    const r = importZplText([template("R:A.ZPL", "^FO10,10^A0N,30,30^FH^FN1^FS"), "^XA^XFR:A.ZPL^FS^FH^FN1^FDab_0dcd^FS^XZ"].join(NL), 8);
    const inline = importZplText("^XA^FO10,10^A0N,30,30^FH^FN1^FDab_0dcd^FS^XZ", 8);
    expect(r.batch?.dataset.rows).toEqual([inline.variables.map((v) => v.defaultValue)]);
    const hex = (f: { kind: string; command: string }[]) => f.filter((x) => x.kind === "hexControl").map((x) => x.command);
    expect(hex(r.report.findings)).toEqual(hex(inline.report.findings));
    expect(hex(r.report.findings)).toEqual(["_0d"]);
  });

  it("lets a printer command between two recall blocks pass without demoting the row", () => {
    const r = importZplText([template("R:A.ZPL", FIELD), "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^XZ~JA", "^XA^XFR:A.ZPL^FS^FN1^FDtwo^FS^XZ"].join(NL), 8);
    expect(r.batch?.dataset.rows).toEqual([["one"], ["two"]]);
  });

  it("folds rows that label software separates with comments, and points findings at their bytes", () => {
    const rows = ["^FXlabel a^FS", "^XA^XFR:A.ZPL^FS^FN1^FDa^FS^XZ", "^FXlabel b^FS", "^XA^XFR:A.ZPL^FS^FN1^FDb^FS^XZ"];
    const r = importZplText([template("R:A.ZPL", FIELD), ...rows].join(NL), 8);
    expect(r.batch?.dataset.rows).toEqual([["a"], ["b"]]);
    const src = [template("R:A.ZPL", FIELD), "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^FN7^FDghost^FS^XZ"].join(NL);
    const stray = importZplText(src, 8);
    const slot = stray.report.findings.find((f) => f.command === "^FN7");
    expect(slot?.span && src.slice(slot.span.start, slot.span.end)).toBe("^FN7");
    const recall = stray.report.findings.find((f) => f.loss === "recallFormat");
    expect(recall?.span && src.slice(recall.span.start, recall.span.end)).toBe("^XFR:A.ZPL");
  });

  it("commits a box the template stashes behind its last field, so the folded page shows it", () => {
    const r = importZplText([template("R:A.ZPL", `${FIELD}^FO50,50^GB100,100,100^FS`), "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^XZ"].join(NL), 8);
    expect(r.batch?.dataset.rows).toEqual([["one"]]);
    expect(r.pages[0]?.objects.map((o) => o.type)).toEqual(["text", "box"]);
  });

  it("counts a saved mapping as lost when the buffer's rows bring their own", () => {
    const zpl = generateBatchZpl({ ...label, storedFormatPath: "R:JOB.ZPL" } as PageLabel, objects, variables, dataset, mapping);
    const current: SourceDocumentState = { label, pages: [{ objects: [] }], variables, printerProfile: {}, columnMapping: { ...mapping, headerSnapshot: dataset.headers } };
    const plan = prepareSourceApply({ text: zpl, baseline: "", current });
    expect(plan.ok && plan.loss.mappingLost).toBe(3);
  });

  it("takes the settings a field reads from its payload from the rows, and reports rows that disagree", () => {
    const fields = "^FO10,10^BXN,5,200,,,,_^FN1^FS^FO10,200^BQN,2,5^FN2^FS";
    const rows = ["^XA^XFR:A.ZPL^FS^FN1^FD_1010950110153000^FS^FN2^FDQA,HELLO^FS^XZ", "^XA^XFR:A.ZPL^FS^FN1^FD_1010950110153001^FS^FN2^FDQA,WORLD^FS^XZ"];
    const r = importZplText([template("R:A.ZPL", fields), ...rows].join(NL), 8);
    const props = (o: unknown) => (o as { props: { gs1?: boolean; errorCorrection?: string; content: string } }).props;
    expect(r.pages[0]?.objects.map((o) => [o.type, props(o).gs1 ?? props(o).errorCorrection])).toEqual([["datamatrix", true], ["qrcode", "Q"]]);
    expect(r.pages[0]?.objects.map((o) => props(o).content)).toEqual(["«field_1»", "«field_2»"]);
    expect(r.report.findings.some((f) => f.loss === "recallSettings")).toBe(false);
    const mixed = importZplText([template("R:A.ZPL", fields), rows[0] ?? "", "^XA^XFR:A.ZPL^FS^FN1^FD010950110153001^FS^FN2^FDMA,WORLD^FS^XZ"].join(NL), 8);
    expect(mixed.batch?.dataset.rows).toHaveLength(2);
    // Several disagreeing objects still collapse into one finding.
    expect(mixed.report.findings.filter((f) => f.loss === "recallSettings").map((f) => f.pageIndex)).toEqual([0]);
  });

  it("keeps a partial the row's own value raises, as the inline field would", () => {
    const r = importZplText([template("R:A.ZPL", "^FO10,10^BQN,2,5^FN1^FS"), "^XA^XFR:A.ZPL^FS^FN1^FDMM,B0012https://x^FS^XZ"].join(NL), 8);
    const inline = importZplText("^XA^FO10,10^BQN,2,5^FN1^FDMM,B0012https://x^FS^XZ", 8);
    const partials = (f: { kind: string; command: string }[]) => f.filter((x) => x.kind === "partial").map((x) => x.command);
    expect(partials(r.report.findings)).toEqual(partials(inline.report.findings));
    expect(partials(r.report.findings)).toContain("^BQ");
  });

  it("folds blocks whose printer state matches the template's, and block-scoped state the rows agree on", () => {
    const state = importZplText([template("R:A.ZPL", FIELD), "^XA^CI28^PW400^LL240^LS0^LH0,0^LT0^LRN^FWN^XFR:A.ZPL^FS^FN1^FDone^FS^PQ01^XZ", "^XA^XFR:A.ZPL^FS^FN1^FDtwo^FS^PQ1^XZ"].join(NL), 8);
    expect(state.batch?.dataset.rows).toEqual([["one"], ["two"]]);
    // ^PQ never falls through from another page, so the rows' agreed quantity reaches the design through the template.
    const quantity = importZplText([template("R:A.ZPL", FIELD), "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^PQ1,0,1,Y^XZ", "^XA^XFR:A.ZPL^FS^FN1^FDtwo^FS^PQ1,0,1,Y^XZ", "^XA^XFR:A.ZPL^FS^FN1^FDthree^FS^PQ5^XZ"].join(NL), 8);
    expect(quantity.batch?.dataset.rows).toEqual([["one"], ["two"]]);
    expect(quantity.labelConfig).toMatchObject({ printQuantity: 1, replicates: 1, overridePauseCount: "Y" });
    expect(quantity.pages).toHaveLength(2);
    const shifted = importZplText([template("R:A.ZPL", FIELD), "^XA^LH10,10^XFR:A.ZPL^FS^FN1^FDone^FS^XZ"].join(NL), 8);
    expect(shifted.batch).toBeUndefined();
    // A home the template was stored under is the row's default. A reset away from it is not.
    const homed = importZplText(["^XA^LH10,10^DFR:A.ZPL^FS^FO10,10^A0N,30,30^FN1^FDx^FS^XZ", "^XA^LH10,10^XFR:A.ZPL^FS^FN1^FDone^FS^XZ", "^XA^LH0,0^XFR:A.ZPL^FS^FN1^FDtwo^FS^XZ"].join(NL), 8);
    expect(homed.batch?.dataset.rows).toEqual([["one"]]);
    expect(homed.pages).toHaveLength(2);
    const five = importZplText([template("R:A.ZPL", FIELD), "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^PQ5^XZ"].join(NL), 8);
    expect(five.batch?.dataset.rows).toEqual([["one"]]);
    expect(five.labelConfig.printQuantity).toBe(5);
    // A quantity an earlier job block left standing is not the rows' own, so it stays with page 0's verdict.
    const leaked = importZplText(["^XA^FO5,5^A0N,20,20^FDCOVER^FS^XZ", "^XA^PQ5^FO5,5^A0N,20,20^FDJOB^FS^XZ", template("R:A.ZPL", FIELD), "^XA^XFR:A.ZPL^FS^FN1^FDa^FS^XZ", "^XA^XFR:A.ZPL^FS^FN1^FDb^FS^XZ"].join(NL), 8);
    expect(leaked.batch?.dataset.rows).toEqual([["a"], ["b"]]);
    expect(leaked.labelConfig.printQuantity).toBeUndefined();
  });

  it("names variables as a linear probe would, gaps refilled after a serial sweep or a replay", () => {
    const swept = importZplText(["^XA^FO10,10^A0N,30,30^FN1^FDaaa^FS^XZ", "^XA^FO10,10^A0N,30,30^FN1^FDbbb^FS^SN1,1,Y^XZ", "^XA^FO10,10^A0N,30,30^FN1^FDccc^FS^XZ"].join(NL), 8);
    expect(swept.variables.map((v) => v.name)).toEqual(["field_1", "field_1_2"]);
    const hinted = importZplText([
      "^XA^FX var: field^FS^FO10,10^A0N,30,30^FN2^FDa^FS^FX var: field^FS^FO10,50^A0N,30,30^FN3^FDb^FS^FO10,90^A0N,30,30^SN1,1,Y^FN1^FD0001^FS^XZ",
      "^XA^FX var: field^FS^FO10,10^A0N,30,30^FN4^FDc^FS^XZ",
    ].join(NL), 8);
    expect(hinted.variables.map((v) => v.name)).toEqual(["field", "field_2", "field_3"]);
    const pages = importZplText([template("R:A.ZPL", FIELD), ...[1, 2, 3].map((i) => `^XA^FO5,${i}^GB10,10,1^FS^XFR:A.ZPL^FS^FN1^FDv${i}^FS^XZ`)].join(NL), 8);
    expect(pages.variables.map((v) => v.name)).toEqual(["field_1", "field_1_2", "field_1_3", "field_1_4"]);
  });

  it("folds the template the rows recall even when the stream stores another format", () => {
    const r = importZplText([template("R:LOGO.ZPL", "^FO5,5^A0N,20,20^FDLOGO^FS"), template("R:A.ZPL", FIELD), "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^XZ"].join(NL), 8);
    expect(r.batch?.dataset.rows).toEqual([["one"]]);
    expect(r.pages).toHaveLength(2);
  });

  it("decodes a graphic in the template once, however many rows recall it", () => {
    const bitmap = "^FO10,120^GFA,8,8,1,FFFFFFFFFFFFFFFF^FS";
    const r = importZplText([template("R:A.ZPL", `${FIELD}${bitmap}`), ...[1, 2, 3].map((i) => `^XA^XFR:A.ZPL^FS^FN1^FDv${i}^FS^XZ`)].join(NL), 8);
    expect(r.batch?.dataset.rows).toHaveLength(3);
    expect(r.decodedImages).toHaveLength(1);
  });

  it("fills a slot the template only declares from the row, and treats a block's own field as ink", () => {
    const declared = importZplText([template("R:A.ZPL", `${FIELD}^FN2^FDfallback^FS`), "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^FN2^FDrowA^FS^XZ"].join(NL), 8);
    expect(declared.batch?.dataset.rows).toEqual([["one", "rowA"]]);
    const ink = importZplText([template("R:A.ZPL", FIELD), "^XA^XFR:A.ZPL^FS^FDstray^FS^FN1^FDone^FS^XZ", "^XA^XFR:A.ZPL^FS^FN1^FDtwo^FS^XZ"].join(NL), 8);
    expect(ink.batch?.dataset.rows).toEqual([["two"]]);
    expect(ink.pages).toHaveLength(2);
    expect(ink.pages[1]?.objects.map((o) => o.type)).toEqual(["text"]);
    expect(ink.report.findings.some((f) => f.loss === "recallSettings")).toBe(false);
  });

  it("reports a row printing at another density once, on the template page", () => {
    const r = importZplText(["^XA^JMB^FO5,5^A0N,20,20^FDcover^FS^XZ", `^XA^JMA^DFR:A.ZPL^FS${FIELD}^XZ`, ...[1, 2, 3].map((i) => `^XA^XFR:A.ZPL^FS^FN1^FDv${i}^FS^XZ`)].join(NL), 8);
    expect(r.pages).toHaveLength(2);
    expect(r.report.findings.filter((f) => f.kind === "mixedPageGeometry").map((f) => f.pageIndex)).toEqual([1]);
  });

  it("keeps two names apart when a template names a slot the replay leaves bare", () => {
    const r = importZplText([template("R:A.ZPL", "^FXalpha^FS^FO10,10^A0N,30,30^FN1^FDx^FS^FN2^FN3^FS"), "^XA^XFR:A.ZPL^FS^FXalpha^FS^FN2^FDtwo^FS^XZ"].join(NL), 8);
    const names = r.variables.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("pins the replay guards: overlays, finding dedupe, head state, frames restated or changed, long names, bytes behind ^XZ", () => {
    const reversed = importZplText(["^XA^DFR:A.ZPL^FS^LRY^FO10,10^A0N,30,30^FN1^FS^LRN^XZ", "^XA^FO5,5^GB10,10,1^FS^XFR:A.ZPL^FS^FN1^FDone^FS^XZ"].join(NL), 8);
    expect(reversed.pages).toHaveLength(2);
    expect(reversed.pages[1]?.overlay).toBeDefined();
    const stored = importZplText(["^XA^DFR:A.ZPL^FS^ILR:LOGO.GRF^FO10,10^A0N,30,30^FN1^FS^XZ", "^XA^FO5,5^GB10,10,1^FS^XFR:A.ZPL^FS^FN1^FDone^FS^XZ"].join(NL), 8);
    expect(stored.pages[1]?.overlay).toBeDefined();
    expect(generateMultiPageZPL(label, stored.pages, stored.variables)).toContain("^GB10,10,1^FS^XFR:A.ZPL^FS^FN1^FDone^FS");
    const device = importZplText(["^XA^DFR:A.ZPL^FS^IDR:OLD.GRF^FS^FO10,10^A0N,30,30^FN1^FS^XZ", ...[1, 2, 3].map((i) => `^XA^XFR:A.ZPL^FS^FN1^FDv${i}^FS^XZ`)].join(NL), 8);
    expect(device.report.findings.filter((f) => f.kind === "deviceAction")).toHaveLength(1);
    const head = importZplText(["^XA^DFR:A.ZPL^JMA^FO10,10^A0N,30,30^FN1^FS^XZ", "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^XZ"].join(NL), 8);
    expect(head.batch?.dataset.rows).toEqual([["one"]]);
    expect(head.report.findings.filter((f) => f.kind === "partial")).toEqual([]);
    const missing = importZplText(["^XA^DFR:A.ZPL^FS^XGR:MISSING.GRF,3,3^FS^FO10,10^A0N,30,30^FN1^FS^XZ", "^XA^PQ5^XFR:A.ZPL^FS^FN1^FDone^FS^XZ", "^XA^PQ5^XFR:A.ZPL^FS^FN1^FDtwo^FS^XZ"].join(NL), 8);
    expect(missing.report.findings.filter((f) => f.kind === "partial" && f.command === "^XG")).toHaveLength(1);
    const open = importZplText(["^XA^DFR:A.ZPL^FS^FO10,10^A0N,30,30^FN1^XZ", "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^XZ"].join(NL), 8);
    expect(open.batch?.dataset.rows).toEqual([["one"]]);
    const restated = importZplText(["^XA^LS50^LRY^FWR^DFR:A.ZPL^FS^FO10,10^A0N,30,30^FN1^FS^XZ", ...[1, 2].map((i) => `^XA^LS50^LRY^FWR^XFR:A.ZPL^FS^FN1^FDv${i}^FS^XZ`)].join(NL), 8);
    expect(restated.batch?.dataset.rows).toEqual([["v1"], ["v2"]]);
    const justified = importZplText([template("R:A.ZPL", FIELD), "^XA^FWN,1^XZ", "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^XZ"].join(NL), 8);
    expect(justified.batch).toBeUndefined();
    const uploaded = importZplText(["^XA^DFR:A.ZPL^FS~DGR:LOGO.GRF,8,1,FFFFFFFFFFFFFFFF^FO10,10^A0N,30,30^FN1^FS^XZ", "^XA^FO5,5^GB10,10,1^FS^XFR:A.ZPL^FS^FN1^FDone^FS^XZ"].join(NL), 8);
    expect(uploaded.pages[1]?.overlay).toBeDefined();
    const long = importZplText(["^XA^DFR:TOOLONGNAME.ZPL^FS^FO10,10^A0N,30,30^FN1^FS^XZ", "^XA^XFR:TOOLONGNAME.ZPL^FS^FN1^FDone^FS^XZ"].join(NL), 8);
    expect(long.batch).toBeUndefined();
    const trailing = importZplText([template("R:A.ZPL", FIELD), "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^XZ^  ", "^XA^XFR:A.ZPL^FS^FN1^FDtwo^FS^XZ"].join(NL), 8);
    expect(trailing.batch?.dataset.rows).toEqual([["one"], ["two"]]);
    for (const reset of ["^LT10", "^LRY", "^FWR", "^FWN,1", "^MUI", "^QQ1", "^CF0,40"]) {
      const r = importZplText([template("R:A.ZPL", FIELD), `^XA${reset}^XFR:A.ZPL^FS^FN1^FDone^FS^XZ`].join(NL), 8);
      expect(r.batch, reset).toBeUndefined();
    }
    // ZD230-measured: a state change behind the ^XF keeps the block a page, restored or not.
    for (const around of [["^MUM", "^MUD"], ["^LH40,60", "^LH0,0"], ["^CF0,90,90", "^CF0,30,30"], ["^FWR", "^FWN"], ["", "^BY5"]]) {
      const r = importZplText([template("R:A.ZPL", FIELD), `^XA${around[0]}^XFR:A.ZPL^FS^FN1^FDone^FS${around[1]}^XZ`].join(NL), 8);
      expect(r.batch, around.join(" ")).toBeUndefined();
    }
    // A ^CW alias the row points elsewhere prints another font under the same letter.
    const alias = importZplText(["^XA^CWZ,R:F1.FNT^DFR:A.ZPL^FS^FO10,10^AZN,30,30^FN1^FDx^FS^XZ", "^XA^CWZ,R:F1.FNT^XFR:A.ZPL^FS^FN1^FDone^FS^XZ", "^XA^CWZ,R:F2.FNT^XFR:A.ZPL^FS^FN1^FDtwo^FS^XZ"].join(NL), 8);
    expect(alias.batch?.dataset.rows).toEqual([["one"]]);
    // State the template left unset and the model carries as it is set: the row decides it and the design adopts it.
    for (const plain of ["^PQ1,0,2", "^FXrow one^FS", "^LS-5", "^PQ1,0,1,N,N", "^PQ1,2", "^MUD,300,300"]) {
      const r = importZplText([template("R:A.ZPL", FIELD), `^XA${plain}^XFR:A.ZPL^FS^FN1^FDone^FS^XZ`].join(NL), 8);
      expect(r.batch?.dataset.rows, plain).toEqual([["one"]]);
    }
    const many = importZplText([template("R:A.ZPL", "^FO10,10^A0N,30,30^FH^FN1^FS"), ...[1, 2, 3, 4, 5].map((i) => `^XA^XFR:A.ZPL^FS^FH^FN1^FDa_0d${i}^FS^XZ`)].join(NL), 8);
    expect(many.report.findings.filter((f) => f.kind === "hexControl")).toHaveLength(1);
  });

  it("keeps a row as a page when stream state between store and recall changes what the format prints", () => {
    const fields = "^FO10,10^A0N,30,30^FN1^FS^FO10,100^BCN,60,N,N,N^FN2^FS";
    for (const between of ["^XA^MUI^XZ", "^XA^BY6^FO10,200^BCN,60,N,N,N^FDother^FS^XZ"]) {
      const r = importZplText([template("R:A.ZPL", fields), between, "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^FN2^FD123^FS^XZ"].join(NL), 8);
      expect(r.batch, between).toBeUndefined();
      const props = (k: number) => r.pages[0]?.objects[k] as unknown as { props: Record<string, unknown> };
      expect(props(0).props.fontHeight).toBe(30);
      expect(props(1).props.height).toBe(60);
    }
    const same = importZplText([template("R:A.ZPL", fields), "^XA^BY2^FO10,200^BCN,60,N,N,N^FDother^FS^XZ", "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^FN2^FD123^FS^XZ"].join(NL), 8);
    expect(same.batch?.dataset.rows).toEqual([["one", "123"]]);
  });

  it("folds a rotated ^FO field whose model position depends on its data, and keeps a row's own control byte apart", () => {
    const rotated = importZplText(["^XA^DFR:A.ZPL^FS^FO100,100^A0I,30,30^FN1^FDx^FS^XZ", "^XA^XFR:A.ZPL^FS^FN1^FDlongervalue^FS^XZ"].join(NL), 8);
    expect(rotated.batch?.dataset.rows).toEqual([["longervalue"]]);
    const shifted = importZplText(["^XA^DFR:A.ZPL^FS^FO100,100^A0I,30,30^FN1^FDx^FS^XZ", "^XA^LH5,5^XFR:A.ZPL^FS^FN1^FDx^FS^XZ"].join(NL), 8);
    expect(shifted.batch).toBeUndefined();
    const hex = importZplText(["^XA^DFR:A.ZPL^FS^FO10,10^A0N,30,30^FH^FDab_0dcd^FS^FO10,60^A0N,30,30^FH^FN1^FS^XZ", "^XA^XFR:A.ZPL^FS^FH^FN1^FDef_0dgh^FS^XZ"].join(NL), 8);
    expect(hex.report.findings.filter((f) => f.kind === "hexControl")).toHaveLength(2);
    const declared = importZplText(["^XA^DFR:A.ZPL^FS^FH^FN1^FDtpl_0dz^FS^FO10,10^A0N,30,30^FH^FN1^FS^XZ", "^XA^XFR:A.ZPL^FS^FH^FN1^FDab_0dcd^FS^XZ"].join(NL), 8);
    expect(declared.report.findings.filter((f) => f.kind === "hexControl").map((f) => f.pageIndex)).toEqual([0]);
  });

  it("keeps a row as a page when it resets the label shift or changes document state the design carries", () => {
    const shift = importZplText(["^XA^LS50^DFR:A.ZPL^FS^FO10,10^A0N,30,30^FN1^FS^XZ", "^XA^LS50^XFR:A.ZPL^FS^FN1^FDa^FS^XZ", "^XA^LS0^XFR:A.ZPL^FS^FN1^FDb^FS^XZ"].join(NL), 8);
    expect(shift.batch?.dataset.rows).toEqual([["a"]]);
    expect(shift.pages).toHaveLength(2);
    const media = importZplText(["^XA^MMT^DFR:A.ZPL^FS^FO10,10^A0N,30,30^FN1^FS^XZ", "^XA^MMT^XFR:A.ZPL^FS^FN1^FDa^FS^XZ", "^XA^MMV^XFR:A.ZPL^FS^FN1^FDb^FS^XZ"].join(NL), 8);
    expect(media.batch?.dataset.rows).toEqual([["a"]]);
    // A value the template left unset is the rows' to set, as long as they agree.
    const adopted = importZplText([template("R:A.ZPL", FIELD), "^XA^MD30^XFR:A.ZPL^FS^FN1^FDa^FS^XZ", "^XA^MD30^XFR:A.ZPL^FS^FN1^FDb^FS^XZ", "^XA^MD10^XFR:A.ZPL^FS^FN1^FDc^FS^XZ"].join(NL), 8);
    expect(adopted.batch?.dataset.rows).toEqual([["a"], ["b"]]);
    expect(adopted.labelConfig.darkness).toBe(30);
    // A first row printing at the standing darkness decides it, so a later ^MD is a change.
    const standing = importZplText([template("R:A.ZPL", FIELD), "^XA^XFR:A.ZPL^FS^FN1^FDa^FS^XZ", "^XA^MD30^XFR:A.ZPL^FS^FN1^FDb^FS^XZ"].join(NL), 8);
    expect(standing.batch?.dataset.rows).toEqual([["a"]]);
    // A block that is no row decides nothing for the rows behind it, whichever check demoted it.
    const quantity = importZplText([template("R:A.ZPL", FIELD), "^XA^FO5,5^GB10,10,1^FS^MD10^XFR:A.ZPL^FS^FN1^FDa^FS^XZ", "^XA^MD30^XFR:A.ZPL^FS^FN1^FDb^FS^XZ", "^XA^MD30^XFR:A.ZPL^FS^FN1^FDc^FS^XZ"].join(NL), 8);
    expect(quantity.batch?.dataset.rows).toEqual([["b"], ["c"]]);
    const stray = importZplText([template("R:A.ZPL", FIELD), "^XA^MD10^XFR:A.ZPL^FS^FN1^FDa^FS^FN7^FDghost^FS^XZ", "^XA^MD30^XFR:A.ZPL^FS^FN1^FDb^FS^XZ", "^XA^MD30^XFR:A.ZPL^FS^FN1^FDc^FS^XZ"].join(NL), 8);
    expect(stray.batch?.dataset.rows).toEqual([["b"], ["c"]]);
    const behind = importZplText([template("R:A.ZPL", FIELD), "^XA^MD10^XFR:A.ZPL^FS^FN1^FDa^FS^XZ^FO200,200^A0N,20,20^FDstray^FS", "^XA^MD30^XFR:A.ZPL^FS^FN1^FDb^FS^XZ", "^XA^MD30^XFR:A.ZPL^FS^FN1^FDc^FS^XZ"].join(NL), 8);
    expect(behind.batch?.dataset.rows).toEqual([["b"], ["c"]]);
    // Every value the design carries counts, the label shift and the extra print speeds included.
    const inherited = importZplText(["^XA^LS50^DFR:A.ZPL^FS^FO10,10^A0N,30,30^FN1^FS^XZ", "^XA^LS50^XFR:A.ZPL^FS^FN1^FDa^FS^XZ", "^XA^LS0^XFR:A.ZPL^FS^FN1^FDb^FS^XZ", "^XA^XFR:A.ZPL^FS^FN1^FDc^FS^XZ"].join(NL), 8);
    expect(inherited.batch?.dataset.rows).toEqual([["a"]]);
    const slew = importZplText([template("R:A.ZPL", FIELD), "^XA^PR4,2^XFR:A.ZPL^FS^FN1^FDa^FS^XZ", "^XA^PR4,10^XFR:A.ZPL^FS^FN1^FDb^FS^XZ"].join(NL), 8);
    expect(slew.batch?.dataset.rows).toEqual([["a"]]);
    const unit = importZplText([template("R:A.ZPL", FIELD), "^XA^MUD^XFR:A.ZPL^FS^FN1^FDa^FS^XZ"].join(NL), 8);
    expect(unit.batch?.dataset.rows).toEqual([["a"]]);
    const charset = importZplText(["^XA^CI28^DFR:A.ZPL^FS^FO10,10^A0N,30,30^FN1^FS^XZ", "^XA^CI13^XFR:A.ZPL^FS^FN1^FDa^FS^XZ"].join(NL), 8);
    expect(charset.batch).toBeUndefined();
  });

  it("binds no column to another page's variable, even when every slot number is taken or a page follows the template", () => {
    const cover = `^XA${Array.from({ length: 99 }, (_, i) => `^FO5,${5 + i * 5}^A0N,20,20^FN${i + 1}^FDc${i + 1}^FS`).join("")}^XZ`;
    const exhausted = importZplText([cover, template("R:A.ZPL", "^FO10,500^A0N,30,30^FN1^FS"), "^XA^XFR:A.ZPL^FS^FN1^FDrowA^FS^XZ"].join(NL), 8);
    // With no column to carry it, the row stays a page with its own bytes.
    expect(exhausted.batch).toBeUndefined();
    expect(exhausted.pages).toHaveLength(3);
    expect(exhausted.pages[2]?.overlay).toBeDefined();
    const bare = importZplText([template("R:A.ZPL", "^FO10,10^A0N,30,30^FN1^FDx^FS^FN2^FS"), "^XA^XFR:A.ZPL^FS^FN1^FDa1^FS^FN2^FDa2^FS^XZ"].join(NL), 8);
    expect(bare.batch).toBeUndefined();
    expect(bare.pages).toHaveLength(2);
    expect(bare.variables.map((v) => v.defaultValue)).toEqual(expect.arrayContaining(["a2"]));
    const trailing = importZplText([template("R:A.ZPL", "^FO10,10^A0N,30,30^FN1^FS"), "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^XZ", "^XA^FO5,5^A0N,20,20^FN1^FDtail^FS^XZ"].join(NL), 8);
    expect(trailing.variables).toHaveLength(2);
    expect(trailing.variables.map((v) => v.defaultValue)).toEqual(expect.arrayContaining(["tail"]));
  });

  it("keeps a cover page's slot apart from the template's, so only the template binds to the rows", () => {
    const r = importZplText(["^XA^FO5,5^A0N,20,20^FN1^FDabc^FS^XZ", template("R:A.ZPL", "^FO10,10^A0N,30,30^FN1^FS"), "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^XZ"].join(NL), 8);
    expect(r.batch?.dataset.rows).toEqual([["one"]]);
    const bound = new Set(Object.keys(r.batch?.columnMapping.bindings ?? {}));
    const coverContent = (r.pages[0]?.objects[0] as unknown as { props: { content: string } }).props.content;
    const coverVariable = r.variables.find((v) => `«${v.name}»` === coverContent);
    expect(coverVariable && bound.has(coverVariable.id)).toBe(false);
    expect(coverVariable?.defaultValue).toBe("abc");
  });

  it("keeps a replayed control byte's finding to rows whose own bytes carry it", () => {
    const r = importZplText(["^XA^DFR:A.ZPL^FS^FO10,10^A0N,30,30^FH^FDx_0dy^FS^FO10,60^A0N,30,30^FN1^FS^XZ", "^XA^PQ5^XFR:A.ZPL^FS^FN1^FDv1^FS^XZ", "^XA^PQ5^XFR:A.ZPL^FS^FN1^FDv2^FS^XZ"].join(NL), 8);
    expect(r.report.findings.filter((f) => f.kind === "hexControl").map((f) => f.pageIndex)).toEqual([0]);
  });

  it("pairs a row's objects with the stored part of the template, behind what the block built before ^DF", () => {
    const r = importZplText(["^XA^ILR:LOGO.GRF^DFR:A.ZPL^FS^FO10,10^BXN,5,200,,,,_^FN1^FS^XZ", "^XA^XFR:A.ZPL^FS^FN1^FD_1010950110153001^FS^XZ"].join(NL), 8);
    expect(r.batch?.dataset.rows).toEqual([["010950110153001"]]);
    expect(r.pages[0]?.objects.map((o) => [o.type, (o as unknown as { props: { gs1?: boolean } }).props.gs1])).toEqual([["image", undefined], ["datamatrix", true]]);
  });

  it("keeps a row under another frame as a page, folds document state, restores a stray slot, and reports a device action once", () => {
    const inherited = importZplText([template("R:A.ZPL", FIELD), "^XA^XFR:A.ZPL^FS^FN1^FDbefore^FS^XZ", "^XA^LH20,20^XFR:A.ZPL^FS^FN1^FDshift^FS^XZ", "^XA^XFR:A.ZPL^FS^FN1^FDafter^FS^XZ"].join(NL), 8);
    expect(inherited.batch?.dataset.rows).toEqual([["before"]]);
    expect(inherited.pages).toHaveLength(3);
    const state = importZplText([template("R:A.ZPL", FIELD), "^XA^MD30^PR4^XFR:A.ZPL^FS^FN1^FDone^FS^XZ", "^XA^MD30^PR4^XFR:A.ZPL^FS^FN1^FDtwo^FS^XZ"].join(NL), 8);
    expect(state.batch?.dataset.rows).toEqual([["one"], ["two"]]);
    expect(state.labelConfig.darkness).toBe(30);
    expect(state.report.findings.filter((f) => f.kind === "partial")).toEqual([]);
    const restored = importZplText([template("R:A.ZPL", FIELD), "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^FN5^FDghost^FS^XZ"].join(NL), 8);
    expect(restored.variables.map((v) => [v.fnNumber, v.defaultValue])).toEqual(expect.arrayContaining([[5, "ghost"]]));
    const twice = importZplText([`${template("R:A.ZPL", FIELD)}~JA`, "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^XZ~JA", "^XA^XFR:A.ZPL^FS^FN1^FDtwo^FS^XZ~JA"].join(NL), 8);
    expect(twice.report.findings.filter((f) => f.kind === "deviceAction")).toHaveLength(1);
  });

  it("flags a ^XF path the printer could not read as partial, naming it, and never folds it", () => {
    for (const path of ["???", "R:TOOLONGNAME.ZPL"]) {
      const r = importZplText([template("R:A.ZPL", FIELD), `^XA^XF${path}^FS^FN1^FDone^FS^XZ`].join(NL), 8);
      expect(r.batch).toBeUndefined();
      expect(r.report.findings.some((f) => f.kind === "partial" && f.command === `^XF${path}`)).toBe(true);
    }
  });

  it("replays a template head with ^JM without a false partial, and keeps a folded row's own warnings", () => {
    const jm = importZplText(["^XA^JMA^DFR:A.ZPL^FS^FO10,10^A0N,30,30^FN1^FDx^FS^XZ", "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^XZ"].join(NL), 8);
    expect(jm.batch?.dataset.rows).toEqual([["one"]]);
    expect(jm.report.findings.filter((f) => f.kind === "partial")).toEqual([]);
    const tilde = importZplText([template("R:A.ZPL", FIELD), "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^XZ~JA", "^XA^XFR:A.ZPL^FS^FN1^FDtwo^FS^XZ"].join(NL), 8);
    expect(tilde.batch?.dataset.rows).toEqual([["one"], ["two"]]);
    expect(tilde.report.findings.filter((f) => f.kind === "deviceAction").map((f) => [f.command, f.pageIndex])).toEqual([["~JA", 0]]);
  });

  it("names a ^XF a stored format carries once, even when rows fold into that format", () => {
    const r = importZplText([template("R:LOGO.ZPL", "^FO5,5^A0N,20,20^FDLOGO^FS"), "^XA^DFR:A.ZPL^FS^XFR:LOGO.ZPL^FS^FO10,10^A0N,30,30^FDhello^FS^XZ"].join(NL), 8);
    expect(r.report.findings.filter((f) => f.kind === "partial").map((f) => [f.command, f.pageIndex, f.loss])).toEqual([["^XFR:LOGO.ZPL", 1, undefined]]);
    const rows = importZplText([template("R:LOGO.ZPL", "^FO5,5^A0N,20,20^FDLOGO^FS"), `^XA^DFR:A.ZPL^FS^XFR:LOGO.ZPL^FS${FIELD}^XZ`, "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^XZ"].join(NL), 8);
    expect(rows.batch?.dataset.rows).toEqual([["one"]]);
    expect(rows.report.findings.filter((f) => f.command === "^XFR:LOGO.ZPL")).toHaveLength(1);
  });

  it("replays only what follows ^DF, so a row's own geometry stands as its own page and diverges visibly", () => {
    const r = importZplText(["^XA^PW400^LL300^DFR:A.ZPL^FS^FO10,10^A0N,30,30^FN1^FDd^FS^XZ", "^XA^PW800^LL900^XFR:A.ZPL^FS^FN1^FDone^FS^XZ"].join(NL), 8);
    expect(r.batch).toBeUndefined();
    expect(r.pages).toHaveLength(2);
    expect(r.mixedPageGeometry).toBe(true);
    expect(r.report.findings.some((f) => f.kind === "mixedPageGeometry" && f.cause === "size")).toBe(true);
  });

  it("keeps a ^GS symbol slot a slot on export, so every row prints its own symbol", () => {
    const r = importZplText([template("R:A.ZPL", "^FO10,10^GSN,30,30^FN1^FDA^FS"), "^XA^XFR:A.ZPL^FS^FN1^FDB^FS^XZ", "^XA^XFR:A.ZPL^FS^FN1^FDC^FS^XZ"].join(NL), 8);
    expect(r.batch?.dataset.rows).toEqual([["B"], ["C"]]);
    const page = r.pages[0];
    const zpl = generateBatchZpl({ ...r.labelConfig, storedFormatPath: "R:A.ZPL" } as PageLabel, page?.objects ?? [], r.variables, r.batch?.dataset ?? { headers: [], rows: [] }, r.batch?.columnMapping ?? { bindings: {} });
    expect(zpl).toContain("^GSN,30,30^FN1^FS");
    expect(zpl).toContain("^FN1^FDB^FS");
    expect(zpl).toContain("^FN1^FDC^FS");
    expect(zpl).not.toContain("^FDA");
    // The template keeps its own symbol for the default print. The rows differ by design.
    expect((page?.objects[0] as { props: { symbol: string } } | undefined)?.props.symbol).toBe("A");
    expect(r.variables[0]?.defaultValue).toBe("A");
    expect(r.report.findings.some((f) => f.loss === "recallSettings")).toBe(false);
  });

  it("hands the rows to a source apply along with the mapping", () => {
    const zpl = generateBatchZpl({ ...label, storedFormatPath: "R:JOB.ZPL" } as PageLabel, objects, variables, dataset, mapping);
    const current: SourceDocumentState = { label, pages: [{ objects: [] }], variables: [], printerProfile: {}, columnMapping: null };
    const plan = prepareSourceApply({ text: zpl, baseline: "", current });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.batch?.dataset.rows).toEqual(dataset.rows);
    expect(plan.next.columnMapping).toEqual(plan.batch?.columnMapping);
    expect(plan.next.pages).toHaveLength(1);
  });
});

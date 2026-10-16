import { describe, it, expect } from "vitest";
import { generateBatchZpl, generateMultiPageZPL } from "./zplGenerator";
import { parseDesignFile, serializeDesign } from "./designFile";
import { importZplText } from "./zplImportService";
import { dropPageOverlays } from "./pageOverlay";
import type { LabelConfig } from "../types/LabelConfig";
import { pageLabelConfig, type Page } from "../types/Group";

const label: LabelConfig = { widthMm: 50, heightMm: 30, dpmm: 8 };

describe("host commands on a page", () => {
  it("ask an immediate command ahead of the format and a format command right after ^XA, ahead of a ^DF that would store it", () => {
    const out = generateMultiPageZPL(label, [{ objects: [], jmDensity: "B", storedFormatPath: "R:A.ZPL", hostCommands: ["~HS", "^HWR:*.*"] }], []);
    expect(out).toContain("~HS");
    expect(out.indexOf("~HS")).toBeLessThan(out.indexOf("^XA"));
    expect(out.indexOf("^XA")).toBeLessThan(out.indexOf("^HWR:*.*"));
    expect(out.indexOf("^HWR:*.*")).toBeLessThan(out.indexOf("^DFR:A.ZPL"));
    expect(out.indexOf("^DFR:A.ZPL")).toBeLessThan(out.indexOf("^JMB"));
  });

  it("enter the model in canonical spelling once the ^CC or ^CD that spelled them is gone", () => {
    const r = importZplText("^XA^CC/^FO20,40/GB50,50,2/GB60,60,2/FS/HWR:*.*/XZ", 8);
    expect(r.pages[0]?.overlay).toBeUndefined();
    expect(r.pages[0]?.hostCommands).toEqual(["^HWR:*.*"]);
    const delim = importZplText("^XA^CD;^FO20;40^GB50;50;2^GB60;60;2^FS^HV1;20;H;E;F^XZ", 8);
    expect(delim.pages[0]?.hostCommands).toEqual(["^HV1,20,H,E,F"]);
  });

  it("stay ahead of a ^DF set after the import, so the stored format never asks", () => {
    const r = importZplText("^XA~HS^FO10,10^A0N,20,20^FDx^FS^XZ", 8);
    const page = { ...(r.pages[0] as Page), storedFormatPath: "R:A.ZPL" };
    const out = generateMultiPageZPL(r.labelConfig as LabelConfig, [page], r.variables);
    expect(out.indexOf("~HS")).toBeLessThan(out.indexOf("^DFR:A.ZPL"));
    expect(out.split("~HS")).toHaveLength(2);
  });

  it("regenerate a replayed block whose later question a ^DF set after the import would store", () => {
    const late = importZplText("^XA^FO10,10^A0N,20,20^FDx^FS^HWR:*.*^XZ", 8);
    const lateOut = generateMultiPageZPL(late.labelConfig as LabelConfig, [{ ...(late.pages[0] as Page), storedFormatPath: "R:A.ZPL" }], late.variables);
    expect(lateOut.indexOf("^HWR:*.*")).toBeLessThan(lateOut.indexOf("^DFR:A.ZPL"));
    expect(lateOut.split("^HWR:*.*")).toHaveLength(2);
    const led = importZplText("^XA^HV1,20,H,E,F~HS^FO10,10^A0N,20,20^FDx^FS^XZ", 8);
    const ledOut = generateMultiPageZPL(led.labelConfig as LabelConfig, [{ ...(led.pages[0] as Page), storedFormatPath: "R:A.ZPL" }], led.variables);
    expect(ledOut.indexOf("~HS")).toBeLessThan(ledOut.indexOf("^DFR:A.ZPL"));
    expect(ledOut.indexOf("^DFR:A.ZPL")).toBeLessThan(ledOut.indexOf("^HV1,20,H,E,F"));
  });

  it("let a ^DF set after the import land ahead of a ^HV the block asks first, so the frame keeps it", () => {
    const r = importZplText("^XA^HV1,20,H,E,F^FO10,10^A0N,20,20^FDx^FS^XZ", 8);
    const out = generateMultiPageZPL(r.labelConfig as LabelConfig, [{ ...(r.pages[0] as Page), storedFormatPath: "R:A.ZPL" }], r.variables);
    expect(out).toContain("^XA^DFR:A.ZPL^HV1,20,H,E,F^FO10,10");
  });

  it("report a format command ahead of the first ^XA as dropped, and keep an immediate one there", () => {
    const r = importZplText("^HWR:*.*^XA^FO10,10^A0N,20,20^FDx^FS^XZ", 8);
    expect(r.pages[0]?.hostCommands).toBeUndefined();
    expect(r.report.hostQuery).toEqual([]);
    expect(r.report.findings).toContainEqual(expect.objectContaining({ kind: "partial", command: "^HW", loss: "droppedHostCommand" }));
    expect(importZplText("~HS^XA^FO10,10^A0N,20,20^FDx^FS^XZ", 8).pages[0]?.hostCommands).toEqual(["~HS"]);
  });

  it("report a format command behind the block's own ^DF as dropped, since only the frame would ask it", () => {
    const behind = importZplText("^XA^DFR:A.ZPL^FS^FO10,10^A0N,20,20^FDx^FS^HWR:*.*^XZ", 8);
    expect(behind.pages[0]?.hostCommands).toBeUndefined();
    expect(behind.report.findings).toContainEqual(expect.objectContaining({ kind: "partial", command: "^HW", loss: "droppedHostCommand" }));
    expect(importZplText("^XA^HWR:*.*^DFR:A.ZPL^FS^FO10,10^A0N,20,20^FDx^FS^XZ", 8).pages[0]?.hostCommands).toEqual(["^HWR:*.*"]);
    const wrapped = importZplText("^XA^HWR:\n*.*^FO10,10^A0N,20,20^FDx^FS^XZ", 8);
    expect(wrapped.pages[0]?.hostCommands).toBeUndefined();
    expect(wrapped.report.findings).toContainEqual(expect.objectContaining({ kind: "partial", command: "^HW", loss: "droppedHostCommand" }));
  });

  it("are dropped by the design file unless they are canonical host command lines", () => {
    const lines = ["^XZ^XA^FO0,0^GB10,10,1^FS", "hello", "~HS^XZ^XA^MCY^JUF", "~HS~HS", " ~HS", "~HS\u0000", "~hs", "^HW R:*.*", "~HS", "^HWR:*.*", "~HQES", "^HV1,20,H,E,F"];
    const json = serializeDesign(label, [{ objects: [], hostCommands: lines }], []);
    const loaded = parseDesignFile(json);
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.value.pages[0]?.hostCommands).toEqual(["~HS", "^HWR:*.*", "~HQES", "^HV1,20,H,E,F"]);
  });

  it("come out once, whether the overlay replays them or the model regenerates them", () => {
    const r = importZplText("^XA~HS^FO10,10^A0N,20,20^FDx^FS^XZ", 8);
    const count = (text: string) => text.split("~HS").length - 1;
    expect(count(generateMultiPageZPL(r.labelConfig as LabelConfig, r.pages, r.variables))).toBe(1);
    // Appending to an open design drops the overlays, as the store does.
    expect(count(generateMultiPageZPL(r.labelConfig as LabelConfig, dropPageOverlays(r.pages), r.variables))).toBe(1);
  });

  it("replay a bare immediate command as it came, with no format around it", () => {
    const r = importZplText("~HS", 8);
    expect(r.pages[0]?.hostCommands).toEqual(["~HS"]);
    expect(generateMultiPageZPL(r.labelConfig as LabelConfig, r.pages, r.variables)).toBe("~HS");
  });

  it("keep ^HV's trailing space through the import and the regenerated block", () => {
    const r = importZplText("^XA^FO10,10^A0N,20,20^FN1^FS^HV1,20,HEADER ^XZ", 8);
    expect(r.pages[0]?.hostCommands).toEqual(["^HV1,20,HEADER "]);
    expect(generateMultiPageZPL(r.labelConfig as LabelConfig, dropPageOverlays(r.pages), r.variables)).toContain("^HV1,20,HEADER \n^XZ");
  });

  it("keep ^HV with the fields it reads, in the block and in the stored frame", () => {
    const out = generateMultiPageZPL(label, [{ objects: [], hostCommands: ["~HS", "^HV1,20,H,E,F"] }], []);
    expect(out).toContain("~HS");
    expect(out.indexOf("~HS")).toBeLessThan(out.indexOf("^PW"));
    expect(out.indexOf("^HV1,20,H,E,F")).toBeGreaterThan(out.indexOf("^CI28"));
    expect(out.indexOf("^HV1,20,H,E,F")).toBeLessThan(out.indexOf("^XZ"));
    const r = importZplText(["^XA^DFR:A.ZPL^FS^FO20,20^A0N,20,20^FN1^FS^HV1,20,H,E,F~HS^XZ", "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^XZ"].join(String.fromCharCode(10)), 8);
    const page = r.pages[0] as Page;
    const batch = generateBatchZpl(pageLabelConfig(label, page), page.objects, r.variables, r.batch!.dataset, r.batch!.columnMapping);
    const frameEnd = batch.indexOf("^XZ" + String.fromCharCode(10)) + 4;
    const [frame, recall] = [batch.slice(0, frameEnd), batch.slice(frameEnd)];
    expect(frame).toContain("^HV1,20,H,E,F");
    expect(frame).not.toContain("~HS");
    expect(recall).toContain("~HS");
    expect(recall.indexOf("~HS")).toBeLessThan(recall.indexOf("^XA"));
    expect(recall).not.toContain("^HV");
  });

  it.each([
    ["~HB", ""], ["~HD", ""], ["^HF", "R:FMT.ZPL"], ["^HG", "R:LOGO.GRF"], ["^HH", ""], ["~HI", ""], ["~HM", ""], ["~HQ", "ES"],
    ["~HS", ""], ["^HT", ""], ["~HU", ""], ["^HV", "1,20,H,E,F"], ["^HW", "R:*.*"], ["^HY", "E:LOGO.PNG"], ["^HZ", "O"],
  ])("%s%s is reported, kept in the model and placed by its kind", (id, payload) => {
    const r = importZplText(`^XA${id}${payload}^FO20,40^GB50,50,2^GB60,60,2^FS^XZ`, 8);
    expect(r.pages[0]?.overlay).toBeUndefined();
    expect(r.report.hostQuery).toEqual([`${id}${payload}`]);
    expect(r.pages[0]?.hostCommands).toEqual([`${id}${payload}`]);
    const out = generateMultiPageZPL(r.labelConfig as LabelConfig, r.pages, r.variables);
    expect(out.split(`${id}${payload}`)).toHaveLength(2);
    if (id === "^HV") expect(out.indexOf(id)).toBeGreaterThan(out.indexOf("^CI28"));
    else expect(out.indexOf(id)).toBeLessThan(out.indexOf("^PW"));
  });

  it("report a ^HW whose remapped delimiter is its path's own colon, and spell a remapped semicolon back", () => {
    const colon = importZplText("^XA^CD:^FO20:40^GB50:50:2^GB60:60:2^FS^HWR:*.*^XZ", 8);
    expect(colon.pages[0]?.hostCommands).toBeUndefined();
    expect(colon.report.findings).toContainEqual(expect.objectContaining({ kind: "partial", command: "^HW", loss: "droppedHostCommand" }));
    const semicolon = importZplText("^XA^CD;^FO20;40^GB50;50;2^GB60;60;2^FS^HWR:*.*;B^XZ", 8);
    expect(semicolon.pages[0]?.hostCommands).toEqual(["^HWR:*.*,B"]);
  });

  it("rename a ^HV whose slot moved", () => {
    const NL = String.fromCharCode(10);
    const moved = importZplText(["^XA^FO10,10^A0N,20,20^FN1^FDa^FS^XZ", "^XA^FO10,10^A0N,20,20^FN1^FDb^FS^HV1,20,H,E,F^XZ"].join(NL), 8);
    expect(moved.report.findings.some((f) => f.kind === "fnRenumbered")).toBe(true);
    expect(moved.pages[1]?.hostCommands).toEqual(["^HV2,20,H,E,F"]);
  });

  it("report a ^HV whose remapped list holds a literal comma as dropped, and keep it only while its overlay replays it", () => {
    const replayed = importZplText("^XA^CD;^FO20;40^A0N;20;20^FDx^FS^HV1;20;A,B;END;F^XZ", 8);
    expect(replayed.pages[0]?.overlay).toBeDefined();
    expect(replayed.pages[0]?.hostCommands).toBeUndefined();
    expect(generateMultiPageZPL(replayed.labelConfig as LabelConfig, replayed.pages, replayed.variables)).toContain("^HV1;20;A,B;END;F");
    const dropped = importZplText("^XA^CD;^FO20;40^GB50;50;2^GB60;60;2^FS^HV1;20;A,B;END;F^XZ", 8);
    expect(dropped.pages[0]?.overlay).toBeUndefined();
    expect(generateMultiPageZPL(dropped.labelConfig as LabelConfig, dropped.pages, dropped.variables)).not.toContain("^HV");
    expect(dropped.report.hostQuery).toEqual([]);
    expect(dropped.report.findings).toContainEqual(expect.objectContaining({ kind: "partial", command: "^HV", loss: "droppedHostCommand" }));
  });

  it("keep ^HV on every recall of a frame this app never stored, and ask the immediate question once in either case", () => {
    const r = importZplText(["^XA^DFR:A.ZPL^FS^FO20,20^A0N,20,20^FN1^FS^HV1,20,H,E,F~HS^XZ", "^XA^XFR:A.ZPL^FS^FN1^FDone^FS^XZ", "^XA^XFR:A.ZPL^FS^FN1^FDtwo^FS^XZ"].join(String.fromCharCode(10)), 8);
    const page = r.pages[0] as Page;
    const blocks = (delivery: "setup" | "printer") =>
      generateBatchZpl(pageLabelConfig(label, { ...page, storedFormatDelivery: delivery }), page.objects, r.variables, r.batch!.dataset, r.batch!.columnMapping).split("^XZ" + String.fromCharCode(10) + "^XA");
    const held = blocks("printer");
    expect(held).toHaveLength(2);
    expect(held.map((b) => b.includes("^HV1,20,H,E,F"))).toEqual([true, true]);
    expect(held.map((b) => b.includes("~HS"))).toEqual([true, false]);
    const [first] = held;
    if (first === undefined) throw new Error("two blocks");
    expect(first.indexOf("^FDone")).toBeLessThan(first.indexOf("^HV1,20,H,E,F"));
    const stored = blocks("setup");
    expect(stored.map((b) => b.includes("^HV"))).toEqual([false, false]);
    expect(stored.map((b) => b.includes("~HS"))).toEqual([true, false]);
    const doc = generateMultiPageZPL(label, [{ ...page, storedFormatDelivery: "printer" }], r.variables);
    expect(doc.indexOf("^XFR:A.ZPL")).toBeLessThan(doc.indexOf("^HV1,20,H,E,F"));
    expect(doc.split("^HV")).toHaveLength(2);
  });

  it("stay ahead of a ^DF when the block's tilde was remapped", () => {
    const r = importZplText("^XA^CT#^XZ" + String.fromCharCode(10) + "^XA#HS^FO10,10^A0N,20,20^FDx^FS^XZ", 8);
    const page = { ...(r.pages[1] as Page), storedFormatPath: "R:A.ZPL" };
    const out = generateMultiPageZPL(r.labelConfig as LabelConfig, [page], r.variables);
    expect(out.indexOf("#HS")).toBeLessThan(out.indexOf("^DFR:A.ZPL"));
  });
});

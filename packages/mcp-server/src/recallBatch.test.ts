import { describe, it, expect } from "vitest";
import { exportZpl, importZpl, validateZpl } from "./tools";

const NL = String.fromCharCode(10);
const stream = [
  "^XA^DFE:JOB.ZPL^FS^FO10,10^A0N,30,30^FN1^FS^FO10,60^BY2^BCN,60,N,N,N^FN2^FS^XZ",
  "^XA^XFE:JOB.ZPL^FS^FN1^FDone^FS^FN2^FDA1B^FS^XZ",
  "^XA^XFE:JOB.ZPL^FS^FN1^FDtwo^FS^FN2^FD^FS^XZ",
].join(NL);

describe("recall blocks travel through the tools as batch rows", () => {
  it("import hands back rows and a mapping that export turns into recall blocks again", () => {
    const imported = importZpl(stream, 8);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.batch).toEqual({ headers: ["field_1", "field_2"], rows: [["one", "A1B"], ["two", ""]], formatPath: "E:JOB.ZPL" });
    expect(imported.designFile.pages).toHaveLength(1);
    const exported = exportZpl(imported.designFile, { batch: imported.batch });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.zpl.match(/\^XFE:JOB\.ZPL/g)).toHaveLength(2);
    expect(exported.zpl).toContain("^FN2^FDA1B^FS");
  });

  it("refuses a batch with ragged rows, no mapping, or headers that bind nothing", () => {
    const imported = importZpl(stream, 8);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(exportZpl(imported.designFile, { batch: { headers: imported.batch?.headers ?? [], rows: [["only-one"]] } }).ok).toBe(false);
    const unbound = exportZpl({ ...imported.designFile, csvMapping: undefined }, { batch: imported.batch });
    expect(unbound.ok).toBe(false);
    const foreign = exportZpl(imported.designFile, { batch: { headers: ["other"], rows: [["x"]] } });
    expect(foreign.ok).toBe(false);
  });

  it("recalls the stored page even when the stream put a cover page first", () => {
    const withCover = ["^XA^FO5,5^A0N,20,20^FN1^FDabc^FS^XZ", stream].join(NL);
    const imported = importZpl(withCover, 8);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.designFile.pages).toHaveLength(2);
    const exported = exportZpl(imported.designFile, { batch: imported.batch });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.zpl).toContain("^DFE:JOB.ZPL");
    expect(exported.zpl).not.toContain("abc");
    expect(exported.zpl).toContain("^FDtwo^FS");
    expect(exported.notes?.some((n) => n.includes("page 2 of 2"))).toBe(true);
  });

  it("recalls the page the batch names when the stream stores another format too", () => {
    const two = ["^XA^DFE:A.ZPL^FS^FO10,10^A0N,30,30^FN1^FS^XZ", "^XA^DFE:B.ZPL^FS^FO10,10^A0N,30,30^FN1^FS^XZ", "^XA^XFE:A.ZPL^FS^FN1^FDq^FS^XZ"].join(NL);
    const imported = importZpl(two, 8);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.batch?.formatPath).toBe("E:A.ZPL");
    const exported = exportZpl(imported.designFile, { batch: imported.batch });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.zpl).toContain("^DFE:A.ZPL");
    expect(exported.zpl).not.toContain("^DFE:B.ZPL");
  });

  it("refuses a batch with no rows or a formatPath that names nothing, and resolves a bare name like ^XF", () => {
    const two = ["^XA^DFE:A.ZPL^FS^FO10,10^A0N,30,30^FN1^FS^XZ", "^XA^DFE:B.ZPL^FS^FO10,10^A0N,30,30^FN1^FS^XZ", "^XA^XFE:A.ZPL^FS^FN1^FDq^FS^XZ"].join(NL);
    const imported = importZpl(two, 8);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.batch && exportZpl(imported.designFile, { batch: { ...imported.batch, rows: [] } }).ok).toBe(false);
    expect(imported.batch && exportZpl(imported.designFile, { batch: { ...imported.batch, formatPath: "R:NOPE.ZPL" } }).ok).toBe(false);
    expect(imported.batch && exportZpl(imported.designFile, { batch: { ...imported.batch, formatPath: "A" } }).ok).toBe(true);
    expect(imported.batch && exportZpl(imported.designFile, { batch: { ...imported.batch, formatPath: "R:" } }).ok).toBe(false);
    expect(imported.batch && exportZpl(imported.designFile, { batch: { ...imported.batch, formatPath: "E:A.GRF" } }).ok).toBe(false);
    const unnamed = imported.batch && exportZpl(imported.designFile, { batch: { headers: imported.batch.headers, rows: imported.batch.rows } });
    expect(unnamed && unnamed.ok).toBe(false);
  });

  it("validate reports the rows without building a draft", () => {
    const validated = validateZpl(stream, 8);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.batch).toEqual({ headers: ["field_1", "field_2"], rowCount: 2 });
    expect(validated.pageCount).toBe(1);
  });
});

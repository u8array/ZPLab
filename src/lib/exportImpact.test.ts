import { describe, it, expect } from "vitest";
import { exportPrinterImpact, printerImpactNotices } from "./exportImpact";
import en from "../locales/en";

describe("exportPrinterImpact", () => {
  it("reports setup and device-action commands in their source form, deduped", () => {
    const zpl = "^XA^JUS^ST10^FO10,10^A0N,30,30^FDX^FS^XZ\n^XA^JUS~JA^XZ";
    const impact = exportPrinterImpact(zpl);
    expect(impact.setup).toContain("^JU");
    expect(impact.setup).toContain("^ST");
    expect(impact.setup.filter((c) => c === "^JU")).toHaveLength(1);
    expect(impact.actions).toContain("~JA");
  });

  it("lists a command once across a mid-stream prefix remap", () => {
    const impact = exportPrinterImpact("^XA^ST10^CC//ST11/XZ");
    expect(impact.setup.filter((c) => c.endsWith("ST"))).toHaveLength(1);
  });

  it("is empty for a plain design export", () => {
    const impact = exportPrinterImpact("^XA^FO10,10^A0N,30,30^FDX^FS^XZ");
    expect(impact).toEqual({ setup: [], actions: [], stores: [], printsNothing: false });
  });

  it("says what a ^DF job stores, and whether anything prints", () => {
    const only = exportPrinterImpact("^XA^DFE:JOB.ZPL^FO10,10^A0N,30,30^FDX^FS^XZ");
    expect(only).toMatchObject({ stores: ["E:JOB.ZPL"], printsNothing: true });
    expect(printerImpactNotices(only, en)).toEqual(["Sending this code stores the format as E:JOB.ZPL and prints nothing."]);
    const batch = exportPrinterImpact("^XA^DFE:JOB.ZPL^FO10,10^A0N,30,30^FN1^FDX^FS^XZ\n^XA^XFE:JOB.ZPL^FN1^FDA^FS^XZ");
    expect(batch).toMatchObject({ stores: ["E:JOB.ZPL"], printsNothing: false });
    expect(printerImpactNotices(batch, en)).toEqual(["Sending this code also stores the format as E:JOB.ZPL."]);
    const mixed = exportPrinterImpact("^XA^DFE:A.ZPL^FO1,1^FDx^FS^XZ\n^XA^DFLBL.ZPL^FO1,1^FDy^FS^XZ\n^XA^FO1,1^FDz^FS^XZ");
    expect(mixed).toMatchObject({ stores: ["E:A.ZPL", "R:LBL.ZPL"], printsNothing: false });
  });
});

import { describe, it, expect } from "vitest";
import { exportPrinterImpact } from "./exportImpact";

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
    expect(impact).toEqual({ setup: [], actions: [] });
  });
});

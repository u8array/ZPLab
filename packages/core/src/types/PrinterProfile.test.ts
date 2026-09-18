import { describe, it, expect } from "vitest";
import { countChangedProfileSettings, printerProfileSchema, repairPrinterProfile } from "./PrinterProfile";

describe("countChangedProfileSettings", () => {
  it("counts settings that differ by value and leaves the upload lists to their own counter", () => {
    expect(countChangedProfileSettings({}, { printerName: "P1" })).toBe(1);
    expect(countChangedProfileSettings({ printerName: "P1" }, { printerName: "P1" })).toBe(0);
    expect(countChangedProfileSettings({ modeProtection: ["D"] }, { modeProtection: ["D"] })).toBe(0);
    expect(countChangedProfileSettings({ modeProtection: ["D"] }, { modeProtection: ["D", "C"] })).toBe(1);
    expect(countChangedProfileSettings({}, { setupFonts: [{ path: "E:A.TTF" }], printerName: "P1" })).toBe(1);
  });
});

describe("repairPrinterProfile", () => {
  it("drops the key a cross-field rule names, even when the rule reports the absent side", () => {
    expect(repairPrinterProfile({ clockMode: "TOL" })).toEqual({});
    expect(repairPrinterProfile({ clockMode: "S", clockTolerance: 30, printerName: "P1" })).toEqual({ clockMode: "S", printerName: "P1" });
  });

  it("lets the patched maintenance type win over the one it pairs with", () => {
    const repaired = repairPrinterProfile(
      { maintenanceAlert: { type: "R", print: "Y", threshold: 200, frequency: 100, units: "C" }, maintenanceMessage: { type: "C", text: "Clean me" } },
      { maintenanceAlert: { type: "R", print: "Y", threshold: 200, frequency: 100, units: "C" } },
    );
    expect(printerProfileSchema.safeParse(repaired).success).toBe(true);
    expect(repaired.maintenanceMessage?.type).toBe("R");
  });
});

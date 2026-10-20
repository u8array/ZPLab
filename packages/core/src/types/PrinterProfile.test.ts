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

describe("setupFonts download", () => {
  it("accepts only the shapes the parser rebuilds", () => {
    const ok = (download: string) => printerProfileSchema.safeParse({ setupFonts: [{ path: "R:X.FNT", download }] }).success;
    expect(ok("~DSR:X.FNT,4,01020304")).toBe(true);
    expect(ok("~DYR:X.FNT,A,B,4,,01020304")).toBe(true);
    expect(ok("~DBR:T8.FNT,N,5,24,3,10,2,ZEBRA 1992,\n#0025.\nOOFF\r\nFF00")).toBe(true);
    for (const bad of [
      "~DSR:X.FNT,4,0102\n0304",
      "~DSR:X.FNT,4,01020304^XZ",
      "~DSR:X.FNT,4,01020304~JA",
      "~DSR:X.FNT,4,01020304\n! U1 setvar \"a\" \"b\"",
      "~DSR:X.FNT,4,01020304\n{}{\"a\":1}",
      "~DYR:X.FNT,B,T,4,,01020304",
      "~DYR:X.GRF,A,G,4,1,00FFFF00",
      "~DBR:T8.FNT,N,5,24,3,10,2,C,\n#0025.\n00FF\x1b",
      "^DSR:X.FNT,4,01020304",
      "~JAR:X",
    ]) expect(ok(bad), bad).toBe(false);
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

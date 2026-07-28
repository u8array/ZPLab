import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  generateSetupScript,
  SETUP_SCRIPT_FIELDS,
  __SETUP_SCRIPT_EMITTERS_FOR_TESTS,
} from "./zplSetupScript";
import { parseZPL } from "@zplab/core/lib/zplParser";
import {
  MAINTENANCE_ALERT_DEFAULTS,
  MAINTENANCE_DISTANCE_MAX_BY_TYPE,
  printerProfileSchema,
  type PrinterProfile,
} from "@zplab/core/types/PrinterProfile";

const base: PrinterProfile = {};

describe("generateSetupScript — output shape", () => {
  it("returns empty string when no Setup-Script field is set", () => {
    expect(generateSetupScript(base)).toBe("");
  });

  it("emits tilde-prefix commands standalone (no wrapper block) with 3-digit ~TA padding", () => {
    // ~TA requires 3-digit magnitude per spec; firmware silently
    // ignores shorter forms ("~TA10" is dropped, "~TA010" is honored).
    const script = generateSetupScript({ ...base, tearOffAdjust: 10 });
    expect(script).toBe("~TA010");
  });

  it("pads ~TA magnitude with the sign outside the 3-digit field", () => {
    expect(generateSetupScript({ ...base, tearOffAdjust: 5 })).toBe("~TA005");
    expect(generateSetupScript({ ...base, tearOffAdjust: -5 })).toBe("~TA-005");
    expect(generateSetupScript({ ...base, tearOffAdjust: 120 })).toBe("~TA120");
    expect(generateSetupScript({ ...base, tearOffAdjust: -120 })).toBe("~TA-120");
    expect(generateSetupScript({ ...base, tearOffAdjust: 0 })).toBe("~TA000");
  });

  it("wraps caret-prefix commands in a ^XA...^XZ block", () => {
    const script = generateSetupScript({ ...base, reprintAfterError: "N" });
    expect(script).toBe("^XA\n^JZN\n^XZ");
  });

  it("combines tilde lines above the caret block", () => {
    const script = generateSetupScript({
      ...base,
      tearOffAdjust: -5,
      reprintAfterError: "Y",
      headTestInterval: 100,
    });
    expect(script).toBe("~TA-005\n^XA\n^JZY\n^JT100\n^XZ");
  });

  it("omits the wrapper block when only tilde commands are set", () => {
    const script = generateSetupScript({ ...base, tearOffAdjust: 0 });
    expect(script).not.toContain("^XA");
    expect(script).not.toContain("^XZ");
  });

  it("emits ^ST with the six positional params in MM,DD,YYYY,HH,MM,SS order", () => {
    const script = generateSetupScript({
      ...base,
      setRealtimeClock: "2026-05-29T18:30:00",
    });
    expect(script).toBe("^XA\n^ST05,29,2026,18,30,00\n^XZ");
  });

  it("defaults ^ST seconds to 00 when datetime-local omits them", () => {
    const script = generateSetupScript({
      ...base,
      setRealtimeClock: "2026-05-29T18:30",
    });
    expect(script).toContain("^ST05,29,2026,18,30,00");
  });

  it("skips ^ST emit silently when the value is unparsable", () => {
    const script = generateSetupScript({
      ...base,
      setRealtimeClock: "not-a-datetime",
    });
    expect(script).toBe("");
  });

  describe("^ST live mode (useCurrentTimeForClock)", () => {
    beforeEach(() => {
      // Local fields: May 30 2026 18:30:45 in whatever TZ the host
      // is in; toLocalIsoString reads getFullYear/etc, so the
      // assertion is TZ-independent.
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 4, 30, 18, 30, 45));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("emits ^ST with the current wall-clock time when live mode is on", () => {
      const script = generateSetupScript({ ...base, useCurrentTimeForClock: true });
      expect(script).toBe("^XA\n^ST05,30,2026,18,30,45\n^XZ");
    });

    it("live mode wins over a stored static value", () => {
      const script = generateSetupScript({
        ...base,
        useCurrentTimeForClock: true,
        setRealtimeClock: "2020-01-01T00:00:00",
      });
      expect(script).toBe("^XA\n^ST05,30,2026,18,30,45\n^XZ");
    });

    it("falls back to the static value when live mode is off", () => {
      const script = generateSetupScript({
        ...base,
        useCurrentTimeForClock: false,
        setRealtimeClock: "2020-01-01T00:00:00",
      });
      expect(script).toBe("^XA\n^ST01,01,2020,00,00,00\n^XZ");
    });
  });

  it("emits ^KD with the selected clock-format code", () => {
    const script = generateSetupScript({ ...base, clockFormat: "2" });
    expect(script).toBe("^XA\n^KD2\n^XZ");
  });

  it("round-trips ^ST + ^KD via the parser without loss", () => {
    const orig: PrinterProfile = {
      ...base,
      setRealtimeClock: "2026-05-29T18:30:45",
      clockFormat: "3",
    };
    const { printerProfile: parsed } = parseZPL(generateSetupScript(orig));
    expect(parsed.setRealtimeClock).toBe("2026-05-29T18:30:45");
    expect(parsed.clockFormat).toBe("3");
  });

  it("rejects ^KD with an unknown format code", () => {
    expect(parseZPL("^XA^KD9^XZ").printerProfile.clockFormat).toBeUndefined();
  });

  it("rejects ^ST with malformed positional params", () => {
    expect(parseZPL("^XA^ST05,29,26,18,30,00^XZ").printerProfile.setRealtimeClock).toBeUndefined();
    expect(parseZPL("^XA^ST05,29,2026,18,30^XZ").printerProfile.setRealtimeClock).toBeUndefined();
  });

  it("emits ^KL with the selected printer locale", () => {
    expect(generateSetupScript({ ...base, printerLocale: "DE" })).toBe("^XA\n^KLDE\n^XZ");
  });

  it("emits ^SE with the encoding-table file path", () => {
    expect(generateSetupScript({ ...base, encodingTable: "E:UHANGUL.DAT" }))
      .toBe("^XA\n^SEE:UHANGUL.DAT\n^XZ");
  });

  it("rejects empty-string encodingTable at the schema layer", () => {
    // The schema's min(1) makes empty string unreachable through
    // printerProfileSchema.parse, so the generator no longer carries
    // its own empty-string defense. This test pins the schema
    // contract so a future schema loosening would also surface here.
    expect(() => printerProfileSchema.parse({ ...base, encodingTable: "" })).toThrow();
  });

  it("emits ^SZ with the selected ZPL mode", () => {
    expect(generateSetupScript({ ...base, zplMode: "1" })).toBe("^XA\n^SZ1\n^XZ");
    expect(generateSetupScript({ ...base, zplMode: "2" })).toBe("^XA\n^SZ2\n^XZ");
  });

  it("round-trips ^KL + ^SE + ^SZ via the parser without loss", () => {
    const orig: PrinterProfile = {
      ...base,
      printerLocale: "JP",
      encodingTable: "E:UHANGUL.DAT",
      zplMode: "2",
    };
    const { printerProfile: parsed } = parseZPL(generateSetupScript(orig));
    expect(parsed.printerLocale).toBe("JP");
    expect(parsed.encodingTable).toBe("E:UHANGUL.DAT");
    expect(parsed.zplMode).toBe("2");
  });

  it("round-trips the 3-char SP2 printer-locale code", () => {
    // SP2 is the only non-2-char alpha code in PRINTER_LOCALE_VALUES;
    // pin its round-trip so a future regex tightening of the parser
    // (e.g. assuming 2-char codes) breaks here loudly.
    const { printerProfile: parsed } = parseZPL(generateSetupScript({ ...base, printerLocale: "SP2" }));
    expect(parsed.printerLocale).toBe("SP2");
  });

  it("preserves spaces inside ^SE encoding-table paths", () => {
    // Hand-edited ZPL can carry paths with spaces (e.g.
    // `E:MY FILE.DAT`). The parser must not mangle them.
    const path = "E:MY FILE.DAT";
    const { printerProfile: parsed } = parseZPL(generateSetupScript({ ...base, encodingTable: path }));
    expect(parsed.encodingTable).toBe(path);
  });

  it("rejects ZPL injection attempts in ^SE values at the schema layer", () => {
    // `^SE${value}` interpolation makes this a real injection
    // surface for imported / pasted ZPL. Schema must reject any
    // value carrying the command-introducer chars.
    expect(() => printerProfileSchema.parse({ ...base, encodingTable: "^SDXY" })).toThrow();
    expect(() => printerProfileSchema.parse({ ...base, encodingTable: "E:F.DAT~JR" })).toThrow();
    expect(() => printerProfileSchema.parse({ ...base, encodingTable: "E:F.DAT\n^MD30" })).toThrow();
  });

  it("emits ^KN with name only when description is unset", () => {
    expect(generateSetupScript({ ...base, printerName: "Lab-01" }))
      .toBe("^XA\n^KNLab-01\n^XZ");
  });

  it("folds ^KN description into the same line when both are set", () => {
    expect(generateSetupScript({ ...base, printerName: "Lab-01", printerDescription: "front desk" }))
      .toBe("^XA\n^KNLab-01,front desk\n^XZ");
  });

  it("skips ^KN emit when only the description is set (name is the anchor)", () => {
    expect(generateSetupScript({ ...base, printerDescription: "orphan" })).toBe("");
  });

  it("skips ^KN emit when name is whitespace-only after trim", () => {
    // Schema's min(1) accepts "   "; the emit-side trim-guard
    // prevents an empty ^KN from going out and silently dropping
    // both fields on re-import.
    expect(generateSetupScript({ ...base, printerName: "   " })).toBe("");
    expect(generateSetupScript({ ...base, printerName: "   ", printerDescription: "desc" }))
      .toBe("");
  });

  it("round-trips ^KN via the parser without loss", () => {
    const orig: PrinterProfile = {
      ...base,
      printerName: "Lab-01",
      printerDescription: "front desk",
    };
    const { printerProfile: parsed } = parseZPL(generateSetupScript(orig));
    expect(parsed.printerName).toBe("Lab-01");
    expect(parsed.printerDescription).toBe("front desk");
  });

  it("rejects ZPL injection attempts in ^KN values at the schema layer", () => {
    expect(() => printerProfileSchema.parse({ ...base, printerName: "^SD30" })).toThrow();
    expect(() => printerProfileSchema.parse({ ...base, printerDescription: "front\n^MD0" })).toThrow();
  });

  it("rejects ^KN names longer than the 16-char spec cap", () => {
    expect(() => printerProfileSchema.parse({ ...base, printerName: "abcdefghij0123456" })).toThrow();
  });

  it("emits ^KP for a 4-digit password", () => {
    expect(generateSetupScript({ ...base, setPassword: "4711" }))
      .toBe("^XA\n^KP4711\n^XZ");
  });

  it("preserves ^KP0000 (the disable-protection value)", () => {
    expect(generateSetupScript({ ...base, setPassword: "0000" }))
      .toBe("^XA\n^KP0000\n^XZ");
  });

  it("schema rejects non-4-digit passwords", () => {
    expect(() => printerProfileSchema.parse({ ...base, setPassword: "123" })).toThrow();
    expect(() => printerProfileSchema.parse({ ...base, setPassword: "12345" })).toThrow();
    expect(() => printerProfileSchema.parse({ ...base, setPassword: "abcd" })).toThrow();
  });

  it("round-trips ^KP via the parser", () => {
    const { printerProfile: parsed } = parseZPL("^XA^KP9876^XZ");
    expect(parsed.setPassword).toBe("9876");
  });

  it("parser rejects ^KP values that don't match the 4-digit shape", () => {
    expect(parseZPL("^XA^KP12^XZ").printerProfile.setPassword).toBeUndefined();
    expect(parseZPL("^XA^KP12A4^XZ").printerProfile.setPassword).toBeUndefined();
  });

  it("emits ^JU{action} for each spec value", () => {
    expect(generateSetupScript({ ...base, configurationUpdate: "S" }))
      .toBe("^XA\n^JUS\n^XZ");
    expect(generateSetupScript({ ...base, configurationUpdate: "R" }))
      .toBe("^XA\n^JUR\n^XZ");
    expect(generateSetupScript({ ...base, configurationUpdate: "N" }))
      .toBe("^XA\n^JUN\n^XZ");
    expect(generateSetupScript({ ...base, configurationUpdate: "F" }))
      .toBe("^XA\n^JUF\n^XZ");
  });

  it("places ^JU last in the block so ^JUS commits everything before it", () => {
    const script = generateSetupScript({
      ...base,
      setPassword: "4711",
      printerName: "lab-01",
      configurationUpdate: "S",
    });
    const lines = script.split("\n");
    expect(lines[lines.length - 2]).toBe("^JUS");
    expect(lines[lines.length - 1]).toBe("^XZ");
  });

  it("round-trips ^JU via the parser", () => {
    for (const action of ["S", "R", "N", "F"] as const) {
      const { printerProfile: parsed } = parseZPL(`^XA^JU${action}^XZ`);
      expect(parsed.configurationUpdate).toBe(action);
    }
  });

  it("parser rejects ^JU with an unknown action letter", () => {
    expect(parseZPL("^XA^JUX^XZ").printerProfile.configurationUpdate).toBeUndefined();
  });

  it("emits ^SL with mode S only when language is unset", () => {
    expect(generateSetupScript({ ...base, clockMode: "S" })).toBe("^XA\n^SLS\n^XZ");
  });

  it("emits ^SL with mode T plus language when both set", () => {
    expect(generateSetupScript({ ...base, clockMode: "T", clockLanguage: "4" }))
      .toBe("^XA\n^SLT,4\n^XZ");
  });

  it("emits ^SL with numeric tolerance when mode is TOL", () => {
    expect(generateSetupScript({ ...base, clockMode: "TOL", clockTolerance: 60, clockLanguage: "1" }))
      .toBe("^XA\n^SL60,1\n^XZ");
  });

  it("schema rejects clockMode='TOL' without clockTolerance (cross-field rule)", () => {
    expect(() => printerProfileSchema.parse({ ...base, clockMode: "TOL" })).toThrow();
  });

  it("schema rejects clockTolerance set under non-TOL mode (cross-field rule)", () => {
    expect(() => printerProfileSchema.parse({ ...base, clockMode: "S", clockTolerance: 60 })).toThrow();
  });

  it("skips ^SL emit when only language or tolerance is set without mode anchor", () => {
    expect(generateSetupScript({ ...base, clockLanguage: "4" })).toBe("");
    expect(generateSetupScript({ ...base, clockTolerance: 60 })).toBe("");
  });

  it("round-trips ^SL S/T/TOL modes via the parser", () => {
    for (const orig of [
      { ...base, clockMode: "S" as const },
      { ...base, clockMode: "T" as const, clockLanguage: "4" as const },
      { ...base, clockMode: "TOL" as const, clockTolerance: 90, clockLanguage: "1" as const },
    ]) {
      const { printerProfile: parsed } = parseZPL(generateSetupScript(orig));
      expect(parsed.clockMode).toBe(orig.clockMode);
      if (orig.clockMode === "TOL") expect(parsed.clockTolerance).toBe(orig.clockTolerance);
      if ("clockLanguage" in orig) expect(parsed.clockLanguage).toBe(orig.clockLanguage);
    }
  });

  it("parses bare ^SL with no params as a no-op (no field set)", () => {
    const { printerProfile: parsed } = parseZPL("^XA^SL^XZ");
    expect(parsed.clockMode).toBeUndefined();
    expect(parsed.clockLanguage).toBeUndefined();
  });

  it("drops ^SL with out-of-range tolerance or unknown language", () => {
    expect(parseZPL("^XA^SL1500,1^XZ").printerProfile.clockMode).toBeUndefined();
    expect(parseZPL("^XA^SLS,99^XZ").printerProfile.clockLanguage).toBeUndefined();
  });

  it("clears stale clockTolerance when a later ^SL parses to mode S/T", () => {
    // Schema's cross-field rule forbids `tolerance set while mode in
    // {S, T}`. Parser writes raw values, so without the clear a
    // second ^SL parse would leave the store in an un-saveable
    // state. `^SL60,1^SLS` mid-stream is the realistic scenario.
    const zpl = "^XA^SL60,1^XZ^XA^SLS^XZ";
    const { printerProfile } = parseZPL(zpl);
    expect(printerProfile.clockMode).toBe("S");
    expect(printerProfile.clockTolerance).toBeUndefined();
  });

  it("does not orphan-set clockLanguage when the mode parse drops", () => {
    // Without the mode guard, `^SL1500,1` would set
    // clockLanguage='1' while clockMode stays undefined; emit
    // would then drop the orphan language silently, making it
    // write-only state. Pin the guard.
    expect(parseZPL("^XA^SL1500,1^XZ").printerProfile.clockLanguage).toBeUndefined();
  });

  it("rejects commas in ^KN / ^SE free-string fields (would round-trip-split)", () => {
    expect(() => printerProfileSchema.parse({ ...base, printerName: "Lab,01" })).toThrow();
    expect(() => printerProfileSchema.parse({ ...base, printerDescription: "front,desk" })).toThrow();
    expect(() => printerProfileSchema.parse({ ...base, encodingTable: "E:F.DAT,extra" })).toThrow();
  });

  it("parser drops ^SE values carrying ZPL command-introducer chars", () => {
    // The parser writes into the store without re-running the
    // schema; the dangerous-char check mirrors the schema so an
    // import cannot smuggle an injection past it.
    expect(parseZPL("^XA^SE\x1bbad^XZ").printerProfile.encodingTable).toBeUndefined();
  });

  it("rejects ^KL with an unknown locale code", () => {
    expect(parseZPL("^XA^KLXX^XZ").printerProfile.printerLocale).toBeUndefined();
  });

  it("rejects ^SZ with an unknown mode", () => {
    expect(parseZPL("^XA^SZ9^XZ").printerProfile.zplMode).toBeUndefined();
  });

  it("declares its channel-field set as a SSoT (SETUP_SCRIPT_FIELDS)", () => {
    // Guards against the if-chain in generateSetupScript silently
    // drifting from the documented registry. If a new Setup-Script
    // command is added, both the if-chain and SETUP_SCRIPT_FIELDS
    // must be updated together.
    expect([...SETUP_SCRIPT_FIELDS]).toEqual([
      "setupFonts",
      "tearOffAdjust",
      "reprintAfterError",
      "headTestInterval",
      "setRealtimeClock",
      "useCurrentTimeForClock",
      "clockFormat",
      "printerLocale",
      "encodingTable",
      "zplMode",
      "printerName",
      "printerDescription",
      "setPassword",
      "clockMode",
      "clockTolerance",
      "clockLanguage",
      "earlyWarningMaintenance",
      "headCleaningIntervalMeters",
      "maintenanceAlert",
      "maintenanceMessage",
      "headColdWarning",
      "fontLinks",
      "configurationUpdate",
      "codeValidation",
      "paSlotA",
      "paSlotB",
      "paSlotC",
      "paSlotD",
      "fontCacheOn",
      "fontCacheAddKb",
      "fontCacheType",
      "modeProtection",
      "modeProtectionExplicit",
    ]);
  });

  it("emits ^CO with only the slots the profile sets (parse-generate identity)", () => {
    expect(generateSetupScript({})).not.toContain("^CO");
    expect(generateSetupScript({ fontCacheAddKb: 78 })).toContain("^CO,78");
    expect(generateSetupScript({ fontCacheOn: "N", fontCacheType: "1" })).toContain("^CON,,1");
    expect(generateSetupScript({ fontCacheOn: "Y" })).toMatch(/\^COY(?!,)/);
  });

  it("emits the ^MPE baseline only for an absolute set", () => {
    expect(generateSetupScript({})).not.toContain("^MP");
    // Absolute (UI-authored or stream carried ^MPE): reset first.
    const absolute = generateSetupScript({ modeProtection: ["D", "C"], modeProtectionExplicit: true });
    expect(absolute).toContain("^MPE\n^MPD\n^MPC");
    // Relative import (^MPD without ^MPE): additions only, no injected reset.
    const relative = generateSetupScript({ modeProtection: ["D", "C"] });
    expect(relative).toContain("^MPD\n^MPC");
    expect(relative).not.toContain("^MPE");
    // Imported enable-all (^MPE with nothing after) round-trips as empty set.
    expect(generateSetupScript({ modeProtection: [], modeProtectionExplicit: true })).toContain("^MPE");
  });

  it("a fully-empty ^CO normalises to its a-slot default and round-trips", () => {
    const { printerProfile } = parseZPL("^XA^CO^XZ");
    expect(printerProfile.fontCacheOn).toBe("Y");
    expect(generateSetupScript(printerProfile)).toMatch(/\^COY(?!,)/);
  });

  it("later shorter ^CO clears slots an earlier ^CO had set (last command wins)", () => {
    const { printerProfile } = parseZPL("^XA^COY,78,1^CON^XZ");
    expect(printerProfile.fontCacheOn).toBe("N");
    expect(printerProfile.fontCacheAddKb).toBeUndefined();
    expect(printerProfile.fontCacheType).toBeUndefined();
  });

  it("a relative ^MP import round-trips without a fabricated ^MPE", () => {
    const { printerProfile } = parseZPL("^XA^MPD^XZ");
    expect(printerProfile.modeProtection).toEqual(["D"]);
    expect(printerProfile.modeProtectionExplicit).toBeUndefined();
    expect(generateSetupScript(printerProfile)).not.toContain("^MPE");
    const explicit = parseZPL("^XA^MPE^MPD^XZ").printerProfile;
    expect(explicit.modeProtectionExplicit).toBe(true);
    expect(generateSetupScript(explicit)).toContain("^MPE\n^MPD");
  });

  it("places configurationUpdate as the last persistent entry so ^JUS commits the block", () => {
    // Tripwire: ^JU emits whatever persistent writes precede it, so a
    // future persistent field added after configurationUpdate would
    // land in the same ^XA…^XZ block and only get committed on the
    // next print job, not at provisioning. Session-scoped entries
    // (e.g. ^CV) are allowed after because they emit after ^JUS.
    const persistentFields = SETUP_SCRIPT_FIELDS.filter((f) => {
      const e = __SETUP_SCRIPT_EMITTERS_FOR_TESTS[f];
      return e.kind === 'emit' && e.channel === 'block' && e.scope === 'persistent';
    });
    expect(persistentFields[persistentFields.length - 1]).toBe(
      "configurationUpdate",
    );
  });

  it("emits session-scoped commands after ^JUS so the commit can't try to persist them", () => {
    const script = generateSetupScript({
      configurationUpdate: 'S',
      codeValidation: 'Y',
    });
    expect(script).toBe("^XA\n^JUS\n^CVY\n^XZ");
  });

  it("PrinterProfile carries only Setup-Script fields — no per-label leakage", () => {
    // The schema must not accept per-label keys (^MD, ~SD, ^PR, ^MN
    // and friends). This pins the "no double-source-of-truth"
    // contract: per-label config stays on labelConfig.
    const result = printerProfileSchema.safeParse({
      ...base,
      darkness: 15,
      instantDarkness: 20,
      printSpeed: 6,
      mediaTracking: "Y",
    } as Record<string, unknown>);
    // Strict mode would error; default zod object strips unknown
    // keys silently. Verify the parsed result doesn't carry them.
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("darkness");
      expect(result.data).not.toHaveProperty("instantDarkness");
      expect(result.data).not.toHaveProperty("printSpeed");
      expect(result.data).not.toHaveProperty("mediaTracking");
    }
  });
});

describe("generateSetupScript — maintenance commands", () => {
  it("emits ^MA with the 5 positional params", () => {
    const script = generateSetupScript({
      ...base,
      maintenanceAlert: { type: 'C', print: 'Y', threshold: 5, frequency: 1, units: 'M' },
    });
    expect(script).toBe("^XA\n^MAC,Y,5,1,M\n^XZ");
  });

  it("emits ^MI as type + text", () => {
    const script = generateSetupScript({
      ...base,
      maintenanceMessage: { type: 'C', text: 'Clean head soon' },
    });
    expect(script).toBe("^XA\n^MIC,Clean head soon\n^XZ");
  });

  it("emits ^MW for the head-cold-warning flag", () => {
    expect(generateSetupScript({ ...base, headColdWarning: 'N' })).toBe("^XA\n^MWN\n^XZ");
  });

  it("emits ^CV for the code-validation toggle", () => {
    expect(generateSetupScript({ ...base, codeValidation: 'Y' })).toBe("^XA\n^CVY\n^XZ");
    expect(generateSetupScript({ ...base, codeValidation: 'N' })).toBe("^XA\n^CVN\n^XZ");
  });

  it("parses ^CV back into the profile", () => {
    expect(parseZPL("^XA^CVY^XZ").printerProfile.codeValidation).toBe("Y");
    expect(parseZPL("^XA^CVN^XZ").printerProfile.codeValidation).toBe("N");
  });

  it("drops ^CV with an invalid value", () => {
    expect(parseZPL("^XA^CVX^XZ").printerProfile.codeValidation).toBeUndefined();
  });

  it("emits ^PA composite when any slot is set", () => {
    expect(generateSetupScript({ ...base, paSlotA: true })).toBe("^XA\n^PA1,0,0,0\n^XZ");
    expect(generateSetupScript({ ...base, paSlotB: true, paSlotD: true })).toBe("^XA\n^PA0,1,0,1\n^XZ");
    expect(generateSetupScript({ ...base, paSlotA: true, paSlotB: true, paSlotC: true, paSlotD: true }))
      .toBe("^XA\n^PA1,1,1,1\n^XZ");
  });

  it("omits ^PA when no slot is set (default behaviour byte-identical)", () => {
    expect(generateSetupScript(base)).not.toContain("^PA");
  });

  it("omits ^PA when every slot is explicitly false (treated as default)", () => {
    expect(generateSetupScript({
      ...base, paSlotA: false, paSlotB: false, paSlotC: false, paSlotD: false,
    })).not.toContain("^PA");
  });

  it("parses ^PA back into the profile (true-only storage)", () => {
    const r = parseZPL("^XA^PA1,1,0,1^XZ").printerProfile;
    expect(r.paSlotA).toBe(true);
    expect(r.paSlotB).toBe(true);
    expect(r.paSlotC).toBeUndefined();
    expect(r.paSlotD).toBe(true);
  });

  it("round-trips ^PA1,1,1,1", () => {
    const r = parseZPL("^XA^PA1,1,1,1^XZ").printerProfile;
    expect(generateSetupScript(r)).toContain("^PA1,1,1,1");
  });

  it("emits ~DY for each setupFonts entry with bytes in fontCache, before ^FL", async () => {
    const { loadFontBytes } = await import("@zplab/core/lib/fontCache");
    await loadFontBytes(new Uint8Array([1, 2, 3, 4]), "TESTSU.TTF");
    const script = generateSetupScript({
      ...base,
      setupFonts: [{ path: "E:TESTSU.TTF" }],
      fontLinks: [{ ext: "E:TESTSU.TTF", base: "E:LATIN.TTF" }],
    });
    expect(script).toBe(
      "~DYE:TESTSU,A,T,4,,01020304\n^XA\n^FLE:TESTSU.TTF,E:LATIN.TTF,1\n^XZ",
    );
  });

  it("skips setupFonts entries whose bytes are missing", () => {
    const script = generateSetupScript({
      ...base,
      setupFonts: [{ path: "E:NOPE.TTF" }],
    });
    expect(script).not.toContain("~DY");
  });

  it("skips setupFonts entries with non-TTF/OTF extensions or missing drive", () => {
    expect(generateSetupScript({ ...base, setupFonts: [{ path: "E:LOGO.BMP" }] }))
      .not.toContain("~DY");
    expect(generateSetupScript({ ...base, setupFonts: [{ path: "NOCOLON.TTF" }] }))
      .not.toContain("~DY");
  });

  it("omits the ~DY block when setupFonts is empty or missing", () => {
    expect(generateSetupScript(base)).not.toContain("~DY");
    expect(generateSetupScript({ ...base, setupFonts: [] })).not.toContain("~DY");
  });

  it("emits one ^FL per active font link, persistent (before ^JUS)", () => {
    const script = generateSetupScript({
      ...base,
      fontLinks: [{ ext: "E:ARABIC.TTF", base: "E:LATIN.TTF" }],
      configurationUpdate: "S",
    });
    expect(script).toBe("^XA\n^FLE:ARABIC.TTF,E:LATIN.TTF,1\n^JUS\n^XZ");
  });

  it("omits ^FL when no links are present", () => {
    expect(generateSetupScript(base)).not.toContain("^FL");
    expect(generateSetupScript({ ...base, fontLinks: [] })).not.toContain("^FL");
  });

  it("parses ^FL into the profile (link=1 adds)", () => {
    const r = parseZPL("^XA^FLE:ARABIC.TTF,E:LATIN.TTF,1^XZ").printerProfile;
    expect(r.fontLinks).toEqual([{ ext: "E:ARABIC.TTF", base: "E:LATIN.TTF" }]);
  });

  it("^FL link=0 removes an existing pair", () => {
    const r = parseZPL(
      "^XA^FLE:ARABIC.TTF,E:LATIN.TTF,1^FS" +
      "^FLE:ARABIC.TTF,E:LATIN.TTF,0^FS^XZ",
    ).printerProfile;
    expect(r.fontLinks).toBeUndefined();
  });

  it("^FL is idempotent on duplicate add", () => {
    const r = parseZPL(
      "^XA^FLE:ARABIC.TTF,E:LATIN.TTF,1^FS" +
      "^FLE:ARABIC.TTF,E:LATIN.TTF,1^FS^XZ",
    ).printerProfile;
    expect(r.fontLinks).toEqual([{ ext: "E:ARABIC.TTF", base: "E:LATIN.TTF" }]);
  });

  it("^FL with missing link param defaults to add", () => {
    const r = parseZPL("^XA^FLE:ARABIC.TTF,E:LATIN.TTF^XZ").printerProfile;
    expect(r.fontLinks).toEqual([{ ext: "E:ARABIC.TTF", base: "E:LATIN.TTF" }]);
  });

  it("^FL with invalid link value is ignored (per spec)", () => {
    const r = parseZPL("^XA^FLE:ARABIC.TTF,E:LATIN.TTF,2^XZ").printerProfile;
    expect(r.fontLinks).toBeUndefined();
  });

  it("^FL emit skips rows with empty ext or base (editor drafts)", () => {
    const script = generateSetupScript({
      ...base,
      fontLinks: [{ ext: "", base: "" }, { ext: "E:A.TTF", base: "E:B.TTF" }],
    });
    expect(script).toBe("^XA\n^FLE:A.TTF,E:B.TTF,1\n^XZ");
  });

  it("^FL parser drops rows with oversize or unsafe-char paths", () => {
    const long = "E:" + "A".repeat(130) + ".TTF";
    expect(parseZPL(`^XA^FL${long},E:B.TTF,1^XZ`).printerProfile.fontLinks).toBeUndefined();
    expect(parseZPL("^XA^FLE:A~1.TTF,E:B.TTF,1^XZ").printerProfile.fontLinks).toBeUndefined();
  });

  it("^FL emit trims whitespace-only rows and trims surviving rows", () => {
    const script = generateSetupScript({
      ...base,
      fontLinks: [{ ext: "  ", base: "  " }, { ext: " E:A.TTF ", base: " E:B.TTF " }],
    });
    expect(script).toBe("^XA\n^FLE:A.TTF,E:B.TTF,1\n^XZ");
  });

  it("round-trips multi-link ^FL", () => {
    const r = parseZPL(
      "^XA^FLE:CJK.TTF,E:LATIN.TTF,1" +
      "^FLE:ARABIC.TTF,E:LATIN.TTF,1^XZ",
    ).printerProfile;
    expect(generateSetupScript(r))
      .toContain("^FLE:CJK.TTF,E:LATIN.TTF,1\n^FLE:ARABIC.TTF,E:LATIN.TTF,1");
  });

  it("treats omitted ^PA slots as 0 (printer default)", () => {
    const r = parseZPL("^XA^PA1^XZ").printerProfile;
    expect(r.paSlotA).toBe(true);
    expect(r.paSlotB).toBeUndefined();
    expect(r.paSlotC).toBeUndefined();
    expect(r.paSlotD).toBeUndefined();
  });

  it("parses ^PA0,0,0,0 as empty profile and re-emits nothing", () => {
    const r = parseZPL("^XA^PA0,0,0,0^XZ").printerProfile;
    expect(r.paSlotA).toBeUndefined();
    expect(r.paSlotB).toBeUndefined();
    expect(r.paSlotC).toBeUndefined();
    expect(r.paSlotD).toBeUndefined();
    expect(generateSetupScript(r)).not.toContain("^PA");
  });

  it("tolerates whitespace around ^PA slot values", () => {
    const r = parseZPL("^XA^PA 1 , 0 , 1 , 0 ^XZ").printerProfile;
    expect(r.paSlotA).toBe(true);
    expect(r.paSlotC).toBe(true);
    expect(r.paSlotB).toBeUndefined();
    expect(r.paSlotD).toBeUndefined();
  });

  it("treats out-of-range ^PA values as 0 (strict 1-only)", () => {
    const r = parseZPL("^XA^PA2,X,1,0^XZ").printerProfile;
    expect(r.paSlotA).toBeUndefined();
    expect(r.paSlotB).toBeUndefined();
    expect(r.paSlotC).toBe(true);
    expect(r.paSlotD).toBeUndefined();
  });

  it("ignores extra ^PA slots beyond the 4 spec'd ones", () => {
    const r = parseZPL("^XA^PA1,0,1,0,1^XZ").printerProfile;
    expect(r.paSlotA).toBe(true);
    expect(r.paSlotC).toBe(true);
    expect(generateSetupScript(r)).toContain("^PA1,0,1,0");
  });

  it("emits ^JH with f-slot filled and other slots empty", () => {
    const script = generateSetupScript({ ...base, earlyWarningMaintenance: 'E' });
    expect(script).toBe("^XA\n^JH,,,,,E,,,,\n^XZ");
  });

  it("emits ^JH with both f and g slots when both set", () => {
    const script = generateSetupScript({
      ...base,
      earlyWarningMaintenance: 'E',
      headCleaningIntervalMeters: 150,
    });
    expect(script).toBe("^XA\n^JH,,,,,E,1,,,\n^XZ");
  });

  it("emits ^JH with only g-slot when only the interval is set", () => {
    const script = generateSetupScript({ ...base, headCleaningIntervalMeters: 200 });
    expect(script).toBe("^XA\n^JH,,,,,,2,,,\n^XZ");
  });

  it("parses ^MA / ^MI / ^MW / ^JH back into the profile", () => {
    const zpl = [
      "^XA",
      "^MAC,Y,5,1,M",
      "^MIC,Clean me",
      "^MWN",
      "^JH,,,,,E,1,,,",
      "^XZ",
    ].join("\n");
    const { printerProfile } = parseZPL(zpl);
    expect(printerProfile.maintenanceAlert).toEqual({
      type: 'C', print: 'Y', threshold: 5, frequency: 1, units: 'M',
    });
    expect(printerProfile.maintenanceMessage).toEqual({ type: 'C', text: 'Clean me' });
    expect(printerProfile.headColdWarning).toBe('N');
    expect(printerProfile.earlyWarningMaintenance).toBe('E');
    expect(printerProfile.headCleaningIntervalMeters).toBe(150);
  });

  it("round-trips the maintenance batch", () => {
    const profile: PrinterProfile = {
      maintenanceAlert: { type: 'R', print: 'N', threshold: 50, frequency: 5, units: 'I' },
      maintenanceMessage: { type: 'R', text: 'Replace head' },
      headColdWarning: 'Y',
      earlyWarningMaintenance: 'E',
      headCleaningIntervalMeters: 300,
    };
    const script = generateSetupScript(profile);
    const { printerProfile } = parseZPL(script);
    expect(printerProfile).toEqual(profile);
  });

  it("emits ^JH before ^MA so the alert gate is set first", () => {
    const script = generateSetupScript({
      ...base,
      earlyWarningMaintenance: 'E',
      maintenanceAlert: { type: 'C', print: 'Y', threshold: 5, frequency: 1, units: 'I' },
    });
    expect(script.indexOf("^JH")).toBeLessThan(script.indexOf("^MA"));
  });

  it("defaults ^MA print to Y when the slot is blank", () => {
    const { printerProfile } = parseZPL("^XA^MAC,,5,1,M^XZ");
    expect(printerProfile.maintenanceAlert?.print).toBe("Y");
  });

  it("defaults ^MA units to I when the slot is blank", () => {
    const { printerProfile } = parseZPL("^XA^MAC,Y,5,1^XZ");
    expect(printerProfile.maintenanceAlert?.units).toBe("I");
  });

  it("defaults ^MA threshold and frequency to spec values when slots are blank", () => {
    const { printerProfile } = parseZPL("^XA^MAR,Y,,,M^XZ");
    expect(printerProfile.maintenanceAlert).toEqual({
      type: "R", print: "Y", threshold: 5, frequency: 1, units: "M",
    });
  });

  it("drops ^MA with invalid type", () => {
    const { printerProfile } = parseZPL("^XA^MAX,Y,5,1,M^XZ");
    expect(printerProfile.maintenanceAlert).toBeUndefined();
  });

  it("drops ^MA type C with threshold over the 2000 m cap", () => {
    const { printerProfile } = parseZPL("^XA^MAC,Y,2001,1,M^XZ");
    expect(printerProfile.maintenanceAlert).toBeUndefined();
  });

  it("accepts ^MA type R with threshold up to 150000 m", () => {
    const { printerProfile } = parseZPL("^XA^MAR,Y,150000,1,M^XZ");
    expect(printerProfile.maintenanceAlert?.threshold).toBe(150000);
  });

  it("accepts ^MA with frequency=0 (disabled-repeat idiom)", () => {
    const { printerProfile } = parseZPL("^XA^MAC,Y,5,0,M^XZ");
    expect(printerProfile.maintenanceAlert?.frequency).toBe(0);
  });

  it("drops ^MI with embedded comma", () => {
    const { printerProfile } = parseZPL("^XA^MIC,Hi, there^XZ");
    expect(printerProfile.maintenanceMessage).toBeUndefined();
  });

  it("drops ^MI exceeding the message length cap", () => {
    const longText = "A".repeat(64);
    const { printerProfile } = parseZPL(`^XA^MIC,${longText}^XZ`);
    expect(printerProfile.maintenanceMessage).toBeUndefined();
  });

  it("parses ^JH g-slot index 1 as 150 m", () => {
    const { printerProfile } = parseZPL("^XA^JH,,,,,E,1,,,^XZ");
    expect(printerProfile.headCleaningIntervalMeters).toBe(150);
  });

  it("drops ^JH g-slot index out of range", () => {
    const { printerProfile } = parseZPL("^XA^JH,,,,,E,17,,,^XZ");
    expect(printerProfile.headCleaningIntervalMeters).toBeUndefined();
  });

  it("rejects mismatched ^MA/^MI type via schema", () => {
    const result = printerProfileSchema.safeParse({
      maintenanceAlert: { type: 'C', print: 'Y', threshold: 5, frequency: 1, units: 'M' },
      maintenanceMessage: { type: 'R', text: 'Mismatched' },
    });
    expect(result.success).toBe(false);
  });

  it("parser drops a mismatched ^MI so the import patch never crashes the schema", () => {
    const { printerProfile } = parseZPL("^XA^MAC,Y,5,1,M^MIR,Replace head^XZ");
    expect(printerProfile.maintenanceAlert?.type).toBe("C");
    expect(printerProfile.maintenanceMessage).toBeUndefined();
  });

  it("parser drops a stale ^MI when a later ^MA flips the type", () => {
    const { printerProfile } = parseZPL("^XA^MIC,Clean me^MAR,Y,5,1,M^XZ");
    expect(printerProfile.maintenanceAlert?.type).toBe("R");
    expect(printerProfile.maintenanceMessage).toBeUndefined();
  });

  it("reverse-order import: ^MI before ^MA with mismatched types, alert wins", () => {
    const { printerProfile } = parseZPL("^XA^MIC,Clean me^MAR,Y,5,1,M^XZ");
    expect(printerProfile.maintenanceAlert?.type).toBe("R");
    expect(printerProfile.maintenanceMessage).toBeUndefined();
  });

  it("MAINTENANCE_ALERT_DEFAULTS fit the tighter (C) cap", () => {
    // Parser blank-slot fallbacks are type-independent; if a future
    // bump exceeds the C cap the round-trip of a partial ^MAC dump
    // would silently corrupt. Pin the invariant.
    const minCap = Math.min(
      MAINTENANCE_DISTANCE_MAX_BY_TYPE.R,
      MAINTENANCE_DISTANCE_MAX_BY_TYPE.C,
    );
    expect(MAINTENANCE_ALERT_DEFAULTS.threshold).toBeLessThanOrEqual(minCap);
    expect(MAINTENANCE_ALERT_DEFAULTS.frequency).toBeLessThanOrEqual(minCap);
  });
});

describe("SETUP_SCRIPT_EMITTERS structural invariants", () => {
  it("every foldedInto.target points at a kind:'emit' entry, never another foldedInto", () => {
    // A target chain (foldedInto → foldedInto) would mean no entry
    // actually produces the wire command; the registry would compile
    // but the emit channel would silently drop. This test catches a
    // typo where `clockTolerance.target` got changed to `clockLanguage`
    // (also a foldedInto) instead of `clockMode`.
    for (const [field, entry] of Object.entries(__SETUP_SCRIPT_EMITTERS_FOR_TESTS)) {
      if (entry.kind !== 'foldedInto') continue;
      const target = __SETUP_SCRIPT_EMITTERS_FOR_TESTS[entry.target as keyof typeof __SETUP_SCRIPT_EMITTERS_FOR_TESTS];
      expect(target, `field "${field}" folded into missing target "${entry.target}"`).toBeDefined();
      expect(
        target.kind,
        `field "${field}" folded into "${entry.target}" but target is itself ${target.kind}, not 'emit'`,
      ).toBe('emit');
    }
  });
});

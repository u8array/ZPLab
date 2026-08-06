import { describe, it, expect } from "vitest";
import { generateZPL } from "@zplab/core/lib/zplGenerator";
import { generateSetupScript } from "./zplSetupScript";
import { parseZPL } from "@zplab/core/lib/zplParser";
import type { LabelConfig } from "@zplab/core/types/LabelConfig";
const base: LabelConfig = { widthMm: 100, heightMm: 50, dpmm: 8 };

describe("Printer Settings Modal Tab 1 — generator", () => {
  it("omits ^MN / ^ML / ^MF / ^XB when no field is set", () => {
    const zpl = generateZPL(base, []);
    expect(zpl).not.toContain("^MN");
    expect(zpl).not.toContain("^ML");
    expect(zpl).not.toContain("^MF");
    expect(zpl).not.toContain("^XB");
  });

  it("emits ^MC / ^PF / ^PH / ^PP only when set and round-trips them", () => {
    expect(generateZPL(base, [])).not.toMatch(/\^MC|\^PF|\^PH|\^PP/);
    const zpl = generateZPL(
      { ...base, mapClear: "N", slewDotRows: 120, slewToHome: true, programmablePause: true },
      [],
    );
    expect(zpl).toContain("^MCN");
    expect(zpl).toContain("^PF120");
    expect(zpl).toContain("^PH");
    expect(zpl).toContain("^PP");
    const back = parseZPL(zpl, 8).labelConfig;
    expect(back.mapClear).toBe("N");
    expect(back.slewDotRows).toBe(120);
    expect(back.slewToHome).toBe(true);
    expect(back.programmablePause).toBe(true);
  });

  it("emits ^PF0 (explicit no-slew) rather than dropping the zero", () => {
    expect(generateZPL({ ...base, slewDotRows: 0 }, [])).toContain("^PF0");
  });

  it("emits an explicit imported ^MCY (both enum states are representable)", () => {
    expect(generateZPL({ ...base, mapClear: "Y" }, [])).toContain("^MCY");
  });

  it("emits ^MN with the selected tracking mode", () => {
    const zpl = generateZPL({ ...base, mediaTracking: "W" }, []);
    expect(zpl).toContain("^MNW");
  });

  it("emits ^ML with the maximum label length in dots", () => {
    const zpl = generateZPL({ ...base, maxLabelLength: 1200 }, []);
    expect(zpl).toContain("^ML1200");
  });

  it("emits ^MF with both positional params; missing slot defaults to N", () => {
    const both = generateZPL(
      { ...base, mediaFeedPowerUp: "F", mediaFeedHeadClose: "C" },
      [],
    );
    expect(both).toContain("^MFF,C");
    // Only one slot set: the other must still be present.
    const only = generateZPL({ ...base, mediaFeedPowerUp: "F" }, []);
    expect(only).toContain("^MFF,N");
  });

  it("emits bare ^XB when suppressBackfeed is true", () => {
    const zpl = generateZPL({ ...base, suppressBackfeed: true }, []);
    expect(zpl).toMatch(/\^XB(?![A-Z0-9])/);
  });

  it("omits ^XB when suppressBackfeed is false or undefined", () => {
    expect(generateZPL({ ...base, suppressBackfeed: false }, [])).not.toContain("^XB");
    expect(generateZPL({ ...base }, [])).not.toContain("^XB");
  });
});

describe("Printer Settings Modal Tab 1 — parser roundtrip", () => {
  it("round-trips all four commands without loss", () => {
    const orig: LabelConfig = {
      ...base,
      mediaTracking: "M",
      maxLabelLength: 800,
      mediaFeedPowerUp: "F",
      mediaFeedHeadClose: "L",
      suppressBackfeed: true,
    };
    const zpl = generateZPL(orig, []);
    const { labelConfig: parsed } = parseZPL(zpl);
    expect(parsed.mediaTracking).toBe("M");
    expect(parsed.maxLabelLength).toBe(800);
    expect(parsed.mediaFeedPowerUp).toBe("F");
    expect(parsed.mediaFeedHeadClose).toBe("L");
    expect(parsed.suppressBackfeed).toBe(true);
  });

  it("clamps an out-of-range ^MN value by ignoring it", () => {
    const { labelConfig } = parseZPL("^XA^MNZ^XZ");
    expect(labelConfig.mediaTracking).toBeUndefined();
  });

  it("reads ^MN's first positional even when a second param is present", () => {
    // ^MNa,b: b is the optional black-mark offset for W/M modes.
    // We don't model b, but a must still be captured.
    const { labelConfig } = parseZPL("^XA^MNY,10^XZ");
    expect(labelConfig.mediaTracking).toBe("Y");
  });

  it("ignores a non-positive ^ML value", () => {
    const { labelConfig } = parseZPL("^XA^ML0^XZ");
    expect(labelConfig.maxLabelLength).toBeUndefined();
  });

  // Pin the documented asymmetry: the generator fills the missing
  // ^MF slot with 'N' so the printer keeps its current behaviour
  // there, and the parser writes whatever it sees back into the
  // store. A roundtrip with only one slot set therefore materialises
  // the implicit 'N' on the other slot. This is by design; if the
  // generator ever emits a marker for "absent slot", revisit here.
  it("MF emit fills the unset slot with 'N' and the parser writes it back", () => {
    const zpl = generateZPL({ ...base, mediaFeedPowerUp: "F" }, []);
    expect(zpl).toContain("^MFF,N");
    const { labelConfig } = parseZPL(zpl);
    expect(labelConfig.mediaFeedPowerUp).toBe("F");
    expect(labelConfig.mediaFeedHeadClose).toBe("N");
  });
});

describe("Printer Settings Modal Tab 2 — Print Quality commands (Setup Script)", () => {
  it("emits ^JZ in the Setup Script with the selected reprint mode", () => {
    expect(generateSetupScript({ reprintAfterError: "Y" })).toContain("^JZY");
    expect(generateSetupScript({ reprintAfterError: "N" })).toContain("^JZN");
  });

  it("emits ^JT in the Setup Script with the head-test interval", () => {
    expect(generateSetupScript({ headTestInterval: 500 })).toContain("^JT500");
  });

  it("emits ~TA in the Setup Script (tilde-prefix above the wrapper block)", () => {
    // Pair with a caret command so the ^XA wrapper exists; otherwise
    // a tilde-only script has no block to compare position against.
    const script = generateSetupScript({
      tearOffAdjust: -30,
      reprintAfterError: "Y",
    });
    expect(script).toContain("~TA-030");
    expect(script.indexOf("~TA")).toBeLessThan(script.indexOf("^XA"));
  });

  it("keeps ^JZ / ^JT / ~TA out of the per-label generateZPL output", () => {
    // After the printerProfile split, generateZPL only sees labelConfig
    // so these commands cannot reach the per-label stream by construction.
    // Test still pins the invariant in case a future refactor wires
    // profile values through generateZPL again.
    const zpl = generateZPL(base, []);
    expect(zpl).not.toContain("^JZ");
    expect(zpl).not.toContain("^JT");
    expect(zpl).not.toContain("~TA");
  });

  it("returns an empty Setup Script when no relevant field is set", () => {
    expect(generateSetupScript({})).toBe("");
  });

  it("round-trips ^JZ / ^JT / ~TA via the Setup Script parser", () => {
    const orig = {
      reprintAfterError: "Y" as const,
      headTestInterval: 250,
      tearOffAdjust: 15,
    };
    const { printerProfile: parsed } = parseZPL(generateSetupScript(orig));
    expect(parsed.reprintAfterError).toBe("Y");
    expect(parsed.headTestInterval).toBe(250);
    expect(parsed.tearOffAdjust).toBe(15);
  });

  it("clamps out-of-range parser values for ^JT and ~TA", () => {
    expect(parseZPL("^XA^JT99999^XZ").printerProfile.headTestInterval).toBeUndefined();
    expect(parseZPL("~TA200^XA^XZ").printerProfile.tearOffAdjust).toBeUndefined();
    expect(parseZPL("~TA-200^XA^XZ").printerProfile.tearOffAdjust).toBeUndefined();
  });
});

describe("RFID setup (^RS / ^RB / ^RW, spec-only)", () => {
  const base = { widthMm: 50, heightMm: 30, dpmm: 8 } as LabelConfig;

  it("emits nothing when no RFID field is set", () => {
    const zpl = generateZPL(base, []);
    expect(zpl).not.toContain("^RS");
    expect(zpl).not.toContain("^RB");
    expect(zpl).not.toContain("^RW");
  });

  it("round-trips the full ^RS slot set (a and c stay unmodelled)", () => {
    const cfg = {
      ...base,
      rfidTagType: 8, rfidPosition: "F1", rfidVoidLength: 200,
      rfidRetries: 5, rfidErrorHandling: "P" as const, rfidVoidSpeed: 4,
    };
    const zpl = generateZPL(cfg, []);
    expect(zpl).toContain("^RS8,F1,200,5,P,,,4");
    const back = parseZPL(zpl, 8).labelConfig;
    expect(back.rfidTagType).toBe(8);
    expect(back.rfidPosition).toBe("F1");
    expect(back.rfidVoidLength).toBe(200);
    expect(back.rfidRetries).toBe(5);
    expect(back.rfidErrorHandling).toBe("P");
    expect(back.rfidVoidSpeed).toBe(4);
  });

  it("trims trailing empty ^RS slots", () => {
    expect(generateZPL({ ...base, rfidTagType: 8 }, [])).toContain("^RS8" + String.fromCharCode(10));
    expect(generateZPL({ ...base, rfidPosition: "520" }, [])).toContain("^RS,520" + String.fromCharCode(10));
  });

  it("round-trips ^RB with partitions and drops a mismatched sum", () => {
    const cfg = { ...base, rfidEpcBits: 96, rfidEpcPartitions: [8, 3, 3, 20, 24, 38] };
    const zpl = generateZPL(cfg, []);
    expect(zpl).toContain("^RB96,8,3,3,20,24,38");
    const back = parseZPL(zpl, 8).labelConfig;
    expect(back.rfidEpcBits).toBe(96);
    expect(back.rfidEpcPartitions).toEqual([8, 3, 3, 20, 24, 38]);
    // Partitions summing to 95 != 96 would encode wrong fields: drop whole cmd.
    const badParse = parseZPL("^XA^RB96,8,3,3,20,24,37^XZ", 8);
    expect(badParse.labelConfig.rfidEpcBits).toBeUndefined();
    expect(badParse.labelConfig.rfidEpcPartitions).toBeUndefined();
    // The drop is reported, never silent.
    expect(
      badParse.pages[0]?.findings.filter((f) => f.kind === "partial").map((f) => f.command),
    ).toContain("^RB");
  });

  it("reports a gap inside the ^RB partition list instead of closing it", () => {
    const r = parseZPL("^XA^RB96,8,,24,64^XZ", 8);
    expect(r.labelConfig.rfidEpcPartitions).toBeUndefined();
    expect(
      r.pages[0]?.findings.filter((f) => f.kind === "partial").map((f) => f.command),
    ).toContain("^RB");
    // A trailing delimiter is only noise, so that list still adopts.
    expect(parseZPL("^XA^RB96,8,24,64,^XZ", 8).labelConfig.rfidEpcPartitions).toEqual([8, 24, 64]);
  });

  it("round-trips ^RW across the numeric/level power union", () => {
    expect(generateZPL({ ...base, rfidReadPower: 16, rfidWritePower: "L" }, [])).toContain("^RW16,L");
    const back = parseZPL("^XA^RWH,30^XZ", 8).labelConfig;
    expect(back.rfidReadPower).toBe("H");
    expect(back.rfidWritePower).toBe(30);
  });

  it("flags the unmodelled ^RS a/c and ^RW antenna slots as partial", () => {
    const r = parseZPL("^XA^RS8,,,,,A2^RW16,16,A3^XZ", 8);
    const partial = r.pages[0]?.findings.filter((f) => f.kind === "partial").map((f) => f.command);
    expect(partial).toContain("^RS");
    expect(partial).toContain("^RW");
    // The modelled slots still adopt.
    expect(r.labelConfig.rfidTagType).toBe(8);
    expect(r.labelConfig.rfidReadPower).toBe(16);
  });

  it("flags a legacy tag type as partial and keeps the other slots", () => {
    const r = parseZPL("^XA^RS1,520^XZ", 8);
    expect(r.labelConfig.rfidTagType).toBeUndefined();
    expect(r.labelConfig.rfidPosition).toBe("520");
    const partial = r.pages[0]?.findings.filter((f) => f.kind === "partial").map((f) => f.command);
    expect(partial).toContain("^RS");
  });

  it("adopts a partition-less ^RB beyond the 16x64 form", () => {
    expect(parseZPL("^XA^RB2048^XZ", 8).labelConfig.rfidEpcBits).toBe(2048);
  });

  it("bounds the forward position at F999 per the Link-OS spec", () => {
    expect(parseZPL("^XA^RS8,F999^XZ", 8).labelConfig.rfidPosition).toBe("F999");
    expect(parseZPL("^XA^RS8,F1000^XZ", 8).labelConfig.rfidPosition).toBeUndefined();
  });

  it("reads the VOID length through the ^MU multiplier like ^ML", () => {
    // ^MUI: 2 inches = 406 dots at 8 dpmm (203 dpi).
    expect(parseZPL("^XA^MUI^RS8,,2^XZ", 8).labelConfig.rfidVoidLength).toBe(406);
  });

  it("ignores invalid RFID slot values", () => {
    const back = parseZPL("^XA^RS9,X99,-1,11,Q^RW31,Z^XZ", 8).labelConfig;
    expect(back.rfidTagType).toBeUndefined();
    expect(back.rfidPosition).toBeUndefined();
    expect(back.rfidVoidLength).toBeUndefined();
    expect(back.rfidRetries).toBeUndefined();
    expect(back.rfidErrorHandling).toBeUndefined();
    expect(back.rfidReadPower).toBeUndefined();
    expect(back.rfidWritePower).toBeUndefined();
  });
});

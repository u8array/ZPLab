import { describe, expect, it } from "vitest";
import { planGs1Fd } from "./gs1Plan";
import { generateMultiPageZPL } from "./zplGenerator";
import { GS1_GS } from "./gs1";
import { getEntry, type LeafObject } from "../registry";

const GS = GS1_GS;

describe("planGs1Fd", () => {
  it("derives fd, element string and no losses for segmentable content", () => {
    const content = "011234567890123110ABC";
    const c128 = planGs1Fd(content, "code128");
    expect(c128.fd).toBe("(01)12345678901231(10)ABC");
    expect(c128.bwipText).toBe("(01)12345678901231(10)ABC");
    expect(c128.losses).toEqual([]);
    const dm = planGs1Fd(`10ABC${GS}21XYZ`, "datamatrix");
    expect(dm.fd).toBe("_110ABC_121XYZ");
    expect(dm.bwipText).toBe("(10)ABC(21)XYZ");
    expect(planGs1Fd("0112345678901231", "databar").bwipText).toBe("(01)12345678901231");
  });

  it("goes verbatim on BOTH sides when the content does not segment", () => {
    for (const carrier of ["code128", "databar"] as const) {
      const plan = planGs1Fd("0112345", carrier);
      expect(plan.fd).toBe("0112345");
      expect(plan.bwipText).toBe("0112345");
      expect(plan.losses).toEqual([{ kind: "unparsed" }]);
    }
    // DM still wraps the wire in its escape grammar (raw GS -> _1) and
    // reports no loss: the `_1` codec keeps FNC1 positions exact.
    const dm = planGs1Fd(`0112345678901231${GS}10ABC`, "datamatrix");
    expect(dm.fd).toBe("_10112345678901231_110ABC");
    expect(dm.losses).toEqual([]);
  });

  it("matches the full toZPL output byte for byte (covers the ^FH wrapping layer)", () => {
    // plan.fd is the payload handed to fdField, which may still wrap it in
    // ^FH hex (raw GS on the databar wire); undo that layer for comparison.
    const fdOf = (zpl: string): string => {
      const m = /\^FD([\s\S]*?)\^FS/.exec(zpl);
      if (!m) throw new Error(`no ^FD in ${zpl}`);
      const fd = m[1] ?? "";
      return zpl.includes("^FH_")
        ? fd.replace(/_([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
        : fd;
    };
    const leaf = (type: string, props: object) =>
      ({ id: "x", type, x: 0, y: 0, rotation: 0, props }) as unknown as LeafObject;
    for (const content of [
      "0112345678901231", `10ABC${GS}21XYZ`, "0112345", `01123${GS}`, "(01)12345678901231",
      `0112345678901231${GS}10ABC`, "10>5B", "",
    ]) {
      const tag = JSON.stringify(content);
      const bc = getEntry("code128")!.toZPL(leaf("code128", {
        content, height: 100, moduleWidth: 2, printInterpretation: false,
        printInterpretationAbove: false, checkDigit: false, rotation: "N", gs1: true,
      }));
      expect(planGs1Fd(content, "code128").fd, tag).toBe(fdOf(bc));
      const bx = getEntry("datamatrix")!.toZPL(leaf("datamatrix", {
        content, gs1: true, dimension: 20, quality: 200, rotation: "N",
      }));
      expect(planGs1Fd(content, "datamatrix").fd, tag).toBe(fdOf(bx));
      const br = getEntry("gs1databar")!.toZPL(leaf("gs1databar", {
        content, symbology: 6, magnification: 3, segments: 22, rotation: "N",
      }));
      expect(planGs1Fd(content, "databar").fd, tag).toBe(fdOf(br));
    }
  });

  it("builds carrier-true parsefnc fallbacks (DM keeps FNC1 per GS, drops trailing)", () => {
    const dm = planGs1Fd(`01123${GS}9^9${GS}`, "datamatrix");
    expect(dm.bwipParsefncText).toBe("^FNC101123^FNC19^^9");
    const bc = planGs1Fd(`01123${GS}9^9`, "code128");
    expect(bc.bwipParsefncText).toBe("^FNC101123" + "9^^9");
    expect(planGs1Fd("0112345678901231", "code128").bwipParsefncText).toBeNull();
  });
});

describe("GS1 DataMatrix element string", () => {
  it("never ships the human-readable parentheses inside the symbol", () => {
    // ^BX encodes ^FD verbatim; only ^BC mode D strips parens (spec p.95).
    expect(planGs1Fd("(00)340123450000000017", "datamatrix").fd).toBe("_100340123450000000017");
  });

  it("leaves canonical content exactly as it was", () => {
    expect(planGs1Fd("00340123450000000017", "datamatrix").fd).toBe("_100340123450000000017");
  });

  it("chains a fixed-length AI without a separator", () => {
    expect(planGs1Fd("(01)04012345123456(10)L42", "datamatrix").fd).toBe("_1010401234512345610L42");
  });

  it("separates after a variable-length AI, where the decoder needs it", () => {
    expect(planGs1Fd("(10)L42(17)261231", "datamatrix").fd).toBe("_110L42_117261231");
  });
});

describe("a variable inside a GS1 field", () => {
  const emit = (type: "code128" | "datamatrix") =>
    generateMultiPageZPL(
      { widthMm: 70, heightMm: 40, dpmm: 8 },
      [{
        objects: [{
          id: "s", type, x: 10, y: 10, rotation: 0,
          props: {
            content: "(01)«GTIN»(10)«LOT»",
            gs1: true, height: 60, moduleWidth: 2,
            dimension: 6, quality: 200, rotation: "N",
          },
        } as never],
      }],
      [
        { id: "v1", name: "GTIN", fnNumber: 1, defaultValue: "04150123456782" },
        { id: "v2", name: "LOT", fnNumber: 2, defaultValue: "L42" },
      ],
    );

  it("emits the slot, never a value computed from the slot number", () => {
    for (const type of ["code128", "datamatrix"] as const) {
      const zpl = emit(type);
      expect(zpl, type).toContain("#1#");
      expect(zpl, type).not.toContain("00000000000");
    }
  });

  it("still canonicalises content that carries no marker", () => {
    expect(planGs1Fd("(01)04150123456782", "datamatrix").fd).toBe("_10104150123456782");
  });
});

describe("values that only look like a slot reference", () => {
  it("keeps the separator on a hyphenated lot", () => {
    // (10) is variable length, so the next AI needs FNC1 after it.
    expect(planGs1Fd("(10)-123-(17)261231", "code128").fd).toBe("(10)-123->8(17)261231");
  });

  it("canonicalises that same content for DataMatrix", () => {
    expect(planGs1Fd("(10)-123-(17)261231", "datamatrix").fd).toBe("_110-123-_117261231");
  });

  it("still recognises a real embed", () => {
    expect(planGs1Fd("(10)#2#(17)261231", "code128").fd).toContain("#2#");
  });
});

describe("values that use the same characters an embed does", () => {
  const literal = (content: string, carrier: "code128" | "datamatrix") =>
    planGs1Fd(content, carrier).fd;

  it("treats percent and ampersand values as data, not as slot references", () => {
    // Both are legal in the GS1 82-character set and both are ^FE candidates.
    expect(literal("(10)%123%(17)261231", "code128")).toBe("(10)%123%>8(17)261231");
    expect(literal("(10)&42&(17)261231", "datamatrix")).toBe("_110&42&_117261231");
  });

  it("keeps separating a hyphenated lot", () => {
    expect(literal("(10)-123-(17)261231", "code128")).toBe("(10)-123->8(17)261231");
  });
});

describe("a GS1 DataMatrix whose values are still variable", () => {
  const emit = (content: string) =>
    generateMultiPageZPL(
      { widthMm: 70, heightMm: 40, dpmm: 8 },
      [{
        objects: [{
          id: "s", type: "datamatrix", x: 10, y: 10, rotation: 0,
          props: { content, gs1: true, dimension: 6, quality: 200, rotation: "N" },
        } as never],
      }],
      [
        { id: "v1", name: "GTIN", fnNumber: 1, defaultValue: "04150123456782" },
        { id: "v2", name: "LOT", fnNumber: 2, defaultValue: "L42" },
      ],
    );

  it("drops the human-readable parentheses from the symbol data", () => {
    const zpl = emit("(01)«GTIN»(10)«LOT»");
    expect(zpl).toContain("#1#");
    expect(zpl).not.toContain("^FD_1(01)");
    expect(zpl).not.toContain("(10)");
  });

  it("keeps the separator after the variable-length AI when one follows", () => {
    // (10) is variable, so a following (17) needs FNC1; (01) is fixed and does not.
    const zpl = emit("(01)«GTIN»(10)«LOT»(17)261231");
    expect(zpl).toMatch(/\^FD_101#1#10#2#_117261231\^FS/);
  });
});

describe("an AI the catalog does not know", () => {
  const emit = (content: string) =>
    generateMultiPageZPL(
      { widthMm: 70, heightMm: 40, dpmm: 8 },
      [{
        objects: [{
          id: "s", type: "datamatrix", x: 10, y: 10, rotation: 0,
          props: { content, gs1: true, dimension: 6, quality: 200, rotation: "N" },
        } as never],
      }],
      [{ id: "v1", name: "LOT", fnNumber: 1, defaultValue: "L42" }],
    );

  it("is judged the same with or without an unresolved marker", () => {
    // (99) is company-internal and the catalog carries no spec for it, so the
    // template path must not canonicalise what the literal path refuses.
    expect(emit("(9999)«LOT»")).toContain("(9999)");
    expect(planGs1Fd("(9999)ABC", "datamatrix").fd).toContain("(9999)");
  });
});

describe("a GS1 content whose GTIN is literal but another value is bound", () => {
  const emit = (content: string, type: string) =>
    generateMultiPageZPL(
      { widthMm: 70, heightMm: 40, dpmm: 8 },
      [{
        objects: [{
          id: "s", type, x: 10, y: 10, rotation: 0,
          props: { content, gs1: true, dimension: 6, quality: 200, rotation: "N", height: 60, moduleWidth: 2 },
        } as never],
      }],
      [{ id: "v2", name: "LOT", fnNumber: 2, defaultValue: "L42" }],
    );

  // The literal path completes AI 01 to 14 digits with its check digit, so a
  // bound sibling must not change the number the scanner reads.
  it("still completes the GTIN on both carriers", () => {
    expect(emit("(01)5901234123457(10)«LOT»", "datamatrix")).toContain("_10159012341234576");
    expect(emit("(01)5901234123457(10)«LOT»", "code128")).toContain("(01)59012341234576");
  });
});

describe("GS1 content the catalog can only partly segment", () => {
  // parseGs1ToSegments returns what it could read; the rest is still the user's
  // data and must reach the symbol (roundtrip rule).
  it("carries the unsegmented tail into the ^BX payload", () => {
    const plan = planGs1Fd("(01)09501101530003TRAILING", "datamatrix");
    expect(plan.fd).toContain("TRAILING");
  });
});

describe("a marked GS1 DataMatrix the canvas has to measure", () => {
  // The canvas encodes bwipParsefncText while ^BX ships fd. Reading the raw
  // content for the preview kept the parens and one leading FNC1, so the two
  // sized the symbol from different data (DM steps up in discrete sizes).
  it("previews the runs the ^FD ships, not the parenthesized content", () => {
    const plan = planGs1Fd("(01)«GTIN»(10)ABC", "datamatrix");
    expect(plan.bwipParsefncText).toBe("^FNC101«GTIN»10ABC");
    expect(plan.fd).not.toContain("(");
  });

  it("separates the preview runs wherever the ^FD separates them", () => {
    // AI 10 is variable-length, so a following AI needs its own FNC1 in both.
    const plan = planGs1Fd("(10)«LOT»(11)260809", "datamatrix");
    expect(plan.bwipParsefncText).toBe("^FNC110«LOT»^FNC111260809");
    // The marker's guillemets are non-printable bytes, hence the _dNNN escapes.
    expect(plan.fd).toBe("_110_d171LOT_d187_111260809");
  });
});

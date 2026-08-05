import { describe, expect, it } from "vitest";
import { planGs1Fd } from "./gs1Plan";
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

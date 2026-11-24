import { describe, it, expect } from "vitest";
import { getEntry } from "@zplab/core/registry";
import { serialDisablePatch, serialEnablePatch, serialFieldData, sfIncrementValue, SERIAL_DEFAULT, type SerialMode } from "@zplab/core/registry/serialField";

describe("serialisable capability (matches what the emitter actually emits)", () => {
  it("is set for text and free-data 1D symbologies", () => {
    for (const type of ["text", "code128", "code39", "code93", "interleaved2of5"]) {
      expect(getEntry(type)?.serialisable).toBe(true);
    }
  });

  it("is off for EAN/UPC (fixed check digit)", () => {
    for (const type of ["ean13", "ean8", "upca", "upce"]) {
      expect(getEntry(type)?.serialisable).toBeFalsy();
    }
  });

  it("is off for 2D/stacked and structured symbologies (emitters ignore ^SN/^SF)", () => {
    for (const type of ["qrcode", "datamatrix", "pdf417", "aztec", "micropdf417", "codablock", "code49", "gs1databar", "maxicode", "tlc39"]) {
      expect(getEntry(type)?.serialisable).toBeFalsy();
    }
  });
});

describe("serialEnablePatch / serialDisablePatch (checkbox props patches)", () => {
  it("on: defaults the mode, filters the seed, snapshots the raw template", () => {
    expect(serialEnablePatch("«sku»-7", "AB-12 34")).toEqual({
      serial: { ...SERIAL_DEFAULT },
      content: "AB1234",
      preSerialContent: "«sku»-7",
    });
  });

  it("on: intersects with the symbology charset", () => {
    expect(serialEnablePatch("AB1234", "AB1234", { charset: "0-9" }).content).toBe("1234");
  });

  it("off: restores the snapshot and clears it", () => {
    expect(serialDisablePatch({ preSerialContent: "«sku»-7" })).toEqual({
      serial: undefined,
      preSerialContent: undefined,
      content: "«sku»-7",
    });
  });

  it("off without a snapshot (parser import) keeps the seed", () => {
    expect(serialDisablePatch({})).toEqual({ serial: undefined, preSerialContent: undefined });
  });
});

const sf = (increment: number): SerialMode => ({ increment, zplMode: "SF" });

describe("serialFieldData for ^SF", () => {
  it("writes a plain number while it lands on digit positions", () => {
    expect(serialFieldData("001", sf(1))).toBe("^FD001^SFddd,1^FS");
    expect(serialFieldData("A0090", sf(12))).toBe("^FDA0090^SFAdddd,12^FS");
  });

  it("writes the increment in the radix of the positions it lands on", () => {
    expect(serialFieldData("AB", sf(1))).toBe("^FDAB^SFAA,B^FS");
    expect(serialFieldData("A9", sf(12))).toBe("^FDA9^SFAd,B2^FS");
    expect(serialFieldData("1a", sf(27))).toBe("^FD1a^SFda,1b^FS");
  });

  it("counts down with the complement", () => {
    expect(serialFieldData("010", sf(-1))).toBe("^FD010^SFddd,999^FS");
  });

  it("keeps the plain number on an empty seed", () => {
    expect(serialFieldData("", sf(1))).toBe("^FD^SF,1^FS");
  });
});

describe("sfIncrementValue", () => {
  it("reads the increment back against the classes of the data", () => {
    expect(sfIncrementValue("001", "ddd", "1")).toBe(1);
    expect(sfIncrementValue("AB", "AA", "B")).toBe(1);
    expect(sfIncrementValue("A9", "Ad", "B2")).toBe(12);
    expect(sfIncrementValue("1a", "da", "1b")).toBe(27);
  });

  it("counts a character that does not belong to its position as nothing", () => {
    expect(sfIncrementValue("A9", "Ad", "12")).toBe(2);
    expect(sfIncrementValue("010", "ddd", "-1")).toBe(1);
  });

  it("reads only the characters that lie over the data", () => {
    expect(sfIncrementValue("5", "d", "-1")).toBe(1);
    expect(sfIncrementValue("m1h6", "adad", "90006")).toBe(6);
  });

  it("skips a % position and what lies left of a shorter mask", () => {
    expect(sfIncrementValue("xN", "a%", "O")).toBe(0);
    expect(sfIncrementValue("1234", "dd", "100")).toBe(0);
    expect(sfIncrementValue("ABCD1000EFGH", "%%%%dddd%%%%", "10000")).toBe(26 ** 4);
  });

  it("gives a character the export drops no position of its own", () => {
    expect(sfIncrementValue("BL00-0", "AAdd%d", "1%1")).toBe(11);
    expect(sfIncrementValue("C10 ", "Add%", "51%")).toBe(51);
  });

  it("counts a surrogate pair as one position, as the export does", () => {
    expect(sfIncrementValue("1😀2", "d%d", "1%1")).toBe(11);
  });

  it("puts an empty increment's one in the last position the mask counts", () => {
    expect(sfIncrementValue("007", "ddd", "")).toBe(1);
    expect(sfIncrementValue("12X", "dd%", "")).toBe(26);
    expect(sfIncrementValue("12X", "", "")).toBe(0);
  });

  it("reads a string that counts nowhere as zero", () => {
    expect(sfIncrementValue("AB", "AA", "A")).toBe(0);
    expect(sfIncrementValue("AA", "AA", "1")).toBe(0);
    expect(sfIncrementValue("q", "a", "T")).toBe(0);
  });
});

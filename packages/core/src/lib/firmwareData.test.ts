import { describe, expect, it } from "vitest";
import bwipjs from "bwip-js/generic";
import { getEntry, type LeafObject } from "../registry";
import { barcodeEncodeIssueWith, type BwipEngine } from "./barcodeDims";
import { hriText } from "./barcodeHri";
import { firmwareData } from "./firmwareData";

describe("firmwareData", () => {
  // Each row is a ZD230 preview of the right-hand data.
  it.each<[string, string, string]>([
    ["ean13", "12345", "000000012345"],
    ["ean13", "5901234123450", "590123412345"],
    ["ean8", "123", "0000123"],
    ["ean8", "12345679", "1234567"],
    ["upca", "123", "00000000123"],
    ["upca", "123456789019", "12345678901"],
    ["upcEanExtension", "1", "01"],
    ["upcEanExtension", "123", "00123"],
    ["upcEanExtension", "1234", "01234"],
    ["upcEanExtension", "123456", "12345"],
    ["upcEanExtension", "1234567", "12345"],
    ["code39", "abc", "ABC"],
    ["code93", "abc", "ABC"],
    ["logmars", "abc", "ABC"],
    ["codabar", "a123b", "A123B"],
    ["plessey", "ab12", "AB12"],
  ])("reads %s data %s as %s", (type, typed, encoded) => {
    expect(firmwareData(type, typed)).toBe(encoded);
  });

  it("uppercases a to z and leaves other letters", () => {
    expect(firmwareData("code93", "stra" + String.fromCharCode(223) + "e")).toBe("STRA" + String.fromCharCode(223) + "E");
  });

  it.each(["code93", "codabar", "plessey"])("shows the encoded data in the %s line", (type) => {
    expect(hriText(type, "ab12")).toBe("AB12");
  });

  it.each(["123", "12a3"])("shows PLANET data %s without the fill in the line", (typed) => {
    expect(hriText("planet", typed)).toBe("123");
  });

  it.each<[string, string]>([
    ["ean13", "12345678901234"],
    ["ean8", "123456789"],
    ["upca", "1234567890123"],
    ["ean13", "12A45"],
    ["ean13", ""],
  ])("leaves %s data %s as typed, where the printer prints something else or nothing", (type, typed) => {
    expect(firmwareData(type, typed)).toBe(typed);
  });
});

describe("the print check on data the firmware adjusts", () => {
  const leaf = (type: string, content: string) =>
    ({ id: "x", type, x: 0, y: 0, rotation: 0, props: { ...(getEntry(type)?.defaultProps as object), content } }) as unknown as LeafObject;

  it.each<[string, string]>([
    ["ean13", "12345"],
    ["ean13", "5901234123450"],
    ["ean8", "123"],
    ["upca", "123"],
    ["upcEanExtension", "1"],
    ["upcEanExtension", "123"],
    ["code93", "abc"],
  ])("takes %s data %s, which the printer prints", (type, content) => {
    expect(barcodeEncodeIssueWith(bwipjs as unknown as BwipEngine, leaf(type, content), 8)).toBeNull();
  });

  it("refuses an EAN-13 that is two digits too long", () => {
    expect(barcodeEncodeIssueWith(bwipjs as unknown as BwipEngine, leaf("ean13", "12345678901234"), 8)).not.toBeNull();
  });
});

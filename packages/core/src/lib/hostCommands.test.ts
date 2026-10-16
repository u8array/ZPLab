import { describe, expect, it } from "vitest";
import { repliesToHost } from "./hostCommands";

describe("repliesToHost", () => {
  it("accepts only the prefix the catalog spells", () => {
    expect(repliesToHost("^XA~HS^HW^XZ")).toEqual(["~HS", "^HW"]);
    expect(repliesToHost("^XA^HS~HW^FO10,10^XZ")).toEqual([]);
  });

  it("names every spelling once, in the order the printer meets them", () => {
    expect(repliesToHost("^XA^HW R:*.*^FO10,10^FDx^FS~HS^HH~HS^XZ")).toEqual(["^HWR:*.*", "~HS", "^HH"]);
    expect(repliesToHost("^XA~HQES~HQHA~HQES^XZ")).toEqual(["~HQES", "~HQHA"]);
  });

  it("is empty for a document that only prints", () => {
    expect(repliesToHost("^XA^FO10,10^A0N,20,20^FDHS^FS^XZ")).toEqual([]);
  });

  // ^HW is a format command, so inside field data it is data, while an immediate ~HS acts anywhere.
  it("leaves a tilde the firmware does not intercept as field data", () => {
    expect(repliesToHost("^XA^FO10,10^FDsend ~HW the drive^FS^XZ")).toEqual([]);
  });

  it("counts an immediate host command inside field data", () => {
    expect(repliesToHost("^XA^FO10,10^FDbefore ~HS after^FS^XZ")).toEqual(["~HS"]);
  });

  it("asks a format command stored behind a ^DF only where the same bytes recall the frame", () => {
    const frame = "^XA^DFR:A.ZPL^FS^FO10,10^A0N,20,20^FN1^FS^HWR:*.*^HV1,20,H,E,F~HS^XZ";
    expect(repliesToHost(frame)).toEqual(["~HS"]);
    expect(repliesToHost(`${frame}^XA^XFR:A.ZPL^FS^FN1^FDone^FS^XZ`)).toEqual(["~HS", "^HWR:*.*", "^HV1,20,H,E,F"]);
    expect(repliesToHost(`${frame}^XA^XFR:B.ZPL^FS^XZ`)).toEqual(["~HS"]);
    expect(repliesToHost("^XA^HWR:*.*^DFR:A.ZPL^FS^XZ")).toEqual(["^HWR:*.*"]);
    expect(repliesToHost("^XA^FO10,10^FDx^FS^DFR:A.ZPL^FS^HWR:*.*^XZ")).toEqual([]);
  });

  it("resolves a recall like the printer: the device search order, a defaulted extension, and no match for another named device", () => {
    expect(repliesToHost("^XA^DFE:A.ZPL^FS^FN1^FS^HWR:*.*^XZ^XA^XFA.ZPL^FS^FN1^FDx^FS^XZ")).toEqual(["^HWR:*.*"]);
    expect(repliesToHost("^XA^DFR:A.ZPL^FS^FN1^FS^HWR:*.*^XZ^XA^XFR:A^FS^FN1^FDx^FS^XZ")).toEqual(["^HWR:*.*"]);
    expect(repliesToHost("^XA^DFE:A.ZPL^FS^FN1^FS^HWR:*.*^XZ^XA^XFR:A.ZPL^FS^FN1^FDx^FS^XZ")).toEqual([]);
  });

  it("keeps a recall inside a stored frame for that frame's own recall, in either declaration order, through a chain and past a cycle", () => {
    const storeA = "^XA^DFR:A.ZPL^FS^FO10,10^A0N,20,20^FN1^FS^HWR:*.*^XZ";
    const storeB = "^XA^DFR:B.ZPL^FS^XFR:A.ZPL^FS^HT^XZ";
    expect(repliesToHost(storeA + storeB)).toEqual([]);
    expect(repliesToHost(storeA + storeB + "^XA^XFR:B.ZPL^FS^XZ")).toEqual(["^HWR:*.*", "^HT"]);
    expect(repliesToHost(storeB + storeA + "^XA^XFR:B.ZPL^FS^XZ")).toEqual(["^HWR:*.*", "^HT"]);
    const storeC = "^XA^DFR:C.ZPL^FS^XFR:B.ZPL^FS^HH^XZ";
    expect(repliesToHost(storeA + storeB + storeC + "^XA^XFR:C.ZPL^FS^XZ")).toEqual(["^HWR:*.*", "^HT", "^HH"]);
    const self = "^XA^DFR:S.ZPL^FS^HWE:*.*^XFR:S.ZPL^FS^XZ";
    expect(repliesToHost(self + "^XA^XFR:S.ZPL^FS^XZ")).toEqual(["^HWE:*.*"]);
  });

  it("names the frame after the first usable ^DF, a later one being stored text", () => {
    const block = "^XA^DFR:A.ZPL^FS^HZA^FS^DFR:B.ZPL^FS^HH^FS^XZ";
    expect(repliesToHost(block + "^XA^XFR:B.ZPL^FS^XZ")).toEqual([]);
    expect(repliesToHost(block + "^XA^XFR:A.ZPL^FS^XZ")).toEqual(["^HZA", "^HH"]);
  });

  it("answers a format command only inside an open format, an immediate one anywhere", () => {
    expect(repliesToHost("^HWR:*.*^XA^FO10,10^FDx^FS^XZ")).toEqual([]);
    expect(repliesToHost("^XA^FO10,10^FDx^FS^XZ^HWR:*.*")).toEqual([]);
    expect(repliesToHost("^XA^FO10,10^FDx^FS^XZ~HS")).toEqual(["~HS"]);
    expect(repliesToHost("^HWR:*.*")).toEqual([]);
    expect(repliesToHost("^XA^DFR:A.ZPL^FS^HWR:*.*^XZ^XFR:A.ZPL")).toEqual([]);
  });

  it("follows a ^CT remap to the new tilde char", () => {
    expect(repliesToHost("^XA^CT/^FS/HS^XZ")).toEqual(["~HS"]);
    expect(repliesToHost("^XA^CT/^FS~HS^XZ")).toEqual([]);
  });

  it("follows a ^CC remap to the new caret char", () => {
    expect(repliesToHost("^XA^CC//HWR:*.*//XZ")).toEqual(["^HWR:*.*"]);
  });
});

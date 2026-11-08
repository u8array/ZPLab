import { describe, expect, it } from "vitest";
import { fieldHostParams, hostCommandAsks, walkHostCommands } from "./hostCommands";

describe("fieldHostParams", () => {
  it("reads the slot, the header, the terminator and the per-label flag, each with a default", () => {
    expect(fieldHostParams("1,20,HEAD,END,F")).toEqual({ slot: 1, bytes: 20, header: "HEAD", terminator: "END", perLabel: false });
    expect(fieldHostParams("12,20,, END , l")).toEqual({ slot: 12, bytes: 20, header: "", terminator: " END ", perLabel: true });
    expect(fieldHostParams("3")).toEqual({ slot: 3, bytes: 64, header: "", terminator: "", perLabel: false });
    expect(fieldHostParams("")).toEqual({ slot: 0, bytes: 64, header: "", terminator: "", perLabel: false });
    expect(fieldHostParams("1;20;H,X;E;L", ";")).toEqual({ slot: 1, bytes: 20, header: "H,X", terminator: "E", perLabel: true });
    expect(["1,1", "1, 256 ", "1,0", "1,257", "1,x", "1,1.5"].map((params) => fieldHostParams(params).bytes)).toEqual([1, 256, 64, 64, 64, 1]);
  });
});

describe("hostCommandAsks", () => {
  const labelsOf = (zpl: string) => hostCommandAsks(zpl).map((a) => `${a.id}:${a.ask}:${a.labels}`);
  const dataOf = (zpl: string) => hostCommandAsks(zpl).filter((a) => a.ask === "asked").map((a) => a.data);

  it("counts the labels the document prints, and none for a format without a field", () => {
    const printed = (zpl: string) => walkHostCommands(zpl).labels;
    expect(printed("^XA^FN1^FDx^FS^HV1,20,H,E,L^PQ2^XZ")).toBe(2);
    expect(printed("^XA^FO10,10^GB10,10,1^FS^XZ^XA^FDx^PQ4^XZ")).toBe(5);
    expect(printed("^XA~HS^XZ^XA^PQ3^XZ^XA^HV1,20,H,E,F^XZ")).toBe(0);
    const frame = "^XA^DFR:A.ZPL^FS^FN1^FS^HV1,20,H,E,L^XZ";
    expect(printed(`${frame}^XA^XFR:A.ZPL^FS^PQ2^XZ^XA^XFR:B.ZPL^FS^XZ`)).toBe(3);
    expect(printed("^XA^DFR:A.ZPL^XZ^XA^XFR:A.ZPL^PQ2^XZ^XA^XFR:B.ZPL^PQ3^XZ")).toBe(3);
    expect(printed("^XA^RT1^PQ2^XZ^XA^FN1^PQ4^XZ")).toBe(6);
    expect(printed("^FN1^FDx^FS^PQ2")).toBe(0);
    expect(printed("^XA^FO10,10^A0N,30,30^SN001,1,Y^PQ2^XZ")).toBe(2);
    expect(printed("^XA^FO10,10^RFR,H^PQ2^XZ")).toBe(2);
    expect(printed("^XA^FO10,10^A0N,30,30^SFddd^PQ2^XZ")).toBe(0);
  });

  it("gives every answered command the labels of its format, from a ^PQ before or behind it, and none without a field", () => {
    expect(labelsOf("^XA^PQ3^FDx^FS^HV1,20,H,E,L~HS^XZ")).toEqual(["^HV:asked:3", "~HS:asked:3"]);
    expect(labelsOf("^XA^PQ100000000^FDx^FS^HV1,20^XZ^HV2,20")).toEqual(["^HV:asked:100000000", "^HV:ignored:0"]);
    expect(labelsOf("^XA^PQ3^PQ0^FDx^FS^HV1,20^XZ^XA^CD;^PQ4;1^FDx^FS^HV1,20^XZ")).toEqual(["^HV:asked:3", "^HV:asked:4"]);
    expect(labelsOf("^XA^PQ3^FDx^FS^HV1,20,H,E,L")).toEqual(["^HV:asked:3"]);
    expect(labelsOf("^XA^FDx^FS^HV1,20,H,E,L^PQ3^XZ^XA^FDx^FS^HV1,20,H,E,L^XZ")).toEqual(["^HV:asked:3", "^HV:asked:1"]);
    expect(labelsOf("^XA^PQ0^FDx^FS^HV1,20^XZ^XA^PQ 2,1^FDx^FS^HV1,20^XZ")).toEqual(["^HV:asked:1", "^HV:asked:2"]);
    expect(labelsOf("^XA^PQ3^PQ^FDx^FS^HV1,20,H,E,L^XZ^XA^PQ,2^FDx^FS^HV1,20,H,E,L^XZ")).toEqual(["^HV:asked:1", "^HV:asked:1"]);
    expect(labelsOf("^XA^PQ3^HV1,20,H,E,L~HS^XZ")).toEqual(["^HV:asked:0", "~HS:asked:0"]);
  });

  it("replays a stored ^PQ at the recall, where a later ^PQ in the recalling format wins", () => {
    const frame = "^XA^DFR:A.ZPL^FS^FN1^FS^PQ5^HV1,20,H,E,L^XZ";
    expect(labelsOf(frame)).toEqual(["^HV:stored:0"]);
    expect(labelsOf("^XA^HWR:*.*^HV1,20,H,E^DFR:A.ZPL^FS^PQ5^XZ")).toEqual(["^HW:asked:0", "^HV:asked:0"]);
    expect(labelsOf(`${frame}^XA^XFR:A.ZPL^FS^FN1^FDa^FS^XZ`).at(-1)).toBe("^HV:asked:5");
    expect(labelsOf(`${frame}^XA^PQ2^XFR:A.ZPL^FS^FN1^FDa^FS^XZ`).at(-1)).toBe("^HV:asked:5");
    expect(labelsOf(`${frame}^XA^XFR:A.ZPL^FS^FN1^FDa^FS^PQ2^XZ`).at(-1)).toBe("^HV:asked:2");
  });

  it("gives a ^HV the field data of its slot from the printing format, decoded under ^FH, and none where the document holds none", () => {
    expect(dataOf("^XA^HV1,20,H,E^FN1^FDone^FS^FN2^FVtwo^FS^HV2,20,H,E^HV3,20,H,E^XZ")).toEqual([["one"], ["two"], []]);
    expect(dataOf("^XA^FH_^FN1^FD_45H^FS^HV1,20,H,E^XZ^XA^FN1^FDx^XZ^XA^HV1,20,H,E^XZ")).toEqual([["EH"], []]);
    expect(dataOf("^XA^FN1^FDa^FS^FDb^FS^FN1^SNx^FS^HV1,20,H,E^XZ")).toEqual([["a"]]);
    expect(dataOf("^XA^FN1^FDaH^FS^FN1^FV^FS^HV1,20,H,E^XZ")).toEqual([["aH"]]);
    expect(dataOf("^XA^FN1^FDa\r\nb^FS^HV1,20,H,E^XZ")).toEqual([["ab"]]);
    expect(dataOf("^XA^DFR:A.ZPL^FS^FN1^FDstored^FS^HV1,20,H,E^XZ^XA^XFR:A.ZPL^FS^FN1^FDfilled^FS^XZ^XA^XFR:A.ZPL^FS^XZ")).toEqual([["stored", "filled"], ["stored"]]);
  });

  it("cuts the field data to the bytes the ^HV returns, as the transport decodes them", () => {
    expect(dataOf("^XA^FN1^FDabc^FS^HV1,2,H,E^XZ")).toEqual([["ab"]]);
    expect(dataOf(`^XA^FN1^FD${"x".repeat(70)}^FS^HV1,,H,E^HV1,300,H,E^HV1,256,H,E^XZ`)).toEqual([["x".repeat(64)], ["x".repeat(64)], ["x".repeat(70)]]);
    expect(dataOf("^XA^FN1^FD\u00e4^FS^HV1,1,H,E^XZ")).toEqual([["\ufffd"]]);
    expect(dataOf("^XA^FH_^FN1^FD_E4H^FS^HV1,2,H,E^XZ")).toEqual([["\ufffdH"]]);
    expect(dataOf("^XA^FH_^FN1^FD\u00e4_45^FS^HV1,2,H,E^HV1,3,H,E^XZ")).toEqual([["\u00e4"], ["\u00e4E"]]);
    expect(dataOf("^XA^DFR:A.ZPL^FS^FN1^FDabc^FS^HV1,2,H,E^XZ^XA^XFR:A.ZPL^FS^FN1^FDabd^FS^XZ")).toEqual([["ab"]]);
  });
});

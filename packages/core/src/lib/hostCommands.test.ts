import { describe, expect, it } from "vitest";
import { fieldHostParams, hostCommandAsks } from "./hostCommands";

describe("fieldHostParams", () => {
  it("reads the slot, the header, the terminator and the per-label flag, each with a default", () => {
    expect(fieldHostParams("1,20,HEAD,END,F")).toEqual({ slot: 1, bytes: 20, header: "HEAD", terminator: "END", perLabel: false });
    expect(fieldHostParams("12,20,, END , l")).toEqual({ slot: 12, bytes: 20, header: "", terminator: " END ", perLabel: true });
    expect(fieldHostParams("3")).toEqual({ slot: 3, bytes: 64, header: "", terminator: "", perLabel: false });
    expect(fieldHostParams("")).toEqual({ slot: 0, bytes: 64, header: "", terminator: "", perLabel: false });
    expect(fieldHostParams("1;20;H,X;E;L", ";")).toEqual({ slot: 1, bytes: 20, header: "H,X", terminator: "E", perLabel: true });
    // The reply carries 1 to 256 bytes of the field, 64 unless spelled so (spec p.239).
    expect(["1,1", "1, 256 ", "1,0", "1,257", "1,x", "1,1.5"].map((params) => fieldHostParams(params).bytes)).toEqual([1, 256, 64, 64, 64, 1]);
  });
});

describe("hostCommandAsks", () => {
  const plain = { caretChar: "^", tildeChar: "~", delimiterChar: "," };
  // The tokenizer carries a ^CD remap in the chars it is handed, so each call gets its own copy.
  const labelsOf = (zpl: string) => hostCommandAsks(zpl, { ...plain }).map((a) => `${a.id}:${a.ask}:${a.labels}`);
  const dataOf = (zpl: string) => hostCommandAsks(zpl, { ...plain }).filter((a) => a.ask === "asked").map((a) => a.data);

  it("gives every answered command the labels of its format, from a ^PQ before or behind it", () => {
    expect(labelsOf("^XA^PQ3^HV1,20,H,E,L~HS^XZ")).toEqual(["^HV:asked:3", "~HS:asked:3"]);
    expect(labelsOf("^XA^PQ100000000^HV1,20^XZ^HV2,20")).toEqual(["^HV:asked:100000000", "^HV:ignored:0"]);
    expect(labelsOf("^XA^PQ3^PQ0^HV1,20^XZ^XA^CD;^PQ4;1^HV1,20^XZ")).toEqual(["^HV:asked:3", "^HV:asked:4"]);
    expect(labelsOf("^XA^PQ3^HV1,20,H,E,L")).toEqual(["^HV:asked:3"]);
    expect(labelsOf("^XA^HV1,20,H,E,L^PQ3^XZ^XA^HV1,20,H,E,L^XZ")).toEqual(["^HV:asked:3", "^HV:asked:1"]);
    expect(labelsOf("^XA^PQ0^HV1,20^XZ^XA^PQ 2,1^HV1,20^XZ")).toEqual(["^HV:asked:1", "^HV:asked:2"]);
    // A bare q is the spec's default of 1, p.324.
    expect(labelsOf("^XA^PQ3^PQ^HV1,20,H,E,L^XZ^XA^PQ,2^HV1,20,H,E,L^XZ")).toEqual(["^HV:asked:1", "^HV:asked:1"]);
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
    // An empty ^FV is ignored, spec p.207, so the ^FD stays.
    expect(dataOf("^XA^FN1^FDaH^FS^FN1^FV^FS^HV1,20,H,E^XZ")).toEqual([["aH"]]);
    expect(dataOf("^XA^FN1^FDa\r\nb^FS^HV1,20,H,E^XZ")).toEqual([["ab"]]);
    // The stored ^FD seals the slot on the ZD230 and the recall's prints as a stray field, so both may be what the ^HV returns.
    expect(dataOf("^XA^DFR:A.ZPL^FS^FN1^FDstored^FS^HV1,20,H,E^XZ^XA^XFR:A.ZPL^FS^FN1^FDfilled^FS^XZ^XA^XFR:A.ZPL^FS^XZ")).toEqual([["stored", "filled"], ["stored"]]);
  });

  it("cuts the field data to the bytes the ^HV returns, as the transport decodes them", () => {
    expect(dataOf("^XA^FN1^FDabc^FS^HV1,2,H,E^XZ")).toEqual([["ab"]]);
    expect(dataOf(`^XA^FN1^FD${"x".repeat(70)}^FS^HV1,,H,E^HV1,300,H,E^HV1,256,H,E^XZ`)).toEqual([["x".repeat(64)], ["x".repeat(64)], ["x".repeat(70)]]);
    expect(dataOf("^XA^FN1^FD\u00e4^FS^HV1,1,H,E^XZ")).toEqual([["\ufffd"]]);
    // A ^FH run is the bytes it spells, so the cut falls on them and the transport decodes what is left.
    expect(dataOf("^XA^FH_^FN1^FD_E4H^FS^HV1,2,H,E^XZ")).toEqual([["\ufffdH"]]);
    expect(dataOf("^XA^FH_^FN1^FD\u00e4_45^FS^HV1,2,H,E^HV1,3,H,E^XZ")).toEqual([["\u00e4"], ["\u00e4E"]]);
    expect(dataOf("^XA^DFR:A.ZPL^FS^FN1^FDabc^FS^HV1,2,H,E^XZ^XA^XFR:A.ZPL^FS^FN1^FDabd^FS^XZ")).toEqual([["ab"]]);
  });
});

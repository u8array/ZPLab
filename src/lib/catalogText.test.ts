import { describe, it, expect } from "vitest";
import { referenceRows, syntaxSegments } from "./catalogText";

describe("syntaxSegments", () => {
  it("marks each slot letter and leaves the command name literal", () => {
    expect(syntaxSegments("^A0o,h,w", ["o", "h", "w"])).toEqual([
      { text: "^A0", slot: null },
      { text: "o", slot: 0 },
      { text: ",", slot: null },
      { text: "h", slot: 1 },
      { text: ",", slot: null },
      { text: "w", slot: 2 },
    ]);
  });

  it("keeps adjacent slot letters apart, so each carries its own parameter index", () => {
    expect(syntaxSegments("^Afo,h", ["f", "o", "h"])).toEqual([
      { text: "^A", slot: null },
      { text: "f", slot: 0 },
      { text: "o", slot: 1 },
      { text: ",", slot: null },
      { text: "h", slot: 2 },
    ]);
  });
});

describe("referenceRows", () => {
  const params = [
    { name: "x", meaning: "horizontal position in dots", values: "0 to 32000", default: "0" },
    { name: "y", meaning: "vertical position in dots", values: "0 to 32000", default: "0" },
  ];

  it("takes each row from the translation where it has one and from English otherwise", () => {
    const rows = referenceRows(params, { hash: "s", summary: "", reference: { hash: "r", params: [{ meaning: "horizontale Position", values: "0 bis 32000", default: "0" }] } });
    expect(rows.map((r) => r.meaning)).toEqual(["horizontale Position", "vertical position in dots"]);
    expect(rows.map((r) => r.name)).toEqual(["x", "y"]);
  });

  it("is English without a translation", () => {
    expect(referenceRows(params, undefined).map((r) => r.values)).toEqual(["0 to 32000", "0 to 32000"]);
  });
});

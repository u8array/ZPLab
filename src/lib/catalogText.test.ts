import { describe, it, expect } from "vitest";
import { syntaxSegments } from "./catalogText";

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

import { describe, it, expect } from "vitest";
import { diffLines, mapOffset, rangeMatched } from "./lineDiff";

const NL = String.fromCharCode(10);
const j = (...lines: string[]) => lines.join(NL);

describe("diffLines", () => {
  it("anchors unique lines and grows over equal neighbours", () => {
    const a = j("^XA", "^FO1^FDa^FS", "^FO2^FDb^FS", "^XZ");
    const b = j("^XA", "^FO1^FDa^FS", "^FO9^FDnew^FS", "^FO2^FDb^FS", "^XZ");
    const d = diffLines(a, b);
    expect([...d.aToB.entries()].sort()).toEqual([[0, 0], [1, 1], [2, 3], [3, 4]]);
  });

  it("maps a changed line to the same place inside its block and a deleted one as deleted", () => {
    const a = j("^XA", "^FO1^FDa^FS", "^FO2^FDb^FS", "^XZ");
    const changed = j("^XA", "^FO1^FDa^FS", "^FO2^FDB^FS", "^XZ");
    expect(mapOffset(diffLines(a, changed), a.indexOf("^FO2"))).toEqual({ offset: changed.indexOf("^FO2"), deleted: false });
    const deleted = j("^XA", "^FO1^FDa^FS", "^XZ");
    expect(mapOffset(diffLines(a, deleted), a.indexOf("^FO2")).deleted).toBe(true);
    // Three lines became one: the first takes its place, the rest are gone.
    const shrunk = diffLines(j("^XA", "^FO1^FDa^FS", "^FO2^FDb^FS", "^FO3^FDc^FS"), j("^XA", "^FO9^FDz^FS"));
    expect(mapOffset(shrunk, a.indexOf("^FO1")).deleted).toBe(false);
    expect(mapOffset(shrunk, a.indexOf("^FO2")).deleted).toBe(true);
  });

  it("ignores a CR, treats the text end as its own line and survives an empty b", () => {
    const a = j("^XA", "^FO1^FDa^FS", "^XZ");
    const crlf = a.replace(/\n/g, "\r\n");
    expect([...diffLines(crlf, a).aToB.entries()].sort()).toEqual([[0, 0], [1, 1], [2, 2]]);
    const trailing = diffLines(a + NL, a + NL);
    expect(trailing.aStarts).toHaveLength(4);
    expect(mapOffset(trailing, a.length + 1)).toEqual({ offset: a.length + 1, deleted: false });
    expect(mapOffset(diffLines(a, ""), 0)).toEqual({ offset: 0, deleted: false });
    expect(mapOffset(diffLines(a, ""), a.indexOf("^FO1")).deleted).toBe(true);
  });

  it("tells a fully surviving span from a touched one", () => {
    const a = j("^XA", "^FO1^FDa^FS", "^FO2^FDb^FS", "^XZ");
    const b = j("^XA", "^FO1^FDa^FS", "^FO2^FDB^FS", "^XZ");
    const d = diffLines(a, b);
    expect(rangeMatched(d, a.indexOf("^FO1"), a.indexOf("^FO2"))).toBe(true);
    expect(rangeMatched(d, a.indexOf("^FO2"), a.indexOf("^XZ"))).toBe(false);
  });
});

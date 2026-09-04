import { describe, it, expect } from "vitest";
import { diffBlocks } from "./blockDiff";
import type { SourceSpan } from "./zplParser/types";

const NL = String.fromCharCode(10);
const doc = (...blocks: string[][]): { text: string; blocks: SourceSpan[] } => {
  let text = "";
  const spans: SourceSpan[] = [];
  for (const lines of blocks) {
    const start = text.length;
    text += ["^XA", ...lines, "^XZ"].join(NL) + NL;
    spans.push({ start, end: text.length });
  }
  return { text, blocks: spans };
};
const f = (...lines: string[]) => lines.map((l) => `^FO1^FD${l}^FS`);
const pairsOf = (x: { text: string; blocks: SourceSpan[] }, y: { text: string; blocks: SourceSpan[] }) => [...diffBlocks(x.text, x.blocks, y.text, y.blocks).pairs];

describe("diffBlocks", () => {
  it("keeps equal pages in place when one of them is edited", () => {
    expect(pairsOf(doc(f("A", "B"), f("A", "B")), doc(f("A", "Z"), f("A", "B")))).toEqual([[0, 0], [1, 1]]);
    expect(pairsOf(doc(f("A", "B"), f("A", "B"), f("A", "B")), doc(f("A", "B"), f("A", "Z"), f("A", "B")))).toEqual([[0, 0], [1, 1], [2, 2]]);
    // Ambiguous by content (page 2 equals the new page 1, page 1 shares a line with each): staying wins.
    expect(pairsOf(doc(f("A", "B", "C"), f("A", "B")), doc(f("A", "B"), f("A", "C")))).toEqual([[0, 0], [1, 1]]);
  });

  it("follows a page that moved, by its unique lines, even around a rewritten one", () => {
    expect(pairsOf(doc(f("a", "h"), f("z1", "z2")), doc(f("z1", "z2"), f("a", "h")))).toEqual([[0, 1], [1, 0]]);
    expect(pairsOf(doc(f("p1", "p2"), f("m1", "m2"), f("q1", "q2")), doc(f("q1", "q2"), f("n1", "n2"), f("p1", "p2")))).toEqual([[0, 2], [1, 1], [2, 0]]);
  });

  it("matches a line repeated on every page inside its own block", () => {
    const x = doc(f("A", "B", "C"), f("A", "B", "D"));
    const y = doc(f("A", "B"), f("A", "B", "E"));
    const d = diffBlocks(x.text, x.blocks, y.text, y.blocks);
    const bOf = (block: number, line: string) => y.text.indexOf(`^FD${line}^FS`, y.blocks[block]?.start) - 4;
    expect(d.mapOffset(x.text.indexOf("^FDB^FS") - 4)).toEqual({ offset: bOf(0, "B"), deleted: false });
    expect(d.mapOffset(x.text.indexOf("^FDC^FS") - 4).deleted).toBe(true);
    const secondA = x.text.indexOf("^FDA^FS", x.blocks[1]?.start) - 4;
    expect(d.mapOffset(secondA)).toEqual({ offset: bOf(1, "A"), deleted: false });
    expect(d.rangeMatched(secondA, secondA + 9)).toBe(true);
  });

  it("pairs by distinctive lines, not by the header every block shares", () => {
    const x = doc(f("H", "A"), f("H", "B"));
    const y = doc(f("H", "B"), f("H", "A"));
    expect(pairsOf(x, y)).toEqual([[0, 1], [1, 0]]);
  });

  it("weighs a unique line over one shared by most pages", () => {
    const x = doc(f("ANCHOR0", "COMMON"), f("ANCHOR1", "COMMON"), f("ANCHOR2", "COMMON"));
    const y = doc(f("ANCHOR2", "COMMON"), f("ANCHOR0", "COMMONX", "H0"), f("ANCHOR1", "COMMON"));
    expect(pairsOf(x, y)).toEqual([[0, 1], [1, 2], [2, 0]]);
  });

  it("rescues a page moved farther than the band by its unique lines", () => {
    const pages = Array.from({ length: 12 }, (_, i) => f(`p${i}a`, `p${i}b`));
    const moved = [...pages.slice(1), pages[0]!];
    const pairs = pairsOf(doc(...pages), doc(...moved));
    expect(pairs[0]).toEqual([0, 11]);
    expect(pairs.slice(1)).toEqual(pages.slice(1).map((_, k) => [k + 1, k]));
  });

  it("ignores what trails the last ^XZ and follows equal text backwards", () => {
    const x = doc(f("S"), f("S", "T"), f("S"));
    const y = doc(f("S"), f("S"), f("S"));
    expect(pairsOf(x, { text: y.text + NL + "^FXpad^FS", blocks: [...y.blocks.slice(0, 2), { start: y.blocks[2]!.start, end: y.text.length + 9 }] })).toEqual([[0, 0], [1, 1], [2, 2]]);
    expect(pairsOf(doc(f("a", "b"), []), doc([], f("a", "b")))).toEqual([[0, 1], [1, 0]]);
  });

  it("skips an inserted page and drops a deleted one", () => {
    expect(pairsOf(doc(f("a"), [], f("z")), doc(f("a"), f("n"), [], f("z")))).toEqual([[0, 0], [1, 2], [2, 3]]);
    expect(pairsOf(doc(f("a"), [], f("z")), doc(f("a"), [], f("z"), f("t")))).toEqual([[0, 0], [1, 1], [2, 2]]);
    const x = doc(f("a"), f("b"));
    const y = doc(f("a"));
    const d = diffBlocks(x.text, x.blocks, y.text + NL + NL, y.blocks);
    expect(d.pairs.has(1)).toBe(false);
    expect(d.mapOffset(x.blocks[1]!.start).deleted).toBe(true);
    expect(d.rangeMatched(x.text.indexOf("^FDb^FS"), x.text.indexOf("^FDb^FS") + 9)).toBe(false);
  });
});

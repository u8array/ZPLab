// Correspondence between two texts made of blocks: blocks pair first, lines only
// within a pair, so a line repeated on every page still identifies itself inside its own.

import { diffLines, indexAtOrBefore, mapOffset as mapLineOffset, rangeMatched as linesMatched, splitLines, type LineDiff, type MappedOffset } from "./lineDiff";
import type { SourceSpan } from "./zplParser/types";

const NL = "\n";

export interface BlockDiff {
  /** a block index -> b block index. */
  pairs: ReadonlyMap<number, number>;
  mapOffset(offset: number): MappedOffset;
  rangeMatched(start: number, end: number): boolean;
}

/** A page keeps its place up to the document's growth plus a few reorder steps; farther moves are the rescue pass's. */
const MOVE_BAND = 8;

function blockOf(starts: readonly number[], blocks: readonly SourceSpan[], offset: number): number {
  const i = indexAtOrBefore(starts, offset);
  const block = blocks[i];
  return block && offset < block.end ? i : -1;
}

/** A block's lines up to its closing ^XZ, trailing whitespace off: the parser folds
 *  the separator after ^XZ into the block, the generator does not. */
function linesOf(text: string, span: SourceSpan): string[] {
  const lines = splitLines(text.slice(span.start, span.end)).lines.map((l) => l.trimEnd());
  const close = lines.findLastIndex((l) => l.includes("^XZ"));
  const last = lines[close];
  if (last !== undefined) {
    lines.length = close + 1;
    lines[close] = last.slice(0, last.lastIndexOf("^XZ") + 3);
  }
  while (lines.at(-1) === "") lines.pop();
  return lines;
}

/** A line's evidence for block identity: 1 when one block carries it, fading with
 *  every further block, 0 when all do (the shared format head says nothing).
 *  Counted once per block, spent once per line. */
function lineWeights(blocks: readonly (readonly string[])[]): Map<string, number> {
  const holders = new Map<string, number>();
  for (const lines of blocks) for (const l of new Set(lines)) holders.set(l, (holders.get(l) ?? 0) + 1);
  return new Map([...holders].map(([l, n]) => [l, n === blocks.length ? 0 : 1 / n]));
}

/** Weighted share of the lighter block's lines found in the other (multiset), so a page
 *  that gained or lost fields still reads as itself; 0 when either weighs nothing. */
function similarity(x: readonly string[], y: readonly string[], weight: ReadonlyMap<string, number>): number {
  const count = new Map<string, number>();
  let wx = 0;
  for (const l of x) {
    count.set(l, (count.get(l) ?? 0) + 1);
    wx += weight.get(l) ?? 0;
  }
  let shared = 0;
  let wy = 0;
  for (const l of y) {
    const w = weight.get(l) ?? 0;
    wy += w;
    const left = count.get(l) ?? 0;
    if (left > 0) {
      shared += w;
      count.set(l, left - 1);
    }
  }
  return wx === 0 || wy === 0 ? 0 : shared / Math.min(wx, wy);
}

/** Order-preserving alignment of maximal total similarity; the diagonal wins ties, so
 *  an equal page stays in place. Only blocks within `band` positions of each other may pair. */
function align(sim: (i: number, j: number) => number, n: number, m: number, band: number): Map<number, number> {
  const total = new Float64Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  const pairable = (i: number, j: number) => (Math.abs(i - j) <= band ? sim(i - 1, j - 1) : 0);
  // 0 = diagonal, 1 = up (a block skipped), 2 = left (b block skipped).
  const choice = (i: number, j: number): 0 | 1 | 2 => {
    const diag = (total[at(i - 1, j - 1)] ?? 0) + pairable(i, j);
    const up = total[at(i - 1, j)] ?? 0;
    const left = total[at(i, j - 1)] ?? 0;
    if (up > diag && up >= left) return 1;
    return left > diag ? 2 : 0;
  };
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const move = choice(i, j);
      total[at(i, j)] = move === 0 ? (total[at(i - 1, j - 1)] ?? 0) + pairable(i, j) : move === 1 ? (total[at(i - 1, j)] ?? 0) : (total[at(i, j - 1)] ?? 0);
    }
  }
  const pairs = new Map<number, number>();
  for (let i = n, j = m; i > 0 && j > 0; ) {
    const move = choice(i, j);
    if (move === 0) {
      if (pairable(i, j) > 0) pairs.set(i - 1, j - 1);
      i--;
      j--;
    } else if (move === 1) i--;
    else j--;
  }
  return pairs;
}

/** Blocks align in order by weighted lines; a leftover follows its unique lines or equal
 *  text to a free block (a moved page), and one with no evidence takes the gap its
 *  neighbours leave. A reprint equalling another page's text can still displace it. */
function pairBlocks(a: string, aBlocks: readonly SourceSpan[], aStarts: readonly number[], b: string, bBlocks: readonly SourceSpan[]): Map<number, number> {
  const aLines = aBlocks.map((s) => linesOf(a, s));
  const bLines = bBlocks.map((s) => linesOf(b, s));
  const aText = aLines.map((l) => l.join(NL));
  const bText = bLines.map((l) => l.join(NL));
  const same = (i: number, j: number) => aText[i] === bText[j];
  const weight = lineWeights([...aLines, ...bLines]);
  const weightless = (lines: readonly string[]) => lines.every((l) => (weight.get(l) ?? 0) === 0);
  const memo = new Map<number, number>();
  // Blocks made of shared lines only (an empty page) are the same block when their text is.
  const sim = (i: number, j: number): number => {
    const key = i * bBlocks.length + j;
    let s = memo.get(key);
    if (s === undefined) {
      const x = aLines[i] ?? [];
      const y = bLines[j] ?? [];
      s = weightless(x) && weightless(y) ? Number(same(i, j)) : similarity(x, y, weight);
      memo.set(key, s);
    }
    return s;
  };
  const pairs = align(sim, aBlocks.length, bBlocks.length, Math.abs(aBlocks.length - bBlocks.length) + MOVE_BAND);
  const taken = new Set(pairs.values());
  const global = diffLines(a, b);
  const bStarts = bBlocks.map((s) => s.start);
  const linked: { i: number; j: number }[] = [];
  for (const [la, lb] of global.aToB) {
    const i = blockOf(aStarts, aBlocks, global.aStarts[la] ?? -1);
    const j = blockOf(bStarts, bBlocks, global.bStarts[lb] ?? -1);
    if (i >= 0 && j >= 0 && !pairs.has(i) && !taken.has(j)) linked.push({ i, j });
  }
  linked.sort((x, y) => sim(y.i, y.j) - sim(x.i, x.j) || x.i - y.i || x.j - y.j);
  for (const { i, j } of linked) {
    if (pairs.has(i) || taken.has(j)) continue;
    pairs.set(i, j);
    taken.add(j);
  }
  aBlocks.forEach((_, i) => {
    if (pairs.has(i)) return;
    const twin = bBlocks.findIndex((_, j) => !taken.has(j) && same(i, j));
    if (twin >= 0) {
      pairs.set(i, twin);
      taken.add(twin);
    }
  });
  aBlocks.forEach((_, i) => {
    if (pairs.has(i)) return;
    const partner = (k: number) => pairs.get(k);
    let lo = -1;
    let hi = bBlocks.length;
    for (let k = i - 1; k >= 0 && lo < 0; k--) lo = partner(k) ?? -1;
    for (let k = i + 1; k < aBlocks.length && hi === bBlocks.length; k++) hi = partner(k) ?? bBlocks.length;
    // The rescue pass can cross pairs and leave no ordered gap; then any free block will do.
    const inGap = (j: number) => lo >= hi || (lo < j && j < hi);
    for (let j = 0; j < bBlocks.length; j++) {
      if (taken.has(j) || !inGap(j)) continue;
      pairs.set(i, j);
      taken.add(j);
      break;
    }
  });
  return new Map([...pairs].sort((x, y) => x[0] - y[0]));
}

/** Blocks must ascend and not overlap on either side. */
export function diffBlocks(a: string, aBlocks: readonly SourceSpan[], b: string, bBlocks: readonly SourceSpan[]): BlockDiff {
  const aStarts = aBlocks.map((s) => s.start);
  const pairs = pairBlocks(a, aBlocks, aStarts, b, bBlocks);
  const local = new Map<number, { aBlock: SourceSpan; bBlock: SourceSpan; diff: LineDiff }>();
  for (const [i, j] of pairs) {
    const aBlock = aBlocks[i];
    const bBlock = bBlocks[j];
    if (aBlock && bBlock) local.set(i, { aBlock, bBlock, diff: diffLines(a.slice(aBlock.start, aBlock.end), b.slice(bBlock.start, bBlock.end)) });
  }
  const gone = (i: number): MappedOffset => {
    let next = bBlocks.length;
    for (let k = i + 1; k < aBlocks.length; k++) {
      const j = pairs.get(k);
      if (j !== undefined) {
        next = j;
        break;
      }
    }
    return { offset: bBlocks[next]?.start ?? b.length, deleted: true };
  };
  return {
    pairs,
    mapOffset(offset) {
      const i = blockOf(aStarts, aBlocks, offset);
      const pair = local.get(i);
      if (!pair) return gone(i);
      const at = mapLineOffset(pair.diff, offset - pair.aBlock.start);
      return { offset: at.offset + pair.bBlock.start, deleted: at.deleted };
    },
    rangeMatched(start, end) {
      const pair = local.get(blockOf(aStarts, aBlocks, start));
      return pair !== undefined && linesMatched(pair.diff, start - pair.aBlock.start, end - pair.aBlock.start);
    },
  };
}

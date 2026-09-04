// Line-level correspondence between two texts: a line unique on both sides is the same
// line wherever it went. Enough for ZPL, whose fields are lines that almost always differ.

export interface LineDiff {
  aStarts: number[];
  bStarts: number[];
  /** a line index -> b line index for matched (identical) lines. */
  aToB: Map<number, number>;
}

export interface MappedOffset {
  offset: number;
  /** The a position fell into text b no longer has (a pure deletion). */
  deleted: boolean;
}

/** Lines compare without their CR: an editor may hand back an LF-normalised buffer. */
export function splitLines(text: string): { lines: string[]; starts: number[] } {
  const lines: string[] = [];
  const starts: number[] = [];
  let at = 0;
  while (at <= text.length) {
    const nl = text.indexOf("\n", at);
    const end = nl === -1 ? text.length : nl;
    starts.push(at);
    lines.push(text.slice(at, end).replace(/\r$/, ""));
    if (nl === -1) break;
    at = nl + 1;
  }
  return { lines, starts };
}

function uniqueLines(lines: readonly string[]): Map<string, number> {
  const count = new Map<string, number>();
  for (const l of lines) count.set(l, (count.get(l) ?? 0) + 1);
  const out = new Map<string, number>();
  lines.forEach((l, i) => {
    if (count.get(l) === 1) out.set(l, i);
  });
  return out;
}

export function diffLines(a: string, b: string): LineDiff {
  const A = splitLines(a);
  const B = splitLines(b);
  const ua = uniqueLines(A.lines);
  const ub = uniqueLines(B.lines);
  const pairs: { a: number; b: number }[] = [];
  for (const [line, ia] of ua) {
    const ib = ub.get(line);
    if (ib !== undefined) pairs.push({ a: ia, b: ib });
  }
  pairs.sort((x, y) => x.a - y.a);
  const aToB = new Map<number, number>();
  const bToA = new Map<number, number>();
  const link = (ia: number, ib: number): void => {
    aToB.set(ia, ib);
    bToA.set(ib, ia);
  };
  pairs.forEach(({ a: ia, b: ib }) => link(ia, ib));
  for (const { a: ia, b: ib } of pairs) {
    for (let d = 1; ; d++) {
      const x = ia + d;
      const y = ib + d;
      if (aToB.has(x) || bToA.has(y) || A.lines[x] === undefined || A.lines[x] !== B.lines[y]) break;
      link(x, y);
    }
    for (let d = 1; ; d++) {
      const x = ia - d;
      const y = ib - d;
      if (x < 0 || y < 0 || aToB.has(x) || bToA.has(y) || A.lines[x] !== B.lines[y]) break;
      link(x, y);
    }
  }
  return { aStarts: A.starts, bStarts: B.starts, aToB };
}

/** Index of the last start at or before `offset` in an ascending list; 0 before the first. */
export function indexAtOrBefore(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Where an a offset lands in b: on its matched line at the same column, else at
 *  the start of the same-ranked line inside the changed block around it; a rank the
 *  block no longer has is deleted. */
export function mapOffset(diff: LineDiff, offset: number): MappedOffset {
  const la = indexAtOrBefore(diff.aStarts, offset);
  const matched = diff.aToB.get(la);
  if (matched !== undefined) {
    const column = offset - (diff.aStarts[la] ?? 0);
    return { offset: (diff.bStarts[matched] ?? 0) + column, deleted: false };
  }
  let pa = la - 1;
  while (pa >= 0 && !diff.aToB.has(pa)) pa--;
  let na = la + 1;
  while (na < diff.aStarts.length && !diff.aToB.has(na)) na++;
  const pb = pa >= 0 ? (diff.aToB.get(pa) ?? -1) : -1;
  const nb = na < diff.aStarts.length ? (diff.aToB.get(na) ?? diff.bStarts.length) : diff.bStarts.length;
  const rank = la - pa - 1;
  if (rank >= nb - pb - 1) return { offset: diff.bStarts[nb] ?? 0, deleted: true };
  return { offset: diff.bStarts[pb + 1 + rank] ?? 0, deleted: false };
}

/** True when every line of the a range [start, end) matched. */
export function rangeMatched(diff: LineDiff, start: number, end: number): boolean {
  const first = indexAtOrBefore(diff.aStarts, start);
  const last = indexAtOrBefore(diff.aStarts, Math.max(start, end - 1));
  for (let l = first; l <= last; l++) if (!diff.aToB.has(l)) return false;
  return true;
}

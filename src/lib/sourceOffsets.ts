// String offsets of the store buffer vs CodeMirror positions: CM counts a \r\n
// as ONE position under either line-separator facet, so every seam crossing
// from one to the other derives the mapping here.
import { countBefore } from "@zplab/core/lib/sortedCount";

/** Pure-CRLF test for the editor's lineSeparator facet: only a buffer with no
 *  bare \n may pin CRLF, else the LF parts collapse into one editor line. The
 *  facet is fixed at mount, so the mount key and the mount read MUST agree. */
export const isPureCrlf = (text: string): boolean => /\r\n/.test(text) && !/(?<!\r)\n/.test(text);

/** Sorted string offsets of every \r\n. */
export function crlfIndex(text: string): number[] {
  const idx: number[] = [];
  for (let i = text.indexOf("\r\n"); i !== -1; i = text.indexOf("\r\n", i + 2)) idx.push(i);
  return idx;
}

/** Editor position of a string offset; `idx` is the crlfIndex of the same text. */
export const toDocPos = (idx: readonly number[], offset: number): number => offset - countBefore(idx, offset);

/** Smallest replacement turning `old` into `next`, in editor positions of the old doc;
 *  `lineBreak` is the editor's. Under CRLF a boundary never falls inside a pair. */
export function minimalSplice(old: string, next: string, lineBreak: string): { from: number; to: number; insert: string } {
  let from = 0;
  let oldEnd = old.length;
  let newEnd = next.length;
  const minLen = Math.min(oldEnd, newEnd);
  while (from < minLen && old.charCodeAt(from) === next.charCodeAt(from)) from++;
  while (oldEnd > from && newEnd > from && old.charCodeAt(oldEnd - 1) === next.charCodeAt(newEnd - 1)) {
    oldEnd--;
    newEnd--;
  }
  if (lineBreak !== "\r\n") return { from, to: oldEnd, insert: next.slice(from, newEnd) };
  const insidePair = (at: number): boolean => old[at - 1] === "\r" && old[at] === "\n";
  if (insidePair(from)) from--;
  if (insidePair(oldEnd)) {
    oldEnd++;
    newEnd++;
  }
  const idx = crlfIndex(old);
  return { from: toDocPos(idx, from), to: toDocPos(idx, oldEnd), insert: next.slice(from, newEnd) };
}

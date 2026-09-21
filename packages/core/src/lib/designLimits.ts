import { MAX_SOURCE_PAGES } from "./zplSourceEdit";

/** Mirrors the raw-ZPL tools' input cap so preflight and emit stay bounded. The page cap is the source editor's. */
const MAX_PAGES = MAX_SOURCE_PAGES;
const MAX_TOTAL_OBJECTS = 10000;
const MAX_GROUP_DEPTH = 64;

/** Counts NODES, descending into group children: a top-level count would let
 *  one group carry an unbounded subtree past the cap into preflight. */
export function designSizeIssue(pages: readonly { objects: readonly unknown[] }[]): string | null {
  if (pages.length > MAX_PAGES) return `design exceeds the ${MAX_PAGES}-page limit`;
  let total = 0;
  const stack: [unknown, number][] = [];
  for (const p of pages) for (const o of p.objects) stack.push([o, 1]);
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const [node, depth] = next;
    total++;
    if (total > MAX_TOTAL_OBJECTS) return `design exceeds the ${MAX_TOTAL_OBJECTS}-object limit`;
    // This iterative walk is the gate for every recursive one after it, which
    // would otherwise answer a deep chain with a bare stack overflow.
    if (depth > MAX_GROUP_DEPTH) return `design exceeds the ${MAX_GROUP_DEPTH}-level group nesting limit`;
    const children = (node as { children?: unknown })?.children;
    if (Array.isArray(children)) for (const c of children) stack.push([c, depth + 1]);
  }
  return null;
}

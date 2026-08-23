import type { EmitSpan } from "@zplab/core/lib/zplGenerator";

/** Zero-based line indices of `text` that the given objects' spans touch. */
export function spanCoveredLines(
  text: string,
  spans: readonly EmitSpan[],
  leafIds: ReadonlySet<string>,
): Set<number> {
  const covered = new Set<number>();
  // Ascending and non-overlapping by the emit map's contract.
  const picked = spans.filter((s) => leafIds.has(s.objectId));
  if (picked.length === 0) return covered;
  let lineStart = 0;
  let line = 0;
  let r = 0;
  while (lineStart <= text.length && r < picked.length) {
    let lineEnd = text.indexOf("\n", lineStart);
    if (lineEnd < 0) lineEnd = text.length;
    while (r < picked.length && (picked[r]?.end ?? 0) <= lineStart) r++;
    const span = picked[r];
    if (span && span.start < lineEnd && span.end > lineStart) covered.add(line);
    lineStart = lineEnd + 1;
    line++;
  }
  return covered;
}

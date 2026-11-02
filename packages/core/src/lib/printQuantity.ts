/** The labels a ^PQ asks for: 1 where q is omitted, as the spec defaults it on p.324, and undefined where q is no count,
 *  which leaves the format's count as it was. */
export function printQuantityOf(q: string | undefined): number | undefined {
  const spelled = (q ?? "").trim();
  if (spelled === "") return 1;
  const labels = Number.parseInt(spelled, 10);
  return labels > 0 ? labels : undefined;
}

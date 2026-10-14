/** Stacking-order moves on a page's top-level object array (later index = drawn
 *  on top). Pure and identity-preserving: returns the same array reference when
 *  the move is a no-op, so the caller's patch stays empty. A multi-selection
 *  moves as one block, keeping the members' relative order. */
export type ZOrderDir = "front" | "back" | "forward" | "backward";

export function reorderForZ<T extends { id: string }>(
  items: readonly T[],
  selectedIds: ReadonlySet<string>,
  dir: ZOrderDir,
): T[] | readonly T[] {
  const anySelected = items.some((o) => selectedIds.has(o.id));
  if (!anySelected) return items;

  if (dir === "front" || dir === "back") {
    const sel: T[] = [];
    const rest: T[] = [];
    for (const o of items) (selectedIds.has(o.id) ? sel : rest).push(o);
    if (sel.length === 0 || rest.length === 0) return items; // all or none selected
    const next = dir === "front" ? [...rest, ...sel] : [...sel, ...rest];
    return sameOrder(items, next) ? items : next;
  }

  // forward/backward: shift the selected block one step past its unselected
  // neighbour. Iterate from the moving edge so members don't collide.
  const next = [...items];
  const swap = (i: number, j: number) => {
    const a = next[i];
    const b = next[j];
    if (a && b && selectedIds.has(a.id) && !selectedIds.has(b.id)) {
      next[i] = b;
      next[j] = a;
    }
  };
  if (dir === "forward") {
    for (let i = next.length - 2; i >= 0; i--) swap(i, i + 1);
  } else {
    for (let i = 1; i < next.length; i++) swap(i, i - 1);
  }
  return sameOrder(items, next) ? items : next;
}

function sameOrder<T extends { id: string }>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((o, i) => o.id === b[i]?.id);
}

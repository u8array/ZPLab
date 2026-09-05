/** How many entries of an ascending list lie strictly before `x`. */
export function countBefore(sorted: readonly number[], x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] ?? Infinity) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

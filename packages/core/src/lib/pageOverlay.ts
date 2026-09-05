/** Strip overlays (all pages, or those matching `shouldDrop`) so they
 *  regenerate from the model instead of replaying stale bytes.
 *  Identity-preserving when nothing changes. */
export function dropPageOverlays<P extends { overlay?: unknown }>(
  pages: P[],
  shouldDrop?: (page: P, index: number) => boolean,
): P[] {
  if (!pages.some((p, i) => p.overlay && (shouldDrop?.(p, i) ?? true))) return pages;
  return pages.map((p, i) => {
    if (!p.overlay || (shouldDrop && !shouldDrop(p, i))) return p;
    const next = { ...p };
    delete next.overlay;
    return next;
  });
}

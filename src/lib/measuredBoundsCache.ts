// Module-level measured-footprint cache for object types whose size is not
// purely computable (barcodes, single-line text, image). Deliberately NOT
// zustand: writes happen every render and must never trigger a re-render.
//
// Convention: store the ALREADY-ROTATED footprint in dots, keyed by obj.id.
// objectBounds.ts consumes it verbatim, typed as core's MeasuredFootprint.
import { type MeasuredFootprint } from "@zplab/core/lib/objectBounds";

export type { MeasuredFootprint };


const cache = new Map<string, MeasuredFootprint>();

// useSyncExternalStore plumbing: the cache stays non-reactive for hot
// per-render writes; `snapshot` is rebuilt only when a footprint changes, so
// its identity stays stable until a consumer (the selection frame) must recompute.
let snapshot: ReadonlyMap<string, MeasuredFootprint> = cache;
const listeners = new Set<() => void>();

export function subscribeMeasuredBounds(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Immutable snapshot for useSyncExternalStore; identity changes only on a real
 *  footprint change, so getSnapshot stays cache-stable between renders. */
export function getMeasuredSnapshot(): ReadonlyMap<string, MeasuredFootprint> {
  return snapshot;
}

function emitChange(): void {
  snapshot = new Map(cache);
  for (const fn of listeners) fn();
}

function footprintsEqual(a: MeasuredFootprint, b: MeasuredFootprint): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.barHeightDots === b.barHeightDots &&
    a.barLeftDots === b.barLeftDots &&
    a.barTopDots === b.barTopDots &&
    a.uprightBarWDots === b.uprightBarWDots &&
    a.uprightBarHDots === b.uprightBarHDots
  );
}

export function setMeasuredBounds(id: string, footprint: MeasuredFootprint): void {
  const prev = cache.get(id);
  if (prev && footprintsEqual(prev, footprint)) return;
  cache.set(id, footprint);
  emitChange();
}

export function getMeasuredBounds(id: string): MeasuredFootprint | undefined {
  return cache.get(id);
}

export function clearMeasuredBounds(id: string): void {
  if (cache.delete(id)) emitChange();
}

/** The live map for the align handler's ctx.measured. Returned as-is (readonly
 *  at the call site) so reads stay zero-copy. */
export function measuredBoundsMap(): ReadonlyMap<string, MeasuredFootprint> {
  return cache;
}

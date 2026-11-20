import type { LabelObject } from "../types/Group";

/** Rotated visual footprint in exact dots (raw object, scale = dpmm). */
export interface Footprint {
  w: number;
  h: number;
}

/** `dpmm` is the dot density the object's dot values live in; callers that
 *  know a non-store density (import) pass it so the measurer never falls back
 *  to an unrelated open document's. */
type FootprintMeasurer = (obj: LabelObject, dpmm?: number) => Footprint | null;

/** Callers without a measurer fall back to the z-less path. */
let measurer: FootprintMeasurer | null = null;
// Memo per props reference: mutators replace props on every edit (the same
// invariant dirty tracking relies on), so unrelated edits hit the cache and
// the live ZPL panel doesn't re-encode every barcode per keystroke.
let cache = new WeakMap<object, { dpmm?: number; fp: Footprint | null }>();

export function registerFootprintMeasurer(m: FootprintMeasurer | null): void {
  measurer = m;
  cache = new WeakMap();
}

/** Runs `fn` under `m`, then restores the previous measurer. Both switches drop
 *  the memo, which keys on props and not on the measurer that filled it. */
export function withFootprintMeasurer<T>(m: FootprintMeasurer, fn: () => T): T {
  const prev = measurer;
  registerFootprintMeasurer(m);
  try {
    return fn();
  } finally {
    registerFootprintMeasurer(prev);
  }
}

export function measureFootprintDots(obj: LabelObject, dpmm?: number): Footprint | null {
  if (!measurer) return null;
  const key = (obj as { props?: object }).props;
  if (!key) return measurer(obj, dpmm);
  const hit = cache.get(key);
  if (hit && hit.dpmm === dpmm) return hit.fp;
  const fp = measurer(obj, dpmm);
  cache.set(key, { dpmm, fp });
  return fp;
}

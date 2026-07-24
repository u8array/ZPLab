import type { LabelObject } from "../types/Group";

/** Rotated visual footprint in exact dots (raw object, scale = dpmm). */
interface Footprint {
  w: number;
  h: number;
}

/** `dpmm` is the dot density the object's dot values live in; callers that
 *  know a non-store density (import) pass it so the measurer never falls back
 *  to an unrelated open document's. */
type FootprintMeasurer = (obj: LabelObject, dpmm?: number) => Footprint | null;

/** Barcode extents need bwip; headless callers leave this null and import
 *  normalisation / 1D z-emit fall back to their z-less behaviour. The app
 *  registers a canvas measurer, the MCP sidecar a bwip-raw one (S3b). */
let measurer: FootprintMeasurer | null = null;
// Memo per props reference: mutators replace props on every edit (the same
// invariant dirty tracking relies on), so unrelated edits hit the cache and
// the live ZPL panel doesn't re-encode every barcode per keystroke.
let cache = new WeakMap<object, { dpmm?: number; fp: Footprint | null }>();

export function registerFootprintMeasurer(m: FootprintMeasurer | null): void {
  measurer = m;
  cache = new WeakMap();
}

/** Clears only if `m` is still active (stale cleanup must not null a successor). */
export function unregisterFootprintMeasurer(m: FootprintMeasurer): void {
  if (measurer === m) measurer = null;
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

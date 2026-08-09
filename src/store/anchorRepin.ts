import type { LabelObject } from "@zplab/core/types/Group";
import type { ObjectChanges } from "@zplab/core/types/LabelObject";
import { anchorRepin as coreAnchorRepin, type BarcodeFootprint } from "@zplab/core/lib/anchorRepin";

type BarcodeWidthProber = (obj: LabelObject) => BarcodeFootprint | null;

/** Probe resolving variable DEFAULTS, the same source the sidecar uses, so a preview toggle cannot move the persisted x.
 *  Null in node tests, where re-pinning is simply off. */
let prober: BarcodeWidthProber | null = null;

export function registerBarcodeWidthProber(p: BarcodeWidthProber | null): void {
  prober = p;
}

/** Clears only if `p` is still active, so a stale unmount cleanup can't null
 *  a successor registration. */
export function unregisterBarcodeWidthProber(p: BarcodeWidthProber): void {
  if (prober === p) prober = null;
}

export function probeBarcodeFootprint(obj: LabelObject): BarcodeFootprint | null {
  return prober ? prober(obj) : null;
}

/** Store-side repin: the shared rule bound to the canvas prober (preview
 *  binding), see the core function for the contract. */
export function anchorRepin(obj: LabelObject, changes: ObjectChanges, next: LabelObject): LabelObject {
  return coreAnchorRepin(obj, changes, next, probeBarcodeFootprint);
}

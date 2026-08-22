// Default export only: the generic build's NAMED `raw` is the raw-input
// symbology encoder, not the ToRaw encodation API the kernel needs.
import bwipjs from "bwip-js/generic";
import { registerFootprintMeasurer, resetFootprintCache } from "@zplab/core/lib/footprintProber";
import {
  barcodeEncodeIssueWith,
  measureBarcodeBoundsWith,
  measureBarcodeFootprintDotsWith,
  resolveForMeasure,
  type BwipEngine,
} from "@zplab/core/lib/barcodeDims";
import { clockCtxFromLabel, type ClockResolveCtx } from "@zplab/core/lib/variableBinding";
import { type LeafObject } from "@zplab/core/registry";
import { isGroup, type LabelObject } from "@zplab/core/types/Group";
import type { Variable } from "@zplab/core/types/Variable";
import type { LabelConfig } from "@zplab/core/types/LabelConfig";

const engine: BwipEngine = bwipjs as unknown as BwipEngine;

// Emit/preflight binding context; import measures its own resolved clones.
let binding: { variables: readonly Variable[]; clock: ClockResolveCtx } | null = null;

/** Marker content resolved to its defaults, so a box measures what prints
 *  rather than the marker's own length. Identity-preserving when unbound. */
export function resolveForReport<T extends LabelObject>(o: T): T {
  return binding ? resolveForMeasure(o, binding.variables, binding.clock) : o;
}

const measure = (o: LabelObject, dpmm?: number) => {
  if (isGroup(o)) return null;
  const resolved = resolveForReport(o);
  // The 8 only backs the 1D z-justify callers, whose dot width is dpmm-invariant.
  // Fixed-physical types (maxicode) scale with dpmm, so any caller reaching them
  // must pass a density.
  return measureBarcodeFootprintDotsWith(engine, resolved as LeafObject, dpmm ?? 8);
};

/** Idempotent; re-registering only resets the seam's memo. */
export function registerSidecarFootprintMeasurer(): void {
  registerFootprintMeasurer(measure);
}

/** Full measured-bounds record for the geometry report, resolved against the
 *  active binding like `measure`. */
export function measureBoundsEntry(o: LabelObject, dpmm: number) {
  if (isGroup(o)) return null;
  return measureBarcodeBoundsWith(engine, resolveForReport(o) as LeafObject, dpmm);
}

/** Encode check on an already-resolved clone (the one barcodeEncodeFindingsCore
 *  hands its callback), so the report does not resolve a second time. */
export function barcodeEncodeIssueResolved(resolved: LabelObject, dpmm: number): string | null {
  if (isGroup(resolved)) return null;
  return barcodeEncodeIssueWith(engine, resolved as LeafObject, dpmm);
}

/** Run `fn` with markers resolving against the design's own bindings, the
 *  sidecar twin of the app bridge's store-bound resolution. */
export function withFootprintBinding<T>(
  label: Pick<LabelConfig, "secondaryClockOffset" | "tertiaryClockOffset">,
  variables: readonly Variable[],
  fn: () => T,
): T {
  const prev = binding;
  binding = { variables, clock: clockCtxFromLabel(label) };
  // The prober cache keys on props, not on this binding, so a nested call under
  // a different binding would otherwise read the outer binding's width.
  resetFootprintCache();
  try {
    return fn();
  } finally {
    binding = prev;
    resetFootprintCache();
  }
}

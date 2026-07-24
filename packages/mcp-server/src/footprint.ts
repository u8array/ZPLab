// Default export only: the generic build's NAMED `raw` is the raw-input
// symbology encoder, not the ToRaw encodation API the kernel needs.
import bwipjs from "bwip-js/generic";
import { registerFootprintMeasurer } from "@zplab/core/lib/footprintProber";
import {
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

const measure = (o: LabelObject, dpmm?: number) => {
  if (isGroup(o)) return null;
  const resolved = binding ? resolveForMeasure(o, binding.variables, binding.clock) : o;
  // Width in dots is dpmm-invariant; 8 only backs a caller that passed none.
  return measureBarcodeFootprintDotsWith(engine, resolved as LeafObject, dpmm ?? 8);
};

/** Idempotent; re-registering only resets the seam's memo. */
export function registerSidecarFootprintMeasurer(): void {
  registerFootprintMeasurer(measure);
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
  try {
    return fn();
  } finally {
    binding = prev;
  }
}

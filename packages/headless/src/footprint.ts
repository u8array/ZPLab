// Default export only: the generic build's NAMED `raw` is the raw-input
// symbology encoder, not the ToRaw encodation API the kernel needs.
import bwipjs from "bwip-js/generic";
import {
  barcodeEncodeIssueWith,
  measureBarcodeBoundsWith,
  resolveForMeasure,
  type BwipEngine,
} from "@zplab/core/lib/barcodeDims";
import { clockCtxFromLabel, type ClockResolveCtx } from "@zplab/core/lib/variableBinding";
import { type LeafObject } from "@zplab/core/registry";
import { isGroup, type LabelObject } from "@zplab/core/types/Group";
import type { Variable } from "@zplab/core/types/Variable";
import type { LabelConfig } from "@zplab/core/types/LabelConfig";

const engine: BwipEngine = bwipjs as unknown as BwipEngine;

let binding: { variables: readonly Variable[]; clock: ClockResolveCtx } | null = null;

/** Marker content resolved to its defaults, so a box measures what prints
 *  rather than the marker's own length. Identity-preserving when unbound. */
export function resolveForReport<T extends LabelObject>(o: T): T {
  return binding ? resolveForMeasure(o, binding.variables, binding.clock) : o;
}

/** Measured-bounds record for the geometry report. */
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

/** Runs `fn` with markers resolved against the design's bindings. */
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

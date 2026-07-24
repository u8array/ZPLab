import { registerFootprintMeasurer } from "@zplab/core/lib/footprintProber";
import { clockCtxFromLabel } from "@zplab/core/lib/variableBinding";
import bwipjs from "bwip-js/browser";
import {
  measureBarcodeFootprintDotsWith,
  resolveForMeasure,
  type BwipEngine,
} from "@zplab/core/lib/barcodeDims";
import { type LeafObject } from "@zplab/core/registry";
import { isGroup, type LabelObject } from "@zplab/core/types/Group";
import { useLabelStore } from "../store/labelStore";

const engine = bwipjs as unknown as BwipEngine;

const measure = (o: LabelObject, dpmm?: number) => {
  if (isGroup(o)) return null;
  const s = useLabelStore.getState();
  // Defaults only: see resolveForMeasure (anchor must not track the preview row).
  const resolved = resolveForMeasure(o, s.variables, clockCtxFromLabel(s.label));
  return measureBarcodeFootprintDotsWith(engine, resolved as LeafObject, dpmm ?? s.label.dpmm);
};

/** Registers the exact (dot-space, defaults-resolved) footprint measurer
 *  before the first render, so synchronous emit paths (ZPL pane, preflight)
 *  never see an unregistered seam. The closure reads live state;
 *  re-registration only resets the prober's memo. */
export function initFootprintMeasurer(): void {
  registerFootprintMeasurer(measure);
  useLabelStore.subscribe((s, prev) => {
    // Only inputs that change a measured width invalidate the memo (dpmm is
    // part of the cache key); a plain label edit must not re-encode barcodes.
    if (
      s.variables !== prev.variables ||
      s.label.secondaryClockOffset !== prev.label.secondaryClockOffset ||
      s.label.tertiaryClockOffset !== prev.label.tertiaryClockOffset
    ) {
      registerFootprintMeasurer(measure);
    }
  });
}

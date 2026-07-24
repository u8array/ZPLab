import { registerFootprintMeasurer } from "@zplab/core/lib/footprintProber";
import {
  applyBindingToObject,
  buildActiveRow,
  clockCtxFromLabel,
} from "@zplab/core/lib/variableBinding";
import { objectResolvesCtrl, type LeafObject } from "@zplab/core/registry";
import { isGroup, type LabelObject } from "@zplab/core/types/Group";
import bwipjs from "bwip-js/browser";
import { measureBarcodeFootprintDotsWith, type BwipEngine } from "@zplab/core/lib/barcodeDims";
import { useLabelStore } from "../store/labelStore";

const measure = (o: LabelObject, dpmm?: number) => {
  if (isGroup(o)) return null;
  const s = useLabelStore.getState();
  const d = dpmm ?? s.label.dpmm;
  const resolved = applyBindingToObject(
    o,
    s.variables,
    buildActiveRow(s.dataset, s.columnMapping),
    s.canvasSettings.dataRenderMode,
    clockCtxFromLabel(s.label),
    objectResolvesCtrl(o),
  );
  return measureBarcodeFootprintDotsWith(bwipjs as unknown as BwipEngine, resolved as LeafObject, d, d);
};

/** Registers the exact (dot-space, binding-resolved) footprint measurer before
 *  the first render, so synchronous emit paths (ZPL pane, preflight) never see
 *  an unregistered seam. The closure reads live state; re-registration only
 *  resets the prober's memo when a binding input changes. */
export function initFootprintMeasurer(): void {
  registerFootprintMeasurer(measure);
  useLabelStore.subscribe((s, prev) => {
    if (
      s.variables !== prev.variables ||
      s.dataset !== prev.dataset ||
      s.columnMapping !== prev.columnMapping ||
      s.label !== prev.label ||
      s.canvasSettings.dataRenderMode !== prev.canvasSettings.dataRenderMode
    ) {
      registerFootprintMeasurer(measure);
    }
  });
}

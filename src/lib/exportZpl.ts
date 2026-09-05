import { zplForExport } from "@zplab/core/lib/zplLabelMeta";
import { useLabelStore, selectKeepExportMetadata } from "../store/labelStore";

/** Every export channel reads the setting here; previews strip unconditionally. */
export function finishZplExport(zpl: string): string {
  return zplForExport(zpl, selectKeepExportMetadata(useLabelStore.getState()));
}

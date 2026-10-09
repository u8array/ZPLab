import { generateBatchZpl, generateMultiPageZPL } from "@zplab/core/lib/zplGenerator";
import { zplForExport } from "@zplab/core/lib/zplLabelMeta";
import {
  currentObjects,
  currentPageLabel,
  selectBatchInputs,
  selectKeepExportMetadata,
  type LabelState,
} from "../store/labelStore";

/** The bytes a label send carries: batch form while a dataset is mapped, the document emit otherwise.
 *  The send and the notices above its button read this one derivation, so they cannot name different jobs.
 *  `sampleRows` caps the recall blocks for a caller that reads the commands and not the data. */
export function sendZpl(s: LabelState, sampleRows?: number): string {
  const batch = selectBatchInputs(s);
  if (!batch) return zplForExport(generateMultiPageZPL(s.label, s.pages, s.variables), selectKeepExportMetadata(s));
  const dataset =
    sampleRows === undefined ? batch.dataset : { ...batch.dataset, rows: batch.dataset.rows.slice(0, sampleRows) };
  return zplForExport(
    generateBatchZpl(currentPageLabel(s), currentObjects(s), s.variables, dataset, batch.mapping),
    selectKeepExportMetadata(s),
  );
}

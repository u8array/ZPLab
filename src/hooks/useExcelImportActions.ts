import { useState } from 'react';
import { useLabelStore } from '../store/labelStore';
import { loadFetchedDataset, currentDataContext, isCurrentDataContext } from '../store/datasetActions';
import { excelFetchDataset, excelListSheets, pickExcelFile } from '../lib/excel';
import { basename } from '../lib/fileDialogs';
import { formatTemplate } from '../lib/formatTemplate';
import { useT } from './useT';

export interface PendingExcelImport {
  path: string;
  filename: string;
  sheets: string[];
  /** datasetFetchToken at pick time, see isCurrentDataContext. A stale token
   *  leaves the sheet uncommitted. */
  token: number;
}

/** Desktop-only Excel import: pick a file, choose a worksheet, commit like
 *  the other tabular sources. */
export function useExcelImportActions() {
  const t = useT();
  const setUserError = useLabelStore((s) => s.setUserError);
  const [pendingExcel, setPendingExcel] = useState<PendingExcelImport | null>(null);

  const fail = (e: unknown) =>
    setUserError(formatTemplate(t.variables.excelReadErrorFmt, { error: String(e) }));

  const openExcelPicker = () => {
    void (async () => {
      // Capture at initiation, before the pick/list awaits: a document loaded
      // while the file dialog or sheet listing is in flight must invalidate this
      // import, not silently inherit the new context's token.
      const token = currentDataContext();
      try {
        const path = await pickExcelFile();
        if (!path) return;
        const sheets = await excelListSheets(path);
        // A document loaded during the pick/list: don't open a dialog that is
        // already stale against the new context.
        if (!isCurrentDataContext(token)) return;
        setPendingExcel({ path, filename: basename(path), sheets, token });
      } catch (e) {
        fail(e);
      }
    })();
  };

  const loadSheet = async (sheet: string): Promise<boolean> => {
    if (!pendingExcel) return false;
    // Dialog opened against an older context (a dataset loaded or the document
    // was replaced since the pick): drop it instead of loading into the new one.
    if (!isCurrentDataContext(pendingExcel.token)) {
      setPendingExcel(null);
      return false;
    }
    try {
      // Cancel/X during the fetch supersedes the token (via cancelExcelImport),
      // so a sheet the user declined mid-parse is dropped, not committed.
      const applied = await loadFetchedDataset(() =>
        excelFetchDataset(pendingExcel.path, pendingExcel.filename, sheet),
      );
      if (applied) setPendingExcel(null);
      return applied;
    } catch (e) {
      fail(e);
      return false;
    }
  };

  const cancelExcelImport = () => {
    useLabelStore.getState().invalidateDatasetFetches();
    setPendingExcel(null);
  };

  return { openExcelPicker, pendingExcel, loadSheet, cancelExcelImport };
}

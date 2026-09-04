import { useState } from "react";
import { finishZplExport } from "../lib/exportZpl";
import {
  currentObjects,
  selectBatchInputs,
  selectCanBatchExport,
  useLabelStore,
} from "../store/labelStore";
import { generateMultiPageZPL, generateBatchZpl } from "@zplab/core/lib/zplGenerator";
import { generateSetupScript } from "../lib/zplSetupScript";
import { printLabel } from "../lib/printPreview";
import { saveTextFile, saveErrorMessage, ZPL_FILTER } from "../lib/fileDialogs";
import { labelaryErrorMessage } from "../lib/labelary";
import { currentPageLabel, selectLabelaryEndpoint } from "../store/labelStore.selectors";
import { buildActiveRow } from "@zplab/core/lib/variableBinding";

export function useZplImportExport() {
  // Reactive: only what the UI rendering needs (menu enable +
  // label-count text). Event handlers below all read a fresh
  // snapshot via `useLabelStore.getState()` so generator inputs
  // come from the same point in time and the hook doesn't re-
  // render on every label / page / variable edit.
  const canBatchExport = useLabelStore(selectCanBatchExport);
  const batchRowCount = useLabelStore((s) => s.dataset?.rows.length ?? 0);
  // Source-aware Zebra-print state lives in the store so the
  // PrinterSettingsModal can trigger a Setup-Script send without
  // prop-drilling through this hook. Treat `null` as closed.
  const zebraPrintSource = useLabelStore((s) => s.zebraPrintSource);
  const openZebraPrintStore = useLabelStore((s) => s.openZebraPrint);
  const closeZebraPrintStore = useLabelStore((s) => s.closeZebraPrint);

  const setUserError = useLabelStore((s) => s.setUserError);
  const clearUserError = useLabelStore((s) => s.clearUserError);
  const [showZplImport, setShowZplImport] = useState(false);

  const handleDownload = () => {
    const s = useLabelStore.getState();
    const zpl = finishZplExport(generateMultiPageZPL(s.label, s.pages, s.variables));
    void saveTextFile(zpl, {
      filename: "label.zpl",
      mimeType: "text/plain",
      filter: ZPL_FILTER,
    })
      .then((wrote) => wrote && clearUserError())
      .catch(() => setUserError(saveErrorMessage));
  };

  const handleExportBatch = () => {
    const s = useLabelStore.getState();
    const batch = selectBatchInputs(s);
    if (!batch) return;
    const zpl = finishZplExport(
      generateBatchZpl(currentPageLabel(s), currentObjects(s), s.variables, batch.dataset, batch.mapping),
    );
    void saveTextFile(zpl, {
      filename: "label-batch.zpl",
      mimeType: "text/plain",
      filter: ZPL_FILTER,
    })
      .then((wrote) => wrote && clearUserError())
      .catch(() => setUserError(saveErrorMessage));
  };

  // Print previews via Labelary, which renders one image at a time. We send
  // only the current page so the preview matches what the user sees. The
  // active CSV row (if any) is substituted into bound fields so the
  // preview reflects what would actually print for the selected row.
  const handlePrint = async () => {
    try {
      // Ensure the keychain key is loaded before printing to a premium host,
      // then snapshot once so the design, endpoint, and key are consistent
      // (the await could otherwise let the design change under a stale copy).
      if (!useLabelStore.getState().labelaryApiKeyLoaded) {
        await useLabelStore.getState().hydrateLabelaryApiKey();
      }
      const s = useLabelStore.getState();
      const active = buildActiveRow(s.dataset, s.columnMapping);
      const { host, apiKey } = selectLabelaryEndpoint(s);
      await printLabel(currentPageLabel(s), currentObjects(s), host, apiKey, s.variables, active);
      clearUserError();
    } catch (e) {
      setUserError(labelaryErrorMessage(e), { retryExport: true });
    }
  };

  // ZPL surfaced to direct-print: branch on the active source.
  // - 'setupScript': EEPROM-persistent printer config (live-clock
  //   safe; the generator captures `now` here, at click-time).
  // - 'label' (default): batch form when a CSV is in play, otherwise
  //   the same template the editor displays.
  const currentZpl = () => {
    const s = useLabelStore.getState();
    if (zebraPrintSource === 'setupScript') {
      return generateSetupScript(s.printerProfile);
    }
    const batch = selectBatchInputs(s);
    const zpl = batch
      ? generateBatchZpl(
          currentPageLabel(s), currentObjects(s), s.variables, batch.dataset, batch.mapping,
        )
      : generateMultiPageZPL(s.label, s.pages, s.variables);
    return finishZplExport(zpl);
  };

  return {
    showZplImport,
    openZplImport: () => setShowZplImport(true),
    closeZplImport: () => setShowZplImport(false),
    showZebraPrint: zebraPrintSource !== null,
    openZebraPrint: () => openZebraPrintStore('label'),
    closeZebraPrint: closeZebraPrintStore,
    currentZpl,
    handleDownload,
    handleExportBatch,
    canBatchExport,
    batchRowCount,
    handlePrint,
  };
}

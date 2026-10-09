import { useState, type RefObject } from "react";
import { finishZplExport } from "../lib/exportZpl";
import {
  currentObjects,
  selectBatchInputs,
  selectCanBatchExport,
  useLabelStore,
} from "../store/labelStore";
import { generateMultiPageZPL, generateBatchZpl } from "@zplab/core/lib/zplGenerator";
import { generateSetupScript, setupFormatBlocks } from "../lib/zplSetupScript";
import { printErrorMessage, printLabel, printReplaced } from "../lib/printSheet";
import { saveTextFile, saveErrorMessage, ZPL_SAVE_FILTERS } from "../lib/fileDialogs";
import { labelaryErrorMessage } from "../lib/labelary";
import { currentPageLabel, selectEffectivePreviewProvider, selectLabelaryEndpoint } from "../store/labelStore.selectors";
import { buildActiveRow } from "@zplab/core/lib/variableBinding";
import { renderLabelImageUrl } from "../lib/labelImage";
import { errorMessage } from "../lib/errorMessage";
import type { LabelCanvasHandle } from "../components/Canvas/LabelCanvas";

export function useZplImportExport(canvasRef: RefObject<LabelCanvasHandle | null>) {
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
    void saveTextFile(zpl, { filename: "label.zpl", filters: ZPL_SAVE_FILTERS })
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
    void saveTextFile(zpl, { filename: "label-batch.zpl", filters: ZPL_SAVE_FILTERS })
      .then((wrote) => wrote && clearUserError())
      .catch(() => setUserError(saveErrorMessage));
  };

  // Prints the current page as the preview renderer draws it, with the active row substituted.
  const handlePrint = async () => {
    const renderer = selectEffectivePreviewProvider(useLabelStore.getState());
    // Two stages with two kinds of failure: the renderer may be out of reach, or no print may start.
    let image: string;
    try {
      // A premium host needs the keychain key before the request goes out.
      if (renderer === "labelary" && !useLabelStore.getState().labelaryApiKeyLoaded) {
        await useLabelStore.getState().hydrateLabelaryApiKey();
      }
      const s = useLabelStore.getState();
      const job = { label: currentPageLabel(s), objects: currentObjects(s), variables: s.variables, active: buildActiveRow(s.dataset, s.columnMapping) };
      image = await renderLabelImageUrl(renderer, job, {
        labelary: selectLabelaryEndpoint(s),
        printTarget: s.printTarget,
        captureCanvas: async (dots) => (await canvasRef.current?.captureLabelDots(dots)) ?? null,
      });
    } catch (e) {
      setUserError(renderer === "labelary" ? labelaryErrorMessage(e) : errorMessage(e), { retryExport: renderer === "labelary" });
      return;
    }
    try {
      await printLabel(image);
      clearUserError();
    } catch (e) {
      // The print the user replaced is the older one, so it may not speak for the newer one's banner.
      if (e !== printReplaced) setUserError(printErrorMessage);
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
      return generateSetupScript(s.printerProfile, setupFormatBlocks(s.label, s.pages, s.variables));
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
    outputSource: zebraPrintSource,
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

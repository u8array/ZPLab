import { useState, type RefObject } from "react";
import { finishZplExport } from "../lib/exportZpl";
import {
  currentObjects,
  selectCanBatchExport,
  useLabelStore,
} from "../store/labelStore";
import { generateMultiPageZPL } from "@zplab/core/lib/zplGenerator";
import { sendZpl } from "../lib/sendZpl";
import { generateSetupScript, setupFormatBlocks } from "../lib/zplSetupScript";
import { printErrorMessage, printLabel, printReplaced } from "../lib/printSheet";
import { saveTextFile, saveErrorMessage, ZPL_SAVE_FILTERS } from "../lib/fileDialogs";
import { saveLabelImage } from "../lib/saveLabelImage";
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
  // In the store, so PrinterSettingsModal can open the dialog on the setup script without prop-drilling.
  const outputSource = useLabelStore((s) => s.outputSource);
  const openOutputStore = useLabelStore((s) => s.openOutput);
  const closeOutput = useLabelStore((s) => s.closeOutput);

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
    if (!selectCanBatchExport(s)) return;
    void saveTextFile(sendZpl(s), { filename: "label-batch.zpl", filters: ZPL_SAVE_FILTERS })
      .then((wrote) => wrote && clearUserError())
      .catch(() => setUserError(saveErrorMessage));
  };

  // The canvas capture the context menu saves, so both image exports hold the same pixels.
  const handleExportPng = () => {
    void saveLabelImage(canvasRef.current?.captureLabel() ?? Promise.resolve(null), "label.png");
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
      if (e !== printReplaced) setUserError(printErrorMessage);
    }
  };

  // The setup script captures `now` at the click, so a live clock stays right.
  const currentZpl = () => {
    const s = useLabelStore.getState();
    if (outputSource === 'setupScript') {
      return generateSetupScript(s.printerProfile, setupFormatBlocks(s.label, s.pages, s.variables));
    }
    return sendZpl(s);
  };

  return {
    showZplImport,
    openZplImport: () => setShowZplImport(true),
    closeZplImport: () => setShowZplImport(false),
    outputSource,
    openOutput: () => openOutputStore('label'),
    closeOutput,
    currentZpl,
    handleDownload,
    handleExportBatch,
    canBatchExport,
    batchRowCount,
    handlePrint,
    handleExportPng,
  };
}

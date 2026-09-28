import { useRef, useState, type RefObject } from "react";
import { writePdf, type PdfPage } from "@zplab/core/lib/pdfWriter";
import { pageLabelConfig } from "@zplab/core/types/Group";
import { buildActiveRow } from "@zplab/core/lib/variableBinding";
import { currentObjects, selectBatchInputs, useLabelStore } from "../store/labelStore";
import { currentPageLabel, selectEffectivePreviewProvider, selectLabelaryEndpoint } from "../store/labelStore.selectors";
import { renderLabelMono, type RenderDeps, type RenderJob } from "../lib/labelImage";
import { isTransientLabelaryError } from "../lib/labelary";
import { PDF_FILTER, saveErrorMessage, saveFile } from "../lib/fileDialogs";
import { formatTemplate } from "../lib/formatTemplate";
import { errorMessage } from "../lib/errorMessage";
import { previewProviderLabel } from "../lib/previewProviderLabel";
import type { PreviewProvider } from "../store/slices/uiSlice";
import type { LabelCanvasHandle } from "../components/Canvas/LabelCanvas";
import type { Translations } from "../locales";
import { useT } from "./useT";

export type PdfExportProgress = { done: number; total: number; saving: boolean } | null;

/** Two more tries after a pause, then the row fails. */
const RETRY_DELAYS_MS = [1000, 3000];
const ROW_PAUSE_MS = 100;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function renderWithRetry(renderer: PreviewProvider, job: RenderJob, deps: RenderDeps, cancelled: () => boolean) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await renderLabelMono(renderer, job, deps);
    } catch (e) {
      const delay = RETRY_DELAYS_MS[attempt];
      const retry = renderer === "labelary" && isTransientLabelaryError(e) && delay !== undefined;
      if (!retry || cancelled()) throw e;
      await wait(delay);
    }
  }
}

interface ExportRun {
  t: Translations;
  deps: RenderDeps;
  cancelled: () => boolean;
  onProgress: (p: NonNullable<PdfExportProgress>) => void;
  onError: (message: string) => void;
}

/** Renders every job, then writes the one file. A failure or a cancel leaves no file behind. */
async function exportPages(jobs: RenderJob[], filename: string, run: ExportRun): Promise<boolean> {
  const s = useLabelStore.getState();
  const renderer = selectEffectivePreviewProvider(s);
  if (renderer === "labelary" && !s.labelaryApiKeyLoaded) {
    await s.hydrateLabelaryApiKey();
    run.deps.labelary = selectLabelaryEndpoint(useLabelStore.getState());
  }
  const pages: PdfPage[] = [];
  for (const [i, job] of jobs.entries()) {
    if (run.cancelled()) return false;
    try {
      const raster = await renderWithRetry(renderer, job, run.deps, run.cancelled);
      pages.push({ widthMm: raster.width / job.label.dpmm, heightMm: raster.height / job.label.dpmm, ...raster });
    } catch (e) {
      if (!run.cancelled()) run.onError(formatTemplate(run.t.pdfExport.failedFmt, { i: String(i + 1), error: errorMessage(e) }));
      return false;
    }
    run.onProgress({ done: i + 1, total: jobs.length, saving: false });
    if (renderer === "labelary" && i + 1 < jobs.length) await wait(ROW_PAUSE_MS);
  }
  if (run.cancelled()) return false;
  run.onProgress({ done: jobs.length, total: jobs.length, saving: true });
  const pdf = writePdf(pages, { producer: "ZPLab", subject: formatTemplate(run.t.pdfExport.renderedWithFmt, { renderer: previewProviderLabel(run.t, renderer) }) });
  try {
    return await saveFile(new Blob([pdf.buffer as ArrayBuffer], { type: PDF_FILTER.mimeType }), { filename, filters: [PDF_FILTER] });
  } catch {
    run.onError(saveErrorMessage);
    return false;
  }
}

/** One PDF per export, a page per label or batch row, rendered by the preview renderer. */
export function usePdfExport(canvasRef: RefObject<LabelCanvasHandle | null>) {
  const t = useT();
  const [progress, setProgress] = useState<PdfExportProgress>(null);
  const cancelled = useRef(false);
  const running = useRef(false);
  const setUserError = useLabelStore((s) => s.setUserError);
  const clearUserError = useLabelStore((s) => s.clearUserError);

  const start = (jobs: RenderJob[], filename: string) => {
    if (jobs.length === 0 || running.current) return;
    running.current = true;
    cancelled.current = false;
    setProgress({ done: 0, total: jobs.length, saving: false });
    const run: ExportRun = {
      t,
      deps: {
        labelary: selectLabelaryEndpoint(useLabelStore.getState()),
        printTarget: useLabelStore.getState().printTarget,
        captureCanvas: async (dots) => (await canvasRef.current?.captureLabelDots(dots)) ?? null,
      },
      cancelled: () => cancelled.current,
      onProgress: setProgress,
      onError: setUserError,
    };
    void exportPages(jobs, filename, run)
      .then((wrote) => wrote && clearUserError())
      .finally(() => {
        running.current = false;
        setProgress(null);
      });
  };

  const exportPdf = () => {
    const s = useLabelStore.getState();
    const active = buildActiveRow(s.dataset, s.columnMapping);
    const pages = selectEffectivePreviewProvider(s) === "none" ? [s.pages[s.currentPageIndex]] : s.pages;
    start(
      pages.flatMap((p) => (p ? [{ label: pageLabelConfig(s.label, p), objects: p.objects, variables: s.variables, active }] : [])),
      "label.pdf",
    );
  };

  const exportBatchPdf = () => {
    const s = useLabelStore.getState();
    const batch = selectBatchInputs(s);
    if (!batch || selectEffectivePreviewProvider(s) === "none") return;
    const label = currentPageLabel(s);
    const objects = currentObjects(s);
    start(
      batch.dataset.rows.map((_, i) => ({ label, objects, variables: s.variables, active: buildActiveRow({ ...batch.dataset, activeRowIndex: i }, batch.mapping) })),
      "label-batch.pdf",
    );
  };

  return { progress, exportPdf, exportBatchPdf, cancel: () => { cancelled.current = true; } };
}

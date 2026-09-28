import type { PageLabel } from "@zplab/core/types/LabelConfig";
import type { LabelObject } from "@zplab/core/types/Group";
import type { Variable } from "@zplab/core/types/Variable";
import type { ActiveRow } from "@zplab/core/lib/variableBinding";
import type { PreviewProvider } from "../store/slices/uiSlice";
import { buildPreviewZpl } from "./printPreview";
import { fetchPreview } from "./labelary";
import { fetchPrinterPreview, printerFailureMessage } from "./printerPreview";
import { resolvePreviewTarget, type PrintTarget } from "./printTarget";
import { labelDots, monoFromImageUrl, monoFromPrinterBitmap, rasterToDataUrl, type MonoRaster } from "./labelRaster";

export interface RenderJob {
  label: PageLabel;
  objects: LabelObject[];
  variables: readonly Variable[];
  active: ActiveRow | null;
}

export interface RenderDeps {
  labelary: { host: string; apiKey?: string };
  printTarget: PrintTarget;
  /** The canvas as drawn, at one pixel per dot. Only the current page can be captured. */
  captureCanvas: (dots: { width: number; height: number }) => Promise<Blob | null>;
}

/** The label as the renderer draws it, as the 1-bit raster a PDF page carries. */
export async function renderLabelMono(renderer: PreviewProvider, job: RenderJob, deps: RenderDeps): Promise<MonoRaster> {
  const dots = labelDots(job.label);
  if (renderer === "printer") return monoFromPrinterBitmap(await printerBitmap(job, deps), dots);
  const url = renderer === "none" ? await captureUrl(deps, dots) : await fetchPreview(previewZpl(job), job.label, deps.labelary.host, deps.labelary.apiKey);
  try {
    return await monoFromImageUrl(url, dots);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The label as the renderer draws it, as an image URL for a print window. */
export async function renderLabelImageUrl(renderer: PreviewProvider, job: RenderJob, deps: RenderDeps): Promise<string> {
  const dots = labelDots(job.label);
  if (renderer === "none") return captureUrl(deps, dots);
  if (renderer === "labelary") return fetchPreview(previewZpl(job), job.label, deps.labelary.host, deps.labelary.apiKey);
  const url = rasterToDataUrl(monoFromPrinterBitmap(await printerBitmap(job, deps), dots));
  if (!url) throw new Error("could not decode the printer preview");
  return url;
}

const previewZpl = (job: RenderJob): string => buildPreviewZpl(job.label, job.objects, job.variables, job.active);

async function captureUrl(deps: RenderDeps, dots: { width: number; height: number }): Promise<string> {
  const blob = await deps.captureCanvas(dots);
  if (!blob) throw new Error("could not capture the canvas");
  return URL.createObjectURL(blob);
}

async function printerBitmap(job: RenderJob, deps: RenderDeps) {
  const resolved = resolvePreviewTarget(deps.printTarget);
  if ("error" in resolved) throw new Error(resolved.error);
  const result = await fetchPrinterPreview(resolved.target, previewZpl(job));
  if (result.kind === "bitmap") return result.bitmap;
  throw new Error(printerFailureMessage(result, resolved.target));
}

import { z } from "zod";
import { wireBounds } from "@zplab/core/types/propSpec";
import { intInRange } from "@zplab/core/types/typeHelpers";
import { IMAGE_PROP_SPECS } from "@zplab/core/registry/image";
import type { DesignResponse, EditReceipt, RasterResponse } from "./appBridge.js";
import {
  captureNotes,
  editNotes,
  parseEnvelope,
  reportFor,
  type designReportSchema,
  type DesignFileJson,
  type PatchOp,
  type ToolError,
  type BoundReport,
} from "@zplab/headless";

export type GetCurrentDesignResult = z.infer<typeof designReportSchema> | ToolError;

/** Turn the app's read-back (design + render-measured footprints) into the
 *  standard tool report. Barcodes are re-probed print-true (the app's number
 *  is its zoom view); the other measurements make text/images render-exact. */
export function buildCurrentDesignResult(response: DesignResponse): GetCurrentDesignResult {
  const parsed = parseEnvelope(response.designFile);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    designFile: response.designFile as unknown as DesignFileJson,
    ...reportFor(parsed.value, response.measured),
  };
}

export type EditDesignResult =
  | ({ ok: true; applied: number; added: { opIndex: number; id: string }[] } & BoundReport)
  | (ToolError & { opIndex?: number });

/** The report for an edit the app applied. Bounds are render-measured like get_current_design's. */
export function buildEditDesignResult(receipt: EditReceipt, operations: readonly PatchOp[]): EditDesignResult {
  if (!receipt.ok) {
    return { ok: false, errors: receipt.errors ?? ["the app refused the edit"], ...(receipt.opIndex !== undefined ? { opIndex: receipt.opIndex } : {}) };
  }
  const parsed = parseEnvelope(receipt.designFile);
  // The edit landed before the report failed, so a retry would apply it twice.
  if (!parsed.ok) return { ok: false, errors: ["The edit was applied but the design could not be reported. Do not retry. Read it back with get_current_design.", ...parsed.errors] };
  const report = reportFor(parsed.value, receipt.measured);
  const assignedIds = new Map(Object.entries(receipt.assignedIds ?? {}).map(([i, id]) => [Number(i), id]));
  const notes = [
    ...editNotes(operations, parsed.value.pages, assignedIds),
    ...captureNotes({ lost: receipt.capturesLost ?? [], atRisk: receipt.capturesAtRisk ?? [] }),
    ...(report.notes ?? []),
  ];
  return {
    ok: true,
    applied: operations.length,
    added: [...assignedIds].map(([opIndex, id]) => ({ opIndex, id })),
    ...report,
    ...(notes.length > 0 ? { notes } : {}),
  };
}

/** A data URL keeps the fetch on the agent's side: the app only ever renders
 *  bytes it was handed, so no tool call reaches into the network or the disk. */
export const rasterImageShape = {
  dataUrl: z.string().startsWith("data:"),
  widthDots: z.number().int().positive().max(4000),
  threshold: intInRange(wireBounds(IMAGE_PROP_SPECS.threshold)).optional(),
};

export type RasterImageResult =
  | { ok: true; object: { type: "image"; props: Record<string, unknown> } }
  | ToolError;

/** Shape the raster into the image object create_draft and patch_design take. */
export function rasterImageResult(response: RasterResponse, threshold: number): RasterImageResult {
  if (!response.ok || !response.gfa || response.widthDots === undefined) {
    return { ok: false, errors: [response.error ?? "The image could not be rasterized."] };
  }
  return {
    ok: true,
    object: {
      type: "image",
      props: {
        imageId: "",
        widthDots: response.widthDots,
        ...(response.heightDots !== undefined ? { heightDots: response.heightDots } : {}),
        threshold,
        rotation: "N",
        _gfaCache: response.gfa,
      },
    },
  };
}

// The window side of the sidecar bridge: assemble and post the replies the
// MCP app tools wait on. React-free; useMcpBridge only wires the listeners.

import { serializeDesign } from "@zplab/core/lib/designFile";
import { gfaFromImage, scaledHeightDots } from "@zplab/core/lib/imageToZpl";
import { GF_MAX_BYTES_PER_ROW, GF_MAX_ROWS, gfByteWidth } from "@zplab/core/registry/image";
import { loadImage } from "@zplab/core/lib/loadImage";
import { exportableLeaves, getAllLeaves } from "@zplab/core/types/Group";
import {
  measuredBoundsMap,
  subscribeMeasuredBounds,
} from "./measuredBoundsCache";
import {
  postDesignResponse,
  postDraftReceipt,
  postRasterResponse,
} from "./mcpServer";
import { useLabelStore, selectSourceEditDirty } from "../store/labelStore";

/** Re-measuring after an open_in_app swap is async (React commit + bwip),
 *  so an immediate snapshot could serve the OLD design's footprints. */
const MEASURE_QUIESCE_MS = 150;
const MEASURE_SETTLE_CAP_MS = 1000;

// Frame-less environments (tests, headless) have nothing to wait a frame for.
const nextFrame = (fn: () => void): void => {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => fn());
  else setTimeout(fn, 0);
};

/** Resolve once the canvas has re-measured: two frames for the React commit,
 *  then no cache change for MEASURE_QUIESCE_MS (capped). */
function measuredSettled(): Promise<void> {
  return new Promise((resolve) => {
    let quiesce: ReturnType<typeof setTimeout>;
    let unsubscribe: () => void = () => undefined;
    const done = () => {
      clearTimeout(quiesce);
      clearTimeout(cap);
      unsubscribe();
      resolve();
    };
    const cap = setTimeout(done, MEASURE_SETTLE_CAP_MS);
    nextFrame(() =>
      nextFrame(() => {
        quiesce = setTimeout(done, MEASURE_QUIESCE_MS);
        unsubscribe = subscribeMeasuredBounds(() => {
          clearTimeout(quiesce);
          quiesce = setTimeout(done, MEASURE_QUIESCE_MS);
        });
      }),
    );
  });
}

/** POST design + measured footprints back to the sidecar; a failed reply
 *  surfaces via the sidecar's own request timeout. */
export async function respondToDesignRequest(id: number): Promise<void> {
  await measuredSettled();
  const { label, pages, variables, columnMapping, dataSourceRef } = useLabelStore.getState();
  const designFile: unknown = JSON.parse(
    serializeDesign(label, pages, variables, columnMapping, dataSourceRef),
  );
  // A deleted object's leftover footprint must not ride along.
  const liveIds = new Set(pages.flatMap((p) => exportableLeaves(p.objects)).map((o) => o.id));
  const measured = Object.fromEntries(
    [...measuredBoundsMap()].filter(([objectId]) => liveIds.has(objectId)),
  );
  await postDesignResponse({ id, designFile, measured });
}

/** Apply a pushed draft and tell the sidecar whether it took, so open_in_app
 *  reports what happened instead of assuming it arrived. */
export async function respondToOpenDraft(id: number, designText: string): Promise<void> {
  // Refusing loudly beats destruction: a dirty buffer is unsaved work that
  // exists nowhere else; an untouched session just closes.
  if (selectSourceEditDirty(useLabelStore.getState())) {
    await postDraftReceipt({
      id,
      ok: false,
      error: "the user is editing the label's ZPL source; ask them to apply or discard it first",
    });
    return;
  }
  // Counted before the swap: opening a design replaces the editor's document
  // and clears its undo history, so the reply says what was displaced rather
  // than letting the agent report a silent success.
  const before = useLabelStore
    .getState()
    .pages.reduce((n, p) => n + getAllLeaves(p.objects).length, 0);
  // Answered even on a throw: without a receipt the tool waits out its timeout
  // and reports "no answer" for a document that may already have been swapped.
  let receipt: Parameters<typeof postDraftReceipt>[0];
  try {
    const applied = useLabelStore.getState().loadDesignText(designText);
    receipt = {
      id,
      ok: applied,
      ...(applied ? { replacedObjects: before } : { error: "ZPLab could not open the design file" }),
    };
  } catch (e) {
    receipt = { id, ok: false, error: e instanceof Error ? e.message : "ZPLab could not open the design file" };
  }
  await postDraftReceipt(receipt);
}

/** Ink budget for one graphic: only the width is a parameter, so a tall source
 *  at a wide target allocates unbounded dots. Far past any real label. */
const MAX_RASTER_DOTS = 4_000_000;

/** Decoded-source budget. The output cap says nothing about the source: a
 *  compressed image that unpacks to gigapixels passes it at any target width. */
const MAX_SOURCE_PIXELS = 80_000_000;

/** The decoded source, or a throw naming why it cannot be rastered at that
 *  width. Handed on to the encoder: decoding the same URL twice would spend two
 *  decode timeouts inside the sidecar's one budget. */
async function decodeForRaster(dataUrl: string, widthDots: number): Promise<HTMLImageElement> {
  const img = await loadImage(dataUrl, "Failed to load image for GFA conversion");
  const sourcePixels = (img.naturalWidth || 1) * (img.naturalHeight || 1);
  if (sourcePixels > MAX_SOURCE_PIXELS) {
    throw new Error(`the source image is ${img.naturalWidth}x${img.naturalHeight}; downscale it before sending`);
  }
  const height = scaledHeightDots(widthDots, img.naturalWidth || 1, img.naturalHeight || 1);
  // Core's own emit ceilings, not a second budget: past them gfaHeaderDims
  // refuses the header and toZPL ships ^FD^FS, so producing such a cache would
  // hand back bytes core itself will not print.
  if (height > GF_MAX_ROWS || gfByteWidth(widthDots) / 8 > GF_MAX_BYTES_PER_ROW) {
    throw new Error(`the image would raster to ${widthDots}x${height} dots, past what ^GF can print; lower widthDots or crop the source`);
  }
  if (widthDots * height > MAX_RASTER_DOTS) {
    throw new Error(`the image would raster to ${widthDots}x${height} dots; lower widthDots or crop the source`);
  }
  return img;
}

/** Encode an image the agent handed over; the encoder needs a canvas, which the
 *  headless sidecar has not. Exported like its siblings: the reply shape is a
 *  contract the sidecar parses. */
export async function respondToRasterRequest(line: string): Promise<void> {
  const { id, dataUrl, widthDots, threshold } = JSON.parse(line) as {
    id: number;
    dataUrl: string;
    widthDots: number;
    threshold: number;
  };
  // Encode inside the try, answer outside it: a failing POST must not be
  // mistaken for a failing encode and answered a second time.
  let reply: Parameters<typeof postRasterResponse>[0];
  try {
    const raster = gfaFromImage(await decodeForRaster(dataUrl, widthDots), widthDots, threshold);
    reply = {
      id,
      ok: true,
      gfa: raster.zpl,
      widthDots: raster.widthDots,
      heightDots: raster.heightDots,
    };
  } catch (e) {
    reply = { id, ok: false, error: e instanceof Error ? e.message : "the image could not be decoded" };
  }
  await postRasterResponse(reply);
}

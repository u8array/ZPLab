import { useSyncExternalStore } from "react";
import type Konva from "konva";
import type { CanvasConfig } from "konva/lib/Node";
import { KonvaRenderer } from "react-konva";
import type { RenderMode } from "@zplab/core/lib/variableBinding";
import { CAPTURE_CHROME, CAPTURE_SELECTION, guardedRegion, type Rect } from "../../lib/canvasImage";
import { measuredBoundsMap, type MeasuredFootprint } from "../../lib/measuredBoundsCache";

// Not in the store: the store saves the session on every write.
let capturing = false;
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function setCapturing(on: boolean): void {
  // The canvas tree has its own renderer, so flushSync from react-dom does not reach it.
  KonvaRenderer.flushSyncFromReconciler(() => {
    capturing = on;
    for (const fn of listeners) fn();
  });
}

/** The render mode the canvas draws for a bound field: values during a capture, the view otherwise. */
export function useDrawnRenderMode(view: RenderMode): RenderMode {
  return useSyncExternalStore(subscribe, () => (capturing ? "preview" : view));
}

/** Puts the label group in the print look and returns the restore. */
export function applyPrintLook(group: Konva.Group, paper: Konva.Rect | null): () => void {
  setCapturing(true);
  const chrome = group.find(`.${CAPTURE_CHROME}`);
  const stroked = group.find<Konva.Shape>(`.${CAPTURE_SELECTION}`);
  const widths = stroked.map((n) => n.strokeWidth());
  const rotation = group.rotation();
  chrome.forEach((n) => n.visible(false));
  stroked.forEach((n) => n.strokeWidth(0));
  // The paper shadow inflates the node bbox and would land in the crop.
  paper?.shadowEnabled(false);
  group.rotation(0);
  return () => {
    chrome.forEach((n) => n.visible(true));
    stroked.forEach((n, i) => n.strokeWidth(widths[i] ?? 0));
    paper?.shadowEnabled(true);
    group.rotation(rotation);
    setCapturing(false);
  };
}

/** The stage rectangle with smoothing off, so a later threshold sees hard edges. */
const regionShot = (rect: Rect, pixelRatio: number): CanvasConfig => ({ ...guardedRegion(rect, pixelRatio), imageSmoothingEnabled: false });

/** The look lasts only for the synchronous draw, so two captures cannot restore each other's view. */
function drawPrintLook(group: Konva.Group, paper: Konva.Rect | null, shot: () => CanvasConfig | null): HTMLCanvasElement | null {
  const restore = applyPrintLook(group, paper);
  try {
    const config = shot();
    return config && group.toCanvas(config);
  } finally {
    restore();
  }
}

async function capturePng(group: Konva.Group, paper: Konva.Rect | null, shot: () => CanvasConfig | null): Promise<Blob | null> {
  try {
    const canvas = drawPrintLook(group, paper, shot);
    return canvas && (await new Promise((resolve) => canvas.toBlob(resolve, "image/png")));
  } catch {
    return null;
  }
}

/** The label as a PNG, cropped to the group bbox or to the paper at the given ratio. Null on failure. */
export function captureLabelBlob(
  group: Konva.Group,
  paper: Konva.Rect | null,
  region?: { pixelRatio: number; dots: { width: number; height: number } },
): Promise<Blob | null> {
  return capturePng(group, paper, () => {
    // A bare ratio keeps a screen export crisp on high-dpi displays.
    if (!region || !paper) return { pixelRatio: 2 };
    // The paper rect is the region, so off-label objects cannot widen the capture.
    const { pixelRatio, dots } = region;
    const rect = paper.getClientRect();
    return regionShot({ x: rect.x, y: rect.y, width: dots.width / pixelRatio, height: dots.height / pixelRatio }, pixelRatio);
  });
}

/** One stage rectangle of the label as a PNG for a selection image. Null on failure or without a rectangle. */
export function captureRegionBlob(
  group: Konva.Group,
  paper: Konva.Rect | null,
  rect: (measured: ReadonlyMap<string, MeasuredFootprint>) => Rect | null,
  pixelRatio: number,
): Promise<Blob | null> {
  return capturePng(group, paper, () => {
    const region = rect(measuredBoundsMap());
    return region && regionShot(region, pixelRatio);
  });
}

import type Konva from "konva";

/** Render a Konva node to a PNG blob. A bare pixel ratio keeps a screen export crisp on hidpi. A region
 *  captures exactly that stage rectangle with smoothing off, so a later threshold sees hard edges. Null on failure. */
export async function nodeToPngBlob(
  node: Konva.Node,
  config: number | { x: number; y: number; width: number; height: number; pixelRatio: number } = 2,
): Promise<Blob | null> {
  try {
    const region = typeof config === "number" ? { pixelRatio: config } : { ...config, imageSmoothingEnabled: false };
    const blob = await node.toBlob({ ...region, mimeType: "image/png" });
    return blob instanceof Blob ? blob : null;
  } catch {
    return null;
  }
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Konva `name` of editor-only nodes, which a capture hides. */
export const CAPTURE_CHROME = "capture-chrome";
/** Konva `name` on a content node's own selection stroke, so a capture zeroes the stroke instead of hiding the node. */
export const CAPTURE_SELECTION = "capture-selection";

/** Konva floors the canvas size after scaling, so a hair above the exact size keeps the last column and row. */
export function guardedRegion(rect: Rect, pixelRatio: number): Rect & { pixelRatio: number } {
  const guard = 1e-6 / pixelRatio;
  return { x: rect.x, y: rect.y, width: rect.width + guard, height: rect.height + guard, pixelRatio };
}

/** Puts the label group in the look a print has: chrome hidden, selection strokes off, no paper shadow, no
 *  view rotation. Returns the restore. */
export function applyPrintLook(group: Konva.Group, paper: Konva.Rect | null): () => void {
  const chrome = group.find(`.${CAPTURE_CHROME}`);
  const stroked = group.find<Konva.Shape>(`.${CAPTURE_SELECTION}`);
  const widths = stroked.map((n) => n.strokeWidth());
  const rotation = group.rotation();
  chrome.forEach((n) => n.visible(false));
  stroked.forEach((n) => n.strokeWidth(0));
  // The paper shadow pads the node bbox and would land in the crop.
  paper?.shadowEnabled(false);
  group.rotation(0);
  return () => {
    chrome.forEach((n) => n.visible(true));
    stroked.forEach((n, i) => n.strokeWidth(widths[i] ?? 0));
    paper?.shadowEnabled(true);
    group.rotation(rotation);
  };
}

async function withPrintLook<T>(group: Konva.Group, paper: Konva.Rect | null, capture: () => Promise<T>): Promise<T> {
  const restore = applyPrintLook(group, paper);
  try {
    return await capture();
  } finally {
    restore();
  }
}

/** The label as a PNG, cropped to the group's bbox without a region or to the paper at the given ratio with
 *  one, so a raster lines up with a printer render. Null on failure. */
export async function captureLabelBlob(
  group: Konva.Group,
  paper: Konva.Rect | null,
  region?: { pixelRatio: number; dots: { width: number; height: number } },
): Promise<Blob | null> {
  return withPrintLook(group, paper, async () => {
    if (!region || !paper) return nodeToPngBlob(group);
    // The paper rect is the region, so objects parked off the label cannot widen the capture.
    const { pixelRatio, dots } = region;
    const rect = paper.getClientRect();
    return nodeToPngBlob(group, guardedRegion({ x: rect.x, y: rect.y, width: dots.width / pixelRatio, height: dots.height / pixelRatio }, pixelRatio));
  });
}

/** One stage rectangle of the label as a PNG at the given ratio, for the image of a selection. Null on failure. */
export async function captureRegionBlob(group: Konva.Group, paper: Konva.Rect | null, rect: Rect, pixelRatio: number): Promise<Blob | null> {
  return withPrintLook(group, paper, () => nodeToPngBlob(group, guardedRegion(rect, pixelRatio)));
}

/** Copy a PNG to the clipboard. Takes a Blob promise so the caller can call this
 *  synchronously in the click handler: a pending blob keeps the user activation
 *  Safari/Firefox drop after an await. Throws on failure so the caller can react. */
export async function copyPngToClipboard(blob: Blob | Promise<Blob>): Promise<void> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    throw new Error("clipboard-image-unsupported");
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

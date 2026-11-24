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

/** Copy a PNG to the clipboard. Takes a Blob promise so the caller can call this
 *  synchronously in the click handler: a pending blob keeps the user activation
 *  Safari/Firefox drop after an await. Throws on failure so the caller can react. */
export async function copyPngToClipboard(blob: Blob | Promise<Blob>): Promise<void> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    throw new Error("clipboard-image-unsupported");
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

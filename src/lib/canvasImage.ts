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

/** The label group as a PNG with its editor chrome hidden. Without a region the node's own bbox is captured
 *  for the screen; with one, exactly that stage rectangle at the given ratio, so a raster lines up with a printer render. */
export async function captureLabelBlob(
  group: Konva.Group,
  paper: Konva.Rect | null,
  chromeName: string,
  region?: { pixelRatio: number; dots: { width: number; height: number } },
): Promise<Blob | null> {
  const chrome = group.find(`.${chromeName}`);
  const rotation = group.rotation();
  chrome.forEach((n) => n.visible(false));
  // The paper shadow pads the node bbox; drop it so the PNG crops to the label.
  paper?.shadowEnabled(false);
  group.rotation(0);
  try {
    if (!region || !paper) return await nodeToPngBlob(group);
    // The paper rect is the region, so objects parked off the label cannot widen the capture. Konva floors
    // the canvas size after scaling, so a hair above the exact dots keeps the last column and row.
    const { pixelRatio, dots } = region;
    const rect = paper.getClientRect();
    return await nodeToPngBlob(group, { x: rect.x, y: rect.y, width: (dots.width + 1e-6) / pixelRatio, height: (dots.height + 1e-6) / pixelRatio, pixelRatio });
  } finally {
    chrome.forEach((n) => n.visible(true));
    paper?.shadowEnabled(true);
    group.rotation(rotation);
  }
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

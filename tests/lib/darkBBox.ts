import type { PNG } from 'pngjs';

export interface InkBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The luminance cutoff is the shared definition of "ink"; forking it
 *  makes the gates disagree on glyph size. Extent is in pixels (= dots
 *  on the 8 dpmm fixture canvases). */
export function darkBBox(png: PNG): InkBBox {
  const { width, height, data } = png;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const lum =
        0.299 * (data[idx] ?? 0) +
        0.587 * (data[idx + 1] ?? 0) +
        0.114 * (data[idx + 2] ?? 0);
      if (lum < 200) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

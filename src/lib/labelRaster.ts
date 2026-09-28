import { mmToDots } from "@zplab/core/lib/coordinates";
import type { PdfPage } from "@zplab/core/lib/pdfWriter";
import type { LabelConfig } from "@zplab/core/types/LabelConfig";
import { printerPreviewLayout, printerRenderDims } from "./printerPreview";
import type { PrinterBitmap } from "./zebraGraphic";

export type MonoRaster = Pick<PdfPage, "width" | "height" | "mono">;

/** The label's size in physical head dots, the raster every renderer is brought to. ^JMB halves the
 *  format's density, but ^PW and ^LL stay physical (ZD230-verified), so the head and Labelary keep rendering
 *  at the printer's own dpmm. */
export function labelDots(label: LabelConfig): { width: number; height: number } {
  return { width: mmToDots(label.widthMm, label.dpmm), height: mmToDots(label.heightMm, label.dpmm) };
}

/** The label's part of the head raster, cropped like the preview overlay. */
export function monoFromPrinterBitmap(bmp: PrinterBitmap, label: { width: number; height: number }): MonoRaster {
  const { crop } = printerPreviewLayout(printerRenderDims(bmp), label);
  const stride = Math.ceil(crop.width / 8);
  const srcStride = bmp.width / 8;
  const mono = new Uint8Array(stride * crop.height);
  for (let y = 0; y < crop.height; y++) {
    for (let x = 0; x < crop.width; x++) {
      const sx = crop.x + x;
      const bit = ((bmp.mono[(crop.y + y) * srcStride + (sx >> 3)] ?? 0) >> (7 - (sx & 7))) & 1;
      if (bit) mono[y * stride + (x >> 3)] = (mono[y * stride + (x >> 3)] ?? 0) | (0x80 >> (x & 7));
    }
  }
  return { width: crop.width, height: crop.height, mono };
}

/** Places the image on a white raster of the label's dot size and thresholds it, so a rendered PNG and the
 *  canvas capture become the same 1-bit raster. Unscaled: Labelary rounds the size to a pixel less
 *  (measured 799 by 1199 for 100 by 150 mm at 8 dpmm) and resampling would blur every edge before the threshold. */
export async function monoFromImageUrl(url: string, dots: { width: number; height: number }): Promise<MonoRaster> {
  const image = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = dots.width;
  canvas.height = dots.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, dots.width, dots.height);
  ctx.drawImage(image, 0, 0);
  return monoFromRgba(ctx.getImageData(0, 0, dots.width, dots.height).data, dots.width, dots.height);
}

/** Thresholds RGBA pixels at mid grey into ^GF rows. A transparent pixel counts as paper. */
export function monoFromRgba(data: Uint8ClampedArray, width: number, height: number): MonoRaster {
  const stride = Math.ceil(width / 8);
  const mono = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const a = (data[o + 3] ?? 0) / 255;
      const luma = (0.299 * (data[o] ?? 0) + 0.587 * (data[o + 1] ?? 0) + 0.114 * (data[o + 2] ?? 0)) * a + 255 * (1 - a);
      if (luma < 128) mono[y * stride + (x >> 3)] = (mono[y * stride + (x >> 3)] ?? 0) | (0x80 >> (x & 7));
    }
  }
  return { width, height, mono };
}

/** The raster as a PNG data URL for a print window. */
export function rasterToDataUrl(raster: MonoRaster): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const stride = Math.ceil(raster.width / 8);
  const rgba = new Uint8ClampedArray(raster.width * raster.height * 4);
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      const v = ((raster.mono[y * stride + (x >> 3)] ?? 0) >> (7 - (x & 7))) & 1 ? 0 : 255;
      const o = (y * raster.width + x) * 4;
      rgba[o] = v;
      rgba[o + 1] = v;
      rgba[o + 2] = v;
      rgba[o + 3] = 255;
    }
  }
  ctx.putImageData(new ImageData(rgba, raster.width, raster.height), 0, 0);
  return canvas.toDataURL("image/png");
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed to load"));
    img.src = url;
  });
}

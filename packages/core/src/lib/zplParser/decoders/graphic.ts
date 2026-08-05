import { putImage } from "../../imageCache";
import { BITS_PER_BYTE } from "./constants";
import { gfPayloadToBytes } from "./gfa";
import { wrapGfB64 } from "./crc";
import type { DecodedGraphic } from "../types";

import { newId } from "../../ids";
/**
 * Decode a GF-shaped payload into an image-cache entry. Shared between
 * the `^GF` inline path and the `~DY` graphic-upload preamble; both
 * have the same payload shape and need the same decoded bitmap, canvas
 * paint, and cache write. Returns `null` when the payload can't be
 * decoded (caller surfaces as browserLimit).
 */
export function decodeGraphicToImage(
  rawData: string,
  format: "A" | "B" | "C",
  bytesPerRow: number,
  totalBytesHeader: string,
  dataBytesHeader: string,
  nameHint: string,
): DecodedGraphic | null {
  // Headless (Node/MCP): no canvas to paint the bitmap; degrade to the same
  // browserLimit path as an undecodable payload.
  if (typeof document === "undefined") return null;
  const decoded = gfPayloadToBytes(
    rawData,
    format,
    bytesPerRow,
    Number.parseInt(totalBytesHeader, 10),
  );
  if (!decoded) return null;
  const widthDots = bytesPerRow * BITS_PER_BYTE;
  const heightDots = Math.floor(decoded.data.length / bytesPerRow);
  if (heightDots <= 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = widthDots;
  canvas.height = heightDots;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const imgData = ctx.createImageData(widthDots, heightDots);
  const pixels = imgData.data;
  for (let row = 0; row < heightDots; row++) {
    for (let byteIdx = 0; byteIdx < bytesPerRow; byteIdx++) {
      const byte = decoded.data[row * bytesPerRow + byteIdx] ?? 0;
      for (let bit = 0; bit < BITS_PER_BYTE; bit++) {
        const px = byteIdx * BITS_PER_BYTE + bit;
        const idx = (row * widthDots + px) * 4;
        // ZPL ^GF: 1-bit = black (printed), 0-bit = transparent.
        // ImageData starts zero-filled (rgba(0,0,0,0)); only the
        // 1-bit case needs a write.
        if ((byte & (0x80 >> bit)) !== 0) {
          pixels[idx + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
  const imageId = newId();
  putImage({
    id: imageId,
    name: nameHint,
    dataUrl: canvas.toDataURL("image/png"),
    width: widthDots,
    height: heightDots,
  });
  return {
    imageId,
    widthDots,
    heightDots,
    // Raw binary re-encodes as A + :B64: of the raster (the ZDesigner-proven
    // spec form, p.1602); b then equals c per the uncompressed convention.
    gfaCache: decoded.raw
      ? `^GFA,${decoded.data.length},${decoded.data.length},${bytesPerRow},${wrapGfB64(decoded.data)}`
      : `^GF${format},${totalBytesHeader},${dataBytesHeader},${bytesPerRow},${rawData}`,
    crcOk: decoded.crcOk,
  };
}

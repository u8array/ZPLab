import bwipjs from "bwip-js";
import { bwipRetryOptions } from "@zplab/core/lib/barcodeDims";

function bwipPng(opts: Record<string, unknown>): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    bwipjs.toBuffer(
      opts as unknown as Parameters<typeof bwipjs.toBuffer>[0],
      (err: string | Error, png: Buffer) => {
        if (err) reject(err instanceof Error ? err : new Error(String(err)));
        else resolve(png);
      },
    );
  });
}

/** PNG encode mirroring the app's primary+retry chain (bwipRetryOptions). */
export async function bwipPngWithRetry(opts: Record<string, unknown>): Promise<Buffer> {
  try {
    return await bwipPng(opts);
  } catch (e) {
    const retry = bwipRetryOptions(opts);
    if (retry) return bwipPng(retry);
    throw e;
  }
}

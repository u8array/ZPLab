import { describe, it, expect } from "vitest";
// Node build: the browser entry has no toBuffer, and this pins raw PNG pixels.
import bwipjs from "bwip-js/node";
import { PNG } from "pngjs";
import { BWIP_SCALE } from "@zplab/core/lib/barcodeDims";
import { MAXICODE_INK_MARGIN_PX } from "@zplab/core/lib/bwipConstants";

// The maxicode crop is a fixed px rect measured at BWIP_SCALE, so a scale bump
// or a bwip upgrade that reshapes the bitmap must fail loudly here rather than
// silently squeezing the ink back off the printed raster.
async function maxicodePng(text: string): Promise<PNG> {
  const buf = await new Promise<Buffer>((resolve, reject) => {
    bwipjs.toBuffer(
      { bcid: "maxicode", text, scale: BWIP_SCALE, mode: 4 } as never,
      (err: string | Error, png: Buffer) => (err ? reject(err) : resolve(png)),
    );
  });
  return PNG.sync.read(buf);
}

/** Ink bbox over opaque dark pixels; bwip's background is transparent. */
function inkBox(png: PNG) {
  let minX = png.width, minY = png.height, maxX = -1, maxY = -1;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      if ((png.data[i + 3] ?? 255) === 0) continue;
      const lum = ((png.data[i] ?? 255) + (png.data[i + 1] ?? 255) + (png.data[i + 2] ?? 255)) / 3;
      if (lum >= 128) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

describe("bwip maxicode bitmap geometry at BWIP_SCALE", () => {
  it.each(["1234567890", "ABC", "999999999999999999999999999999"])(
    "renders a 210x200 canvas with the ink at (0,1) sized 209x198 for %s",
    async (text) => {
      const png = await maxicodePng(text);
      expect([png.width, png.height]).toEqual([210, 200]);
      expect(inkBox(png)).toEqual({ x: 0, y: 1, w: 209, h: 198 });
    },
  );

  it("keeps MAXICODE_INK_MARGIN_PX in sync with the measured margins", async () => {
    const png = await maxicodePng("1234567890");
    const ink = inkBox(png);
    expect(MAXICODE_INK_MARGIN_PX).toEqual({
      left: ink.x,
      top: ink.y,
      right: png.width - ink.x - ink.w,
      bottom: png.height - ink.y - ink.h,
    });
  });
});

import { describe, it, expect } from "vitest";
import {
  encodeGraphicFile,
  packMonoBits,
  monoRasterToRgba,
  gfaFromRaster,
  rasterizeMono,
  scaledHeightDots,
  type MonoRaster,
} from "@zplab/core/lib/imageToZpl";

/** Build an RGBA buffer (paddedWidth × height) from per-pixel [r,g,b] rows. */
function rgba(rows: [number, number, number][][]): Uint8ClampedArray {
  const width = rows[0]?.length ?? 0;
  const out = new Uint8ClampedArray(width * rows.length * 4);
  rows.forEach((row, y) =>
    row.forEach(([r, g, b], x) => {
      const i = (y * width + x) * 4;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
    }),
  );
  return out;
}

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

describe("packMonoBits", () => {
  it("packs black pixels MSB-first", () => {
    const px = rgba([[BLACK, WHITE, WHITE, WHITE, WHITE, WHITE, WHITE, BLACK]]);
    expect(Array.from(packMonoBits(px, 8, 1, 128))).toEqual([0x81]);
  });

  it("leaves an all-white row at zero", () => {
    const px = rgba([[WHITE, WHITE, WHITE, WHITE, WHITE, WHITE, WHITE, WHITE]]);
    expect(Array.from(packMonoBits(px, 8, 1, 128))).toEqual([0x00]);
  });

  it("thresholds color via BT.601 luminance", () => {
    // red lum ≈ 76 (< 128 → black), yellow lum ≈ 226 (→ white)
    const red: [number, number, number] = [255, 0, 0];
    const yellow: [number, number, number] = [255, 255, 0];
    const px = rgba([[red, yellow, WHITE, WHITE, WHITE, WHITE, WHITE, WHITE]]);
    expect(Array.from(packMonoBits(px, 8, 1, 128))).toEqual([0x80]);
  });

  it("splits mid-grays at the threshold", () => {
    // exact-equality is FP-dependent (coefficients sum to 1.0 only nominally),
    // so probe one clear step on either side of the threshold instead
    const gray: [number, number, number] = [128, 128, 128];
    const px = rgba([[gray, WHITE, WHITE, WHITE, WHITE, WHITE, WHITE, WHITE]]);
    expect(Array.from(packMonoBits(px, 8, 1, 127))).toEqual([0x00]);
    expect(Array.from(packMonoBits(px, 8, 1, 129))).toEqual([0x80]);
  });

  it("packs multi-byte rows and multiple rows in row-major order", () => {
    const px = rgba([
      [BLACK, ...Array<[number, number, number]>(14).fill(WHITE), BLACK],
      [WHITE, BLACK, ...Array<[number, number, number]>(14).fill(WHITE)],
    ]);
    expect(Array.from(packMonoBits(px, 16, 2, 128))).toEqual([
      0x80, 0x01, 0x40, 0x00,
    ]);
  });
});

describe("monoRasterToRgba", () => {
  const raster = (bytes: number[], widthDots: number, heightDots: number): MonoRaster => ({
    bytes: new Uint8Array(bytes),
    bytesPerRow: Math.ceil(widthDots / 8),
    paddedWidth: Math.ceil(widthDots / 8) * 8,
    widthDots,
    heightDots,
  });

  it("paints set bits opaque black, clear bits transparent", () => {
    // 0xA0 = 10100000
    const out = monoRasterToRgba(raster([0xa0], 3, 1));
    expect(out.length).toBe(3 * 4);
    expect(Array.from(out)).toEqual([
      0, 0, 0, 255,
      0, 0, 0, 0,
      0, 0, 0, 255,
    ]);
  });

  it("crops the byte-pad columns beyond widthDots", () => {
    // pad bits set on purpose; they must not leak into the preview
    const out = monoRasterToRgba(raster([0xff], 3, 1));
    expect(out.length).toBe(3 * 4);
    expect(out[3]).toBe(255);
  });

  it("round-trips a packMonoBits result", () => {
    const px = rgba([[BLACK, WHITE, BLACK, WHITE, WHITE, WHITE, WHITE, WHITE]]);
    const bytes = packMonoBits(px, 8, 1, 128);
    const out = monoRasterToRgba({
      bytes,
      bytesPerRow: 1,
      paddedWidth: 8,
      widthDots: 8,
      heightDots: 1,
    });
    const alphas = Array.from({ length: 8 }, (_, x) => out[x * 4 + 3]);
    expect(alphas).toEqual([255, 0, 255, 0, 0, 0, 0, 0]);
  });
});

describe("scaledHeightDots", () => {
  it("scales by aspect and rounds", () => {
    expect(scaledHeightDots(120, 100, 50)).toBe(60);
    expect(scaledHeightDots(200, 200, 200)).toBe(200);
  });

  it("clamps a wide/short source that rounds to 0 up to 1 row", () => {
    expect(scaledHeightDots(8, 1000, 30)).toBe(1);
  });
});

describe("gfaFromRaster", () => {
  it("emits byte counts, bytesPerRow and uppercase hex", () => {
    const zpl = gfaFromRaster({
      bytes: new Uint8Array([0x81, 0x00, 0xff, 0x0a]),
      bytesPerRow: 2,
      paddedWidth: 16,
      widthDots: 16,
      heightDots: 2,
    });
    expect(zpl).toBe("^GFA,4,4,2,8100FF0A");
  });
});

describe("rasterizeMono guards", () => {
  // The guard returns before any canvas op, so a 0 dimension never reaches
  // getImageData (which throws IndexSizeError). Node lane: no DOM needed.
  const img = { naturalWidth: 100, naturalHeight: 50 } as HTMLImageElement;

  it("returns null for a non-positive widthDots (degenerate ^GF import)", () => {
    expect(rasterizeMono(img, 0, 128)).toBeNull();
    expect(rasterizeMono(img, -4, 128)).toBeNull();
  });

  it("returns null for a 0-width image (dimensionless SVG)", () => {
    expect(rasterizeMono({ naturalWidth: 0, naturalHeight: 0 } as HTMLImageElement, 100, 128)).toBeNull();
  });

  it("refuses a file that is not an image before reading it", async () => {
    await expect(encodeGraphicFile(new File(["x"], "notes.txt", { type: "text/plain" }))).rejects.toThrow("Not an image: notes.txt");
  });
});

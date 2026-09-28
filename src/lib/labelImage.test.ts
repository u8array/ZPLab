import { describe, expect, it, vi } from "vitest";
import type * as Labelary from "./labelary";
import type * as PrinterPreview from "./printerPreview";
import type * as LabelRaster from "./labelRaster";

const { fetchPreview, fetchPrinterPreview, resolvePreviewTarget, monoFromImageUrl } = vi.hoisted(() => ({
  fetchPreview: vi.fn(async () => "blob:labelary"),
  fetchPrinterPreview: vi.fn(),
  resolvePreviewTarget: vi.fn(() => ({ target: { kind: "network" as const, host: "172.17.17.175", port: 9100 } })),
  monoFromImageUrl: vi.fn(async (_url: string, dots: { width: number; height: number }) => ({ ...dots, mono: new Uint8Array(Math.ceil(dots.width / 8) * dots.height) })),
}));
vi.mock("./labelary", async (importOriginal) => ({ ...(await importOriginal<typeof Labelary>()), fetchPreview }));
vi.mock("./printerPreview", async (importOriginal) => ({ ...(await importOriginal<typeof PrinterPreview>()), fetchPrinterPreview, resolvePreviewTarget }));
vi.mock("./labelRaster", async (importOriginal) => ({ ...(await importOriginal<typeof LabelRaster>()), monoFromImageUrl }));

import { renderLabelImageUrl, renderLabelMono } from "./labelImage";
import { pageLabelConfig } from "@zplab/core/types/Group";

const job = { label: pageLabelConfig({ widthMm: 4, heightMm: 1, dpmm: 8 }, {}), objects: [], variables: [], active: null };
const deps = { labelary: { host: "https://api.labelary.com" }, captureCanvas: vi.fn(async () => new Blob(["png"])) };

describe("labelImage", () => {
  it("brings every renderer to the label's dot raster and hands a print window the same image", async () => {
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:canvas", revokeObjectURL: vi.fn() });
    const mono = await renderLabelMono("labelary", job, deps);
    expect([mono.width, mono.height]).toEqual([32, 8]);
    expect(fetchPreview).toHaveBeenCalledWith(expect.stringContaining("^XA"), job.label, "https://api.labelary.com", undefined);
    expect(monoFromImageUrl).toHaveBeenLastCalledWith("blob:labelary", { width: 32, height: 8 });
    await renderLabelMono("none", job, deps);
    expect(deps.captureCanvas).toHaveBeenCalledWith({ width: 32, height: 8 });
    expect(monoFromImageUrl).toHaveBeenLastCalledWith("blob:canvas", { width: 32, height: 8 });
    expect(await renderLabelImageUrl("none", job, deps)).toBe("blob:canvas");
    vi.unstubAllGlobals();
  });

  it("crops the printer's head raster to the label, and names a printer failure the way the preview does", async () => {
    // 40-dot head, 32-dot label: the crop starts at column 4.
    const mono = new Uint8Array(5 * 8);
    for (let y = 0; y < 8; y++) mono[y * 5 + 1] = 0b11110000;
    fetchPrinterPreview.mockResolvedValueOnce({ kind: "bitmap", bitmap: { width: 40, height: 8, mono } });
    const raster = await renderLabelMono("printer", job, deps);
    expect([raster.width, raster.height]).toEqual([32, 8]);
    expect(raster.mono[0]).toBe(0b00001111);
    fetchPrinterPreview.mockResolvedValueOnce({ kind: "refused" });
    await expect(renderLabelMono("printer", job, deps)).rejects.toThrow("The printer refused the connection. Check that port 9100 is open.");
    resolvePreviewTarget.mockReturnValueOnce({ error: "No printer configured." } as never);
    await expect(renderLabelImageUrl("printer", job, deps)).rejects.toThrow("No printer configured.");
  });

  it("refuses when the canvas cannot be captured", async () => {
    await expect(renderLabelMono("none", job, { ...deps, captureCanvas: async () => null })).rejects.toThrow("could not capture the canvas");
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type * as LabelImage from "../lib/labelImage";
import type * as FileDialogs from "../lib/fileDialogs";
import type * as Writer from "@zplab/core/lib/pdfWriter";
import { useLabelStore } from "../store/labelStore";
import type { LabelObject, Page } from "@zplab/core/types/Group";

const { renderLabelMono, saveFile, writePdf } = vi.hoisted(() => ({
  renderLabelMono: vi.fn(),
  saveFile: vi.fn(async () => true),
  writePdf: vi.fn(() => new Uint8Array([0x25, 0x50, 0x44, 0x46])),
}));
vi.mock("../lib/labelImage", async (importOriginal) => ({ ...(await importOriginal<typeof LabelImage>()), renderLabelMono }));
vi.mock("../lib/fileDialogs", async (importOriginal) => ({ ...(await importOriginal<typeof FileDialogs>()), saveFile }));
vi.mock("@zplab/core/lib/pdfWriter", async (importOriginal) => ({ ...(await importOriginal<typeof Writer>()), writePdf }));

import { usePdfExport } from "./usePdfExport";

const text = (id: string): LabelObject => ({ id, type: "text", x: 10, y: 10, rotation: 0, props: { content: id, fontHeight: 30, fontWidth: 0, rotation: "N" } }) as never;
const raster = { width: 32, height: 8, mono: new Uint8Array(32) };
// Labelary rows are paced by a short pause, so a settle must outlast it.
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 300)); });

beforeEach(() => {
  renderLabelMono.mockReset();
  saveFile.mockClear();
  writePdf.mockClear();
  useLabelStore.setState({
    label: { widthMm: 4, heightMm: 1, dpmm: 8 },
    pages: [{ objects: [text("a")], jmDensity: "B" }, { objects: [text("b")] }] as Page[],
    currentPageIndex: 1,
    variables: [],
    dataset: null,
    columnMapping: null,
    previewProvider: "labelary",
    thirdParty: { labelary: true },
    labelaryApiKeyLoaded: true,
    userError: null,
  });
});

describe("usePdfExport", () => {
  it("renders every page through the renderer and writes one file with a page per label", async () => {
    renderLabelMono.mockResolvedValue(raster);
    const { result } = renderHook(() => usePdfExport({ current: null }));
    await act(async () => {
      result.current.exportPdf();
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(renderLabelMono).toHaveBeenCalledTimes(2);
    expect(writePdf).toHaveBeenCalledWith(
      [expect.objectContaining({ widthMm: 4, heightMm: 1, width: 32 }), expect.objectContaining({ widthMm: 4, heightMm: 1 })],
      { producer: "ZPLab", subject: "Rendered with Labelary (online service)" },
    );
    expect(saveFile).toHaveBeenCalledWith(expect.any(Blob), { filename: "label.pdf", filters: [expect.objectContaining({ extensions: ["pdf"] })] });
    expect(result.current.progress).toBeNull();
  });

  it("captures only the page on screen when no renderer draws the others", async () => {
    useLabelStore.setState({ previewProvider: "none" });
    renderLabelMono.mockResolvedValue(raster);
    const { result } = renderHook(() => usePdfExport({ current: null }));
    await act(async () => {
      result.current.exportPdf();
    });
    await flush();
    expect(renderLabelMono).toHaveBeenCalledTimes(1);
    expect(renderLabelMono.mock.calls[0]![1]).toEqual(expect.objectContaining({ objects: [expect.objectContaining({ id: "b" })] }));
  });

  it("writes no file when a page fails or the export is cancelled, and reports the failed page", async () => {
    renderLabelMono.mockResolvedValueOnce(raster).mockRejectedValueOnce(new Error("Could not reach the printer."));
    useLabelStore.setState({ previewProvider: "printer" });
    const { result } = renderHook(() => usePdfExport({ current: null }));
    await act(async () => {
      result.current.exportPdf();
    });
    await flush();
    expect(saveFile).not.toHaveBeenCalled();
    expect(useLabelStore.getState().userError?.message).toBe("Label 2 could not be rendered: Could not reach the printer.");

    let release: (() => void) | undefined;
    renderLabelMono.mockReset();
    renderLabelMono.mockImplementation(() => new Promise((resolve) => { release = () => resolve(raster); }));
    await act(async () => {
      result.current.exportPdf();
    });
    expect(result.current.progress).toEqual({ done: 0, total: 2, saving: false });
    act(() => result.current.cancel());
    await act(async () => {
      release?.();
    });
    await flush();
    expect(saveFile).not.toHaveBeenCalled();
    expect(result.current.progress).toBeNull();
  });
});

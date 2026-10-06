// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { PrinterObjectsSection } from "./PrinterObjectsSection";
import { useLabelStore } from "../../store/labelStore";
import { DEFAULT_PRINT_TARGET } from "../../lib/printTarget";
import { fallbackTranslations as en } from "../../locales";
import type * as PrinterObjects from "../../lib/printerObjects";

const readPrinterObjects = vi.fn();
const readPrinterGraphic = vi.fn();
const deletePrinterObject = vi.fn();
const bitmapToDataUrl = vi.fn();
vi.mock("../../lib/printerObjects", async (importOriginal) => ({
  ...(await importOriginal<typeof PrinterObjects>()),
  readPrinterObjects: (...args: unknown[]) => readPrinterObjects(...args),
  readPrinterGraphic: (...args: unknown[]) => readPrinterGraphic(...args),
  deletePrinterObject: (...args: unknown[]) => deletePrinterObject(...args),
}));
// jsdom has no canvas, so the raster-to-image step is stubbed.
vi.mock("../../lib/printerPreview", () => ({ bitmapToDataUrl: () => bitmapToDataUrl() }));

const loc = en.printerSettings.objects;
const pre = { device: "R", name: "PRE", ext: "GRF", size: 49924 };
const png = { device: "E", name: "CHK06", ext: "PNG", size: 2203 };
const font = { device: "E", name: "CG_TIMES", ext: "TTF", size: 62252 };
const listing = [
  { device: "R", objects: [pre, { device: "R", name: "LBL", ext: "ZPL", size: 214 }], bytesFree: 7467008 },
  { device: "E", objects: [png, font], bytesFree: 47972352 },
];
const target = { kind: "network", host: "172.17.17.175", port: 9100 };
const listed = () => act(() => useLabelStore.setState({ printerObjects: { phase: "done", key: "net:172.17.17.175:9100", at: 0, directories: listing } }));

afterEach(cleanup);
beforeEach(() => {
  readPrinterObjects.mockReset();
  readPrinterGraphic.mockReset();
  deletePrinterObject.mockReset();
  bitmapToDataUrl.mockReset().mockReturnValue("data:image/png;base64,x");
  act(() =>
    useLabelStore.setState({
      printerObjects: { phase: "idle" },
      printerReading: undefined,
      printTarget: { ...DEFAULT_PRINT_TARGET, host: "172.17.17.175" },
      printerProfile: { ...useLabelStore.getState().printerProfile, setupGraphics: [], setupFonts: [] },
    }),
  );
});

describe("PrinterObjectsSection", () => {
  it("reads the printer on request and lists only the objects of its kind with the free space", async () => {
    readPrinterObjects.mockResolvedValue({ kind: "ok", value: listing });
    const r = render(<PrinterObjectsSection kind="graphic" />);
    expect(r.getByText(loc.printerNotRead)).toBeTruthy();
    await act(async () => {
      fireEvent.click(r.getByText(loc.readPrinter));
    });
    expect(r.getByText("R:PRE.GRF")).toBeTruthy();
    expect(r.getByText("E:CHK06.PNG")).toBeTruthy();
    expect(r.queryByText("R:LBL.ZPL")).toBeNull();
    expect(r.queryByText("E:CG_TIMES.TTF")).toBeNull();
    expect(r.getByText("R: 7292 KB free, E: 46848 KB free")).toBeTruthy();
    expect((r.getAllByText(loc.showObject) as HTMLButtonElement[]).map((b) => b.disabled)).toEqual([false, false]);
    r.unmount();
    const fonts = render(<PrinterObjectsSection kind="font" />);
    expect(fonts.getByText("E:CG_TIMES.TTF")).toBeTruthy();
    expect(fonts.queryByText("R:PRE.GRF")).toBeNull();
    expect(fonts.queryByText(loc.showObject)).toBeNull();
  });

  it("shows a stored graphic in a dialog and names a raster it cannot draw", async () => {
    listed();
    readPrinterGraphic.mockResolvedValue({ kind: "ok", value: { name: "PRE", gfa: "^GFA,2,2,1,FFFF" } });
    const r = render(<PrinterObjectsSection kind="graphic" />);
    await act(async () => {
      fireEvent.click(r.getAllByText(loc.showObject)[0] as HTMLElement);
    });
    expect(readPrinterGraphic).toHaveBeenCalledWith(target, pre);
    expect((r.getByRole("img") as HTMLImageElement).alt).toBe("R:PRE.GRF");
    fireEvent.click(r.getByLabelText(en.app.close));
    bitmapToDataUrl.mockReturnValue(null);
    await act(async () => {
      fireEvent.click(r.getAllByText(loc.showObject)[0] as HTMLElement);
    });
    expect(r.getByRole("alert").textContent).toBe(loc.graphicUnreadable);
  });

  it("asks per kind before deleting, warns when the setup script would upload it again, and reports a failed delete", async () => {
    listed();
    act(() => useLabelStore.setState({ printerProfile: { ...useLabelStore.getState().printerProfile, setupFonts: [{ path: "E:CG_TIMES.TTF" }] } }));
    deletePrinterObject.mockResolvedValue({ kind: "unreachable" });
    const r = render(<PrinterObjectsSection kind="font" />);
    fireEvent.click(r.getByText(loc.deleteObject));
    expect(r.getByText(`Delete E:CG_TIMES.TTF from the printer? Labels that use it fall back to another font. ${loc.setupReuploadHint}`)).toBeTruthy();
    fireEvent.click(r.getByText(en.app.cancel));
    expect(deletePrinterObject).not.toHaveBeenCalled();
    fireEvent.click(r.getByText(loc.deleteObject));
    await act(async () => {
      fireEvent.click(r.getAllByText(loc.deleteObject).at(-1) as HTMLElement);
    });
    expect(deletePrinterObject).toHaveBeenCalledWith(target, font);
    expect(r.getByRole("alert").textContent).toMatch(/Could not reach the printer/);
    r.unmount();
    const graphics = render(<PrinterObjectsSection kind="graphic" />);
    fireEvent.click(graphics.getAllByText(loc.deleteObject)[0] as HTMLElement);
    expect(graphics.getByText("Delete R:PRE.GRF from the printer? Labels that recall it print without it.")).toBeTruthy();
  });
});

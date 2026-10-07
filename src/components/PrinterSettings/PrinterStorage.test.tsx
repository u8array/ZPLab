// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { PrinterObjectActions, PrinterStorageBar } from "./PrinterStorage";
import { useLabelStore } from "../../store/labelStore";
import { DEFAULT_PRINT_TARGET } from "../../lib/printTarget";
import { fallbackTranslations as en } from "../../locales";
import type { HostObject } from "@zplab/core/lib/hostDirectory";
import type { StoredObjectOrigin } from "@zplab/core/lib/storedObjectOrigins";
import type * as PrinterObjects from "../../lib/printerObjects";

const readPrinterObjects = vi.fn();
const readPrinterObjectImage = vi.fn();
const deletePrinterObject = vi.fn();
vi.mock("../../lib/printerObjects", async (importOriginal) => ({
  ...(await importOriginal<typeof PrinterObjects>()),
  readPrinterObjects: (...args: unknown[]) => readPrinterObjects(...args),
  readPrinterObjectImage: (...args: unknown[]) => readPrinterObjectImage(...args),
  deletePrinterObject: (...args: unknown[]) => deletePrinterObject(...args),
}));

const loc = en.printerSettings.objects;
const pre = { device: "R", name: "PRE", ext: "GRF", size: 49924 };
const font = { device: "E", name: "CG_TIMES", ext: "TTF", size: 62252 };
const firmware = { device: "Z", name: "TT0003M_", ext: "FNT", size: 11000 };
const listing = [
  { device: "R", objects: [pre], bytesFree: 7467008 },
  { device: "E", objects: [font], bytesFree: 47972352 },
];
const target = { kind: "network", host: "172.17.17.175", port: 9100 };
const media = expect.objectContaining({ dpmm: expect.any(Number) });
const origin = (hostObject: HostObject, extra: Partial<StoredObjectOrigin> = {}): StoredObjectOrigin & { hostObject: HostObject } => ({
  key: `${hostObject.device}:${hostObject.name}.${hostObject.ext}`,
  path: `${hostObject.device}:${hostObject.name}.${hostObject.ext}`,
  inSetup: false,
  hasCopy: false,
  host: "present",
  hostObject,
  ...extra,
});

afterEach(cleanup);
beforeEach(() => {
  readPrinterObjects.mockReset();
  readPrinterObjectImage.mockReset();
  deletePrinterObject.mockReset();
  act(() =>
    useLabelStore.setState({
      printerObjects: { phase: "idle" },
      printerReading: undefined,
      printTarget: { ...DEFAULT_PRINT_TARGET, host: "172.17.17.175" },
    }),
  );
});

describe("PrinterStorageBar", () => {
  it("reads the printer on request and reports the free space of every drive that answered", async () => {
    readPrinterObjects.mockResolvedValue({ kind: "ok", value: listing });
    const r = render(<PrinterStorageBar />);
    expect(r.getByText(loc.printerNotRead)).toBeTruthy();
    await act(async () => {
      fireEvent.click(r.getByText(loc.readPrinter));
    });
    expect(r.getByText("R: 7292 KB free, E: 46848 KB free")).toBeTruthy();
  });

  it("names a failed read instead of an empty listing", async () => {
    readPrinterObjects.mockResolvedValue({ kind: "unreachable" });
    const r = render(<PrinterStorageBar />);
    await act(async () => {
      fireEvent.click(r.getByText(loc.readPrinter));
    });
    expect(r.getByText(en.printerSettings.printerStatus.failUnreachable)).toBeTruthy();
  });
});

describe("PrinterObjectActions", () => {
  it("shows a stored graphic in a dialog and names one it cannot draw", async () => {
    readPrinterObjectImage.mockResolvedValueOnce({ kind: "ok", value: "data:image/png;base64,x" });
    const r = render(<PrinterObjectActions origin={origin(pre)} kind="graphic" />);
    await act(async () => {
      fireEvent.click(r.getByText(loc.showObject));
    });
    expect(readPrinterObjectImage).toHaveBeenCalledWith(target, pre, media);
    expect((r.getByRole("img") as HTMLImageElement).alt).toBe("R:PRE.GRF");
    fireEvent.click(r.getByLabelText(en.app.close));
    readPrinterObjectImage.mockResolvedValueOnce({ kind: "ok", value: null });
    await act(async () => {
      fireEvent.click(r.getByText(loc.showObject));
    });
    expect(r.getByRole("alert").textContent).toBe(loc.graphicUnreadable);
  });

  it("lets the printer draw a font sample and says when it drew nothing", async () => {
    readPrinterObjectImage.mockResolvedValueOnce({ kind: "ok", value: "data:image/png;base64,x" });
    const r = render(<PrinterObjectActions origin={origin(font)} kind="font" />);
    await act(async () => {
      fireEvent.click(r.getByText(loc.showObject));
    });
    expect(readPrinterObjectImage).toHaveBeenCalledWith(target, font, media);
    expect((r.getByRole("img") as HTMLImageElement).alt).toBe("E:CG_TIMES.TTF");
    fireEvent.click(r.getByLabelText(en.app.close));
    readPrinterObjectImage.mockResolvedValueOnce({ kind: "ok", value: null });
    await act(async () => {
      fireEvent.click(r.getByText(loc.showObject));
    });
    expect(r.getByRole("alert").textContent).toBe(loc.fontSampleBlank);
  });

  it("names the copy that survives the delete, per what the row knows", () => {
    const ask = (extra: Partial<StoredObjectOrigin>) => {
      const r = render(<PrinterObjectActions origin={origin(font, extra)} kind="font" />);
      fireEvent.click(r.getByText(loc.deleteObject));
      const message = r.getByRole("alertdialog").textContent ?? "";
      cleanup();
      return message;
    };
    expect(ask({ inSetup: true, hasCopy: true })).toContain(loc.setupReuploadHint);
    expect(ask({ hasCopy: true })).toContain(loc.deleteLocalCopyHint);
    expect(ask({})).toContain(loc.deleteNoCopyHint);
  });

  it("asks per kind, cancels without sending and reports a failed delete on the row", async () => {
    deletePrinterObject.mockResolvedValue({ kind: "unreachable" });
    const r = render(<PrinterObjectActions origin={origin(font)} kind="font" />);
    fireEvent.click(r.getByText(loc.deleteObject));
    expect(r.getByText(`Delete E:CG_TIMES.TTF from the printer? Labels that use it fall back to another font. ${loc.deleteNoCopyHint}`)).toBeTruthy();
    fireEvent.click(r.getByText(en.app.cancel));
    expect(deletePrinterObject).not.toHaveBeenCalled();
    fireEvent.click(r.getByText(loc.deleteObject));
    await act(async () => {
      fireEvent.click(r.getAllByText(loc.deleteObject).at(-1) as HTMLElement);
    });
    expect(deletePrinterObject).toHaveBeenCalledWith(target, font);
    expect(r.getByRole("alert").textContent).toBe(en.printerSettings.printerStatus.failUnreachable);
    cleanup();
    const graphics = render(<PrinterObjectActions origin={origin(pre)} kind="graphic" />);
    fireEvent.click(graphics.getByText(loc.deleteObject));
    expect(graphics.getByText(`Delete R:PRE.GRF from the printer? Labels that recall it print without it. ${loc.deleteNoCopyHint}`)).toBeTruthy();
  });

  it("retires a failed delete's message with the listing it was reported against", async () => {
    deletePrinterObject.mockResolvedValue({ kind: "unreachable" });
    const r = render(<PrinterObjectActions origin={origin(font)} kind="font" />);
    fireEvent.click(r.getByText(loc.deleteObject));
    await act(async () => {
      fireEvent.click(r.getAllByText(loc.deleteObject).at(-1) as HTMLElement);
    });
    expect(r.getByRole("alert")).toBeTruthy();
    act(() => useLabelStore.setState({ printerObjects: { phase: "done", key: "net:172.17.17.175:9100", at: 1, directories: listing } }));
    expect(r.queryByRole("alert")).toBeNull();
  });

  it("offers no delete for a firmware object the printer never releases", () => {
    const r = render(<PrinterObjectActions origin={origin(firmware)} kind="font" />);
    expect((r.getByText(loc.deleteObject) as HTMLButtonElement).disabled).toBe(true);
    expect((r.getByText(loc.showObject) as HTMLButtonElement).disabled).toBe(false);
  });

  it("locks both actions while the channel carries another read", () => {
    act(() => useLabelStore.setState({ printerReading: "^HW" }));
    const r = render(<PrinterObjectActions origin={origin(pre)} kind="graphic" />);
    expect([loc.showObject, loc.deleteObject].map((label) => (r.getByText(label) as HTMLButtonElement).disabled)).toEqual([true, true]);
  });
});

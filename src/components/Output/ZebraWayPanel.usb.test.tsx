// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act, fireEvent, waitFor } from "@testing-library/react";
import { WayPanel } from "./ZebraWayPanel.testkit";
import { useLabelStore } from "../../store/labelStore";
import { DEFAULT_PRINT_TARGET } from "../../lib/printTarget";
import { fallbackTranslations as en } from "../../locales";

vi.mock("../../lib/platform", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), isDesktopShell: true }));
vi.mock("../../lib/localPrint", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listLocalPrinters: vi.fn().mockResolvedValue([]),
}));
// vi.mock is hoisted above this const, so the factory reaches it through a closure.
const setupUsbAccess = vi.fn();
const readPrinterStatus = vi.fn();
vi.mock("../../lib/printerStatus", () => ({
  readPrinterStatus: (...args: unknown[]) => readPrinterStatus(...args),
  readPrinterConfiguration: vi.fn(),
}));
vi.mock("../../lib/usbPrint", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listUsbPrinters: vi.fn().mockResolvedValue([{ id: "usb1", name: "Zebra ZD230", vendor_id: "0a5f" }]),
  sendZplUsb: vi.fn().mockResolvedValue({ kind: "permission_denied" }),
  setupUsbAccess: () => setupUsbAccess(),
}));

afterEach(cleanup);

beforeEach(() => {
  setupUsbAccess.mockReset();
  readPrinterStatus.mockReset();
  act(() => {
    useLabelStore.setState({ dataset: null, columnMapping: null, printTarget: { ...DEFAULT_PRINT_TARGET, transport: "usb" } });
  });
});

describe("ZebraWayPanel USB access", () => {
  it("offers the setup route with its message after a denied check, as after a denied send", async () => {
    readPrinterStatus.mockResolvedValue({ kind: "permission_denied" });
    act(() => useLabelStore.setState({ printerState: { phase: "idle" }, printTarget: { ...DEFAULT_PRINT_TARGET, transport: "usb", usbId: "usb1" } }));
    const r = render(<WayPanel way="usb" zpl={() => "^XA^XZ"} />);
    await waitFor(() => expect(r.getByText(en.zebraPrint.checkPrinter)).toBeTruthy());
    await act(async () => {
      fireEvent.click(r.getByText(en.zebraPrint.checkPrinter));
    });
    expect(r.getByText(en.zebraPrint.usbSetupAccess)).toBeTruthy();
    expect(r.getByText(en.zebraPrint.usbPermissionDenied)).toBeTruthy();
  });

  it("shows the manual route when the sandbox refuses to install the udev rule", async () => {
    setupUsbAccess.mockRejectedValue("flatpak");
    const r = render(<WayPanel way="usb" zpl={() => "^XA^XZ"} />);
    await waitFor(() => expect(r.getByText(/Zebra ZD230/)).toBeTruthy());
    await act(async () => {
      fireEvent.click(r.getByText(en.zebraPrint.send));
    });
    await act(async () => {
      fireEvent.click(r.getByText(en.zebraPrint.usbSetupAccess));
    });
    expect(setupUsbAccess).toHaveBeenCalledTimes(1);
    expect(r.getByText(en.zebraPrint.usbSetupFlatpak)).toBeTruthy();
    expect(r.getByText(en.zebraPrint.usbSetupAccess)).toBeTruthy();
  });

  it("reads the code at the click and never in the render", async () => {
    const zpl = vi.fn(() => "^XA^XZ");
    const r = render(<WayPanel way="usb" zpl={zpl} />);
    await waitFor(() => expect(r.getByText(/Zebra ZD230/)).toBeTruthy());
    expect(zpl).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(r.getByText(en.zebraPrint.send));
    });
    expect(zpl).toHaveBeenCalledTimes(1);
  });

  it("keeps the raw reason for any other failure", async () => {
    setupUsbAccess.mockRejectedValue("setup cancelled");
    const r = render(<WayPanel way="usb" zpl={() => "^XA^XZ"} />);
    await waitFor(() => expect(r.getByText(/Zebra ZD230/)).toBeTruthy());
    await act(async () => {
      fireEvent.click(r.getByText(en.zebraPrint.send));
    });
    await act(async () => {
      fireEvent.click(r.getByText(en.zebraPrint.usbSetupAccess));
    });
    expect(r.getByText("setup cancelled")).toBeTruthy();
  });
});

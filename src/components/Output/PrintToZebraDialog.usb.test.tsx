// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act, fireEvent, waitFor } from "@testing-library/react";
import { PrintToZebraDialog } from "./PrintToZebraDialog";
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
vi.mock("../../lib/usbPrint", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listUsbPrinters: vi.fn().mockResolvedValue([{ id: "usb1", name: "Zebra ZD230", vendor_id: "0a5f" }]),
  sendZplUsb: vi.fn().mockResolvedValue({ kind: "permission_denied" }),
  setupUsbAccess: () => setupUsbAccess(),
}));

afterEach(cleanup);

beforeEach(() => {
  setupUsbAccess.mockReset();
  act(() => {
    useLabelStore.setState({ zebraPrintSource: "label", dataset: null, columnMapping: null, printTarget: { ...DEFAULT_PRINT_TARGET, transport: "usb" } });
  });
});

describe("PrintToZebraDialog USB access", () => {
  it("shows the manual route when the sandbox refuses to install the udev rule", async () => {
    setupUsbAccess.mockRejectedValue("flatpak");
    const r = render(<PrintToZebraDialog zpl="^XA^XZ" onClose={vi.fn()} />);
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

  it("keeps the raw reason for any other failure", async () => {
    setupUsbAccess.mockRejectedValue("setup cancelled");
    const r = render(<PrintToZebraDialog zpl="^XA^XZ" onClose={vi.fn()} />);
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

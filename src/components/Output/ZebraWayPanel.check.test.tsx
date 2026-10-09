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
vi.mock("../../lib/usbPrint", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listUsbPrinters: vi.fn().mockResolvedValue([]),
}));
const readPrinterStatus = vi.fn();
vi.mock("../../lib/printerStatus", () => ({
  readPrinterStatus: (...args: unknown[]) => readPrinterStatus(...args),
  readPrinterConfiguration: vi.fn(),
}));

afterEach(cleanup);
beforeEach(() => {
  readPrinterStatus.mockReset();
  act(() => {
    useLabelStore.setState({ dataset: null, columnMapping: null, printerState: { phase: "idle" } });
  });
});

describe("ZebraWayPanel printer check", () => {
  it("asks over the way shown, not the stored one, and locks Send meanwhile", async () => {
    let finish: (value: unknown) => void = () => undefined;
    readPrinterStatus.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    act(() => useLabelStore.setState({ printTarget: { ...DEFAULT_PRINT_TARGET, transport: "usb", usbId: "unplugged", host: "172.17.17.175" } }));
    const r = render(<WayPanel way="network" zpl={() => "^XA^XZ"} />);
    await waitFor(() => expect(r.getByText(en.zebraPrint.checkPrinter)).toBeTruthy());
    await act(async () => {
      fireEvent.click(r.getByText(en.zebraPrint.checkPrinter));
    });
    expect(readPrinterStatus).toHaveBeenCalledWith({ kind: "network", host: "172.17.17.175", port: 9100 }, expect.any(Function));
    expect((r.getByText(en.zebraPrint.send) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      finish({ kind: "unreachable" });
    });
    expect((r.getByText(en.zebraPrint.send) as HTMLButtonElement).disabled).toBe(false);
  });
});

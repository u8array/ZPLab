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
  listLocalPrinters: vi.fn().mockResolvedValue([{ system_name: "queue-1", name: "Office queue", driver_name: "ZDesigner", port_name: "USB001" }]),
}));
vi.mock("../../lib/usbPrint", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listUsbPrinters: vi.fn().mockResolvedValue([]),
}));
const queryDocument = vi.fn();
vi.mock("../../lib/printerDocumentQuery", () => ({ queryDocument: (...args: unknown[]) => queryDocument(...args) }));
vi.mock("../../lib/printerStatus", () => ({ readPrinterStatus: vi.fn(), readPrinterConfiguration: vi.fn() }));

const loc = en.zebraPrint;
const ASKS = { commands: ["~HS"], prints: false };
const DOCUMENT = "^XA~HS^XZ";

afterEach(cleanup);

beforeEach(() => {
  queryDocument.mockReset();
  act(() => {
    useLabelStore.setState({
      dataset: null,
      columnMapping: null,
      printerReading: undefined,
      printTarget: { ...DEFAULT_PRINT_TARGET, host: "172.17.17.175", localPrinter: "queue-1" },
    });
  });
});

describe("ZebraWayPanel on a document that asks the printer something", () => {
  it("offers the query instead of the send on the network way and opens the reply", async () => {
    queryDocument.mockResolvedValue({
      kind: "ok",
      value: { raw: "030,0,0,0892", commands: ["~HS"], configuration: false, parsed: {} },
    });
    const r = render(<WayPanel way="network" zpl={() => DOCUMENT} query={ASKS} />);
    expect(r.queryByText(loc.send)).toBeNull();
    expect(r.getByText(loc.queryHint)).toBeTruthy();
    expect(r.queryByText(loc.queryMixedHint)).toBeNull();

    await act(async () => {
      fireEvent.click(r.getByText(loc.queryButton));
    });
    expect(queryDocument).toHaveBeenCalledWith({ kind: "network", host: "172.17.17.175", port: 9100 }, DOCUMENT, ASKS.commands);
    await waitFor(() => expect(document.body.textContent).toContain(loc.replyTitle));
    expect(document.body.textContent).toContain("030,0,0,0892");
  });

  it("leaves the dialog closed when the reply lands after the user closed it", async () => {
    let finish: ((value: unknown) => void) | undefined;
    queryDocument.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const r = render(<WayPanel way="network" zpl={() => DOCUMENT} query={ASKS} />);
    await act(async () => {
      fireEvent.click(r.getByText(loc.queryButton));
    });
    await waitFor(() => expect(document.body.textContent).toContain(loc.replyTitle));

    const close = document.querySelector(`[aria-label="${en.app.close}"]`);
    if (!close) throw new Error("no close button");
    await act(async () => {
      fireEvent.click(close);
    });
    expect(document.body.textContent).not.toContain(loc.replyTitle);

    await act(async () => {
      if (!finish) throw new Error("the query never started");
      finish({ kind: "ok", value: { raw: "030,0,0,0892", commands: ["~HS"], configuration: false, parsed: {} } });
    });
    expect(document.body.textContent).not.toContain(loc.replyTitle);
  });

  it("disables the query on a USB way without a device", async () => {
    const r = render(<WayPanel way="usb" zpl={() => DOCUMENT} query={ASKS} />);
    await waitFor(() => expect(r.getByText(loc.queryButton)).toBeTruthy());
    expect((r.getByText(loc.queryButton) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the send button and says nothing on a document that only prints", () => {
    const r = render(<WayPanel way="network" zpl={() => "^XA^FO10,10^FDx^FS^XZ"} query={{ commands: [], prints: true }} />);
    expect(r.getByText(loc.send)).toBeTruthy();
    expect(r.queryByText(loc.queryHint)).toBeNull();
    expect(r.queryByText(loc.queryNoChannel)).toBeNull();
  });
});

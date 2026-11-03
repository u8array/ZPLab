// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act, fireEvent, waitFor } from "@testing-library/react";
import { WayPanel } from "./ZebraWayPanel.testkit";
import { queryFacts } from "../../lib/outputChoice.testkit";
import { documentReply } from "../../lib/printerDocumentQuery.testkit";
import { useLabelStore } from "../../store/labelStore";
import { DEFAULT_PRINT_TARGET } from "../../lib/printTarget";
import { fallbackTranslations as en } from "../../locales";
import { formatTemplate } from "../../lib/formatTemplate";

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
const ASKS = queryFacts({ commands: ["~HS"], prints: false });
const DOCUMENT = "^XA~HS^XZ";

const resolvesOnAbort = (outcome: unknown) => {
  let signal: AbortSignal | undefined;
  queryDocument.mockImplementation(
    (_target: unknown, _zpl: string, given: AbortSignal) =>
      new Promise((resolve) => {
        signal = given;
        given.addEventListener("abort", () => resolve(outcome));
      }),
  );
  return () => {
    if (signal === undefined) throw new Error("no query started");
    return signal;
  };
};

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
    queryDocument.mockResolvedValue({ kind: "ok", value: documentReply({ raw: "030,0,0,0892" }) });
    const r = render(<WayPanel way="network" zpl={() => DOCUMENT} query={ASKS} />);
    expect(r.queryByText(loc.send)).toBeNull();
    expect(r.getByText(loc.queryHint)).toBeTruthy();
    expect(r.queryByText(loc.queryMixedHint)).toBeNull();

    await act(async () => {
      fireEvent.click(r.getByText(loc.queryButton));
    });
    expect(queryDocument).toHaveBeenCalledWith({ kind: "network", host: "172.17.17.175", port: 9100 }, DOCUMENT, expect.any(AbortSignal));
    await waitFor(() => expect(document.body.textContent).toContain(loc.replyTitle));
    expect(document.body.textContent).toContain("030,0,0,0892");
    expect(r.queryByText(en.printerSettings.printerStatus.stopWaiting)).toBeNull();
  });

  it("stops the wait from the dialog, and the reply names what never came", async () => {
    const marked = queryFacts({ commands: ["~HS", "^HV1,20,H,E,F"], prints: false });
    const signal = resolvesOnAbort({ kind: "ok", value: documentReply({ raw: "030,0,0,0892", unanswered: [{ commands: ["^HV1,20,H,E,F"], missing: 1, of: 1 }] }) });
    const r = render(<WayPanel way="network" zpl={() => "^XA~HS^FN1^FDx^FS^HV1,20,H,E,F^XZ"} query={marked} />);
    await act(async () => {
      fireEvent.click(r.getByText(loc.queryButton));
    });
    const stop = en.printerSettings.printerStatus.stopWaiting;
    await waitFor(() => expect(document.body.textContent).toContain(stop));
    expect(signal().aborted).toBe(false);
    await act(async () => {
      fireEvent.click(r.getByText(stop));
    });
    expect(signal().aborted).toBe(true);
    await waitFor(() => expect(document.body.textContent).toContain("030,0,0,0892"));
    expect(document.body.textContent).toContain(formatTemplate(en.zebraPrint.unansweredFmt, { commands: "^HV1,20,H,E,F" }));
    expect(r.queryByText(stop)).toBeNull();
  });

  it("aborts the read when the dialog is closed mid-read, and when the panel goes away", async () => {
    const signal = resolvesOnAbort({ kind: "silent" });
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
    expect(signal().aborted).toBe(true);
    r.unmount();

    const again = render(<WayPanel way="network" zpl={() => DOCUMENT} query={ASKS} />);
    await act(async () => {
      fireEvent.click(again.getByText(loc.queryButton));
    });
    await waitFor(() => expect(signal().aborted).toBe(false));
    again.unmount();
    expect(signal().aborted).toBe(true);
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
      finish({ kind: "ok", value: documentReply({ raw: "030,0,0,0892" }) });
    });
    expect(document.body.textContent).not.toContain(loc.replyTitle);
  });

  it("disables the query on a USB way without a device", async () => {
    const r = render(<WayPanel way="usb" zpl={() => DOCUMENT} query={ASKS} />);
    await waitFor(() => expect(r.getByText(loc.queryButton)).toBeTruthy());
    expect((r.getByText(loc.queryButton) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the send button and says nothing on a document that only prints", () => {
    const r = render(<WayPanel way="network" zpl={() => "^XA^FO10,10^FDx^FS^XZ"} query={queryFacts()} />);
    expect(r.getByText(loc.send)).toBeTruthy();
    expect(r.queryByText(loc.queryHint)).toBeNull();
    expect(r.queryByText(loc.queryNoChannel)).toBeNull();
  });
});

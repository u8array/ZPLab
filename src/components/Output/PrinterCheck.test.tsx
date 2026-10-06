// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { parseHostStatus } from "@zplab/core/lib/hostStatus";
import { PrinterCheck } from "./PrinterCheck";
import { useLabelStore } from "../../store/labelStore";
import { DEFAULT_PRINT_TARGET } from "../../lib/printTarget";
import { fallbackTranslations as en } from "../../locales";
import type { PrinterStatusReport } from "../../lib/printerStatus";

const readPrinterStatus = vi.fn();
vi.mock("../../lib/printerStatus", () => ({
  readPrinterStatus: (...args: unknown[]) => readPrinterStatus(...args),
  readPrinterConfiguration: vi.fn(),
}));

const loc = en.printerSettings.printerStatus;
const report = (over: Partial<PrinterStatusReport>): PrinterStatusReport => ({
  identity: { model: "ZD230", firmware: "V89.21.46Z", dpmm: 8, memoryKb: 4096, options: "" },
  flags: { errors: [], warnings: [] },
  memory: undefined,
  status: undefined,
  withheld: false,
  raw: "",
  ...over,
});
const headUp = parseHostStatus("030,0,0,1200,000,0,0,0,000,0,0,0\n001,0,1,0,1,2,0,0,00000000,1,000");

afterEach(cleanup);
beforeEach(() => {
  readPrinterStatus.mockReset();
  act(() => useLabelStore.setState({ printerState: { phase: "idle" }, printTarget: { ...DEFAULT_PRINT_TARGET, host: "172.17.17.175", usbId: "usb-1" } }));
});

describe("PrinterCheck", () => {
  it("reports a ready printer in one line with identity and warnings behind it", async () => {
    readPrinterStatus.mockResolvedValue({ kind: "ok", value: report({ flags: { errors: [], warnings: ["cleanPrinthead"] } }) });
    const r = render(<PrinterCheck transport="network" sendBusy={false} />);
    await act(async () => {
      fireEvent.click(r.getByText(en.zebraPrint.checkPrinter));
    });
    expect(r.getByText(loc.ready).dataset.tone).toBe("warning");
    expect(r.getByText("ZD230 V89.21.46Z")).toBeTruthy();
    expect(r.getByText(loc.flagCleanPrinthead)).toBeTruthy();
  });

  it("names the blocking conditions from both replies and marks them blocked", async () => {
    readPrinterStatus.mockResolvedValue({ kind: "ok", value: report({ flags: { errors: ["mediaOut"], warnings: [] }, status: headUp }) });
    const r = render(<PrinterCheck transport="network" sendBusy={false} />);
    await act(async () => {
      fireEvent.click(r.getByText(en.zebraPrint.checkPrinter));
    });
    expect(r.getByText(`${loc.flagMediaOut}, ${loc.flagHeadOpen}`).dataset.tone).toBe("blocked");
  });

  it("keeps the status strings' verdict when only the flag query went unanswered", async () => {
    readPrinterStatus.mockResolvedValue({ kind: "ok", value: report({ flags: undefined, status: headUp }) });
    const r = render(<PrinterCheck transport="network" sendBusy={false} />);
    await act(async () => {
      fireEvent.click(r.getByText(en.zebraPrint.checkPrinter));
    });
    expect(r.getByText(loc.flagHeadOpen)).toBeTruthy();
    expect(r.queryByText(loc.warnings)).toBeNull();
    expect(r.queryByText(loc.statusUnreadHint)).toBeNull();
  });

  it("says once that nothing was read when both status queries went unanswered", async () => {
    readPrinterStatus.mockResolvedValue({ kind: "ok", value: report({ flags: undefined, status: undefined }) });
    const r = render(<PrinterCheck transport="network" sendBusy={false} />);
    await act(async () => {
      fireEvent.click(r.getByText(en.zebraPrint.checkPrinter));
    });
    expect(r.getAllByText(loc.statusUnreadHint)).toHaveLength(1);
  });

  it("asks over the tab's way and hands a failure back", async () => {
    readPrinterStatus.mockResolvedValue({ kind: "permission_denied" });
    const failures: string[] = [];
    const r = render(<PrinterCheck transport="usb" sendBusy={false} onFailure={(f) => failures.push(f.kind)} />);
    await act(async () => {
      fireEvent.click(r.getByText(en.zebraPrint.checkPrinter));
    });
    expect(readPrinterStatus).toHaveBeenCalledWith({ kind: "usb", id: "usb-1" }, expect.any(Function));
    expect(failures).toEqual(["permission_denied"]);
    expect(r.getByRole("alert").textContent).toMatch(/No access to the USB printer/);
  });

  it("shows only the reply of its own way and waits while a send holds the channel", () => {
    act(() => useLabelStore.setState({ printerState: { phase: "done", key: "usb:usb-1", at: 0, report: report({ flags: { errors: ["headOpen"], warnings: [] } }) } }));
    const r = render(<PrinterCheck transport="network" sendBusy />);
    expect(r.queryByText(loc.flagHeadOpen)).toBeNull();
    expect((r.getByText(en.zebraPrint.checkPrinter) as HTMLButtonElement).disabled).toBe(true);
  });
});

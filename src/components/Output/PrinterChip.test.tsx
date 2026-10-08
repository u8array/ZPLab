// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { PrinterChip } from "./PrinterChip";
import { useLabelStore } from "../../store/labelStore";
import { DEFAULT_PRINT_TARGET } from "../../lib/printTarget";
import { fallbackTranslations as en } from "../../locales";
import type { PrinterStatusReport } from "../../lib/printerStatus";

const readPrinterStatus = vi.fn();
vi.mock("../../lib/printerStatus", () => ({
  readPrinterStatus: (...args: unknown[]) => readPrinterStatus(...args),
  readPrinterConfiguration: vi.fn().mockResolvedValue({ kind: "ok", value: "ZD230  PRINTER" }),
}));

const loc = en.printerSettings.printerStatus;
const report = (over: Partial<PrinterStatusReport>): PrinterStatusReport => ({
  identity: { model: "ZD230", firmware: "V89.21.46Z", dpmm: 8, memoryKb: 4096, options: "" },
  flags: { errors: [], warnings: [] },
  memory: undefined,
  status: undefined,
  withheld: false,
  raw: "~HI\nZD230",
  ...over,
});
const dot = (r: ReturnType<typeof render>) => (r.container.querySelector("button span") as HTMLSpanElement).dataset.tone;

afterEach(cleanup);
beforeEach(() => {
  readPrinterStatus.mockReset();
  act(() => useLabelStore.setState({ printerState: { phase: "idle" }, printerSettingsTab: null, printTarget: { ...DEFAULT_PRINT_TARGET, host: "172.17.17.175" } }));
});

describe("PrinterChip", () => {
  it("names the configured printer, reads it on request and tones the dot for a warning", async () => {
    readPrinterStatus.mockResolvedValue({ kind: "ok", value: report({ flags: { errors: [], warnings: ["cleanPrinthead"] } }) });
    const r = render(<PrinterChip />);
    expect(dot(r)).toBe("unknown");
    fireEvent.click(r.getByText("172.17.17.175"));
    expect(r.getByText(loc.notChecked)).toBeTruthy();
    await act(async () => {
      fireEvent.click(r.getByText(loc.checkNow));
    });
    expect(readPrinterStatus).toHaveBeenCalledWith({ kind: "network", host: "172.17.17.175", port: 9100 }, expect.any(Function));
    expect(dot(r)).toBe("warning");
    fireEvent.click(r.getByText("172.17.17.175"));
    expect(r.getByText(loc.ready)).toBeTruthy();
    expect(r.getByText(loc.flagCleanPrinthead)).toBeTruthy();
    expect(r.getByText("ZD230 V89.21.46Z")).toBeTruthy();
  });

  it("tones the dot blocked for a blocking condition and drops a reply that belongs to another printer", () => {
    const blocked = report({ flags: { errors: ["headOpen"], warnings: [] } });
    act(() => useLabelStore.setState({ printerState: { phase: "done", key: "net:172.17.17.175:9100", at: 0, report: blocked } }));
    const r = render(<PrinterChip />);
    expect(dot(r)).toBe("blocked");
    act(() => useLabelStore.setState({ printerState: { phase: "done", key: "net:10.0.0.9:9100", at: 0, report: blocked } }));
    expect(dot(r)).toBe("unknown");
    fireEvent.click(r.getByText("172.17.17.175"));
    expect(r.queryByText(loc.flagHeadOpen)).toBeNull();
    expect(r.getByText(loc.notChecked)).toBeTruthy();
  });

  it("tells the user to configure a printer when none is set", async () => {
    act(() => useLabelStore.setState({ printTarget: DEFAULT_PRINT_TARGET }));
    const r = render(<PrinterChip />);
    fireEvent.click(r.getByText(en.zebraPrint.printer));
    await act(async () => {
      fireEvent.click(r.getByText(loc.checkNow));
    });
    expect(readPrinterStatus).not.toHaveBeenCalled();
    fireEvent.click(r.getByText(en.zebraPrint.printer));
    expect(r.getByText(/No printer configured/)).toBeTruthy();
    expect(dot(r)).toBe("blocked");
  });

  it("opens the printer's own storage, the shortest way there from the design", () => {
    const r = render(<PrinterChip />);
    fireEvent.click(r.getByText("172.17.17.175"));
    fireEvent.click(r.getByText(en.printerSettings.objects.listHeading));
    expect(useLabelStore.getState().printerSettingsTab).toBe("storedFonts");
  });

  it("opens the configuration echo with the raw replies beside it", async () => {
    act(() => useLabelStore.setState({ printerState: { phase: "done", key: "net:172.17.17.175:9100", at: 0, report: report({}) } }));
    const r = render(<PrinterChip />);
    fireEvent.click(r.getByText("172.17.17.175"));
    await act(async () => {
      fireEvent.click(r.getByText(loc.readConfiguration));
    });
    expect(r.getByRole("dialog")).toBeTruthy();
    expect([...document.querySelectorAll("pre")].map((pre) => pre.textContent)).toEqual(["ZD230  PRINTER", "~HI\nZD230"]);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useLabelStore } from "../labelStore";
import { DEFAULT_PRINT_TARGET } from "../../lib/printTarget";
import { selectPrinterState } from "../labelStore.selectors";

const readPrinterStatus = vi.fn();
const readPrinterConfiguration = vi.fn();
vi.mock("../../lib/printerStatus", () => ({
  readPrinterStatus: (...args: unknown[]) => readPrinterStatus(...args),
  readPrinterConfiguration: (...args: unknown[]) => readPrinterConfiguration(...args),
}));

const report = { identity: undefined, flags: { errors: [], warnings: [] }, memory: undefined, status: undefined, withheld: false, raw: "" };

beforeEach(() => {
  readPrinterStatus.mockReset();
  useLabelStore.setState({ printerState: { phase: "idle" }, printTarget: { ...DEFAULT_PRINT_TARGET, host: "172.17.17.175", usbId: "usb-1" } });
});

describe("checkPrinter", () => {
  it("reads over the named way, keeps the reply under that target's key and refuses a second read meanwhile", async () => {
    let finish: (value: unknown) => void = () => undefined;
    readPrinterStatus.mockImplementation((_t: unknown, onStep: (s: string) => void) => {
      onStep("~HI");
      return new Promise((resolve) => (finish = resolve));
    });
    const pending = useLabelStore.getState().checkPrinter("usb");
    expect(useLabelStore.getState().printerReading).toBe("~HI");
    expect(await useLabelStore.getState().readPrinterConfiguration()).toBeUndefined();
    expect(await useLabelStore.getState().checkPrinter()).toBeUndefined();
    expect(readPrinterStatus).toHaveBeenCalledTimes(1);
    finish({ kind: "ok", value: report });
    await pending;
    expect(useLabelStore.getState().printerState).toMatchObject({ phase: "done", key: "usb:usb-1", report });
    expect(useLabelStore.getState().printerReading).toBeUndefined();
    expect(selectPrinterState(useLabelStore.getState(), "usb").phase).toBe("done");
    expect(selectPrinterState(useLabelStore.getState(), "network").phase).toBe("idle");
  });

  it("keeps a failure with its kind and names a missing target without asking", async () => {
    readPrinterStatus.mockResolvedValue({ kind: "permission_denied" });
    expect(await useLabelStore.getState().checkPrinter("usb")).toEqual({ kind: "permission_denied" });
    expect(useLabelStore.getState().printerState).toMatchObject({ phase: "failed", key: "usb:usb-1", failure: { kind: "permission_denied" } });
    useLabelStore.setState({ printTarget: DEFAULT_PRINT_TARGET });
    expect(await useLabelStore.getState().checkPrinter()).toBeUndefined();
    expect(useLabelStore.getState().printerState).toMatchObject({ phase: "failed", key: "", failure: { kind: "unconfigured" } });
    expect(selectPrinterState(useLabelStore.getState()).phase).toBe("failed");
    expect(readPrinterStatus).toHaveBeenCalledTimes(1);
  });
});

describe("readPrinterConfiguration", () => {
  it("holds the channel while the echo is read and hands the echo back", async () => {
    let finish: (value: unknown) => void = () => undefined;
    readPrinterConfiguration.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const pending = useLabelStore.getState().readPrinterConfiguration();
    expect(useLabelStore.getState().printerReading).toBe("^HH");
    expect(await useLabelStore.getState().checkPrinter()).toBeUndefined();
    finish({ kind: "ok", value: "ZD230  PRINTER" });
    expect(await pending).toEqual({ kind: "ok", value: "ZD230  PRINTER" });
    expect(useLabelStore.getState().printerReading).toBeUndefined();
    expect(readPrinterConfiguration).toHaveBeenCalledWith({ kind: "network", host: "172.17.17.175", port: 9100 });
    useLabelStore.setState({ printTarget: DEFAULT_PRINT_TARGET });
    expect(await useLabelStore.getState().readPrinterConfiguration()).toEqual({ kind: "unconfigured" });
  });
});

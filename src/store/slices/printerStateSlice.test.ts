import { describe, it, expect, vi, beforeEach } from "vitest";
import { useLabelStore } from "../labelStore";
import { DEFAULT_PRINT_TARGET } from "../../lib/printTarget";
import { selectPrinterState } from "../labelStore.selectors";
import { adoptionDiff } from "@zplab/core/lib/printerSettingsAdoption";
import { parseSgdDump } from "@zplab/core/lib/sgd";
import { ZD230_ALLCV_EXCERPT } from "@zplab/core/lib/sgd.fixture";

const readPrinterStatus = vi.fn();
const readPrinterConfiguration = vi.fn();
const readPrinterSettings = vi.fn();
vi.mock("../../lib/printerStatus", () => ({
  readPrinterStatus: (...args: unknown[]) => readPrinterStatus(...args),
  readPrinterConfiguration: (...args: unknown[]) => readPrinterConfiguration(...args),
}));
vi.mock("../../lib/printerSettings", () => ({
  readPrinterSettings: (...args: unknown[]) => readPrinterSettings(...args),
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
    expect(await useLabelStore.getState().readPrinterConfiguration()).toEqual({ kind: "busy" });
    expect(await useLabelStore.getState().checkPrinter()).toEqual({ kind: "busy" });
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
    expect(await useLabelStore.getState().checkPrinter()).toEqual({ kind: "busy" });
    finish({ kind: "ok", value: "ZD230  PRINTER" });
    expect(await pending).toEqual({ kind: "ok", value: "ZD230  PRINTER" });
    expect(useLabelStore.getState().printerReading).toBeUndefined();
    expect(readPrinterConfiguration).toHaveBeenCalledWith({ kind: "network", host: "172.17.17.175", port: 9100 });
    useLabelStore.setState({ printTarget: DEFAULT_PRINT_TARGET });
    expect(await useLabelStore.getState().readPrinterConfiguration()).toEqual({ kind: "unconfigured" });
  });
});

describe("readPrinterSettings", () => {
  it("holds the channel under the dump command and hands the settings back", async () => {
    let finish: (value: unknown) => void = () => undefined;
    readPrinterSettings.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const pending = useLabelStore.getState().readPrinterSettings();
    expect(useLabelStore.getState().printerReading).toBe('! U1 getvar "allcv"');
    expect(await useLabelStore.getState().checkPrinter()).toEqual({ kind: "busy" });
    finish({ kind: "ok", value: [{ key: "print.tone", value: "15.0" }] });
    expect(await pending).toEqual({ kind: "ok", value: [{ key: "print.tone", value: "15.0" }] });
    expect(useLabelStore.getState().printerReading).toBeUndefined();
    expect(readPrinterSettings).toHaveBeenCalledWith({ kind: "network", host: "172.17.17.175", port: 9100 });
    useLabelStore.setState({ printTarget: DEFAULT_PRINT_TARGET });
    expect(await useLabelStore.getState().readPrinterSettings()).toEqual({ kind: "unconfigured" });
  });
});

describe("adoptPrinterSettings", () => {
  const rowsFor = (fields: string[]) => {
    const state = useLabelStore.getState();
    return adoptionDiff(parseSgdDump(ZD230_ALLCV_EXCERPT), state.label, state.printerProfile).filter((row) => fields.includes(row.field));
  };

  it("writes the chosen rows to the label settings and to the printer profile", () => {
    useLabelStore.setState({ label: { widthMm: 100, heightMm: 60, dpmm: 8 }, printerProfile: {} });
    expect(useLabelStore.getState().adoptPrinterSettings(rowsFor(["printSpeed", "mediaMode", "printerName"]))).toBe(true);
    expect(useLabelStore.getState().label).toMatchObject({ printSpeed: 6, mediaMode: "T", widthMm: 100 });
    expect(useLabelStore.getState().printerProfile).toEqual({ printerName: "D4J260700032" });
  });

  it("rescales the design when the head density comes along", () => {
    useLabelStore.setState({ label: { widthMm: 100, heightMm: 60, dpmm: 12, labelHomeX: 120 }, printerProfile: {} });
    useLabelStore.getState().adoptPrinterSettings(rowsFor(["dpmm", "widthMm", "heightMm"]));
    expect(useLabelStore.getState().label).toMatchObject({ dpmm: 8, widthMm: 101.6, heightMm: 152.4, labelHomeX: 80 });
  });

  it("takes the label and the profile back in one undo", () => {
    useLabelStore.setState({ label: { widthMm: 100, heightMm: 60, dpmm: 8 }, printerProfile: {} });
    useLabelStore.temporal.getState().clear();
    useLabelStore.getState().adoptPrinterSettings(rowsFor(["printSpeed", "printerName"]));
    useLabelStore.temporal.getState().undo();
    expect(useLabelStore.getState().label.printSpeed).toBeUndefined();
    expect(useLabelStore.getState().printerProfile.printerName).toBeUndefined();
  });

  it("takes the rescaled design and the profile back in one undo", () => {
    useLabelStore.setState({ label: { widthMm: 100, heightMm: 60, dpmm: 12, labelHomeX: 120 }, printerProfile: {} });
    useLabelStore.temporal.getState().clear();
    useLabelStore.getState().adoptPrinterSettings(rowsFor(["dpmm", "printerName"]));
    useLabelStore.temporal.getState().undo();
    expect(useLabelStore.getState().label).toMatchObject({ dpmm: 12, labelHomeX: 120 });
    expect(useLabelStore.getState().printerProfile.printerName).toBeUndefined();
  });

  it("answers false and writes nothing while the editor is locked", () => {
    useLabelStore.setState({ label: { widthMm: 100, heightMm: 60, dpmm: 8 }, printerProfile: {}, sourceEdit: { status: "editing", draft: "^XA^XZ", baseline: "^XA^XZ", session: 1 } });
    expect(useLabelStore.getState().adoptPrinterSettings(rowsFor(["printSpeed"]))).toBe(false);
    expect(useLabelStore.getState().label.printSpeed).toBeUndefined();
    useLabelStore.setState({ sourceEdit: { status: "off" } });
  });
});

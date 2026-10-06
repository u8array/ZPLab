import { describe, it, expect, vi, beforeEach } from "vitest";
import { useLabelStore } from "../labelStore";
import { DEFAULT_PRINT_TARGET } from "../../lib/printTarget";
import { selectPrinterObjects } from "../labelStore.selectors";

const readPrinterObjects = vi.fn();
const readPrinterGraphic = vi.fn();
const deletePrinterObject = vi.fn();
vi.mock("../../lib/printerObjects", () => ({
  readPrinterObjects: (...args: unknown[]) => readPrinterObjects(...args),
  readPrinterGraphic: (...args: unknown[]) => readPrinterGraphic(...args),
  deletePrinterObject: (...args: unknown[]) => deletePrinterObject(...args),
}));
const readPrinterStatus = vi.fn();
vi.mock("../../lib/printerStatus", () => ({
  readPrinterStatus: (...args: unknown[]) => readPrinterStatus(...args),
  readPrinterConfiguration: vi.fn(),
}));

const target = { kind: "network", host: "172.17.17.175", port: 9100 };
const pre = { device: "R", name: "PRE", ext: "GRF", size: 49924 };
const listing = [{ device: "R", objects: [pre], bytesFree: 7467008 }];

beforeEach(() => {
  readPrinterObjects.mockReset();
  readPrinterGraphic.mockReset();
  deletePrinterObject.mockReset();
  readPrinterStatus.mockReset();
  useLabelStore.setState({ printerObjects: { phase: "idle" }, printerReading: undefined, printTarget: { ...DEFAULT_PRINT_TARGET, host: "172.17.17.175" } });
});

describe("readPrinterObjects", () => {
  it("holds the channel against every other read, files the listing under the target and names a missing target", async () => {
    let finish: (value: unknown) => void = () => undefined;
    readPrinterObjects.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const pending = useLabelStore.getState().readPrinterObjects();
    expect(useLabelStore.getState().printerReading).toBe("^HW");
    expect(await useLabelStore.getState().checkPrinter()).toEqual({ kind: "busy" });
    expect(await useLabelStore.getState().readPrinterGraphic(pre)).toEqual({ kind: "busy" });
    expect(await useLabelStore.getState().deletePrinterObject(pre)).toEqual({ kind: "busy" });
    expect(readPrinterStatus).not.toHaveBeenCalled();
    expect(deletePrinterObject).not.toHaveBeenCalled();
    finish({ kind: "ok", value: listing });
    await pending;
    expect(readPrinterObjects).toHaveBeenCalledWith(target, expect.any(Function));
    expect(useLabelStore.getState().printerReading).toBeUndefined();
    expect(selectPrinterObjects(useLabelStore.getState())).toMatchObject({ phase: "done", key: "net:172.17.17.175:9100", directories: listing });
    useLabelStore.setState({ printTarget: { ...DEFAULT_PRINT_TARGET, host: "10.0.0.9" } });
    expect(selectPrinterObjects(useLabelStore.getState()).phase).toBe("idle");
    useLabelStore.setState({ printTarget: DEFAULT_PRINT_TARGET });
    await useLabelStore.getState().readPrinterObjects();
    expect(selectPrinterObjects(useLabelStore.getState())).toMatchObject({ phase: "failed", failure: { kind: "unconfigured" } });
    expect(readPrinterObjects).toHaveBeenCalledTimes(1);
  });
});

describe("readPrinterGraphic", () => {
  it("hands the graphic back without touching the listing", async () => {
    readPrinterGraphic.mockResolvedValue({ kind: "ok", value: { name: "PRE", gfa: "^GFA,2,2,1,FFFF" } });
    expect(await useLabelStore.getState().readPrinterGraphic(pre)).toMatchObject({ kind: "ok", value: { name: "PRE" } });
    expect(readPrinterGraphic).toHaveBeenCalledWith(target, pre);
    expect(useLabelStore.getState().printerObjects).toEqual({ phase: "idle" });
    expect(useLabelStore.getState().printerReading).toBeUndefined();
  });
});

describe("deletePrinterObject", () => {
  it("reads the listing again after the delete and skips that read when the delete failed", async () => {
    deletePrinterObject.mockResolvedValueOnce(undefined);
    readPrinterObjects.mockResolvedValueOnce({ kind: "ok", value: [{ device: "R", objects: [], bytesFree: 7516932 }] });
    expect(await useLabelStore.getState().deletePrinterObject(pre)).toBeUndefined();
    expect(deletePrinterObject).toHaveBeenCalledWith(target, pre);
    expect(selectPrinterObjects(useLabelStore.getState())).toMatchObject({ phase: "done", directories: [{ objects: [] }] });
    deletePrinterObject.mockResolvedValueOnce({ kind: "unreachable" });
    expect(await useLabelStore.getState().deletePrinterObject(pre)).toEqual({ kind: "unreachable" });
    expect(readPrinterObjects).toHaveBeenCalledTimes(1);
    expect(useLabelStore.getState().printerReading).toBeUndefined();
  });

  it("reports a delete the printer ignored when the fresh listing still names the object", async () => {
    deletePrinterObject.mockResolvedValueOnce(undefined);
    readPrinterObjects.mockResolvedValueOnce({ kind: "ok", value: listing });
    expect(await useLabelStore.getState().deletePrinterObject(pre)).toEqual({ kind: "ignored" });
    expect(selectPrinterObjects(useLabelStore.getState())).toMatchObject({ phase: "done", directories: listing });
  });
});

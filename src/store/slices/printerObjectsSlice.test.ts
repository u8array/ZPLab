import { describe, it, expect, vi, beforeEach } from "vitest";
import { useLabelStore } from "../labelStore";
import { DEFAULT_PRINT_TARGET } from "../../lib/printTarget";
import { selectPrinterObjects } from "../labelStore.selectors";

const readPrinterObjects = vi.fn();
const readPrinterObjectImage = vi.fn();
const deletePrinterObject = vi.fn();
vi.mock("../../lib/printerObjects", () => ({
  readPrinterObjects: (...args: unknown[]) => readPrinterObjects(...args),
  readPrinterObjectImage: (...args: unknown[]) => readPrinterObjectImage(...args),
  deletePrinterObject: (...args: unknown[]) => deletePrinterObject(...args),
}));
const readPrinterStatus = vi.fn();
vi.mock("../../lib/printerStatus", () => ({
  readPrinterStatus: (...args: unknown[]) => readPrinterStatus(...args),
  readPrinterConfiguration: vi.fn(),
}));

const target = { kind: "network", host: "172.17.17.175", port: 9100 };
const pre = { device: "R", name: "PRE", ext: "GRF", size: 49924 };
const font = { device: "E", name: "CG_TIMES", ext: "TTF", size: 62252 };
const listing = [{ device: "R", objects: [pre], bytesFree: 7467008 }];

beforeEach(() => {
  readPrinterObjects.mockReset();
  readPrinterObjectImage.mockReset();
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
    expect(await useLabelStore.getState().readPrinterObjectImage(pre)).toEqual({ kind: "busy" });
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

describe("readPrinterObjectImage", () => {
  it("hands the image back on the page's media, names the step per kind and leaves the listing", async () => {
    let step: string | undefined;
    readPrinterObjectImage.mockImplementation(() => {
      step = useLabelStore.getState().printerReading;
      return Promise.resolve({ kind: "ok", value: "data:image/png;base64,x" });
    });
    expect(await useLabelStore.getState().readPrinterObjectImage(font)).toEqual({ kind: "ok", value: "data:image/png;base64,x" });
    expect(step).toBe("^IS");
    const { widthMm, heightMm, dpmm } = useLabelStore.getState().label;
    expect(readPrinterObjectImage).toHaveBeenCalledWith(target, font, expect.objectContaining({ widthMm, heightMm, dpmm }));
    await useLabelStore.getState().readPrinterObjectImage(pre);
    expect(step).toBe("^HG");
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

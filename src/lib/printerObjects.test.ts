import { describe, it, expect, vi, beforeEach } from "vitest";
import { deletePrinterObject, readPrinterFontSample, readPrinterGraphic, readPrinterObjectImage, readPrinterObjects } from "./printerObjects";
import type * as PrinterPreview from "./printerPreview";
import type * as PrinterQuery from "./printerQuery";
import type * as ZebraPrint from "./zebraPrint";
import type * as UsbPrint from "./usbPrint";

const queryPrinter = vi.fn();
const sendViaNetwork = vi.fn();
const sendZplUsb = vi.fn();
const fetchPrinterPreview = vi.fn();
vi.mock("./printerPreview", async (importOriginal) => ({
  ...(await importOriginal<typeof PrinterPreview>()),
  fetchPrinterPreview: (...args: unknown[]) => fetchPrinterPreview(...args),
}));
vi.mock("./printerQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof PrinterQuery>()),
  queryPrinter: (...args: unknown[]) => queryPrinter(...args),
}));
vi.mock("./zebraPrint", async (importOriginal) => ({
  ...(await importOriginal<typeof ZebraPrint>()),
  sendViaNetwork: (...args: unknown[]) => sendViaNetwork(...args),
}));
vi.mock("./usbPrint", async (importOriginal) => ({
  ...(await importOriginal<typeof UsbPrint>()),
  sendZplUsb: (...args: unknown[]) => sendZplUsb(...args),
}));

const network = { kind: "network", host: "172.17.17.175", port: 9100 } as const;
const usb = { kind: "usb", id: "usb-1" } as const;
const pre = { device: "R", name: "PRE", ext: "GRF", size: 49924 };
const listingOf = (zpl: string) => {
  const drive = zpl.slice(6, 8);
  return { kind: "ok", value: `\u0002\r\n- DIR ${drive}*.* \r\n* ${drive}PRE.GRF     49924          \r\n\u0003` };
};

beforeEach(() => {
  queryPrinter.mockReset();
  sendViaNetwork.mockReset();
  sendZplUsb.mockReset();
  fetchPrinterPreview.mockReset();
});

const font = { device: "E", name: "CG_TIMES", ext: "TTF", size: 62252 };
const media = { widthMm: 100, heightMm: 150, dpmm: 8 };

describe("readPrinterFontSample", () => {
  it("has the printer render the sample and crops it to the ink", async () => {
    fetchPrinterPreview.mockResolvedValueOnce({ kind: "ok", value: { width: 16, height: 3, mono: Uint8Array.from([0, 0, 0, 0x18, 0, 0]) } });
    expect(await readPrinterFontSample(network, font, media)).toEqual({ kind: "ok", value: { width: 8, height: 1, mono: Uint8Array.from([0x18]) } });
    expect(fetchPrinterPreview).toHaveBeenCalledWith(network, expect.stringContaining("^A@N,60,,E:CG_TIMES.TTF"));
    expect(sendViaNetwork).not.toHaveBeenCalled();
  });

  it("reports a blank sample as null and passes a failed render through", async () => {
    fetchPrinterPreview.mockResolvedValueOnce({ kind: "ok", value: { width: 8, height: 1, mono: Uint8Array.from([0]) } });
    expect(await readPrinterFontSample(network, font, media)).toEqual({ kind: "ok", value: null });
    fetchPrinterPreview.mockResolvedValueOnce({ kind: "unreachable" });
    expect(await readPrinterFontSample(network, font, media)).toEqual({ kind: "unreachable" });
  });
});

describe("readPrinterObjectImage", () => {
  it("takes the ^HG path for a graphic and the sample path for a font", async () => {
    queryPrinter.mockResolvedValueOnce({ kind: "ok", value: "" });
    expect(await readPrinterObjectImage(network, pre, media)).toEqual({ kind: "unparsed" });
    expect(fetchPrinterPreview).not.toHaveBeenCalled();
    fetchPrinterPreview.mockResolvedValueOnce({ kind: "ok", value: { width: 8, height: 1, mono: Uint8Array.from([0]) } });
    expect(await readPrinterObjectImage(network, font, media)).toEqual({ kind: "ok", value: null });
    expect(queryPrinter).toHaveBeenCalledTimes(1);
  });
});

describe("readPrinterObjects", () => {
  it("asks drive by drive, names each step and hands the listings back", async () => {
    queryPrinter.mockImplementation((_t: unknown, zpl: string) => Promise.resolve(listingOf(zpl)));
    const steps: string[] = [];
    const result = await readPrinterObjects(network, (step) => steps.push(step));
    expect(steps).toEqual(["^HWR:*.*", "^HWE:*.*", "^HWB:*.*", "^HWA:*.*", "^HWZ:*.*"]);
    expect(queryPrinter).toHaveBeenNthCalledWith(2, network, "^XA^HWE:*.*^XZ");
    expect(result).toMatchObject({ kind: "ok", value: [{ device: "R", objects: [{ name: "PRE" }] }, { device: "E" }, { device: "B" }, { device: "A" }, { device: "Z" }] });
  });

  it("leaves out a drive the printer does not list and fails when no drive parsed", async () => {
    queryPrinter.mockImplementation((_t: unknown, zpl: string) => Promise.resolve(zpl.includes("HWA") ? { kind: "ok", value: "" } : listingOf(zpl)));
    expect(await readPrinterObjects(network)).toMatchObject({ kind: "ok", value: [{ device: "R" }, { device: "E" }, { device: "B" }, { device: "Z" }] });
    queryPrinter.mockResolvedValue({ kind: "ok", value: "PRINTER STATUS" });
    expect(await readPrinterObjects(network)).toEqual({ kind: "unparsed" });
  });

  it("keeps the drives already read when a later one goes silent, and fails when the first one does", async () => {
    queryPrinter.mockResolvedValueOnce(listingOf("^XA^HWR:*.*^XZ")).mockResolvedValueOnce({ kind: "unreachable" });
    expect(await readPrinterObjects(network)).toMatchObject({ kind: "ok", value: [{ device: "R" }] });
    expect(queryPrinter).toHaveBeenCalledTimes(2);
    queryPrinter.mockResolvedValueOnce({ kind: "unreachable" });
    expect(await readPrinterObjects(network)).toEqual({ kind: "unreachable" });
  });
});

describe("readPrinterGraphic", () => {
  it("asks for the one object and refuses a reply without a graphic", async () => {
    queryPrinter.mockResolvedValueOnce({ kind: "ok", value: "~DGPRE,2,1,\r\nFFFF" });
    expect(await readPrinterGraphic(network, pre)).toEqual({ kind: "ok", value: { name: "PRE", gfa: "^GFA,2,2,1,FFFF" } });
    expect(queryPrinter).toHaveBeenCalledWith(network, "^XA^HGR:PRE.GRF^XZ");
    queryPrinter.mockResolvedValueOnce({ kind: "ok", value: "" });
    expect(await readPrinterGraphic(network, pre)).toEqual({ kind: "unparsed" });
  });
});

describe("deletePrinterObject", () => {
  it("sends ^ID the way a job goes and maps the send outcome onto the query failures", async () => {
    sendViaNetwork.mockResolvedValueOnce({ kind: "sent" });
    expect(await deletePrinterObject(network, pre)).toBeUndefined();
    expect(sendViaNetwork).toHaveBeenCalledWith("172.17.17.175", 9100, "^XA^IDR:PRE.GRF^FS^XZ");
    sendViaNetwork.mockResolvedValueOnce({ kind: "refused" });
    expect(await deletePrinterObject(network, pre)).toEqual({ kind: "refused", port: 9100 });
    sendViaNetwork.mockResolvedValueOnce({ kind: "error" });
    expect(await deletePrinterObject(network, pre)).toEqual({ kind: "unreachable" });
    sendZplUsb.mockResolvedValueOnce({ kind: "permission_denied" });
    expect(await deletePrinterObject(usb, pre)).toEqual({ kind: "permission_denied" });
    expect(sendZplUsb).toHaveBeenCalledWith("usb-1", "^XA^IDR:PRE.GRF^FS^XZ");
  });
});

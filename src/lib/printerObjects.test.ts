import { describe, it, expect, vi, beforeEach } from "vitest";
import { deletePrinterObject, readPrinterGraphic, readPrinterObjects } from "./printerObjects";
import type * as PrinterQuery from "./printerQuery";
import type * as ZebraPrint from "./zebraPrint";
import type * as UsbPrint from "./usbPrint";

const queryPrinter = vi.fn();
const sendViaNetwork = vi.fn();
const sendZplUsb = vi.fn();
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
});

describe("readPrinterObjects", () => {
  it("asks drive by drive, names each step and hands the listings back", async () => {
    queryPrinter.mockImplementation((_t: unknown, zpl: string) => Promise.resolve(listingOf(zpl)));
    const steps: string[] = [];
    const result = await readPrinterObjects(network, (step) => steps.push(step));
    expect(steps).toEqual(["^HWR:*.*", "^HWE:*.*", "^HWB:*.*", "^HWA:*.*"]);
    expect(queryPrinter).toHaveBeenNthCalledWith(2, network, "^XA^HWE:*.*^XZ");
    expect(result).toMatchObject({ kind: "ok", value: [{ device: "R", objects: [{ name: "PRE" }] }, { device: "E" }, { device: "B" }, { device: "A" }] });
  });

  it("leaves out a drive the printer does not list and fails when no drive parsed", async () => {
    queryPrinter.mockImplementation((_t: unknown, zpl: string) => Promise.resolve(zpl.includes("HWA") ? { kind: "ok", value: "" } : listingOf(zpl)));
    expect(await readPrinterObjects(network)).toMatchObject({ kind: "ok", value: [{ device: "R" }, { device: "E" }, { device: "B" }] });
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

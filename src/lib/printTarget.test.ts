import { describe, expect, it } from "vitest";
import { DEFAULT_PRINT_TARGET, effectiveTransport, needsRawChannel, offeredTransports, parsePort, readLegacyPrintTarget, resolveQueryTarget } from "./printTarget";

function storageOf(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return { map, getItem: (k: string) => map.get(k) ?? null, removeItem: (k: string) => void map.delete(k) };
}

describe("printTarget", () => {
  it("reads a TCP port and rejects a blank draft", () => {
    expect(parsePort("")).toBeNull();
    expect(parsePort(" 6101 ")).toBe(6101);
    expect(parsePort("0")).toBeNull();
    expect(parsePort("65536")).toBeNull();
    expect(parsePort("9100.5")).toBeNull();
    expect(parsePort("port")).toBeNull();
  });

  it("offers the ways per build and counts a device way while its list may still hold one", () => {
    const none = { local: false, usb: false };
    const all = { local: true, usb: true };
    expect(offeredTransports(false, all)).toEqual(["network", "browserprint"]);
    expect(offeredTransports(true, none)).toEqual(["network"]);
    expect(offeredTransports(true, all)).toEqual(["network", "local", "usb"]);
  });

  it("shows the network form for a way the build lacks without rewriting the choice", () => {
    const all = { local: true, usb: true };
    expect(effectiveTransport("usb", offeredTransports(true, all))).toBe("usb");
    expect(effectiveTransport("usb", offeredTransports(true, { local: true, usb: false }))).toBe("network");
    expect(effectiveTransport("local", offeredTransports(false, all))).toBe("network");
  });

  it("names the ways a status read blocks", () => {
    expect(needsRawChannel("network", "none")).toBe(true);
    expect(needsRawChannel("usb", "none")).toBe(true);
    // The agent and the OS spooler own the device, so a read of our own cannot be in their way.
    expect(needsRawChannel("browserprint", "printer")).toBe(false);
    expect(needsRawChannel("local", "printer")).toBe(false);
    // The system way sends no code, so only the render it needs first can contend.
    expect(needsRawChannel("system", "printer")).toBe(true);
    expect(needsRawChannel("system", "labelary")).toBe(false);
  });

  it("takes the pre-0.7.0 browser keys over once and clears them", () => {
    const storage = storageOf({
      zebra_print_ip: " 172.17.17.175 ",
      zebra_print_port: "6101",
      zebra_print_usb: "0a5f:0166:D4J260700032",
      zebra_preview_transport: "usb",
      zebra_print_uid: "bp-1",
      zebra_print_local: "ZDesigner ZD230",
    });
    expect(readLegacyPrintTarget(storage)).toEqual({
      transport: "usb",
      host: "172.17.17.175",
      port: 6101,
      usbId: "0a5f:0166:D4J260700032",
      browserPrintUid: "bp-1",
      localPrinter: "ZDesigner ZD230",
    });
    expect(storage.map.size).toBe(0);
  });

  it("falls back to the defaults for missing or broken keys", () => {
    const storage = storageOf({ zebra_print_port: "carrier-pigeon", zebra_preview_transport: "usb" });
    expect(readLegacyPrintTarget(storage)).toEqual(DEFAULT_PRINT_TARGET);
  });

  it("resolves the USB way and lets one without a device fall through to the network", () => {
    const usb = { ...DEFAULT_PRINT_TARGET, host: "10.0.0.5", usbId: "usb-1", transport: "usb" as const };
    expect(resolveQueryTarget(usb)).toEqual({ target: { kind: "usb", id: "usb-1" } });
    expect(resolveQueryTarget({ ...usb, usbId: "" })).toEqual({ target: { kind: "network", host: "10.0.0.5", port: 9100 } });
    expect(resolveQueryTarget({ ...usb, transport: "local" })).toEqual({ target: { kind: "network", host: "10.0.0.5", port: 9100 } });
    expect(resolveQueryTarget(DEFAULT_PRINT_TARGET)).toEqual({ failure: { kind: "unconfigured" } });
    expect(resolveQueryTarget(usb, "network")).toEqual({ target: { kind: "network", host: "10.0.0.5", port: 9100 } });
  });
});

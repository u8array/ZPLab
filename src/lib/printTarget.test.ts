import { describe, expect, it } from "vitest";
import { carriesReply, DEFAULT_PRINT_TARGET, effectiveTransport, needsRawChannel, offeredTransports, parsePort, queryChannel, queryTargetKey, reachableTransports, readLegacyPrintTarget, readsPrinter, resolveQueryTarget } from "./printTarget";

const DESKTOP = { desktop: true, server: false };
const WEB = { desktop: false, server: false };
const SERVED = { desktop: false, server: true };

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
    const none = { local: false, usb: false, server: false };
    const all = { local: true, usb: true, server: true };
    expect(offeredTransports(WEB, all)).toEqual(["network", "browserprint"]);
    expect(offeredTransports(DESKTOP, none)).toEqual(["network"]);
    expect(offeredTransports(DESKTOP, all)).toEqual(["network", "local", "usb"]);
    expect(offeredTransports(SERVED, all)).toEqual(["network", "browserprint", "server"]);
    expect(offeredTransports(SERVED, none)).toEqual(["network", "browserprint"]);
  });

  it("lists the ways a build can ever offer, whatever its device lists hold", () => {
    expect(reachableTransports(WEB)).toEqual(["network", "browserprint"]);
    expect(reachableTransports(DESKTOP)).toEqual(["network", "local", "usb"]);
    expect(reachableTransports(SERVED)).toEqual(["network", "browserprint", "server"]);
  });

  it("shows the network form for a way the build lacks without rewriting the choice", () => {
    const all = { local: true, usb: true, server: true };
    expect(effectiveTransport("usb", offeredTransports(DESKTOP, all))).toBe("usb");
    expect(effectiveTransport("usb", offeredTransports(DESKTOP, { ...all, usb: false }))).toBe("network");
    expect(effectiveTransport("local", offeredTransports(WEB, all))).toBe("network");
    expect(effectiveTransport("server", offeredTransports(SERVED, all))).toBe("server");
    expect(effectiveTransport("server", offeredTransports(WEB, all))).toBe("network");
  });

  it("names the ways a status read blocks", () => {
    expect(needsRawChannel("network", "none")).toBe(true);
    expect(needsRawChannel("usb", "none")).toBe(true);
    expect(needsRawChannel("server", "none")).toBe(true);
    // The agent and the OS spooler own the device, so a read of our own cannot be in their way.
    expect(needsRawChannel("browserprint", "printer")).toBe(false);
    expect(needsRawChannel("local", "printer")).toBe(false);
    // The system way sends no code, so only the render it needs first can contend.
    expect(needsRawChannel("system", "printer")).toBe(true);
    expect(needsRawChannel("system", "labelary")).toBe(false);
  });

  it("names the ways that can bring an answer back", () => {
    expect(carriesReply("network", DESKTOP)).toBe(true);
    expect(carriesReply("usb", DESKTOP)).toBe(true);
    expect(carriesReply("browserprint", DESKTOP)).toBe(false);
    expect(carriesReply("local", DESKTOP)).toBe(false);
    expect(carriesReply("system", DESKTOP)).toBe(false);
    expect(carriesReply("network", WEB)).toBe(false);
    expect(carriesReply("usb", WEB)).toBe(false);
  });

  it("reads through the server only on its own way, in the build the server serves", () => {
    expect(carriesReply("server", SERVED)).toBe(true);
    expect(carriesReply("network", SERVED)).toBe(false);
    expect(carriesReply("browserprint", SERVED)).toBe(false);
    expect(carriesReply("server", WEB)).toBe(false);
    expect(carriesReply("server", DESKTOP)).toBe(false);
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
      serverPrinter: "",
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

  it("routes a USB way with a device to USB and the rest to the network", () => {
    const usb = { ...DEFAULT_PRINT_TARGET, usbId: "usb-1", transport: "usb" as const };
    expect(queryChannel(usb)).toBe("usb");
    expect(queryChannel({ ...usb, usbId: "" })).toBe("network");
    expect(queryChannel(usb, "local")).toBe("network");
    expect(queryChannel(DEFAULT_PRINT_TARGET)).toBe("network");
  });

  it("keeps the server way off the typed address", () => {
    const served = { ...DEFAULT_PRINT_TARGET, host: "10.0.0.5", usbId: "usb-1", serverPrinter: "dock", transport: "server" as const };
    expect(queryChannel(served)).toBe("server");
    expect(resolveQueryTarget(served)).toEqual({ target: { kind: "server", id: "dock" } });
    expect(resolveQueryTarget({ ...served, serverPrinter: "" })).toEqual({ failure: { kind: "unconfigured" } });
    expect(resolveQueryTarget(served, "network")).toEqual({ target: { kind: "network", host: "10.0.0.5", port: 9100 } });
    expect(resolveQueryTarget({ ...served, transport: "network" }, "server")).toEqual({ target: { kind: "server", id: "dock" } });
  });

  it("keys a server printer apart from a USB device of the same id", () => {
    expect(queryTargetKey({ kind: "server", id: "dock" })).toBe("server:dock");
    expect(queryTargetKey({ kind: "usb", id: "dock" })).toBe("usb:dock");
    expect(queryTargetKey({ kind: "network", host: "10.0.0.5", port: 9100 })).toBe("net:10.0.0.5:9100");
  });

  it("reads the printer over USB and the network in the desktop shell and over none in the plain web build", () => {
    const usb = { ...DEFAULT_PRINT_TARGET, usbId: "usb-1", transport: "usb" as const };
    expect(readsPrinter(usb, DESKTOP)).toBe(true);
    expect(readsPrinter(usb, DESKTOP, "local")).toBe(true);
    expect(readsPrinter(DEFAULT_PRINT_TARGET, DESKTOP, "browserprint")).toBe(true);
    expect(readsPrinter(usb, WEB)).toBe(false);
    expect(readsPrinter(usb, WEB, "local")).toBe(false);
    expect(readsPrinter(DEFAULT_PRINT_TARGET, WEB)).toBe(false);
  });

  it("reads the printer through the server on the server way only", () => {
    const served = { ...DEFAULT_PRINT_TARGET, serverPrinter: "dock", transport: "server" as const };
    expect(readsPrinter(served, SERVED)).toBe(true);
    expect(readsPrinter(served, SERVED, "network")).toBe(false);
    expect(readsPrinter(DEFAULT_PRINT_TARGET, SERVED)).toBe(false);
    expect(readsPrinter(served, WEB)).toBe(false);
  });
});

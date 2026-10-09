import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  discoverBrowserPrintDevices,
  isConnectionRefused,
  sendViaBrowserPrint,
  sendViaNetwork,
  type BrowserPrintDevice,
} from "../lib/zebraPrint";

// ── helpers ──────────────────────────────────────────────────────────────────

function mockFetch(response: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(response),
    text: () => Promise.resolve(""),
  } as Partial<Response>);
}

function mockFetchThrow(error: unknown) {
  return vi.fn().mockRejectedValue(error);
}

const DEVICE: BrowserPrintDevice = {
  uid: "usb-001",
  connection: "usb",
  device_type: "printer",
  manufacturer: "Zebra",
  name: "ZT411",
  version: 2,
};

// ── isConnectionRefused ───────────────────────────────────────────────────────

describe("isConnectionRefused", () => {
  it("returns true for TypeError with 'refused' in message", () => {
    expect(isConnectionRefused(new TypeError("Connection refused"))).toBe(true);
    expect(isConnectionRefused(new TypeError("ECONNREFUSED"))).toBe(true);
  });

  it("returns false for TypeError without 'refused'", () => {
    expect(isConnectionRefused(new TypeError("network error"))).toBe(false);
  });

  it("returns false for non-TypeError errors", () => {
    expect(isConnectionRefused(new Error("Connection refused"))).toBe(false);
    expect(isConnectionRefused(new DOMException("AbortError"))).toBe(false);
    expect(isConnectionRefused(null)).toBe(false);
  });
});

// ── discoverBrowserPrintDevices ───────────────────────────────────────────────

describe("discoverBrowserPrintDevices", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("returns devices when agent responds with an array", async () => {
    vi.stubGlobal("fetch", mockFetch([DEVICE]));
    const devices = await discoverBrowserPrintDevices();
    expect(devices).toEqual([DEVICE]);
  });

  it("returns devices from { printer: [...] } envelope format", async () => {
    vi.stubGlobal("fetch", mockFetch({ printer: [DEVICE] }));
    const devices = await discoverBrowserPrintDevices();
    expect(devices).toEqual([DEVICE]);
  });

  it("returns empty array when response shape is unrecognized", async () => {
    vi.stubGlobal("fetch", mockFetch({ unknown: true }));
    const devices = await discoverBrowserPrintDevices();
    expect(devices).toEqual([]);
  });

  it("throws when agent returns non-ok status", async () => {
    vi.stubGlobal("fetch", mockFetch(null, false));
    await expect(discoverBrowserPrintDevices()).rejects.toThrow("Agent returned 500");
  });

  it("falls back to HTTPS when HTTP throws a network error", async () => {
    const httpsFetch = mockFetch([DEVICE]);
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockImplementation(httpsFetch),
    );
    const devices = await discoverBrowserPrintDevices();
    expect(devices).toEqual([DEVICE]);
  });
});

// ── sendViaBrowserPrint ───────────────────────────────────────────────────────

describe("sendViaBrowserPrint", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("sends POST with device and ZPL data to /write", async () => {
    const fetch = mockFetch({});
    vi.stubGlobal("fetch", fetch);
    await sendViaBrowserPrint(DEVICE, "^XA^XZ");
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/write");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as { device: BrowserPrintDevice; data: string };
    expect(body.device).toEqual(DEVICE);
    expect(body.data).toBe("^XA^XZ");
  });

  it("throws when agent returns non-ok status", async () => {
    vi.stubGlobal("fetch", mockFetch(null, false));
    await expect(sendViaBrowserPrint(DEVICE, "^XA^XZ")).rejects.toThrow(
      "Agent write failed: 500",
    );
  });
});

// ── sendViaNetwork ────────────────────────────────────────────────────────────

describe("sendViaNetwork", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("sends POST to http://ip:port with ZPL body", async () => {
    const fetch = mockFetch({});
    vi.stubGlobal("fetch", fetch);
    await sendViaNetwork("192.168.1.50", 9100, "^XA^XZ");
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://192.168.1.50:9100");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("^XA^XZ");
  });

  it("returns no_response on a generic TypeError (raw-socket printer's typical case)", async () => {
    vi.stubGlobal("fetch", mockFetchThrow(new TypeError("network error")));
    await expect(sendViaNetwork("192.168.1.50", 9100, "^XA^XZ")).resolves.toEqual({
      kind: "no_response",
    });
  });

  it("returns no_response on AbortError (timeout — host unreachable or printer silent)", async () => {
    const abort = new DOMException("signal timed out", "AbortError");
    vi.stubGlobal("fetch", mockFetchThrow(abort));
    await expect(sendViaNetwork("192.168.1.50", 9100, "^XA^XZ")).resolves.toEqual({
      kind: "no_response",
    });
  });

  it("returns refused on a TypeError with 'refused' in the message", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchThrow(new TypeError("Connection refused")),
    );
    await expect(sendViaNetwork("192.168.1.50", 9100, "^XA^XZ")).resolves.toEqual({
      kind: "refused",
    });
  });

  it("returns responded with status when fetch resolves (e.g. print server)", async () => {
    vi.stubGlobal("fetch", mockFetch({}));
    await expect(sendViaNetwork("192.168.1.50", 9100, "^XA^XZ")).resolves.toEqual({
      kind: "responded",
      status: 200,
    });
  });

  it("preserves a non-2xx status so the caller can flag it as an error", async () => {
    vi.stubGlobal("fetch", mockFetch({}, false));
    await expect(sendViaNetwork("192.168.1.50", 9100, "^XA^XZ")).resolves.toEqual({
      kind: "responded",
      status: 500,
    });
  });
});

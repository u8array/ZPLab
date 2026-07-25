import { describe, it, expect, afterEach, vi } from "vitest";
import { resolveHost, resolveApiKey, isDefaultHost, fetchPreview, labelaryPath } from "./labelary";

const LABEL = { dpmm: 8, widthMm: 101.6, heightMm: 50.8 } as const;
const DEFAULT_HOST = "https://api.labelary.com";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("resolveHost", () => {
  it("defaults to the public host when nothing is configured", () => {
    expect(resolveHost("")).toBe(DEFAULT_HOST);
  });

  it("runtime host wins over the build env and trims trailing slashes", () => {
    vi.stubEnv("VITE_LABELARY_API_URL", "https://acme.labelary.com");
    expect(resolveHost("https://onprem.example.com//")).toBe("https://onprem.example.com");
  });

  it("falls back to the build env when the runtime host is blank", () => {
    vi.stubEnv("VITE_LABELARY_API_URL", "https://acme.labelary.com");
    expect(resolveHost("   ")).toBe("https://acme.labelary.com");
  });
});

describe("isDefaultHost", () => {
  it("is true for the public host, false for a custom one", () => {
    expect(isDefaultHost("")).toBe(true);
    expect(isDefaultHost("https://onprem.example.com")).toBe(false);
  });

  it("is false when a build env host is set even with a blank runtime host", () => {
    vi.stubEnv("VITE_LABELARY_API_URL", "https://acme.labelary.com");
    expect(isDefaultHost("")).toBe(false);
  });
});

describe("resolveApiKey", () => {
  it("returns undefined with no key anywhere", () => {
    expect(resolveApiKey("")).toBeUndefined();
  });

  it("runtime key wins over the build env key", () => {
    vi.stubEnv("VITE_LABELARY_API_KEY", "env-key");
    expect(resolveApiKey("runtime-key")).toBe("runtime-key");
  });

  it("a blank runtime key falls back to the build env key", () => {
    vi.stubEnv("VITE_LABELARY_API_KEY", "env-key");
    expect(resolveApiKey("  ")).toBe("env-key");
  });
});

describe("labelaryPath", () => {
  it("builds the printer/size print route the proxy validates against", () => {
    expect(labelaryPath({ ...LABEL } as never)).toBe("/v1/printers/8dpmm/labels/4.000x2.000/0/");
  });
});

describe("fetchPreview headers", () => {
  function mockFetch() {
    const fn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response(new Blob(["png"]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fn);
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x") }));
    return fn;
  }

  it("omits X-API-Key when no key is passed", async () => {
    const spy = mockFetch();
    await fetchPreview("^XA^XZ", { ...LABEL } as never, DEFAULT_HOST);
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBeUndefined();
  });

  it("sends X-API-Key and targets the given host", async () => {
    const spy = mockFetch();
    await fetchPreview("^XA^XZ", { ...LABEL } as never, "https://onprem.example.com", "secret-123");
    const url = spy.mock.calls[0]?.[0] as string;
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    expect(url.startsWith("https://onprem.example.com/v1/")).toBe(true);
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("secret-123");
  });
});

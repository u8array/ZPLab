import { describe, it, expect, beforeEach, vi } from "vitest";

// Web contract: no keychain, no CSP; the key lives in localStorage and the
// webview fetch attaches it, so hydration + in-store mirroring still apply.
const getCredential = vi.fn<(name: string) => Promise<string | null>>();
const setCredential = vi.fn<(name: string, value: string) => Promise<void>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: { name: string; value?: string }) => {
    if (cmd === "credential_get") return getCredential(args.name);
    if (cmd === "credential_set") return setCredential(args.name, args.value ?? "");
    if (cmd === "credential_delete") return setCredential(args.name, "");
    return Promise.reject(new Error(`unmocked command: ${cmd}`));
  },
}));
vi.mock("../lib/platform", () => ({ isDesktopShell: false }));

import { useLabelStore } from "./labelStore";

beforeEach(() => {
  getCredential.mockReset();
  setCredential.mockReset();
  setCredential.mockResolvedValue();
  localStorage.clear();
  useLabelStore.setState({
    labelaryApiKey: "",
    labelaryApiKeyLoaded: false,
    labelaryKeyEpoch: 0,
    labelaryHost: "",
    previewMode: { status: "idle" },
  });
});

describe("web labelary key hydration", () => {
  it("loads the stored key into the store once", async () => {
    localStorage.setItem("zpl-cred-labelary-api-key", "stored-key");
    await useLabelStore.getState().hydrateLabelaryApiKey();
    expect(useLabelStore.getState().labelaryApiKey).toBe("stored-key");
    expect(useLabelStore.getState().labelaryApiKeyLoaded).toBe(true);
  });

  it("treats an absent credential as an empty key", async () => {
    await useLabelStore.getState().hydrateLabelaryApiKey();
    expect(useLabelStore.getState().labelaryApiKey).toBe("");
    expect(useLabelStore.getState().labelaryApiKeyLoaded).toBe(true);
  });

  it("skips the read once loaded (a later store change is not picked up)", async () => {
    localStorage.setItem("zpl-cred-labelary-api-key", "k");
    await useLabelStore.getState().hydrateLabelaryApiKey();
    // A second hydrate must not re-read: change the backing value and confirm
    // the store keeps the first-loaded key.
    localStorage.setItem("zpl-cred-labelary-api-key", "changed");
    await useLabelStore.getState().hydrateLabelaryApiKey();
    expect(useLabelStore.getState().labelaryApiKey).toBe("k");
  });

  it("trims a stored value with surrounding whitespace", async () => {
    localStorage.setItem("zpl-cred-labelary-api-key", "  spaced  ");
    await useLabelStore.getState().hydrateLabelaryApiKey();
    expect(useLabelStore.getState().labelaryApiKey).toBe("spaced");
  });
});

describe("web labelary key save", () => {
  it("persists to localStorage and mirrors in memory, trimmed", async () => {
    await useLabelStore.getState().saveLabelaryApiKey("  abc  ");
    expect(localStorage.getItem("zpl-cred-labelary-api-key")).toBe("abc");
    expect(useLabelStore.getState().labelaryApiKey).toBe("abc");
    expect(useLabelStore.getState().labelaryApiKeyLoaded).toBe(true);
  });

  it("bumps the key epoch so the preview cache invalidates", async () => {
    const before = useLabelStore.getState().labelaryKeyEpoch;
    await useLabelStore.getState().saveLabelaryApiKey("k");
    expect(useLabelStore.getState().labelaryKeyEpoch).toBe(before + 1);
  });

  it("migrate is a no-op on web", async () => {
    await useLabelStore.getState().migrateLabelaryKey();
    // No throw, no invoke; the web key already lives under the legacy name.
    expect(useLabelStore.getState().labelaryApiKey).toBe("");
  });
});

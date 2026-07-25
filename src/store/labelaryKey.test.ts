import { describe, it, expect, beforeEach, vi } from "vitest";

// Desktop contract: the key is host-bound in the keychain and never enters the
// webview. Mock the Tauri invoke seam so the real credentialStore/uiSlice runs.
const invoked = vi.fn<(cmd: string, args: Record<string, unknown>) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown>) => invoked(cmd, args),
}));
vi.mock("../lib/platform", () => ({ isDesktopShell: true }));

import { useLabelStore } from "./labelStore";

beforeEach(() => {
  invoked.mockReset();
  invoked.mockResolvedValue(undefined);
  useLabelStore.setState({
    labelaryApiKey: "",
    labelaryApiKeyLoaded: false,
    labelaryKeyEpoch: 0,
    labelaryHost: "",
    previewMode: { status: "idle" },
  });
});

describe("desktop preview awaits migration before the first keyed fetch", () => {
  it("enterPreviewMode migrates the legacy key before hydrating", async () => {
    useLabelStore.setState({ labelaryApiKeyLoaded: false, previewProvider: "labelary", label: { widthMm: 100, heightMm: 50, dpmm: 8 } } as never);
    await useLabelStore.getState().enterPreviewMode().catch(() => undefined);
    expect(invoked).toHaveBeenCalledWith("preview_migrate_labelary_key", expect.anything());
    expect(useLabelStore.getState().labelaryApiKeyLoaded).toBe(true);
  });
});

describe("desktop labelary key hydration", () => {
  it("marks loaded without reading the keychain (key stays out of the webview)", async () => {
    await useLabelStore.getState().hydrateLabelaryApiKey();
    expect(useLabelStore.getState().labelaryApiKeyLoaded).toBe(true);
    expect(useLabelStore.getState().labelaryApiKey).toBe("");
    expect(invoked).not.toHaveBeenCalledWith("credential_get", expect.anything());
  });
});

describe("desktop labelary key save", () => {
  it("binds the key to the resolved host via the rust-only command, never the store", async () => {
    useLabelStore.setState({ labelaryHost: "https://onprem.example.com/" });
    await useLabelStore.getState().saveLabelaryApiKey("  secret-123  ");
    expect(invoked).toHaveBeenCalledWith("preview_set_labelary_key", {
      host: "https://onprem.example.com",
      key: "secret-123",
    });
    // The key must not be mirrored into the webview store on desktop.
    expect(useLabelStore.getState().labelaryApiKey).toBe("");
    expect(invoked).not.toHaveBeenCalledWith("credential_set", expect.anything());
  });

  it("bumps the key epoch so the preview cache invalidates on a key change", async () => {
    const before = useLabelStore.getState().labelaryKeyEpoch;
    await useLabelStore.getState().saveLabelaryApiKey("k");
    expect(useLabelStore.getState().labelaryKeyEpoch).toBe(before + 1);
  });

  it("propagates a keychain failure without bumping the epoch", async () => {
    invoked.mockRejectedValueOnce(new Error("locked"));
    await expect(useLabelStore.getState().saveLabelaryApiKey("k")).rejects.toThrow("locked");
    expect(useLabelStore.getState().labelaryKeyEpoch).toBe(0);
  });

  it("exits an active labelary preview after a save", async () => {
    useLabelStore.setState({ previewMode: { status: "active", url: "blob:x" } });
    await useLabelStore.getState().saveLabelaryApiKey("k");
    expect(useLabelStore.getState().previewMode.status).toBe("idle");
  });

  it("keeps a printer preview when the labelary key changes", async () => {
    useLabelStore.setState({
      previewProvider: "printer",
      previewMode: { status: "active", url: "blob:x" },
    });
    await useLabelStore.getState().saveLabelaryApiKey("k");
    expect(useLabelStore.getState().previewMode.status).toBe("active");
  });

  it("changing the host exits an active labelary preview", () => {
    useLabelStore.setState({ previewProvider: "labelary", previewMode: { status: "active", url: "blob:x" }, labelaryHost: "" });
    useLabelStore.getState().setLabelaryHost("https://onprem.example.com");
    expect(useLabelStore.getState().previewMode.status).toBe("idle");
  });

  it("a no-op host blur leaves the preview alone", () => {
    useLabelStore.setState({ previewProvider: "labelary", previewMode: { status: "active", url: "blob:x" }, labelaryHost: "https://h" });
    useLabelStore.getState().setLabelaryHost("https://h");
    expect(useLabelStore.getState().previewMode.status).toBe("active");
  });
});

describe("desktop legacy-key migration", () => {
  it("moves the legacy key into the host-bound credential via the command", async () => {
    useLabelStore.setState({ labelaryHost: "https://api.labelary.com" });
    await useLabelStore.getState().migrateLabelaryKey();
    expect(invoked).toHaveBeenCalledWith("preview_migrate_labelary_key", {
      host: "https://api.labelary.com",
    });
  });

  it("rejects (surfacing the keychain error) so the caller can guard it", async () => {
    invoked.mockRejectedValueOnce(new Error("locked"));
    await expect(useLabelStore.getState().migrateLabelaryKey()).rejects.toThrow("locked");
  });
});

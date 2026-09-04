import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useLabelStore, canCallLabelary } from "./labelStore";
import { DEFAULT_CANVAS_SETTINGS } from "./slices/uiSlice";

// Pin the public host so these consent assertions hold regardless of the
// runner's env: on a custom host canCallLabelary is intentionally true
// without acknowledgement (labelStore.selectors.ts).
beforeEach(() => {
  vi.stubEnv("VITE_LABELARY_API_URL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  useLabelStore.setState({
    locale: "en",
    showZplCommands: false,
    keepExportMetadata: false,
    labelaryNoticeAcknowledged: false,
    canvasSettings: { ...DEFAULT_CANVAS_SETTINGS },
    previewMode: { status: "idle" },
    thirdParty: { labelary: false },
    pages: [{ objects: [] }],
    currentPageIndex: 0,
  });
});

describe("Labelary consent (revocable)", () => {
  it("acknowledge opens the gate and revoke closes it again", () => {
    const s = useLabelStore.getState();
    s.setThirdPartyEnabled("labelary", true);
    s.acknowledgeLabelaryNotice();
    expect(canCallLabelary(useLabelStore.getState())).toBe(true);
    s.revokeLabelaryNotice();
    expect(useLabelStore.getState().labelaryNoticeAcknowledged).toBe(false);
    expect(canCallLabelary(useLabelStore.getState())).toBe(false);
  });

  it("revoke tears down a live preview so no Labelary overlay lingers", () => {
    const s = useLabelStore.getState();
    s.setThirdPartyEnabled("labelary", true);
    s.acknowledgeLabelaryNotice();
    useLabelStore.setState({ previewMode: { status: "active", url: "blob:x" } });
    useLabelStore.getState().revokeLabelaryNotice();
    expect(useLabelStore.getState().previewMode.status).toBe("idle");
  });
});

describe("applyLocale", () => {
  it("swaps translations and loadedLocale atomically once the chunk loads", async () => {
    const s = useLabelStore.getState();
    s.setLocale("de");
    // setLocale kicked applyLocale off already; await an explicit call to
    // observe the settled state deterministically (loader is cached).
    await useLabelStore.getState().applyLocale("de");
    const after = useLabelStore.getState();
    expect(after.locale).toBe("de");
    expect(after.loadedLocale).toBe("de");
    expect(after.translations.palette.heading).toBe("Objekte");
  });

  it("drops a stale load when the preference changed meanwhile", async () => {
    const s = useLabelStore.getState();
    const pending = useLabelStore.getState().applyLocale("fr");
    s.setLocale("en");
    await pending;
    const after = useLabelStore.getState();
    expect(after.locale).toBe("en");
    expect(after.loadedLocale).not.toBe("fr");
  });
});

describe("resetSettings (scoped)", () => {
  it("restores prefs to defaults but keeps design and language", () => {
    const s = useLabelStore.getState();
    // Change design + language + prefs.
    s.setLocale("fr");
    s.setShowZplCommands(true);
    s.setKeepExportMetadata(true);
    s.setCanvasSettings({ smartSnapEnabled: false, snapEnabled: true });
    s.acknowledgeLabelaryNotice();
    s.addPage();
    const pagesBefore = useLabelStore.getState().pages.length;

    useLabelStore.getState().resetSettings();
    const after = useLabelStore.getState();

    // Prefs reset:
    expect(after.showZplCommands).toBe(false);
    expect(after.keepExportMetadata).toBe(false);
    expect(after.canvasSettings.smartSnapEnabled).toBe(true);
    expect(after.canvasSettings.snapEnabled).toBe(false);
    expect(after.labelaryNoticeAcknowledged).toBe(false);
    // Design + language kept:
    expect(after.locale).toBe("fr");
    expect(after.pages.length).toBe(pagesBefore);
  });

  it("keeps live view state (zoom/rotation) so the canvas isn't stranded at 100%", () => {
    const s = useLabelStore.getState();
    s.setCanvasSettings({ zoom: 0.42, viewRotation: 90, snapEnabled: true });
    useLabelStore.getState().resetSettings();
    const after = useLabelStore.getState().canvasSettings;
    expect(after.zoom).toBe(0.42);
    expect(after.viewRotation).toBe(90);
    expect(after.snapEnabled).toBe(false); // pref still reset
  });

  it("ends a live preview (consent is dropped by reset)", () => {
    useLabelStore.setState({ previewMode: { status: "active", url: "blob:x" } });
    useLabelStore.getState().resetSettings();
    expect(useLabelStore.getState().previewMode.status).toBe("idle");
  });
});

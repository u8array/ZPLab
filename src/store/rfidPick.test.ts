import { describe, it, expect, beforeEach } from "vitest";
import { useLabelStore } from "./labelStore";

// The pick hides the settings modal to free the canvas, so its capture layer
// must never outlive the flow: every exit clears it.
describe("RFID position pick lifecycle", () => {
  beforeEach(() => {
    useLabelStore.setState({ pickingRfidPosition: false, printerSettingsTab: null });
  });

  it("hides the dialog while picking and returns to its tab", () => {
    useLabelStore.getState().startRfidPositionPick();
    expect(useLabelStore.getState().pickingRfidPosition).toBe(true);
    expect(useLabelStore.getState().printerSettingsTab).toBeNull();

    useLabelStore.getState().endRfidPositionPick();
    expect(useLabelStore.getState().pickingRfidPosition).toBe(false);
    expect(useLabelStore.getState().printerSettingsTab).toBe("rfid");
  });

  it("ends when the dialog is opened another way", () => {
    useLabelStore.getState().startRfidPositionPick();
    useLabelStore.getState().setPrinterSettingsTab("mediaFeed");
    expect(useLabelStore.getState().pickingRfidPosition).toBe(false);
  });

  it("is not persisted, so a reload cannot resume it", () => {
    useLabelStore.getState().startRfidPositionPick();
    const persisted = JSON.parse(localStorage.getItem("zpl-designer-session") ?? "{}") as {
      state?: Record<string, unknown>;
    };
    expect(persisted.state && "pickingRfidPosition" in persisted.state).toBeFalsy();
  });
});

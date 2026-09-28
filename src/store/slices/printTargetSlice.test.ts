import { describe, expect, it } from "vitest";
import { useLabelStore } from "../labelStore";
import { DEFAULT_PRINT_TARGET } from "../../lib/printTarget";

describe("printTargetSlice", () => {
  it("merges a patch and stays out of the undo history", () => {
    useLabelStore.setState({ printTarget: DEFAULT_PRINT_TARGET });
    useLabelStore.temporal.getState().clear();
    useLabelStore.getState().setPrintTarget({ transport: "usb", usbId: "usb-1" });
    expect(useLabelStore.getState().printTarget).toEqual({ ...DEFAULT_PRINT_TARGET, transport: "usb", usbId: "usb-1" });
    expect(useLabelStore.temporal.getState().pastStates).toHaveLength(0);
  });
});

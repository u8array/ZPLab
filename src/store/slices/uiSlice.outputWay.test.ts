import { describe, expect, it } from "vitest";
import { useLabelStore } from "../labelStore";
import { DEFAULT_PRINT_TARGET } from "../../lib/printTarget";

describe("chooseOutputWay", () => {
  it("binds a Zebra way to the print target and lets the printer settings decide again", () => {
    useLabelStore.setState({ printTarget: DEFAULT_PRINT_TARGET });
    useLabelStore.getState().setOutputChoice({ printWay: "system" });

    useLabelStore.getState().chooseOutputWay("usb");

    expect(useLabelStore.getState().printTarget.transport).toBe("usb");
    expect(useLabelStore.getState().outputChoice.printWay).toBeNull();
  });

  it("keeps the print target the printer settings own when the system way is chosen", () => {
    useLabelStore.setState({ printTarget: { ...DEFAULT_PRINT_TARGET, transport: "browserprint" } });

    useLabelStore.getState().chooseOutputWay("system");

    expect(useLabelStore.getState().outputChoice.printWay).toBe("system");
    expect(useLabelStore.getState().printTarget.transport).toBe("browserprint");
  });
});

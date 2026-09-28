// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

describe("print target takeover", () => {
  it("moves the pre-0.7.0 keys into the persisted session on the first boot and clears them", async () => {
    localStorage.clear();
    localStorage.setItem("zebra_print_ip", "172.17.17.175");
    localStorage.setItem("zebra_print_usb", "usb-1");
    localStorage.setItem("zpl-designer-session", JSON.stringify({ state: { label: { widthMm: 100, heightMm: 150, dpmm: 8 }, printerProfile: {} }, version: 18 }));
    vi.resetModules();
    const { useLabelStore } = await import("./labelStore");
    expect(useLabelStore.getState().printTarget).toMatchObject({ host: "172.17.17.175", usbId: "usb-1", transport: "network" });
    const persisted = JSON.parse(localStorage.getItem("zpl-designer-session") ?? "{}") as { state: { printTarget?: { host: string } }; version: number };
    expect(persisted.state.printTarget?.host).toBe("172.17.17.175");
    expect(persisted.version).toBe(19);
    expect(localStorage.getItem("zebra_print_ip")).toBeNull();
    expect(useLabelStore.persist.hasHydrated()).toBe(true);
    expect(useLabelStore.temporal.getState().pastStates).toHaveLength(0);
    // A fresh import of the whole store graph takes seconds under a full run.
  }, 30_000);
});

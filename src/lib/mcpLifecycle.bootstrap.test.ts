// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

vi.mock("./mcpServer", () => ({
  startMcpServer: vi.fn(() => Promise.resolve()),
  stopMcpServer: vi.fn(() => Promise.resolve()),
  announceWindow: vi.fn(() => Promise.resolve()),
}));

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("boot wiring before the token hydrate settles", () => {
  it("still stops a sidecar when resetSettings flips the opt-in off", async () => {
    vi.resetModules();
    const { useLabelStore } = await import("../store/labelStore");
    const { initMcpLifecycle, kickMcpLifecycle, getMcpRun } = await import("./mcpLifecycle");
    const { startMcpServer, stopMcpServer } = await import("./mcpServer");

    let releaseHydrate: () => void = () => undefined;
    useLabelStore.setState({
      mcpServerEnabled: true,
      mcpServerToken: "tok",
      mcpServerTokenLoaded: true,
      ensureMcpToken: async () => "tok",
      hydrateMcpToken: () => new Promise<void>((resolve) => {
        releaseHydrate = resolve;
      }),
    } as never);

    void initMcpLifecycle();
    kickMcpLifecycle();
    await flush();
    expect(startMcpServer).toHaveBeenCalled();
    expect(getMcpRun().kind).toBe("running");

    // The follower must already be installed before boot hydrate settles, or this reset races init.
    useLabelStore.getState().resetSettings();
    await flush();
    expect(useLabelStore.getState().mcpServerEnabled).toBe(false);
    expect(stopMcpServer).toHaveBeenCalledTimes(1);
    expect(getMcpRun().kind).toBe("stopped");

    releaseHydrate();
    await flush();
    expect(stopMcpServer).toHaveBeenCalledTimes(1);
  });
});

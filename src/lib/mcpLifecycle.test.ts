// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useLabelStore } from "../store/labelStore";
import { initMcpLifecycle, getMcpRun, kickMcpLifecycle } from "./mcpLifecycle";
import { startMcpServer, stopMcpServer } from "./mcpServer";

vi.mock("./mcpServer", () => ({
  startMcpServer: vi.fn(() => Promise.resolve()),
  stopMcpServer: vi.fn(() => Promise.resolve()),
  announceWindow: vi.fn(() => Promise.resolve()),
}));

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

// One test swaps the store's ensureMcpToken for a pending stub; restore the
// real one so later tests do not inherit a token await that never resolves.
const realEnsureMcpToken = useLabelStore.getState().ensureMcpToken;

beforeEach(() => {
  vi.clearAllMocks();
  useLabelStore.setState({
    mcpServerEnabled: false,
    mcpServerToken: "tok",
    mcpSidecarAvailable: true,
    ensureMcpToken: realEnsureMcpToken,
  } as never);
});

describe("the driver follows the store, not the call site", () => {
  it("stops the sidecar when resetSettings flips the opt-in off", async () => {
    // The reviewer's repro: reset lives in another tab, so no toggle callback
    // fires; before the driver, the child kept running behind an off switch.
    await initMcpLifecycle();
    useLabelStore.setState({ mcpServerEnabled: true });
    await flush();
    expect(getMcpRun().kind).toBe("running");
    // resetSettings writes the store directly, like any future writer.
    useLabelStore.setState({ mcpServerEnabled: false });
    await flush();
    expect(stopMcpServer).toHaveBeenCalled();
    expect(getMcpRun().kind).toBe("stopped");
  });

  it("never starts past an opt-out that lands during the token await", async () => {
    // The re-poll race: enabled was read before two awaits, so a stop landed
    // in between was followed by a spawn nothing would ever stop. init is
    // once-guarded, so calling it here keeps the test order-free.
    await initMcpLifecycle();
    let releaseToken: (t: string) => void = () => undefined;
    useLabelStore.setState({
      mcpServerEnabled: true,
      ensureMcpToken: () => new Promise<string>((r) => { releaseToken = r; }),
    } as never);
    kickMcpLifecycle();
    await flush(); // driver is now inside the token await
    useLabelStore.setState({ mcpServerEnabled: false });
    releaseToken("tok");
    await flush();
    expect(startMcpServer).not.toHaveBeenCalled();
    expect(getMcpRun().kind).toBe("stopped");
  });
});

describe("a stop RPC that fails", () => {
  it("stays retryable instead of claiming stopped", async () => {
    // Claiming "stopped" armed the idempotence skip, so no later kick ever
    // retried and the child ran forever behind the off toggle.
    await initMcpLifecycle();
    useLabelStore.setState({ mcpServerEnabled: true });
    await flush();
    expect(getMcpRun().kind).toBe("running");
    vi.mocked(stopMcpServer).mockRejectedValueOnce(new Error("ipc dead"));
    useLabelStore.setState({ mcpServerEnabled: false });
    await flush();
    expect(getMcpRun().kind).toBe("error");
    kickMcpLifecycle();
    await flush();
    expect(stopMcpServer).toHaveBeenCalledTimes(2);
    expect(getMcpRun().kind).toBe("stopped");
  });
});

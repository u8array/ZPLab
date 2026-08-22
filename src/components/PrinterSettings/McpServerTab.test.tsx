// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act, renderHook } from "@testing-library/react";
import { TAB_GATES } from "./tabVisibility";

// The hook pings the sidecar on mount; the mock keeps jsdom off real Tauri
// invokes. The modal (TAB_GATES) decides visibility, so the tab itself is
// only ever mounted when the build can spawn the sidecar.
const mcpServerStatus = vi.fn(async () => ({ running: false, available: true }));
const startMcpServer = vi.fn(async () => undefined);
const stopMcpServer = vi.fn(async () => undefined);
vi.mock("../../lib/mcpServer", () => ({
  mcpServerStatus: (...args: unknown[]) => mcpServerStatus(...(args as [])),
  startMcpServer: (...args: unknown[]) => startMcpServer(...(args as [])),
  stopMcpServer: (...args: unknown[]) => stopMcpServer(...(args as [])),
  announceWindow: vi.fn(async () => undefined),
  mcpConfigSnippet: vi.fn(() => "{}"),
  generateMcpToken: vi.fn(() => "tok"),
}));

import { McpServerTab } from "./McpServerTab";
import { useMcpAvailability, useMcpServer } from "../../hooks/useMcpServer";
import { useLabelStore } from "../../store/labelStore";

afterEach(cleanup);
beforeEach(() => {
  mcpServerStatus.mockClear();
  startMcpServer.mockReset();
  startMcpServer.mockResolvedValue(undefined);
  stopMcpServer.mockReset();
  stopMcpServer.mockResolvedValue(undefined);
  useLabelStore.setState({ mcpSidecarAvailable: null, mcpServerEnabled: false });
});

describe("McpServerTab", () => {
  it("renders the server controls when mounted", async () => {
    const { container } = render(<McpServerTab />);
    await act(() => Promise.resolve());
    expect(container.querySelector("input[type=checkbox]")).not.toBeNull();
  });
});

describe("mcpServer tab gate", () => {
  it("is visible only when the build can spawn the sidecar", () => {
    const gate = TAB_GATES.mcpServer;
    expect(gate?.({ mcpSidecarAvailable: true, isDesktop: true })).toBe(true);
    // Web/unbundled release report false; boot ping not yet resolved is null.
    expect(gate?.({ mcpSidecarAvailable: false, isDesktop: true })).toBe(false);
    expect(gate?.({ mcpSidecarAvailable: null, isDesktop: true })).toBe(false);
  });
});

describe("useMcpServer toggle race", () => {
  const flush = () => act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });

  it("skips the superseded stop so on→off→on ends running, not stopped", async () => {
    useLabelStore.setState({ mcpSidecarAvailable: true, mcpServerEnabled: false });
    const resolvers: (() => void)[] = [];
    startMcpServer.mockImplementation(
      () => new Promise<undefined>((r) => resolvers.push(() => r(undefined))),
    );
    stopMcpServer.mockImplementation(
      () => new Promise<undefined>((r) => resolvers.push(() => r(undefined))),
    );

    const { result } = renderHook(() => useMcpServer());
    await flush(); // mount reconcile (enabled=false → returns before starting)

    act(() => result.current.toggle(true));
    act(() => result.current.toggle(false));
    act(() => result.current.toggle(true));
    await flush(); // chain runs: the first start and the stop are superseded → skipped

    // The stale stop never reached the backend; only the newest start ran.
    expect(stopMcpServer).not.toHaveBeenCalled();
    expect(startMcpServer).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvers.forEach((r) => r());
      await new Promise<void>((r) => setTimeout(r, 0));
    });
    expect(result.current.run.kind).toBe("running");
  });
});

describe("useMcpAvailability", () => {
  it("stamps the capability when it is still unknown (boot-ping recovery)", async () => {
    renderHook(() => useMcpAvailability());
    await act(() => Promise.resolve());
    expect(useLabelStore.getState().mcpSidecarAvailable).toBe(true);
    expect(mcpServerStatus).toHaveBeenCalledTimes(1);
  });

  it("does not re-ping when the capability is already known", async () => {
    useLabelStore.setState({ mcpSidecarAvailable: false });
    renderHook(() => useMcpAvailability());
    await act(() => Promise.resolve());
    expect(mcpServerStatus).not.toHaveBeenCalled();
    expect(useLabelStore.getState().mcpSidecarAvailable).toBe(false);
  });
});

describe("a start that fails after the status looked fine", () => {
  it("shows the error instead of leaving the tab on running", async () => {
    vi.mocked(mcpServerStatus).mockResolvedValue({ running: false, available: true });
    vi.mocked(startMcpServer).mockRejectedValueOnce(new Error("port in use"));
    useLabelStore.setState({ mcpServerEnabled: true });
    const { result } = renderHook(() => useMcpServer());
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
    expect(result.current.run.kind).toBe("error");
  });
});

describe("a stop that failed while the opt-in is off", () => {
  it("shows the error instead of a grey dot over a live child", async () => {
    // Masking the error as "stopped" unlocked the port and token controls
    // while the old child still served the old config.
    vi.mocked(stopMcpServer).mockRejectedValueOnce(new Error("ipc dead"));
    useLabelStore.setState({ mcpSidecarAvailable: true, mcpServerEnabled: true });
    const { result } = renderHook(() => useMcpServer());
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
    act(() => result.current.toggle(false));
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
    expect(result.current.run.kind).toBe("error");
  });
});

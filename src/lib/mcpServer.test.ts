import { describe, it, expect, vi } from "vitest";
import {
  announceWindow,
  attachAppToSidecar,
  detachAppFromSidecar,
  generateMcpToken,
  mcpConfigSnippet,
  postDraftReceipt,
  startMcpServer,
} from "./mcpServer";

const invoke = vi.hoisted(() =>
  vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(async () => undefined),
);
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("./platform", () => ({ isDesktopShell: true }));

describe("sidecar replies", () => {
  it("go through Rust, since a webview fetch dies on the CORS preflight", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await attachAppToSidecar();
    await postDraftReceipt({ id: 2, ok: true });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(invoke.mock.calls[0]?.[0]).toBe("mcp_reply");
    const attach = invoke.mock.calls[0]?.[1] as { route?: string; payload?: unknown } | undefined;
    expect(attach?.route).toBe("/app-attach");
    expect((attach?.payload as { session?: string })?.session).toMatch(/^[0-9a-f]{32}$/);
    expect(invoke.mock.calls[1]).toEqual([
      "mcp_reply",
      { route: "/draft-receipt", payload: { id: 2, ok: true } },
    ]);
  });
});

describe("a failed restart", () => {
  // mcp_start does not spawn on "already running on another port"; forgetting
  // the session there orphaned a live attach nothing could withdraw anymore.
  it("keeps the live attach session withdrawable", async () => {
    invoke.mockClear();
    const session = await attachAppToSidecar();
    invoke.mockRejectedValueOnce(new Error("already running on another port"));
    await expect(startMcpServer({ port: 9999, token: "t" })).rejects.toThrow();
    await detachAppFromSidecar();
    expect(invoke.mock.calls.at(-1)).toEqual([
      "mcp_reply",
      { route: "/app-detach", payload: { session } },
    ]);
  });
});

describe("restart and the attach session", () => {
  // mcp_start returns true only when it spawned a fresh child; the no-op path
  // (already running) leaves the live session the bridge still holds.
  it("keeps the session on an already-running no-op start", async () => {
    invoke.mockClear();
    const session = await attachAppToSidecar();
    invoke.mockResolvedValueOnce(false);
    await startMcpServer({ port: 1234, token: "t" });
    await detachAppFromSidecar();
    expect(invoke.mock.calls.at(-1)).toEqual([
      "mcp_reply",
      { route: "/app-detach", payload: { session } },
    ]);
  });

  it("forgets the session when a fresh child spawned", async () => {
    invoke.mockClear();
    await attachAppToSidecar();
    invoke.mockResolvedValueOnce(true);
    await startMcpServer({ port: 1234, token: "t" });
    await detachAppFromSidecar();
    const routes = invoke.mock.calls.map((c) => (c[1] as { route?: string } | undefined)?.route);
    expect(routes).not.toContain("/app-detach");
  });
});

describe("generateMcpToken", () => {
  it("returns 32 lowercase hex chars", () => {
    expect(generateMcpToken()).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is unlikely to collide", () => {
    expect(generateMcpToken()).not.toBe(generateMcpToken());
  });
});

describe("mcpConfigSnippet", () => {
  it("embeds the loopback url and bearer token", () => {
    const snippet = mcpConfigSnippet(4123, "deadbeef");
    const parsed = JSON.parse(snippet) as {
      mcpServers: { zplab: { url: string; headers: { Authorization: string } } };
    };
    expect(parsed.mcpServers.zplab.url).toBe("http://127.0.0.1:4123/");
    expect(parsed.mcpServers.zplab.headers.Authorization).toBe("Bearer deadbeef");
  });
});

describe("announceWindow without live bridge listeners", () => {
  it("declines to attach instead of advertising tools nobody answers", async () => {
    // The 5s fallback exists so a dead bridge cannot park the op chain; it
    // used to attach anyway, and every open_in_app then buffered against no
    // listener until its own timeout. A late bridge attaches itself instead.
    invoke.mockClear();
    vi.useFakeTimers();
    try {
      const announced = announceWindow();
      await vi.advanceTimersByTimeAsync(5001);
      await announced;
      expect(invoke).not.toHaveBeenCalledWith(
        "mcp_reply",
        expect.objectContaining({ route: "/app-attach" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

import { useEffect } from "react";
import {
  respondToDesignRequest,
  respondToOpenDraft,
  respondToRasterRequest,
} from "../lib/mcpBridge";
import {
  attachAppToSidecar,
  detachAppFromSidecar,
  markListenersReady,
  mcpServerStatus,
} from "../lib/mcpServer";
import { isDesktopShell } from "../lib/platform";

/** Register the sidecar listeners, then have Rust flush the events it
 *  queued while none existed (see event_buffer in mcp.rs). */
export function useMcpBridge(): void {
  useEffect(() => {
    if (!isDesktopShell) return;
    const unlisteners: (() => void)[] = [];
    let cancelled = false;
    // Captured per mount: a remount attaches under a new session, so this
    // teardown withdraws its own and never the one that replaced it.
    let attachedSession: string | null = null;
    void (async () => {
      const [{ listen }, { invoke }] = await Promise.all([
        import("@tauri-apps/api/event"),
        import("@tauri-apps/api/core"),
      ]);
      const fns = await Promise.all([
        listen<[number, string]>("mcp://open-draft", (e) => {
          void respondToOpenDraft(e.payload[0], e.payload[1]).catch(() => undefined);
        }),
        listen<number>("mcp://design-request", (e) => {
          void respondToDesignRequest(e.payload).catch(() => undefined);
        }),
        listen<string>("mcp://raster-request", (e) => {
          void respondToRasterRequest(e.payload).catch(() => undefined);
        }),
      ]);
      if (cancelled) {
        for (const fn of fns) fn();
        return;
      }
      unlisteners.push(...fns);
      await invoke("mcp_listeners_ready");
      markListenersReady();
      // Announce the window once the sidecar actually listens: a reload finds
      // it already up, while a boot start announces itself from main.tsx.
      const status = await mcpServerStatus();
      // Re-checked after every await: an unmount in that window already tore the
      // listeners down, so announcing now would offer tools nobody answers.
      if (cancelled) return;
      if (status.running) {
        attachedSession = await attachAppToSidecar();
        if (cancelled) {
          await detachAppFromSidecar(attachedSession).catch(() => undefined);
          attachedSession = null;
        }
      }
    })()
      // Non-actionable on failure; swallow like the boot-start in main.tsx.
      .catch(() => undefined);
    return () => {
      cancelled = true;
      // Withdraw before removing listeners (Rust emits straight to the webview
      // once listeners_ready ran); the session is shared, so a boot-made attach
      // is this teardown's to withdraw too.
      void detachAppFromSidecar(attachedSession ?? undefined)
        .catch(() => undefined)
        .finally(() => {
          for (const fn of unlisteners) fn();
        });
    };
  }, []);
}

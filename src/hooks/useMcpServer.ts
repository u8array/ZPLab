import { useEffect, useSyncExternalStore } from "react";
import { useCopyToClipboard } from "./useCopyToClipboard";
import { useLabelStore } from "../store/labelStore";
import { mcpConfigSnippet, mcpServerStatus } from "../lib/mcpServer";
import {
  getMcpRun,
  kickMcpLifecycle,
  subscribeMcpRun,
  type McpRunState,
} from "../lib/mcpLifecycle";

export type RunState = McpRunState;

/** Re-stamp the sidecar-capability fact while it is unknown. The boot ping
 *  (main.tsx) stamps it once; mounting this in the settings modal recovers the
 *  MCP tab without a restart if that ping never landed. */
export function useMcpAvailability(): void {
  const available = useLabelStore((s) => s.mcpSidecarAvailable);
  useEffect(() => {
    if (available !== null) return;
    let cancelled = false;
    void mcpServerStatus()
      .then((s) => {
        if (!cancelled) useLabelStore.getState().setMcpSidecarAvailable(s.available);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [available]);
}

export interface McpServerController {
  run: RunState;
  enabled: boolean;
  port: number;
  token: string;
  running: boolean;
  /** False while the keychain hydrate has not succeeded; Regenerate would
   *  overwrite a token the user cannot see. */
  tokenLoaded: boolean;
  toggle: (checked: boolean) => void;
  regenerate: () => void;
  setPort: (port: number) => void;
  copy: () => void;
  copied: boolean;
}

/** Settings-tab view onto the sidecar lifecycle driven by mcpLifecycle; this
 *  hook only reads the run state and forwards intent writes. */
export function useMcpServer(): McpServerController {
  const enabled = useLabelStore((s) => s.mcpServerEnabled);
  const port = useLabelStore((s) => s.mcpServerPort);
  const token = useLabelStore((s) => s.mcpServerToken);
  const setEnabled = useLabelStore((s) => s.setMcpServerEnabled);
  const setPortState = useLabelStore((s) => s.setMcpServerPort);
  const regenerate = useLabelStore((s) => s.regenerateMcpToken);
  const tokenLoaded = useLabelStore((s) => s.mcpServerTokenLoaded);
  const run = useSyncExternalStore(subscribeMcpRun, getMcpRun);

  // Tab open hydrates the stored token first (display and Regenerate must see
  // it, not mint over it; init's hydrate is once-latched and may have failed),
  // then re-attempts a failed start so the reason shows.
  useEffect(() => {
    void useLabelStore
      .getState()
      .hydrateMcpToken()
      .catch(() => undefined)
      .then(() => kickMcpLifecycle());
  }, []);

  // resetSettings can flip the opt-in off before the driver converges; derive
  // the shown state so a stale "running" can't outlive the toggle. The error
  // kind passes through (masking a failed stop would hide a still-listening child), so controls stay editable to fix it.
  const shownRun: RunState = enabled || run.kind === "error" ? run : { kind: "stopped" };
  const running = shownRun.kind === "running" || shownRun.kind === "starting";

  const { copy, copied } = useCopyToClipboard(() => mcpConfigSnippet(port, token));

  const toggle = (checked: boolean) => {
    setEnabled(checked);
    // Self-sufficient without the store follower, which only exists once
    // initMcpLifecycle ran.
    kickMcpLifecycle();
  };

  const setPort = (next: number) => {
    setPortState(Math.min(65535, Math.max(1024, next)));
    // Converge after any intent write: in the failed-stop error state a stale
    // child may still serve the old config, and the kick retries the stop.
    kickMcpLifecycle();
  };

  const regenerateAndKick = () => {
    regenerate();
    kickMcpLifecycle();
  };

  return {
    run: shownRun,
    enabled,
    port,
    token,
    tokenLoaded,
    running,
    toggle,
    regenerate: regenerateAndKick,
    setPort,
    copy,
    copied,
  };
}

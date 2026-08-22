import { useLabelStore } from "../store/labelStore";
import { errorMessage } from "./errorMessage";
import { announceWindow, startMcpServer, stopMcpServer } from "./mcpServer";

export type McpRunState =
  | { kind: "stopped" }
  | { kind: "starting" }
  | { kind: "running" }
  | { kind: "error"; message: string };

/** The one driver for the sidecar process: the opt-in is store state with more
 *  writers than the settings toggle (resetSettings, the persisted boot value), so
 *  writers change INTENT only and this module converges the process onto it. */

let run: McpRunState = { kind: "stopped" };
const listeners = new Set<() => void>();

export function getMcpRun(): McpRunState {
  return run;
}

export function subscribeMcpRun(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setRun(next: McpRunState): void {
  run = next;
  for (const l of listeners) l();
}

// Ops run serialized and only the newest does work. Superseded ops are safe to
// skip because every op re-derives the desired state from the store at run
// time, so the newest op converges to the same intent a skipped one carried.
let seq = 0;
let chain: Promise<void> = Promise.resolve();

/** Redundant kicks are no-ops, so callers never need to know whether another
 *  writer already asked. */
export function kickMcpLifecycle(): void {
  const mine = ++seq;
  const current = () => seq === mine;
  chain = chain.then(() => transition(current)).catch(() => undefined);
}

async function transition(current: () => boolean): Promise<void> {
  if (!current()) return;
  const store = useLabelStore.getState();
  if (!store.mcpServerEnabled) {
    if (run.kind === "stopped") return;
    try {
      await stopMcpServer();
      if (current()) setRun({ kind: "stopped" });
    } catch (e) {
      // Never claim "stopped" for a stop that failed: the skip above would
      // block every retry while the child keeps running behind the off toggle.
      if (current()) setRun({ kind: "error", message: errorMessage(e) });
    }
    return;
  }
  // No status pre-check: the Rust start_lock absorbs an in-flight boot start,
  // and starting an already-running child is a no-op that still re-attaches.
  const wanted = () => current() && useLabelStore.getState().mcpServerEnabled;
  setRun({ kind: "starting" });
  try {
    const token = await store.ensureMcpToken();
    // Re-derived after every await: the opt-in can flip while we hold no lock,
    // and a start past that point is a server behind an unchecked toggle.
    if (!wanted()) return;
    await startMcpServer({ port: useLabelStore.getState().mcpServerPort, token });
    if (!wanted()) return;
    await announceWindow();
    if (current()) setRun({ kind: "running" });
  } catch (e) {
    if (current()) setRun({ kind: "error", message: errorMessage(e) });
  }
}

let initialized = false;

/** Boot wiring: install the intent follower before the stored-token hydrate,
 *  so reset/toggle writes landing during boot still kick the driver; then
 *  hydrate for display/restart and converge once to the current intent. */
export async function initMcpLifecycle(): Promise<void> {
  if (initialized) return;
  initialized = true;
  useLabelStore.subscribe((s, prev) => {
    if (s.mcpServerEnabled !== prev.mcpServerEnabled) kickMcpLifecycle();
  });
  await useLabelStore
    .getState()
    .hydrateMcpToken()
    .catch(() => undefined);
  kickMcpLifecycle();
}

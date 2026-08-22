import { isDesktopShell } from "./platform";

/** Mirrors the Rust McpStatus DTO. `available` is the build capability: false
 *  in a release shipped without the bundled sidecar. */
export interface McpStatus {
  running: boolean;
  available: boolean;
  /** A start is in flight; `running` only turns true once the port is bound. */
  starting: boolean;
}

/** The attach in flight or landed, or null while unattached. Memoised as a
 *  promise: boot and remount can both attach, and a flag checked before an
 *  await would let them race and announce two sessions nobody could withdraw. */
let attachPromise: Promise<string> | null = null;
let sessionId: string | null = null;

/** 32 hex chars (16 random bytes) for the loopback server's bearer token. */
export function generateMcpToken(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Config snippet in the mcpServers JSON shape most MCP clients accept, for
 *  the loopback Streamable HTTP server. Root `/` is the URL: the transport
 *  answers on any path except the app's reply routes; every request needs the bearer token. */
export function mcpConfigSnippet(port: number, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        zplab: {
          url: `http://127.0.0.1:${port}/`,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

/** One POST per app route, routed through Rust: the sidecar's bearer gate 401s
 *  the CORS preflight a cross-origin fetch out of the webview would need. */
async function postToSidecar(route: string, payload?: unknown): Promise<void> {
  if (!isDesktopShell) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("mcp_reply", { route: `/${route}`, payload: payload ?? {} });
}

/** Resolves once the webview's sidecar listeners are up. Attaching earlier
 *  would offer the app tools while calls still land in Rust's event buffer. */
let markListenersReadyFn = (): void => undefined;
const listenersReadyPromise = new Promise<void>((resolve) => {
  markListenersReadyFn = resolve;
});
// Outside the desktop shell nothing registers listeners and nothing needs the
// attach, so an awaiting caller must not hang on a promise no one resolves.
if (!isDesktopShell) markListenersReadyFn();

export function markListenersReady(): void {
  markListenersReadyFn();
}

/** Callers await this inside a serial queue, so it must always settle: a
 *  bridge that never registered its listeners would otherwise park every later
 *  server operation, the user's Stop included; false means the wait timed out and no listener exists. */
const LISTENERS_READY_TIMEOUT_MS = 5000;

export function whenListenersReady(): Promise<boolean> {
  return Promise.race([
    listenersReadyPromise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), LISTENERS_READY_TIMEOUT_MS)),
  ]);
}

/** Announce this window to the sidecar: until it lands, the server keeps
 *  app-facing tools out of its list instead of accepting calls nobody answers.
 *  Idempotent: a repeat caller gets the live session; a fresh child starts unattached, so start/stop forget it. */
export function attachAppToSidecar(): Promise<string> {
  attachPromise ??= (async () => {
    const session = generateMcpToken();
    await postToSidecar("app-attach", { session });
    sessionId = session;
    return session;
  })().catch((e: unknown) => {
    // A failed POST announced nothing, so the next caller starts fresh.
    attachPromise = null;
    throw e;
  });
  return attachPromise;
}

/** Announce this window once its bridge listeners can answer a call: mcpLifecycle
 *  runs this after every start, whatever intent (boot, toggle) triggered it.
 *  An attach failure is not actionable there, so it is swallowed here. */
export async function announceWindow(): Promise<void> {
  // A window whose bridge never came up must not attach: the sidecar would
  // advertise app tools whose calls buffer against no listener until their
  // timeout. A late bridge attaches itself once its listeners register.
  if (!(await whenListenersReady())) return;
  await attachAppToSidecar().catch(() => undefined);
}

/** Withdraw the announcement: the sidecar drops its app tools rather than
 *  offering ones that would time out on a window that is no longer listening. */
export async function detachAppFromSidecar(session = sessionId): Promise<void> {
  if (session === null) return;
  if (session === sessionId) {
    sessionId = null;
    attachPromise = null;
  }
  await postToSidecar("app-detach", { session });
}

/** Confirm (or refuse) a pushed draft, so open_in_app can report the truth. */
export async function postDraftReceipt(receipt: {
  id: number;
  ok: boolean;
  error?: string;
  replacedObjects?: number;
}): Promise<void> {
  await postToSidecar("draft-receipt", receipt);
}

/** Answer a raster request with the encoded graphic (or the reason it failed). */
export async function postRasterResponse(response: {
  id: number;
  ok: boolean;
  error?: string;
  gfa?: string;
  widthDots?: number;
  heightDots?: number;
}): Promise<void> {
  await postToSidecar("raster-response", response);
}

export async function postDesignResponse(body: {
  id: number;
  designFile: unknown;
  measured: Record<string, unknown>;
}): Promise<void> {
  await postToSidecar("design-response", body);
}

export async function startMcpServer(opts: { port: number; token: string }): Promise<void> {
  if (!isDesktopShell) throw new Error("The MCP server requires the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  // `true` = a fresh child was spawned; `false` = already running (no-op). Only
  // a fresh spawn starts unattached, so only then does the window forget its
  // session; forgetting it on the no-op path would orphan a live attach nothing could withdraw.
  const spawned = await invoke<boolean>("mcp_start", { port: opts.port, token: opts.token });
  if (spawned) {
    sessionId = null;
    attachPromise = null;
  }
}

export async function stopMcpServer(): Promise<void> {
  if (!isDesktopShell) return;
  const { invoke } = await import("@tauri-apps/api/core");
  sessionId = null;
  attachPromise = null;
  await invoke("mcp_stop");
}

export async function mcpServerStatus(): Promise<McpStatus> {
  if (!isDesktopShell) return { running: false, available: false, starting: false };
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<McpStatus>("mcp_status");
}

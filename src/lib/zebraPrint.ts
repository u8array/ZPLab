import { isDesktopShell } from "./platform";

const BROWSER_PRINT_HTTP = "http://localhost:9100";
const BROWSER_PRINT_HTTPS = "https://localhost:9101";

export interface BrowserPrintDevice {
  uid: string;
  connection: string;
  device_type: string;
  manufacturer: string;
  name: string;
  version: number;
}

async function bpFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${BROWSER_PRINT_HTTP}${path}`, init);
  } catch {
    return fetch(`${BROWSER_PRINT_HTTPS}${path}`, init);
  }
}

export async function discoverBrowserPrintDevices(): Promise<BrowserPrintDevice[]> {
  const res = await bpFetch("/available");
  if (!res.ok) throw new Error(`Agent returned ${res.status}`);
  const data: unknown = await res.json();
  const devices = Array.isArray(data)
    ? data
    : (data as Record<string, unknown> | null)?.printer;
  if (!Array.isArray(devices)) return [];
  return devices as BrowserPrintDevice[];
}

export async function sendViaBrowserPrint(
  device: BrowserPrintDevice,
  zpl: string,
): Promise<void> {
  const res = await bpFetch("/write", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device, data: zpl }),
  });
  if (!res.ok) throw new Error(`Agent write failed: ${res.status}`);
}

export function isConnectionRefused(e: unknown): boolean {
  return e instanceof TypeError && /refused/i.test(e.message);
}

/** sent = desktop raw TCP, write confirmed; unreachable = desktop TCP could not
 *  complete (connect/write timeout, no route); no_response = web timeout, which
 *  fetch cannot tell from raw-socket success (so it stays a soft success);
 *  refused = TCP RST; responded = HTTP came back; error = desktop shell rejected
 *  (write broke mid-payload, bad arg). Each kind carries its own meaning so the
 *  UI never needs to know which transport ran. */
export type NetworkPrintResult =
  | { kind: "sent" }
  | { kind: "unreachable" }
  | { kind: "responded"; status: number }
  | { kind: "no_response" }
  | { kind: "refused" }
  | { kind: "error" };

/** Browser transport: HTTP POST at a raw TCP port. The ZPL parser skips the
 *  header bytes, so it prints, but success stays indistinguishable from an
 *  unreachable host. */
async function sendViaNetworkWeb(
  ip: string,
  port: number,
  zpl: string,
): Promise<NetworkPrintResult> {
  try {
    const res = await fetch(`http://${ip}:${port}`, {
      method: "POST",
      body: zpl,
      headers: { "Content-Type": "text/plain" },
      signal: AbortSignal.timeout(4000),
    });
    return { kind: "responded", status: res.status };
  } catch (e) {
    if (isConnectionRefused(e)) return { kind: "refused" };
    return { kind: "no_response" };
  }
}

/** Desktop transport: real raw TCP in the shell, exact connect/write outcome. */
async function sendViaNetworkTcp(
  ip: string,
  port: number,
  zpl: string,
): Promise<NetworkPrintResult> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<NetworkPrintResult>("send_zpl_tcp", { host: ip, port, zpl });
  } catch {
    return { kind: "error" };
  }
}

export const sendViaNetwork = isDesktopShell ? sendViaNetworkTcp : sendViaNetworkWeb;

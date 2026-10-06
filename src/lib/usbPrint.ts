import { isDesktopShell } from "./platform";
import { errorMessage } from "./errorMessage";

/** Mirrors the Rust UsbPrinter DTO (one USB printer). */
export interface UsbPrinter {
  id: string;
  name: string;
  vendor_id: string;
}

/** The invoke-rejection member shared by the USB result unions. */
interface UsbError {
  kind: "error";
  message: string;
}

export type UsbPrintResult =
  | { kind: "sent" }
  | { kind: "permission_denied" }
  | { kind: "not_found" }
  | UsbError;

/** Mirrors the Rust UsbQueryResult; `error` covers the invoke rejection. */
export type UsbQueryResult =
  | { kind: "data"; body: string }
  | { kind: "permission_denied" }
  | { kind: "not_found" }
  | UsbError;

/** Hint only for sorting/labels: the Zebra USB vendor id. */
export function isLikelyZebra(p: UsbPrinter): boolean {
  return p.vendor_id.toLowerCase() === "0a5f";
}

/** Desktop shell only (web and Windows return nothing). */
export async function listUsbPrinters(): Promise<UsbPrinter[]> {
  if (!isDesktopShell) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<UsbPrinter[]>("list_usb_printers");
}

/** Desktop guard + lazy Tauri import; a rejection folds into the union's
 *  `error` member. */
async function invokeUsbCommand<R>(
  cmd: string,
  args: Record<string, unknown>,
): Promise<R | UsbError> {
  if (!isDesktopShell) return { kind: "error", message: "USB printing requires the desktop app" };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<R>(cmd, args);
  } catch (e) {
    return { kind: "error", message: errorMessage(e) };
  }
}

export function sendZplUsb(id: string, zpl: string): Promise<UsbPrintResult> {
  return invokeUsbCommand<UsbPrintResult>("send_zpl_usb", { device: id, zpl });
}

/** Send ZPL and read the printer's reply. Desktop transports only. */
export function queryZplUsb(id: string, zpl: string): Promise<UsbQueryResult> {
  return invokeUsbCommand<UsbQueryResult>("query_zpl_usb", { device: id, zpl });
}

export async function setupUsbAccess(): Promise<void> {
  if (!isDesktopShell) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("setup_usb_access");
}

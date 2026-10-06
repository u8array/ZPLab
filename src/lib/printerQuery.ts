import { errorMessage } from "./errorMessage";
import { isDesktopShell } from "./platform";
import type { QueryTarget } from "./printTarget";
import { queryZplUsb } from "./usbPrint";

export type PrinterQueryFailure =
  | { kind: "unconfigured" }
  | { kind: "refused"; port: number }
  | { kind: "unreachable" }
  | { kind: "not_found" }
  | { kind: "permission_denied" }
  | { kind: "error"; message: string };

export type PrinterOutcome<T> = { kind: "ok"; value: T } | PrinterQueryFailure;

/** Mirrors the Rust TcpQueryResult. */
interface TcpQueryResult {
  kind: "data" | "refused" | "unreachable";
  body?: string;
}

/** The wording for the preview path, which keeps its errors as plain text. */
export function printerFailureMessage(failure: PrinterQueryFailure): string {
  switch (failure.kind) {
    case "unconfigured":
      return "No printer configured. Set a USB device or IP under Settings, Printer.";
    case "refused":
      return `The printer refused the connection. Check that port ${failure.port} is open.`;
    case "unreachable":
      return "Could not reach the printer. Check the IP address and network.";
    case "not_found":
      return "USB printer not found. Re-plug it and check Settings, Printer.";
    case "permission_denied":
      return "No access to the USB printer. Grant it in the print dialog, USB tab.";
    case "error":
      return failure.message;
  }
}

/** Every failure comes back as a value, never as a throw. */
export async function queryPrinter(target: QueryTarget, zpl: string): Promise<PrinterOutcome<string>> {
  if (!isDesktopShell) return { kind: "error", message: "The printer query requires the desktop app" };
  if (target.kind === "usb") {
    const res = await queryZplUsb(target.id, zpl);
    return res.kind === "data" ? { kind: "ok", value: res.body } : res;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const res = await invoke<TcpQueryResult>("query_zpl_tcp", {
      host: target.host,
      port: target.port,
      zpl,
    });
    if (res.kind === "refused") return { kind: "refused", port: target.port };
    if (res.kind === "unreachable") return { kind: "unreachable" };
    return { kind: "ok", value: res.body ?? "" };
  } catch (e) {
    return { kind: "error", message: errorMessage(e) };
  }
}

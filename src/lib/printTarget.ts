import type { PreviewProvider } from "../store/slices/uiSlice";

export type PrintTransport = "network" | "browserprint" | "local" | "usb";

/** A way out of the output dialog. The system dialog hands a rendered label to the operating system, so it
 *  binds no device and answers nothing. */
export type PrintWay = PrintTransport | "system";

export type QueryTarget =
  | { kind: "network"; host: string; port: number }
  | { kind: "usb"; id: string };

/** Names the device, so a cached render or a read state is dropped when the target changes. */
export const queryTargetKey = (target: QueryTarget): string => (target.kind === "usb" ? `usb:${target.id}` : `net:${target.host}:${target.port}`);

/** Where labels go: the way to send and the device bound per way. A printer query uses the same way when
 *  it is bidirectional and the network address otherwise. */
export interface PrintTarget {
  transport: PrintTransport;
  host: string;
  port: number;
  usbId: string;
  browserPrintUid: string;
  localPrinter: string;
}

export const DEFAULT_PRINT_PORT = 9100;

export const DEFAULT_PRINT_TARGET: PrintTarget = {
  transport: "network",
  host: "",
  port: DEFAULT_PRINT_PORT,
  usbId: "",
  browserPrintUid: "",
  localPrinter: "",
};

/** A raw port, or null when it is not a TCP port. */
export function parsePort(value: string | number): number | null {
  const text = String(value).trim();
  const port = Number(text);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

/** The ways a build offers, a device way only while its list has something to offer. */
export function offeredTransports(desktop: boolean, present: { local: boolean; usb: boolean }): PrintTransport[] {
  return [
    "network",
    ...(desktop ? [] : ["browserprint" as const]),
    ...(desktop && present.local ? ["local" as const] : []),
    ...(desktop && present.usb ? ["usb" as const] : []),
  ];
}

/** The ways the output dialog offers. Only a label that can be drawn gates the system dialog. */
export function offeredWays(desktop: boolean, present: { local: boolean; usb: boolean }, renderable: boolean): PrintWay[] {
  return [...offeredTransports(desktop, present), ...(renderable ? ["system" as const] : [])];
}

/** The ways a status read blocks, plus the system dialog while the printer itself renders. */
export function needsRawChannel(way: PrintWay, renderer: PreviewProvider): boolean {
  return way === "network" || way === "usb" || (way === "system" && renderer === "printer");
}

/** The stored way when the build offers it, else the network form, without rewriting the choice. */
export function effectiveTransport(transport: PrintTransport, offered: readonly PrintWay[]): PrintTransport {
  return offered.includes(transport) ? transport : "network";
}

const LEGACY_KEYS = {
  host: "zebra_print_ip",
  port: "zebra_print_port",
  usbId: "zebra_print_usb",
  previewTransport: "zebra_preview_transport",
  browserPrintUid: "zebra_print_uid",
  localPrinter: "zebra_print_local",
} as const;

/** The target releases before 0.7.0 kept in loose browser keys, taken over once and cleared. The old preview
 *  channel was the only stored preference for a way, so USB there becomes the USB way. */
export function readLegacyPrintTarget(storage: Pick<Storage, "getItem" | "removeItem"> = localStorage): PrintTarget {
  const read = (key: string): string => storage.getItem(key) ?? "";
  const usbId = read(LEGACY_KEYS.usbId);
  const target: PrintTarget = {
    transport: usbId && read(LEGACY_KEYS.previewTransport) === "usb" ? "usb" : "network",
    host: read(LEGACY_KEYS.host).trim(),
    port: parsePort(read(LEGACY_KEYS.port)) ?? DEFAULT_PRINT_PORT,
    usbId,
    browserPrintUid: read(LEGACY_KEYS.browserPrintUid),
    localPrinter: read(LEGACY_KEYS.localPrinter),
  };
  for (const key of Object.values(LEGACY_KEYS)) storage.removeItem(key);
  return target;
}

/** The channel for `transport`, default the stored way. A USB way without a device falls through to the network, so a re-plug restores it. */
export function resolveQueryTarget(target: PrintTarget, transport: PrintTransport = target.transport): { target: QueryTarget } | { failure: { kind: "unconfigured" } } {
  if (transport === "usb" && target.usbId) return { target: { kind: "usb", id: target.usbId } };
  return target.host ? { target: { kind: "network", host: target.host, port: target.port } } : { failure: { kind: "unconfigured" } };
}

/** An unconfigured target has no device, so its failure files under the empty key. */
export function queryKeyFor(target: PrintTarget, transport?: PrintTransport): string {
  const resolved = resolveQueryTarget(target, transport);
  return "failure" in resolved ? "" : queryTargetKey(resolved.target);
}

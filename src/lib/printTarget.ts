import type { PreviewProvider } from "../store/slices/uiSlice";

export type PrintTransport = "network" | "browserprint" | "local" | "usb" | "server";

/** A way out of the output dialog. The system dialog hands a rendered label to the operating system, so it
 *  binds no device and answers nothing. */
export type PrintWay = PrintTransport | "system";

export type QueryTarget =
  | { kind: "network"; host: string; port: number }
  | { kind: "usb"; id: string }
  | { kind: "server"; id: string };

/** Names the device, so a cached render or a read state is dropped when the target changes. */
export const queryTargetKey = (target: QueryTarget): string => (target.kind === "network" ? `net:${target.host}:${target.port}` : `${target.kind}:${target.id}`);

/** Where labels go: the way to send and the device bound per way. A printer query uses the same way when
 *  it is bidirectional and the network address otherwise. */
export interface PrintTarget {
  transport: PrintTransport;
  host: string;
  port: number;
  usbId: string;
  browserPrintUid: string;
  localPrinter: string;
  serverPrinter: string;
}

/** What the build reaches a printer through: the raw channels of the desktop shell or the ZPLab server. */
export interface PrintReach {
  desktop: boolean;
  server: boolean;
}

export const DEFAULT_PRINT_PORT = 9100;

export const DEFAULT_PRINT_TARGET: PrintTarget = {
  transport: "network",
  host: "",
  port: DEFAULT_PRINT_PORT,
  usbId: "",
  browserPrintUid: "",
  localPrinter: "",
  serverPrinter: "",
};

/** A raw port, or null when it is not a TCP port. */
export function parsePort(value: string | number): number | null {
  const text = String(value).trim();
  const port = Number(text);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

interface DevicesPresent {
  local: boolean;
  usb: boolean;
  server: boolean;
}

/** The ways a build can ever offer, in the order they are listed. */
export function reachableTransports(reach: PrintReach): PrintTransport[] {
  return ["network", ...(reach.desktop ? (["local", "usb"] as const) : (["browserprint"] as const)), ...(reach.server ? (["server"] as const) : [])];
}

/** The ways a build offers, a device way only while its list has something to offer. */
export function offeredTransports(reach: PrintReach, present: DevicesPresent): PrintTransport[] {
  return reachableTransports(reach).filter((way) => way === "network" || way === "browserprint" || present[way]);
}

/** The ways the output dialog offers. Only a label that can be drawn gates the system dialog. */
export function offeredWays(reach: PrintReach, present: DevicesPresent, renderable: boolean): PrintWay[] {
  return [...offeredTransports(reach, present), ...(renderable ? ["system" as const] : [])];
}

/** The ways a status read blocks, plus the system dialog while the printer itself renders. */
export function needsRawChannel(way: PrintWay, renderer: PreviewProvider): boolean {
  return way === "network" || way === "usb" || way === "server" || (way === "system" && renderer === "printer");
}

/** An answer comes back over the desktop network and USB ways or through the server. */
export function carriesReply(way: PrintWay, reach: PrintReach): boolean {
  return way === "server" ? reach.server : reach.desktop && (way === "network" || way === "usb");
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
    serverPrinter: "",
  };
  for (const key of Object.values(LEGACY_KEYS)) storage.removeItem(key);
  return target;
}

/** The channel a query for `transport` takes, the stored way by default. A USB way without a device falls through to the network, so a re-plug restores it. */
export function queryChannel(target: PrintTarget, transport: PrintTransport = target.transport): QueryTarget["kind"] {
  if (transport === "server") return "server";
  return transport === "usb" && target.usbId ? "usb" : "network";
}

/** Whether the build reads what the printer behind `transport` answers. */
export function readsPrinter(target: PrintTarget, reach: PrintReach, transport?: PrintTransport): boolean {
  return carriesReply(queryChannel(target, transport), reach);
}

/** The device a query for `transport` reaches, or the failure when its channel has none set. */
export function resolveQueryTarget(target: PrintTarget, transport?: PrintTransport): { target: QueryTarget } | { failure: { kind: "unconfigured" } } {
  const channel = queryChannel(target, transport);
  if (channel === "usb") return { target: { kind: "usb", id: target.usbId } };
  if (channel === "server") return target.serverPrinter ? { target: { kind: "server", id: target.serverPrinter } } : { failure: { kind: "unconfigured" } };
  return target.host ? { target: { kind: "network", host: target.host, port: target.port } } : { failure: { kind: "unconfigured" } };
}

/** An unconfigured target has no device, so its failure files under the empty key. */
export function queryKeyFor(target: PrintTarget, transport?: PrintTransport): string {
  const resolved = resolveQueryTarget(target, transport);
  return "failure" in resolved ? "" : queryTargetKey(resolved.target);
}

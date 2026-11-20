import { useState, useEffect } from "react";
import { listUsbPrinters, isLikelyZebra as isUsbZebra, type UsbPrinter } from "../lib/usbPrint";
import { listLocalPrinters, isLikelyZebra as isLocalZebra, type LocalPrinter } from "../lib/localPrint";
import { discoverBrowserPrintDevices, type BrowserPrintDevice } from "../lib/zebraPrint";
import { listServerPrinters, type ServerFailure, type ServerPrinter } from "../lib/serverPrint";
import { printerOptionLabel } from "../lib/printerLabel";
import { errorMessage } from "../lib/errorMessage";
import { useLabelStore } from "../store/labelStore";
import type { Translations } from "../locales";

type DeviceField = "usbId" | "localPrinter" | "browserPrintUid" | "serverPrinter";

type Listed<D, E> = { devices: D[] } | { error: E };

interface DeviceKind<D, E = string> {
  list: () => Promise<Listed<D, E>>;
  idOf: (device: D) => string;
  labelOf: (device: D) => string;
  field: DeviceField;
}

export interface DeviceListState<D = unknown, E = string> {
  devices: D[];
  options: { value: string; label: string }[];
  /** True while the way stays worth offering: loading, at least one device, or a failed enumeration whose error
   *  only the way's picker can show. */
  present: boolean;
  selectedId: string;
  select: (id: string) => void;
  loading: boolean;
  error: E | null;
  refresh: () => Promise<void>;
}

/** A rejected enumeration reads as its message. */
const listed =
  <D>(list: () => Promise<D[]>) =>
  (): Promise<Listed<D, string>> =>
    list().then(
      (devices) => ({ devices }),
      (e: unknown) => ({ error: errorMessage(e) }),
    );

/** Lists the devices and moves a binding the list does not hold to the first device, so the picker and the
 *  send agree. Binding here and not in an effect on the bound id keeps two mounted lists from trading writes. */
async function enumerate<D, E>({ list, idOf, field }: DeviceKind<D, E>): Promise<Listed<D, E>> {
  const res = await list();
  if ("error" in res) return res;
  const first = res.devices[0];
  if (first !== undefined && !res.devices.some((d) => idOf(d) === useLabelStore.getState().printTarget[field])) {
    useLabelStore.getState().setPrintTarget({ [field]: idOf(first) });
  }
  return res;
}

interface Loaded<D, E> {
  devices: D[];
  loading: boolean;
  error: E | null;
}

/** A failed list keeps the devices of the list before it. */
const settled =
  <D, E>(res: Listed<D, E>) =>
  (before: Loaded<D, E>): Loaded<D, E> =>
    "error" in res ? { ...before, loading: false, error: res.error } : { devices: res.devices, loading: false, error: null };

/** One device list bound to a field of the print target, shared by the send dialog and the printer settings so
 *  both enumerate the same way and agree on the device. Errors surface in `error` rather than throwing. */
function useBoundDevices<D, E>(enabled: boolean, kind: DeviceKind<D, E>): DeviceListState<D, E> {
  const { idOf, labelOf, field } = kind;
  const [{ devices, loading, error }, setLoaded] = useState<Loaded<D, E>>({ devices: [], loading: enabled, error: null });
  const bound = useLabelStore((s) => s.printTarget[field]);
  const setPrintTarget = useLabelStore((s) => s.setPrintTarget);

  useEffect(() => {
    if (!enabled) return;
    // The active flag drops a stale load's writes if the component unmounts mid-load.
    let active = true;
    void enumerate(kind).then((res) => {
      if (active) setLoaded(settled(res));
    });
    return () => {
      active = false;
    };
  }, [enabled, kind]);

  const refresh = async (): Promise<void> => {
    setLoaded((before) => ({ ...before, loading: true }));
    setLoaded(settled(await enumerate(kind)));
  };

  return {
    devices,
    options: devices.map((d) => ({ value: idOf(d), label: labelOf(d) })),
    present: loading || devices.length > 0 || error !== null,
    selectedId: bound,
    select: (id) => setPrintTarget({ [field]: id }),
    loading,
    error,
    refresh,
  };
}

/** The picker's rows, with the one placeholder row an empty list shows. */
export function pickerOptions(t: Translations, list: Pick<DeviceListState, "options" | "loading">): { value: string; label: string }[] {
  return list.options.length === 0 ? [{ value: "", label: list.loading ? t.zebraPrint.discovering : t.zebraPrint.noPrinters }] : list.options;
}

const USB: DeviceKind<UsbPrinter> = { list: listed(listUsbPrinters), idOf: (p) => p.id, labelOf: (p) => printerOptionLabel(p.name, isUsbZebra(p)), field: "usbId" };
const LOCAL: DeviceKind<LocalPrinter> = { list: listed(listLocalPrinters), idOf: (p) => p.system_name, labelOf: (p) => printerOptionLabel(p.name, isLocalZebra(p)), field: "localPrinter" };
const BROWSER_PRINT: DeviceKind<BrowserPrintDevice> = { list: listed(discoverBrowserPrintDevices), idOf: (d) => d.uid, labelOf: (d) => d.name || d.manufacturer || d.uid, field: "browserPrintUid" };
const SERVER: DeviceKind<ServerPrinter, ServerFailure> = {
  list: () => listServerPrinters().then((res) => (res.kind === "ok" ? { devices: res.printers } : { error: res })),
  idOf: (p) => p.id,
  labelOf: (p) => p.name,
  field: "serverPrinter",
};

export const useUsbPrinters = (enabled: boolean): DeviceListState<UsbPrinter> => useBoundDevices(enabled, USB);

export const useLocalPrinters = (enabled: boolean): DeviceListState<LocalPrinter> => useBoundDevices(enabled, LOCAL);

export const useServerPrinters = (enabled: boolean): DeviceListState<ServerPrinter, ServerFailure> => useBoundDevices(enabled, SERVER);

/** Discovery asks the Browser Print agent, so it runs on request only. */
export const useBrowserPrintDevices = (): DeviceListState<BrowserPrintDevice> => useBoundDevices(false, BROWSER_PRINT);

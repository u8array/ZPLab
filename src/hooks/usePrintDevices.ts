import { useState, useEffect } from "react";
import { listUsbPrinters, isLikelyZebra as isUsbZebra, type UsbPrinter } from "../lib/usbPrint";
import { listLocalPrinters, isLikelyZebra as isLocalZebra, type LocalPrinter } from "../lib/localPrint";
import { discoverBrowserPrintDevices, type BrowserPrintDevice } from "../lib/zebraPrint";
import { printerOptionLabel } from "../lib/printerLabel";
import { errorMessage } from "../lib/errorMessage";
import { useLabelStore } from "../store/labelStore";
import type { Translations } from "../locales";

type DeviceField = "usbId" | "localPrinter" | "browserPrintUid";

interface DeviceKind<D> {
  list: () => Promise<D[]>;
  idOf: (device: D) => string;
  labelOf: (device: D) => string;
  field: DeviceField;
}

export interface DeviceListState<D = unknown> {
  devices: D[];
  options: { value: string; label: string }[];
  /** True while the way stays worth offering: loading, at least one device, or a failed enumeration whose error
   *  only the way's picker can show. */
  present: boolean;
  selectedId: string;
  select: (id: string) => void;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/** Lists the devices and moves a binding the list does not hold to the first device, so the picker and the
 *  send agree. Binding here and not in an effect on the bound id keeps two mounted lists from trading writes. */
async function enumerate<D>({ list, idOf, field }: DeviceKind<D>): Promise<D[]> {
  const devices = await list();
  const first = devices[0];
  if (first !== undefined && !devices.some((d) => idOf(d) === useLabelStore.getState().printTarget[field])) {
    useLabelStore.getState().setPrintTarget({ [field]: idOf(first) });
  }
  return devices;
}

/** One device list bound to a field of the print target, shared by the send dialog and the printer settings so
 *  both enumerate the same way and agree on the device. Errors surface in `error` rather than throwing. */
function useBoundDevices<D>(enabled: boolean, kind: DeviceKind<D>): DeviceListState<D> {
  const { idOf, labelOf, field } = kind;
  const [devices, setDevices] = useState<D[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const bound = useLabelStore((s) => s.printTarget[field]);
  const setPrintTarget = useLabelStore((s) => s.setPrintTarget);

  useEffect(() => {
    if (!enabled) return;
    // The active flag drops a stale load's writes if the component unmounts mid-load.
    let active = true;
    enumerate(kind)
      .then((d) => {
        if (!active) return;
        setDevices(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (active) setError(errorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [enabled, kind]);

  const refresh = (): Promise<void> => {
    setLoading(true);
    return enumerate(kind)
      .then((d) => {
        setDevices(d);
        setError(null);
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
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
export function pickerOptions(t: Translations, list: DeviceListState): { value: string; label: string }[] {
  return list.options.length === 0 ? [{ value: "", label: list.loading ? t.zebraPrint.discovering : t.zebraPrint.noPrinters }] : list.options;
}

const USB: DeviceKind<UsbPrinter> = { list: listUsbPrinters, idOf: (p) => p.id, labelOf: (p) => printerOptionLabel(p.name, isUsbZebra(p)), field: "usbId" };
const LOCAL: DeviceKind<LocalPrinter> = { list: listLocalPrinters, idOf: (p) => p.system_name, labelOf: (p) => printerOptionLabel(p.name, isLocalZebra(p)), field: "localPrinter" };
const BROWSER_PRINT: DeviceKind<BrowserPrintDevice> = { list: discoverBrowserPrintDevices, idOf: (d) => d.uid, labelOf: (d) => d.name || d.manufacturer || d.uid, field: "browserPrintUid" };

export const useUsbPrinters = (enabled: boolean): DeviceListState<UsbPrinter> => useBoundDevices(enabled, USB);

export const useLocalPrinters = (enabled: boolean): DeviceListState<LocalPrinter> => useBoundDevices(enabled, LOCAL);

/** Discovery asks the Browser Print agent, so it runs on request only. */
export const useBrowserPrintDevices = (): DeviceListState<BrowserPrintDevice> => useBoundDevices(false, BROWSER_PRINT);

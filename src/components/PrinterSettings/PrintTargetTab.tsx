import { useT } from "../../hooks/useT";
import { useLabelStore } from "../../store/labelStore";
import { isDesktopShell } from "../../lib/platform";
import { effectiveTransport, offeredTransports, type PrintTransport } from "../../lib/printTarget";
import { wayHint } from "../../lib/printWayText";
import { pickerOptions, useBrowserPrintDevices, useLocalPrinters, useUsbPrinters, type DeviceListState } from "../../hooks/usePrintDevices";
import { buttonCls, sectionHeadingCls } from "../ui/formStyles";
import { RadioOption } from "../ui/RadioOption";
import { Select } from "../ui/Select";
import { PrinterAddressFields } from "./PrinterAddressFields";

function DevicePicker({ list, error }: { list: DeviceListState; error: string | null }) {
  const t = useT();
  return (
    <section className="flex flex-col gap-2">
      <h3 className={sectionHeadingCls}>{t.zebraPrint.printer}</h3>
      <div className="max-w-md">
        <Select<string> value={list.selectedId} onChange={list.select} disabled={list.options.length === 0} groups={[{ options: pickerOptions(t, list) }]} />
      </div>
      {error && <span className="text-[10px] font-mono text-error">{error}</span>}
    </section>
  );
}

/** The print target: which way sends labels, the device bound per way and the address the preview needs. */
export function PrintTargetTab() {
  const t = useT();
  const loc = t.printerSettings.printTarget;
  const transport = useLabelStore((s) => s.printTarget.transport);
  const setPrintTarget = useLabelStore((s) => s.setPrintTarget);
  const usb = useUsbPrinters(isDesktopShell);
  const local = useLocalPrinters(isDesktopShell);
  const bp = useBrowserPrintDevices();
  const offered = offeredTransports(isDesktopShell, { local: local.present, usb: usb.present });
  const way = effectiveTransport(transport, offered);

  // A device way without devices stays visible, and then its reason replaces the description.
  const deviceWayHint = (value: PrintTransport) => (offered.includes(value) ? undefined : t.zebraPrint.noPrinters);
  const ways: { value: PrintTransport; label: string; desktopOnly?: boolean }[] = [
    { value: "network", label: t.zebraPrint.tabNetwork },
    { value: "browserprint", label: t.zebraPrint.tabBrowserPrint },
    { value: "local", label: t.zebraPrint.tabLocal, desktopOnly: true },
    { value: "usb", label: t.zebraPrint.tabUsb, desktopOnly: true },
  ];

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h3 className={sectionHeadingCls}>{loc.transportHeading}</h3>
        {ways
          .filter((w) => offered.includes(w.value) || (w.desktopOnly && isDesktopShell))
          .map((w) => (
            <RadioOption
              key={w.value}
              name="print-transport"
              value={w.value}
              current={way}
              onSelect={(next) => setPrintTarget({ transport: next })}
              label={w.label}
              hint={deviceWayHint(w.value) ?? wayHint(t.zebraPrint, w.value, isDesktopShell)}
              disabled={!offered.includes(w.value)}
            />
          ))}
        <span className="text-[10px] text-muted max-w-md">{loc.hint}</span>
      </section>

      {way === "browserprint" && (
        <>
          <DevicePicker list={bp} error={bp.error && t.zebraPrint.agentNotFound} />
          <button type="button" className={`${buttonCls} self-start`} disabled={bp.loading} onClick={() => void bp.refresh()}>
            {bp.loading ? t.zebraPrint.discovering : t.zebraPrint.discover}
          </button>
        </>
      )}
      {way === "local" && <DevicePicker list={local} error={local.error} />}
      {way === "usb" && <DevicePicker list={usb} error={usb.error} />}

      <section className="flex flex-col gap-2">
        <h3 className={sectionHeadingCls}>{loc.addressHeading}</h3>
        <PrinterAddressFields />
        <span className="text-[10px] text-muted max-w-md">{loc.addressHint}</span>
      </section>
    </div>
  );
}

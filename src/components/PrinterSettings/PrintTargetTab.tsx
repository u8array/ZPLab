import { useId, useState } from "react";
import type { SgdSetting } from "@zplab/core/lib/sgd";
import { useReplyRead } from "../../hooks/useReplyRead";
import { useT } from "../../hooks/useT";
import { useLabelStore, selectReadsPrinter } from "../../store/labelStore";
import { printReach } from "../../lib/printReach";
import { effectiveTransport, offeredTransports, reachableTransports, type PrintTransport } from "../../lib/printTarget";
import { failureText } from "../../lib/printerStatusText";
import { wayHint, wayLabel } from "../../lib/printWayText";
import { saveServerToken } from "../../lib/serverPrint";
import { pickerOptions, useBrowserPrintDevices, useLocalPrinters, useServerPrinters, useUsbPrinters, type DeviceListState } from "../../hooks/usePrintDevices";
import { AdoptSettingsDialog } from "../Output/AdoptSettingsDialog";
import { buttonCls, inputCls, labelCls, sectionHeadingCls } from "../ui/formStyles";
import { RadioOption } from "../ui/RadioOption";
import { Select } from "../ui/Select";
import { PrinterAddressFields } from "./PrinterAddressFields";

function DevicePicker({ list, error }: { list: Pick<DeviceListState, "options" | "loading" | "selectedId" | "select">; error: string | null }) {
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

/** The field holds only the draft, so a save empties it again. */
function ServerTokenField({ onSaved }: { onSaved: () => void }) {
  const loc = useT().printerSettings.printTarget;
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const id = useId();
  const save = async () => {
    setFailed(false);
    setSaving(true);
    const saved = await saveServerToken(draft).then(
      () => true,
      () => false,
    );
    setSaving(false);
    if (!saved) return setFailed(true);
    setDraft("");
    onSaved();
  };

  return (
    <div className="flex flex-col gap-1 max-w-md">
      <label htmlFor={id} className={labelCls}>
        {loc.serverToken}
      </label>
      <div className="flex gap-2">
        <input id={id} type="password" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={saving} autoComplete="off" className={`${inputCls} flex-1`} />
        <button type="button" className={`${buttonCls} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface-2`} disabled={!draft.trim() || saving} onClick={() => void save()}>
          {loc.serverTokenSave}
        </button>
      </div>
      <span className="text-[10px] text-muted">{loc.serverTokenHint}</span>
      {failed && <span className="text-[10px] font-mono text-error">{loc.serverTokenSaveError}</span>}
    </div>
  );
}

/** The print target: which way sends labels, the device bound per way and the address the preview needs. */
export function PrintTargetTab() {
  const t = useT();
  const loc = t.printerSettings.printTarget;
  const transport = useLabelStore((s) => s.printTarget.transport);
  const setPrintTarget = useLabelStore((s) => s.setPrintTarget);
  const readPrinterSettings = useLabelStore((s) => s.readPrinterSettings);
  const reading = useLabelStore((s) => s.printerReading) !== undefined;
  const readsPrinter = useLabelStore(selectReadsPrinter);
  const settings = useReplyRead<SgdSetting[]>();
  const usb = useUsbPrinters(printReach.desktop);
  const local = useLocalPrinters(printReach.desktop);
  const server = useServerPrinters(printReach.server);
  const bp = useBrowserPrintDevices();
  const offered = offeredTransports(printReach, { local: local.present, usb: usb.present, server: server.present });
  const way = effectiveTransport(transport, offered);

  // A device way without devices stays visible, and then its reason replaces the description.
  const deviceWayHint = (value: PrintTransport) => (offered.includes(value) ? undefined : t.zebraPrint.noPrinters);
  const openSettings = () => settings.start(readPrinterSettings);

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h3 className={sectionHeadingCls}>{loc.transportHeading}</h3>
        {reachableTransports(printReach).map((value) => (
          <RadioOption
            key={value}
            name="print-transport"
            value={value}
            current={way}
            onSelect={(next) => setPrintTarget({ transport: next })}
            label={wayLabel(t.zebraPrint, value)}
            hint={deviceWayHint(value) ?? wayHint(t.zebraPrint, value, printReach.desktop)}
            disabled={!offered.includes(value)}
          />
        ))}
        {/* The hint names the preview fallback, which only the desktop shell has. */}
        {printReach.desktop && <span className="text-[10px] text-muted max-w-md">{loc.hint}</span>}
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
      {way === "server" && (
        <>
          <DevicePicker list={server} error={server.error && failureText(t.printerSettings.printerStatus, server.error)} />
          <ServerTokenField onSaved={() => void server.refresh()} />
        </>
      )}

      {/* The server keeps the address of each printer it names. */}
      {way !== "server" && (
        <section className="flex flex-col gap-2">
          <h3 className={sectionHeadingCls}>{loc.addressHeading}</h3>
          <PrinterAddressFields />
          <span className="text-[10px] text-muted max-w-md">{loc.addressHint}</span>
        </section>
      )}

      {readsPrinter && (
        <button type="button" className={`${buttonCls} self-start`} disabled={reading} onClick={openSettings}>
          {t.printerSettings.printerStatus.adoptFromPrinter}
        </button>
      )}
      {settings.read && <AdoptSettingsDialog read={settings.read} portal onClose={settings.close} />}
    </div>
  );
}

import { useState, type ReactNode } from "react";
import { errorMessage } from "../../lib/errorMessage";
import { XMarkIcon } from "@heroicons/react/16/solid";
import { useT } from "../../hooks/useT";
import { DialogShell } from "../ui/DialogShell";
import { Select } from "../ui/Select";
import { sendViaBrowserPrint, sendViaNetwork } from "../../lib/zebraPrint";
import { isDesktopShell } from "../../lib/platform";
import { effectiveTransport, offeredTransports, type PrintTransport } from "../../lib/printTarget";
import { useLabelStore, selectBatchInputs, selectCanBatchExport, selectBatchPrintCount } from "../../store/labelStore";
import { formatTemplate } from "../../lib/formatTemplate";
import { deliveryNotices, exportPrinterImpact, printerImpactNotices } from "../../lib/exportImpact";
import { sendZplLocal } from "../../lib/localPrint";
import { sendZplUsb, setupUsbAccess } from "../../lib/usbPrint";
import { pickerOptions, useBrowserPrintDevices, useLocalPrinters, useUsbPrinters } from "../../hooks/usePrintDevices";
import { PrinterAddressFields } from "../PrinterSettings/PrinterAddressFields";

type Tab = PrintTransport;
interface Status { type: "idle" | "sending" | "success" | "error"; message?: string }

function StatusMessage({ status }: { status: Status }) {
  if (status.type === "idle" || status.type === "sending") return null;
  return (
    <p className={`font-mono text-[10px] ${status.type === "success" ? "text-green-400" : "text-red-400"}`}>
      {status.message}
    </p>
  );
}

// The list-based transports (browser print, OS spooler, direct USB) share this
// body; network keeps its own ip/port form and stays separate.
interface TransportView {
  key: Tab;
  selected: string;
  onSelect: (value: string) => void;
  options: { value: string; label: string }[];
  selectDisabled: boolean;
  onSend: () => void;
  sendLabel: string;
  sendDisabled: boolean;
  status: Status;
  extra?: ReactNode;
}

function TransportBody({ view, fieldLabel }: { view: TransportView; fieldLabel: string }) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-1">
        <label className="font-mono text-[10px] text-muted uppercase tracking-widest">{fieldLabel}</label>
        <Select<string>
          value={view.selected}
          onChange={view.onSelect}
          disabled={view.selectDisabled}
          groups={[{ options: view.options }]}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        {view.extra ?? <span />}
        <button
          onClick={view.onSend}
          disabled={view.sendDisabled}
          className="px-3 py-1.5 text-xs font-mono rounded bg-accent text-bg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {view.sendLabel}
        </button>
      </div>
      <StatusMessage status={view.status} />
    </div>
  );
}

/** Synchronous on purpose: the banner must exist the moment the send button goes live. */
function ImpactNotices({ zpl }: { zpl: string }) {
  const t = useT();
  const pages = useLabelStore((s) => s.pages);
  const currentPageIndex = useLabelStore((s) => s.currentPageIndex);
  const batch = useLabelStore(selectCanBatchExport);
  const printed = batch ? pages.slice(currentPageIndex, currentPageIndex + 1) : pages;
  const notices = [...printerImpactNotices(exportPrinterImpact(zpl), t), ...deliveryNotices(printed, t)];
  if (notices.length === 0) return null;
  return (
    <div role="status">
      {notices.map((n) => (
        <p key={n} className="px-3 py-1.5 border-b border-border font-mono text-[10px] text-amber-400">
          {n}
        </p>
      ))}
    </div>
  );
}

interface Props {
  zpl: string;
  onClose: () => void;
}

export function PrintToZebraDialog({ zpl, onClose }: Props) {
  const t = useT();
  // The way last used is the tab the dialog opens on, so a repeat print is one click.
  const transport = useLabelStore((s) => s.printTarget.transport);
  const setPrintTarget = useLabelStore((s) => s.setPrintTarget);
  // The label source silently switches to batch form when a dataset is
  // mapped; surface the count so nobody sends 10k labels unaware. A per-label
  // ^PQ rides the stored template and multiplies EVERY recall, so the honest
  // number (selectBatchPrintCount) is rows × quantity.
  const batchRows = useLabelStore((s) =>
    s.zebraPrintSource === "label" ? selectBatchInputs(s)?.dataset.rows.length ?? null : null,
  );
  const printQuantity = useLabelStore((s) => s.label.printQuantity ?? 1);
  const batchCount = useLabelStore(selectBatchPrintCount);
  const printSource = useLabelStore((s) => s.zebraPrintSource);

  const host = useLabelStore((s) => s.printTarget.host);
  const [netStatus, setNetStatus] = useState<Status>({ type: "idle" });

  const bp = useBrowserPrintDevices();
  const [bpStatus, setBpStatus] = useState<Status>({ type: "idle" });
  const local = useLocalPrinters(isDesktopShell);
  const [localStatus, setLocalStatus] = useState<Status>({ type: "idle" });
  const usb = useUsbPrinters(isDesktopShell);
  const [usbStatus, setUsbStatus] = useState<Status>({ type: "idle" });
  // Tracks the last USB send being permission-denied, so the setup affordance
  // survives locale changes and a cancelled polkit prompt.
  const [usbNeedsSetup, setUsbNeedsSetup] = useState(false);
  // Enumeration failures surface in the tab's status area, unless a send status is already showing.
  const withListError = (status: Status, error: string | null): Status =>
    error && status.type === "idle" ? { type: "error", message: error } : status;
  const usbViewStatus = withListError(usbStatus, usb.error);
  const localViewStatus = withListError(localStatus, local.error);
  const bpViewStatus = withListError(bpStatus, bp.error && t.zebraPrint.agentNotFound);

  async function handleNetworkSend() {
    const target = useLabelStore.getState().printTarget;
    setNetStatus({ type: "sending" });
    const result = await sendViaNetwork(target.host, target.port, zpl);
    switch (result.kind) {
      case "sent":
        setNetStatus({ type: "success", message: t.zebraPrint.success });
        return;
      case "responded":
        // 2xx only counts as success; print servers / proxies that respond
        // with 4xx or 5xx must surface as an error rather than green-success.
        if (result.status >= 200 && result.status < 300) {
          setNetStatus({ type: "success", message: t.zebraPrint.success });
        } else {
          setNetStatus({ type: "error", message: t.zebraPrint.errorGeneric });
        }
        return;
      case "no_response":
        // Web raw-socket printers never reply over HTTP, so a timeout is the
        // typical success yet indistinguishable from an unreachable host.
        setNetStatus({ type: "success", message: t.zebraPrint.sentNoResponse });
        return;
      case "unreachable":
        setNetStatus({ type: "error", message: t.zebraPrint.errorNoResponse });
        return;
      case "refused":
        setNetStatus({ type: "error", message: t.zebraPrint.errorRefused });
        return;
      case "error":
        setNetStatus({ type: "error", message: t.zebraPrint.errorGeneric });
        return;
      default: {
        const _exhaustive: never = result;
        throw new Error(`unhandled print result: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  async function handleBrowserPrintSend() {
    const device = bp.devices.find((d) => d.uid === bp.selectedId);
    if (!device) return;
    setBpStatus({ type: "sending" });
    try {
      await sendViaBrowserPrint(device, zpl);
      setBpStatus({ type: "success", message: t.zebraPrint.success });
    } catch (e) {
      setBpStatus({
        type: "error",
        message: e instanceof Error ? e.message : t.zebraPrint.errorGeneric,
      });
    }
  }

  async function handleLocalSend() {
    if (!local.selectedId) return;
    setLocalStatus({ type: "sending" });
    const result = await sendZplLocal(local.selectedId, zpl);
    if (result.kind === "sent") {
      setLocalStatus({ type: "success", message: t.zebraPrint.success });
    } else {
      setLocalStatus({ type: "error", message: result.message || t.zebraPrint.errorGeneric });
    }
  }

  async function handleUsbSend() {
    if (!usb.selectedId) return;
    setUsbStatus({ type: "sending" });
    const result = await sendZplUsb(usb.selectedId, zpl);
    switch (result.kind) {
      case "sent":
        setUsbNeedsSetup(false);
        setUsbStatus({ type: "success", message: t.zebraPrint.success });
        return;
      case "permission_denied":
        setUsbNeedsSetup(true);
        setUsbStatus({ type: "error", message: t.zebraPrint.usbPermissionDenied });
        return;
      case "not_found":
        setUsbNeedsSetup(false);
        setUsbStatus({ type: "error", message: t.zebraPrint.usbNotFound });
        return;
      case "error":
        setUsbNeedsSetup(false);
        setUsbStatus({ type: "error", message: result.message || t.zebraPrint.errorGeneric });
        return;
      default: {
        const _exhaustive: never = result;
        throw new Error(`unhandled print result: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  async function handleUsbSetup() {
    try {
      await setupUsbAccess();
      // Access granted: refresh (a hot-plugged printer may be new) and clear the prompt.
      await usb.refresh();
      setUsbNeedsSetup(false);
      setUsbStatus({ type: "idle" });
    } catch (e) {
      // Failed or cancelled: keep usbNeedsSetup so the button stays available.
      setUsbStatus({ type: "error", message: errorMessage(e) });
    }
  }

  const tabClass = (active: boolean) =>
    `px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest transition-colors ${
      active
        ? "text-text border-b border-accent"
        : "text-muted hover:text-text"
    }`;

  const offered = offeredTransports(isDesktopShell, { local: local.present, usb: usb.present });
  const tabLabels: Record<Tab, string> = { network: t.zebraPrint.tabNetwork, browserprint: t.zebraPrint.tabBrowserPrint, local: t.zebraPrint.tabLocal, usb: t.zebraPrint.tabUsb };
  const tab = effectiveTransport(transport, offered);

  const views: TransportView[] = [
    {
      key: "browserprint",
      selected: bp.selectedId,
      onSelect: bp.select,
      options: pickerOptions(t, bp),
      selectDisabled: bp.options.length === 0,
      onSend: handleBrowserPrintSend,
      sendLabel: bpStatus.type === "sending" ? t.zebraPrint.sending : t.zebraPrint.send,
      sendDisabled: !bp.selectedId || bp.options.length === 0 || bpStatus.type === "sending",
      status: bpViewStatus,
      extra: (
        <button
          onClick={() => {
            setBpStatus({ type: "idle" });
            void bp.refresh();
          }}
          disabled={bp.loading}
          className="px-3 py-1.5 text-xs font-mono rounded border border-border text-muted hover:text-text hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {bp.loading ? t.zebraPrint.discovering : t.zebraPrint.discover}
        </button>
      ),
    },
    {
      key: "local",
      selected: local.selectedId,
      onSelect: local.select,
      options: pickerOptions(t, local),
      selectDisabled: local.options.length === 0,
      onSend: handleLocalSend,
      sendLabel: localStatus.type === "sending" ? t.zebraPrint.sending : t.zebraPrint.send,
      sendDisabled: !local.selectedId || local.options.length === 0 || local.loading || localStatus.type === "sending",
      status: localViewStatus,
    },
    {
      key: "usb",
      selected: usb.selectedId,
      onSelect: usb.select,
      options: pickerOptions(t, usb),
      selectDisabled: usb.options.length === 0,
      onSend: handleUsbSend,
      sendLabel: usbStatus.type === "sending" ? t.zebraPrint.sending : t.zebraPrint.send,
      sendDisabled: !usb.selectedId || usb.options.length === 0 || usb.loading || usbStatus.type === "sending",
      status: usbViewStatus,
      extra: usbNeedsSetup ? (
        <button
          onClick={handleUsbSetup}
          className="px-3 py-1.5 text-xs font-mono rounded border border-border text-muted hover:text-text hover:bg-surface-2 transition-colors"
        >
          {t.zebraPrint.usbSetupAccess}
        </button>
      ) : undefined,
    },
  ];
  const activeView = views.find((v) => v.key === tab);

  return (
    <DialogShell
      onClose={onClose}
      labelledBy="zebra-print-title"
      boxClassName="bg-surface border border-border rounded shadow-lg flex flex-col w-[420px] max-w-[95vw]"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0">
        <span id="zebra-print-title" className="font-mono text-[10px] text-muted uppercase tracking-widest">
          {t.zebraPrint.heading}
        </span>
        <button
          onClick={onClose}
          aria-label={t.app.close}
          className="p-1 rounded text-muted hover:text-text hover:bg-surface-2 transition-colors"
        >
          <XMarkIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {batchRows !== null && (
        <p className="px-3 py-1.5 border-b border-border font-mono text-[10px] text-amber-400">
          {printQuantity > 1
            ? formatTemplate(t.zebraPrint.batchNoticeQtyFmt, {
                n: String(batchCount),
                rows: String(batchRows),
                q: String(printQuantity),
              })
            : formatTemplate(t.zebraPrint.batchNoticeFmt, { n: String(batchRows) })}
        </p>
      )}

      {/* These are the exact bytes sent (batch form included), which the panel may never
          have shown. Source-gated: a setup script changing settings is its purpose. */}
      {printSource !== "setupScript" && <ImpactNotices zpl={zpl} />}

      {/* Tabs */}
      <div className="flex border-b border-border">
        {offered.map((key) => (
          <button key={key} className={tabClass(tab === key)} onClick={() => setPrintTarget({ transport: key })}>
            {tabLabels[key]}
          </button>
        ))}
      </div>

      {/* Network tab */}
      {tab === "network" && (
        <div className="flex flex-col gap-3 p-4">
          {window.location.protocol === "https:" && (
            <p className="font-mono text-[10px] text-yellow-400">
              {t.zebraPrint.httpsWarning}
            </p>
          )}
          <PrinterAddressFields />

          <button
            onClick={handleNetworkSend}
            disabled={!host || netStatus.type === "sending"}
            className="self-end px-3 py-1.5 text-xs font-mono rounded bg-accent text-bg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {netStatus.type === "sending" ? t.zebraPrint.sending : t.zebraPrint.send}
          </button>

          <StatusMessage status={netStatus} />
        </div>
      )}

      {/* List-based transports (browser print, OS spooler, direct USB) */}
      {activeView && <TransportBody view={activeView} fieldLabel={t.zebraPrint.printer} />}
    </DialogShell>
  );
}

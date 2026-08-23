import { useState, useEffect, type ReactNode } from "react";
import { errorMessage } from "../../lib/errorMessage";
import { XMarkIcon } from "@heroicons/react/16/solid";
import { useT } from "../../hooks/useT";
import { DialogShell } from "../ui/DialogShell";
import { Select } from "../ui/Select";
import {
  discoverBrowserPrintDevices,
  sendViaBrowserPrint,
  sendViaNetwork,
  type BrowserPrintDevice,
} from "../../lib/zebraPrint";
import { isDesktopShell } from "../../lib/platform";
import { getPrinterAddress, setPrinterAddress } from "../../lib/printerAddress";
import { useLabelStore, selectBatchInputs, selectBatchPrintCount } from "../../store/labelStore";
import { formatTemplate } from "../../lib/formatTemplate";
import { exportPrinterImpact, printerImpactNotices } from "../../lib/exportImpact";
import { listLocalPrinters, sendZplLocal, isLikelyZebra, type LocalPrinter } from "../../lib/localPrint";
import { sendZplUsb, setupUsbAccess, isLikelyZebra as isUsbZebra } from "../../lib/usbPrint";
import { printerOptionLabel } from "../../lib/printerLabel";
import { useUsbPrinters } from "../../hooks/useUsbPrinters";

const LS_PRINTER_UID = "zebra_print_uid";
const LS_LOCAL_PRINTER = "zebra_print_local";

type Tab = "network" | "browserprint" | "local" | "usb";
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

/** Synchronous on purpose: the banner must exist the moment the send button goes live.
 *  Split out because the dialog is compiler-hostile (try/finally), so no memo holds there. */
function ImpactNotices({ zpl }: { zpl: string }) {
  const t = useT();
  const notices = printerImpactNotices(exportPrinterImpact(zpl), t);
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
  const [tab, setTab] = useState<Tab>("network");
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

  // Network tab state; the address is shared with the preview provider.
  const [ip, setIp] = useState(() => getPrinterAddress().host);
  const [port, setPort] = useState(() => String(getPrinterAddress().port));
  const [netStatus, setNetStatus] = useState<Status>({ type: "idle" });

  // Browser Print tab state
  const [devices, setDevices] = useState<BrowserPrintDevice[]>([]);
  const [selectedUid, setSelectedUid] = useState<string>(
    () => localStorage.getItem(LS_PRINTER_UID) ?? "",
  );
  const [bpStatus, setBpStatus] = useState<Status>({ type: "idle" });
  const [discovering, setDiscovering] = useState(false);

  // Local printer (OS spooler) tab state; desktop shell only.
  const [localPrinters, setLocalPrinters] = useState<LocalPrinter[]>([]);
  const [selectedLocal, setSelectedLocal] = useState<string>(
    () => localStorage.getItem(LS_LOCAL_PRINTER) ?? "",
  );
  const [localStatus, setLocalStatus] = useState<Status>({ type: "idle" });
  // Starts loading on desktop (the effect enumerates on mount); false on web.
  const [loadingLocal, setLoadingLocal] = useState(isDesktopShell);

  // USB tab; desktop shell only. Device enumeration/selection is shared with
  // the preview settings via the hook; send status and setup stay local.
  const usb = useUsbPrinters(isDesktopShell);
  const [usbStatus, setUsbStatus] = useState<Status>({ type: "idle" });
  // Tracks the last USB send being permission-denied, so the setup affordance
  // survives locale changes and a cancelled polkit prompt.
  const [usbNeedsSetup, setUsbNeedsSetup] = useState(false);
  // Enumeration failures surface in the tab's status area, unless a send status
  // is already showing.
  const usbViewStatus: Status =
    usb.error && usbStatus.type === "idle" ? { type: "error", message: usb.error } : usbStatus;

  // Enumerate OS print queues once on mount; the web build has no spooler.
  useEffect(() => {
    if (!isDesktopShell) return;
    let cancelled = false;
    listLocalPrinters()
      .then((printers) => {
        if (cancelled) return;
        setLocalPrinters(printers);
        setSelectedLocal((cur) =>
          cur && printers.some((p) => p.system_name === cur) ? cur : printers[0]?.system_name ?? "",
        );
      })
      .catch((e: unknown) => {
        // A failed enumeration must be visible, not a silent empty list.
        if (!cancelled) {
          setLocalStatus({ type: "error", message: errorMessage(e) });
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingLocal(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Unplugging the printer hides the USB tab button; correct the stranded tab
  // during render (React's derived-state pattern) so there is no empty-tab flash.
  if (tab === "usb" && usb.printers.length === 0) setTab("network");

  function persistNetwork() {
    setPrinterAddress(ip, port);
  }

  async function handleNetworkSend() {
    const portNum = port.trim() === "" ? 9100 : Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      setNetStatus({ type: "error", message: t.zebraPrint.errorInvalidPort });
      return;
    }
    persistNetwork();
    setNetStatus({ type: "sending" });
    const result = await sendViaNetwork(ip.trim(), portNum, zpl);
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

  async function handleDiscover() {
    setDiscovering(true);
    setBpStatus({ type: "idle" });
    try {
      const found = await discoverBrowserPrintDevices();
      setDevices(found);
      const first = found[0];
      if (first && !found.find((d) => d.uid === selectedUid)) {
        setSelectedUid(first.uid);
        localStorage.setItem(LS_PRINTER_UID, first.uid);
      }
    } catch {
      setBpStatus({ type: "error", message: t.zebraPrint.agentNotFound });
    } finally {
      setDiscovering(false);
    }
  }

  async function handleBrowserPrintSend() {
    const device = devices.find((d) => d.uid === selectedUid);
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
    if (!selectedLocal) return;
    localStorage.setItem(LS_LOCAL_PRINTER, selectedLocal);
    setLocalStatus({ type: "sending" });
    const result = await sendZplLocal(selectedLocal, zpl);
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

  const tabs: { key: Tab; label: string; enabled: boolean }[] = [
    { key: "network", label: t.zebraPrint.tabNetwork, enabled: true },
    { key: "browserprint", label: t.zebraPrint.tabBrowserPrint, enabled: !isDesktopShell },
    { key: "local", label: t.zebraPrint.tabLocal, enabled: isDesktopShell },
    { key: "usb", label: t.zebraPrint.tabUsb, enabled: isDesktopShell && usb.printers.length > 0 },
  ];

  const views: TransportView[] = [
    {
      key: "browserprint",
      selected: selectedUid,
      onSelect: (uid) => {
        setSelectedUid(uid);
        localStorage.setItem(LS_PRINTER_UID, uid);
      },
      options:
        devices.length === 0
          ? [{ value: "", label: t.zebraPrint.noPrinters }]
          : devices.map((d) => ({ value: d.uid, label: d.name || d.manufacturer || d.uid })),
      selectDisabled: devices.length === 0,
      onSend: handleBrowserPrintSend,
      sendLabel: bpStatus.type === "sending" ? t.zebraPrint.sending : t.zebraPrint.send,
      sendDisabled: !selectedUid || devices.length === 0 || bpStatus.type === "sending",
      status: bpStatus,
      extra: (
        <button
          onClick={handleDiscover}
          disabled={discovering}
          className="px-3 py-1.5 text-xs font-mono rounded border border-border text-muted hover:text-text hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {discovering ? t.zebraPrint.discovering : t.zebraPrint.discover}
        </button>
      ),
    },
    {
      key: "local",
      selected: selectedLocal,
      onSelect: (name) => {
        setSelectedLocal(name);
        localStorage.setItem(LS_LOCAL_PRINTER, name);
      },
      options:
        localPrinters.length === 0
          ? [{ value: "", label: loadingLocal ? t.zebraPrint.discovering : t.zebraPrint.noPrinters }]
          : localPrinters.map((p) => ({
              value: p.system_name,
              label: printerOptionLabel(p.name, isLikelyZebra(p)),
            })),
      selectDisabled: localPrinters.length === 0,
      onSend: handleLocalSend,
      sendLabel: localStatus.type === "sending" ? t.zebraPrint.sending : t.zebraPrint.send,
      sendDisabled:
        !selectedLocal || localPrinters.length === 0 || loadingLocal || localStatus.type === "sending",
      status: localStatus,
    },
    {
      key: "usb",
      selected: usb.selectedId,
      onSelect: usb.select,
      options:
        usb.printers.length === 0
          ? [{ value: "", label: usb.loading ? t.zebraPrint.discovering : t.zebraPrint.noPrinters }]
          : usb.printers.map((p) => ({
              value: p.id,
              label: printerOptionLabel(p.name, isUsbZebra(p)),
            })),
      selectDisabled: usb.printers.length === 0,
      onSend: handleUsbSend,
      sendLabel: usbStatus.type === "sending" ? t.zebraPrint.sending : t.zebraPrint.send,
      sendDisabled: !usb.selectedId || usb.printers.length === 0 || usb.loading || usbStatus.type === "sending",
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
        {tabs
          .filter((tb) => tb.enabled)
          .map((tb) => (
            <button key={tb.key} className={tabClass(tab === tb.key)} onClick={() => setTab(tb.key)}>
              {tb.label}
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
          <div className="flex gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <label className="font-mono text-[10px] text-muted uppercase tracking-widest">
                {t.zebraPrint.ipAddress}
              </label>
              <input
                type="text"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                onBlur={persistNetwork}
                placeholder="192.168.1.100"
                className="bg-bg border border-border rounded px-2 py-1 text-xs font-mono text-text focus:outline-none focus:border-accent"
              />
            </div>
            <div className="w-20 flex flex-col gap-1">
              <label className="font-mono text-[10px] text-muted uppercase tracking-widest">
                {t.zebraPrint.port}
              </label>
              <input
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(e.target.value)}
                onBlur={persistNetwork}
                className="bg-bg border border-border rounded px-2 py-1 text-xs font-mono text-text focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          <button
            onClick={handleNetworkSend}
            disabled={!ip.trim() || netStatus.type === "sending"}
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

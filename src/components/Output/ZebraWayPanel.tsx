import { useState, type ReactNode } from "react";
import { errorMessage } from "../../lib/errorMessage";
import { useT } from "../../hooks/useT";
import { Select } from "../ui/Select";
import { primaryButtonCls } from "../ui/formStyles";
import { sendViaBrowserPrint, sendViaNetwork } from "../../lib/zebraPrint";
import { isDesktopShell } from "../../lib/platform";
import { needsRawChannel, resolveQueryTarget, type PrintTransport } from "../../lib/printTarget";
import { useLabelStore, selectEffectivePreviewProvider, selectPrinterReading } from "../../store/labelStore";
import { sendZplLocal } from "../../lib/localPrint";
import { sendZplUsb, setupUsbAccess } from "../../lib/usbPrint";
import { pickerOptions } from "../../hooks/usePrintDevices";
import type { PrintDeviceLists } from "../../hooks/usePrintWays";
import { PrinterAddressFields } from "../PrinterSettings/PrinterAddressFields";
import { PrinterCheck } from "./PrinterCheck";
import type { PrinterQueryFailure } from "../../lib/printerQuery";

interface Status { type: "idle" | "sending" | "success" | "error"; message?: string }

function StatusMessage({ status }: { status: Status }) {
  if (status.type === "idle" || status.type === "sending") return null;
  const success = status.type === "success";
  return (
    <p role={success ? "status" : "alert"} className={`font-mono text-[10px] ${success ? "text-green-400" : "text-red-400"}`}>
      {status.message}
    </p>
  );
}

// Browser print, the OS spooler and USB share this body, because each picks from a device list.
interface TransportView {
  key: PrintTransport;
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
      <div className="flex items-start justify-between gap-2">
        {view.extra ?? <span />}
        <button
          onClick={view.onSend}
          disabled={view.sendDisabled}
          className={primaryButtonCls}
        >
          {view.sendLabel}
        </button>
      </div>
      <StatusMessage status={view.status} />
    </div>
  );
}

export function ZebraWayPanel({ zpl, way, devices }: { zpl: () => string; way: PrintTransport; devices: PrintDeviceLists }) {
  const t = useT();
  const printTarget = useLabelStore((s) => s.printTarget);
  const host = printTarget.host;
  const renderer = useLabelStore(selectEffectivePreviewProvider);
  const checking = useLabelStore(selectPrinterReading);
  const locked = checking && needsRawChannel(way, renderer);
  const [netStatus, setNetStatus] = useState<Status>({ type: "idle" });

  const { bp, local, usb } = devices;
  const [bpStatus, setBpStatus] = useState<Status>({ type: "idle" });
  const [localStatus, setLocalStatus] = useState<Status>({ type: "idle" });
  const [usbStatus, setUsbStatus] = useState<Status>({ type: "idle" });
  // Tracks the last USB send being permission-denied, so the setup affordance
  // survives locale changes and a cancelled polkit prompt.
  const [usbNeedsSetup, setUsbNeedsSetup] = useState(false);
  // Enumeration failures surface in the way's status area, unless a send status is already showing.
  const withListError = (status: Status, error: string | null): Status =>
    error && status.type === "idle" ? { type: "error", message: error } : status;
  const usbViewStatus = withListError(usbStatus, usb.error);
  const localViewStatus = withListError(localStatus, local.error);
  const bpViewStatus = withListError(bpStatus, bp.error && t.zebraPrint.agentNotFound);

  async function handleNetworkSend() {
    const target = useLabelStore.getState().printTarget;
    setNetStatus({ type: "sending" });
    const result = await sendViaNetwork(target.host, target.port, zpl());
    switch (result.kind) {
      case "sent":
        setNetStatus({ type: "success", message: t.zebraPrint.success });
        return;
      case "responded":
        // A print server or proxy answers with a status, and 4xx or 5xx must not read as success.
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
      await sendViaBrowserPrint(device, zpl());
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
    const result = await sendZplLocal(local.selectedId, zpl());
    if (result.kind === "sent") {
      setLocalStatus({ type: "success", message: t.zebraPrint.success });
    } else {
      setLocalStatus({ type: "error", message: result.message || t.zebraPrint.errorGeneric });
    }
  }

  async function handleUsbSend() {
    if (!usb.selectedId) return;
    setUsbStatus({ type: "sending" });
    const result = await sendZplUsb(usb.selectedId, zpl());
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
      // Refresh after access is granted, because a printer plugged in meanwhile is not in the list.
      await usb.refresh();
      setUsbNeedsSetup(false);
      setUsbStatus({ type: "idle" });
    } catch (e) {
      // Failed or cancelled: keep usbNeedsSetup so the button stays available.
      setUsbStatus({ type: "error", message: e === "flatpak" ? t.zebraPrint.usbSetupFlatpak : errorMessage(e) });
    }
  }

  const checkProps = (sending: boolean) => ({
    transport: way,
    sendBusy: sending,
    onFailure: (failure: PrinterQueryFailure) => {
      if (failure.kind !== "permission_denied") return;
      setUsbNeedsSetup(true);
      setUsbStatus({ type: "error", message: t.zebraPrint.usbPermissionDenied });
    },
  });

  // Every way reaches the same device, so every way may ask it. Only the desktop shell can read a
  // reply, and a way that cannot be questioned itself falls back to the configured address.
  const addressCheck = (sending: boolean) => {
    if (!isDesktopShell) return null;
    const resolved = resolveQueryTarget(printTarget, way);
    if ("failure" in resolved) return null;
    return (
      <div className="flex flex-col gap-1">
        <PrinterCheck {...checkProps(sending)} />
        {resolved.target.kind === "network" && way !== "network" && (
          <p className="font-mono text-[10px] text-muted leading-snug">{t.zebraPrint.wayQueryAddress}</p>
        )}
      </div>
    );
  };

  const views: TransportView[] = [
    {
      key: "browserprint",
      selected: bp.selectedId,
      onSelect: bp.select,
      options: pickerOptions(t, bp),
      selectDisabled: bp.options.length === 0,
      onSend: handleBrowserPrintSend,
      sendLabel: bpStatus.type === "sending" ? t.zebraPrint.sending : t.zebraPrint.send,
      sendDisabled: !bp.selectedId || bp.options.length === 0 || bpStatus.type === "sending" || locked,
      status: bpViewStatus,
      extra: (
        <div className="flex flex-col gap-2">
          <button
            onClick={() => {
              setBpStatus({ type: "idle" });
              void bp.refresh();
            }}
            disabled={bp.loading}
            className="self-start px-3 py-1.5 text-xs font-mono rounded border border-border text-muted hover:text-text hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {bp.loading ? t.zebraPrint.discovering : t.zebraPrint.discover}
          </button>
          {addressCheck(bpStatus.type === "sending")}
        </div>
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
      sendDisabled: !local.selectedId || local.options.length === 0 || local.loading || localStatus.type === "sending" || locked,
      status: localViewStatus,
      extra: addressCheck(localStatus.type === "sending") ?? undefined,
    },
    {
      key: "usb",
      selected: usb.selectedId,
      onSelect: usb.select,
      options: pickerOptions(t, usb),
      selectDisabled: usb.options.length === 0,
      onSend: handleUsbSend,
      sendLabel: usbStatus.type === "sending" ? t.zebraPrint.sending : t.zebraPrint.send,
      sendDisabled: !usb.selectedId || usb.options.length === 0 || usb.loading || usbStatus.type === "sending" || locked,
      status: usbViewStatus,
      extra: usbNeedsSetup ? (
        <button
          onClick={handleUsbSetup}
          className="px-3 py-1.5 text-xs font-mono rounded border border-border text-muted hover:text-text hover:bg-surface-2 transition-colors"
        >
          {t.zebraPrint.usbSetupAccess}
        </button>
      ) : (
        addressCheck(usbStatus.type === "sending")
      ),
    },
  ];
  const activeView = views.find((v) => v.key === way);

  if (way === "network") {
    return (
      <div className="flex flex-col gap-3 p-4">
        {window.location.protocol === "https:" && (
          <p className="font-mono text-[10px] text-yellow-400">
            {t.zebraPrint.httpsWarning}
          </p>
        )}
        <PrinterAddressFields />

        <div className="flex items-start justify-between gap-2">
          {addressCheck(netStatus.type === "sending") ?? <span />}
          <button
            onClick={handleNetworkSend}
            disabled={!host || netStatus.type === "sending" || locked}
            className={primaryButtonCls}
          >
            {netStatus.type === "sending" ? t.zebraPrint.sending : t.zebraPrint.send}
          </button>
        </div>

        <StatusMessage status={netStatus} />
      </div>
    );
  }

  return activeView ? <TransportBody view={activeView} fieldLabel={t.zebraPrint.printer} /> : null;
}

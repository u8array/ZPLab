import { useRef, useState } from "react";
import { ArrowDownTrayIcon, ArrowPathIcon, ChevronDownIcon, CircleStackIcon, Cog6ToothIcon, DocumentTextIcon } from "@heroicons/react/16/solid";
import type { SgdSetting } from "@zplab/core/lib/sgd";
import { useT } from "../../hooks/useT";
import { useDismiss } from "../../hooks/useDismiss";
import { formatTemplate } from "../../lib/formatTemplate";
import type { PrinterOutcome } from "../../lib/printerQuery";
import { failureText, readingText, reportView, warningsText, type ReadinessTone } from "../../lib/printerStatusText";
import { resolveQueryTarget } from "../../lib/printTarget";
import { selectPrinterState, useLabelStore } from "../../store/labelStore";
import { DropdownItem, DropdownSeparator } from "../ui/DropdownMenu";
import { AdoptSettingsDialog } from "./AdoptSettingsDialog";
import { PrinterConfigurationDialog } from "./PrinterConfigurationDialog";

const DOT_CLS: Record<ReadinessTone, string> = {
  ready: "bg-green-400",
  warning: "bg-amber-400",
  blocked: "bg-red-400",
  unknown: "bg-muted",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 px-3 py-0.5 text-[10px] font-mono">
      <span className="text-muted">{label}</span>
      <span className="text-text text-right">{value}</span>
    </div>
  );
}

/** The device the panel can question, with what it last said. */
export function PrinterChip() {
  const t = useT();
  const loc = t.printerSettings.printerStatus;
  const printTarget = useLabelStore((s) => s.printTarget);
  const state = useLabelStore(selectPrinterState);
  const step = useLabelStore((s) => s.printerReading);
  const checkPrinter = useLabelStore((s) => s.checkPrinter);
  const readPrinterConfiguration = useLabelStore((s) => s.readPrinterConfiguration);
  const readPrinterSettings = useLabelStore((s) => s.readPrinterSettings);
  const setPrinterSettingsTab = useLabelStore((s) => s.setPrinterSettingsTab);
  const [open, setOpen] = useState(false);
  const [configuration, setConfiguration] = useState<PrinterOutcome<string> | "reading" | undefined>();
  const [settings, setSettings] = useState<PrinterOutcome<SgdSetting[]> | "reading" | undefined>();
  const rootRef = useRef<HTMLDivElement>(null);
  useDismiss(rootRef, () => setOpen(false), { active: open });

  const resolved = resolveQueryTarget(printTarget);
  const name = "failure" in resolved ? t.zebraPrint.printer : resolved.target.kind === "usb" ? t.zebraPrint.tabUsb : resolved.target.host;
  // The stored way, because the effective one would enumerate printers on every mount.
  const askedOverAddress = !("failure" in resolved) && resolved.target.kind === "network" && printTarget.transport !== "network";
  const view = reportView(loc, state.phase === "done" ? state.report : undefined);
  const reading = step !== undefined;
  const tone: ReadinessTone = state.phase === "failed" ? "blocked" : (view?.line.tone ?? "unknown");
  const checkedAt = state.phase === "done" || state.phase === "failed" ? formatTemplate(loc.checkedAtFmt, { time: new Date(state.at).toLocaleTimeString() }) : undefined;
  const stateText =
    step !== undefined ? readingText(loc, step) : state.phase === "failed" ? failureText(loc, state.failure) : (view?.line.text ?? loc.notChecked);
  const closeThen = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  const openConfiguration = () => {
    setConfiguration("reading");
    void readPrinterConfiguration().then((result) => setConfiguration((current) => (current === "reading" ? result : current)));
  };
  const openSettings = () => {
    setSettings("reading");
    void readPrinterSettings().then((result) => setSettings((current) => (current === "reading" ? result : current)));
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1.5 px-2 py-1 rounded font-mono text-[10px] transition-colors ${open ? "text-accent bg-[--color-accent-dim]" : "text-muted hover:text-text hover:bg-surface-2"}`}
      >
        <span data-tone={tone} className={`w-2 h-2 rounded-full ${DOT_CLS[tone]} ${reading ? "animate-pulse" : ""}`} />
        {name}
        <ChevronDownIcon className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-64 bg-surface border border-border rounded-lg shadow-2xl py-1">
          {askedOverAddress && (
            <div className="px-3 pb-1 font-mono text-[10px] text-muted leading-snug">{t.zebraPrint.wayQueryAddress}</div>
          )}
          <Row label={loc.state} value={stateText} />
          {view?.report.flags && <Row label={loc.warnings} value={warningsText(loc, view.readiness)} />}
          {view?.report.identity && <Row label={loc.model} value={`${view.report.identity.model} ${view.report.identity.firmware}`} />}
          {view?.report.memory && (
            <Row label={loc.memory} value={formatTemplate(loc.memoryFmt, { available: String(view.report.memory.availableKb), max: String(view.report.memory.maxKb) })} />
          )}
          {checkedAt && <div className="px-3 py-0.5 text-[10px] font-mono text-muted text-right">{checkedAt}</div>}
          <DropdownSeparator />
          <DropdownItem icon={ArrowPathIcon} disabled={reading} onClick={closeThen(() => void checkPrinter())}>
            {loc.checkNow}
          </DropdownItem>
          <DropdownItem icon={DocumentTextIcon} disabled={reading} onClick={closeThen(openConfiguration)}>
            {loc.readConfiguration}
          </DropdownItem>
          <DropdownItem icon={ArrowDownTrayIcon} disabled={reading} onClick={closeThen(openSettings)}>
            {loc.adoptFromPrinter}
          </DropdownItem>
          <DropdownItem icon={CircleStackIcon} onClick={closeThen(() => setPrinterSettingsTab("storedFonts"))}>
            {t.printerSettings.objects.listHeading}
          </DropdownItem>
          <DropdownItem icon={Cog6ToothIcon} onClick={closeThen(() => setPrinterSettingsTab("printTarget"))}>
            {t.printerSettings.title}
          </DropdownItem>
        </div>
      )}
      {configuration && <PrinterConfigurationDialog read={configuration} onClose={() => setConfiguration(undefined)} />}
      {settings && <AdoptSettingsDialog read={settings} onClose={() => setSettings(undefined)} />}
    </div>
  );
}

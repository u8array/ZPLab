import { useId, useRef, useState, type FC } from "react";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, ClipboardDocumentIcon, TrashIcon, XMarkIcon } from "@heroicons/react/16/solid";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useMcpAvailability } from "../../hooks/useMcpServer";
import { useT } from "../../hooks/useT";
import { generateSetupScript } from "../../lib/zplSetupScript";
import { useLabelStore, selectHasPerLabelOverrides } from "../../store/labelStore";
import { isDesktopShell } from "../../lib/platform";
import type { PrinterSettingsTab } from "../../store/slices/uiSlice";
import { TAB_GATES, type TabGateCtx } from "./tabVisibility";
import type { PrinterProfile } from "@zplab/core/types/PrinterProfile";
import { DialogShell } from "../ui/DialogShell";
import { Tooltip } from "../ui/Tooltip";
import { ZplLine } from "../Output/ZplLine";
import { AppSettingsTab } from "./AppSettingsTab";
import { ClockAndTimeTab } from "./ClockAndTimeTab";
import { DataSourcesTab } from "./DataSourcesTab";
import { EncodingAndLanguageTab } from "./EncodingAndLanguageTab";
import { FontsTab } from "./FontsTab";
import { IdentityTab } from "./IdentityTab";
import { MaintenanceTab } from "./MaintenanceTab";
import { McpServerTab } from "./McpServerTab";
import { MediaFeedTab } from "./MediaFeedTab";
import { OutputTab } from "./OutputTab";
import { PreviewSettingsTab } from "./PreviewSettingsTab";
import { PrintQualityTab } from "./PrintQualityTab";
import { IllustrationFocusProvider, PrinterIllustration } from "./printerIllustration";

type TopTabId = 'app' | 'perLabel' | 'setupScript';

/** Sub-tab → top-tab. `satisfies` flags any PrinterSettingsTab union
 *  literal that gets added but forgotten here at compile time. */
const TOP_TAB_OF = {
  appSettings: 'app',
  previewSettings: 'app',
  mcpServer: 'app',
  dataSources: 'app',
  mediaFeed: 'perLabel',
  printQuality: 'perLabel',
  output: 'perLabel',
  clockTime: 'setupScript',
  encodingLanguage: 'setupScript',
  fonts: 'setupScript',
  identity: 'setupScript',
  maintenance: 'setupScript',
} as const satisfies Record<PrinterSettingsTab, TopTabId>;

const TOP_TAB_ORDER: readonly TopTabId[] = ['app', 'perLabel', 'setupScript'];

const TOP_TAB_LABEL_KEY = {
  app: 'railGroupApp',
  perLabel: 'railGroupPerLabel',
  setupScript: 'railGroupSetupScript',
} as const satisfies Record<TopTabId, 'railGroupApp' | 'railGroupPerLabel' | 'railGroupSetupScript'>;

const TABS_BY_TOP_TAB: Record<TopTabId, readonly PrinterSettingsTab[]> = (() => {
  const acc = Object.fromEntries(
    TOP_TAB_ORDER.map((id) => [id, [] as PrinterSettingsTab[]]),
  ) as Record<TopTabId, PrinterSettingsTab[]>;
  for (const [sub, top] of Object.entries(TOP_TAB_OF) as [PrinterSettingsTab, TopTabId][]) {
    acc[top].push(sub);
  }
  return acc;
})();

/** Tabs absent here render as disabled WIP rail entries. */
const TAB_COMPONENTS: Partial<Record<PrinterSettingsTab, FC>> = {
  appSettings: AppSettingsTab,
  previewSettings: PreviewSettingsTab,
  mcpServer: McpServerTab,
  dataSources: DataSourcesTab,
  mediaFeed: MediaFeedTab,
  printQuality: PrintQualityTab,
  output: OutputTab,
  clockTime: ClockAndTimeTab,
  encodingLanguage: EncodingAndLanguageTab,
  fonts: FontsTab,
  identity: IdentityTab,
  maintenance: MaintenanceTab,
};

const MODAL_BOX_CLS =
  "bg-surface border border-border rounded-lg shadow-2xl " +
  "w-[720px] max-w-[95vw] h-[600px] max-h-[85vh] flex flex-col overflow-hidden";

const PREVIEW_HEIGHT = "h-40";

/** Compact two-step reset for the narrow tab rail: one click arms (warning
 *  text), the second resets. A single toggling button, not the shared
 *  two-button DangerConfirmButton, because the rail can't fit confirm+cancel;
 *  the caller's onReset moves focus into the trap before this unmounts. */
function ResetPerLabelButton({
  label,
  confirmLabel,
  onReset,
}: {
  label: string;
  confirmLabel: string;
  onReset: () => void;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      onClick={() => (armed ? onReset() : setArmed(true))}
      onPointerLeave={() => setArmed(false)}
      onBlur={() => setArmed(false)}
      className={
        "w-full px-2 py-1.5 text-[11px] rounded border transition-colors " +
        (armed
          ? "border-warning text-warning"
          : "border-border text-muted hover:text-text hover:bg-surface-2")
      }
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

export function PrinterSettingsModal() {
  const t = useT();
  const tab = useLabelStore((s) => s.printerSettingsTab);
  const setTab = useLabelStore((s) => s.setPrinterSettingsTab);
  const printerProfile = useLabelStore((s) => s.printerProfile);
  const resetPrinterProfile = useLabelStore((s) => s.resetPrinterProfile);
  const resetPerLabelConfig = useLabelStore((s) => s.resetPerLabelConfig);
  // The reset button unmounts once its overrides are gone; move focus to the
  // active top-tab first so it stays inside the dialog's focus trap.
  const topTabsRef = useRef<HTMLDivElement>(null);
  const resetPerLabel = () => {
    topTabsRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
    resetPerLabelConfig();
  };
  const hasPerLabelOverrides = useLabelStore(selectHasPerLabelOverrides);
  const mcpSidecarAvailable = useLabelStore((s) => s.mcpSidecarAvailable);
  const gateCtx: TabGateCtx = { mcpSidecarAvailable, isDesktop: isDesktopShell };
  const openZebraPrint = useLabelStore((s) => s.openZebraPrint);
  const titleId = useId();
  const subtitleId = useId();
  // Recover the capability stamp if the boot ping never landed, so the MCP tab
  // is not permanently hidden by a transient status reject.
  useMcpAvailability();

  if (!tab) return null;

  const activeTopTab = TOP_TAB_OF[tab];
  const isVisible = (id: PrinterSettingsTab) => TAB_GATES[id]?.(gateCtx) ?? true;
  const activeTabs = TABS_BY_TOP_TAB[activeTopTab].filter(isVisible);
  const activeLabelKey = TOP_TAB_LABEL_KEY[activeTopTab];
  // Gate the content pane too, not just the rail, so a gated-out tab never
  // renders its body (the tab component then needs no self-guard).
  const ActiveTab = isVisible(tab) ? TAB_COMPONENTS[tab] : undefined;

  const setupScript = generateSetupScript(printerProfile);

  return (
    <DialogShell
      portal
      labelledBy={titleId}
      describedBy={subtitleId}
      onClose={() => setTab(null)}
      boxClassName={MODAL_BOX_CLS}
    >
      <header className="px-5 py-4 border-b border-border flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 id={titleId} className="text-sm font-medium text-text">
            {t.printerSettings.title}
          </h2>
          <p id={subtitleId} className="text-[11px] text-muted">
            {activeTopTab === 'app' ? t.printerSettings.subtitleApp : t.printerSettings.subtitle}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setTab(null)}
          aria-label={t.printerSettings.close}
          className="text-muted hover:text-text transition-colors p-1 -m-1"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </header>

      <div
        ref={topTabsRef}
        // Plain nav (not role=tablist) so the strip + rail share one
        // a11y paradigm.
        className="px-5 pt-3 border-b border-border flex gap-1"
        aria-label={t.printerSettings.title}
      >
        {TOP_TAB_ORDER.map((id) => {
          const active = id === activeTopTab;
          return (
            <button
              key={id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => {
                if (!active) {
                  const first = TABS_BY_TOP_TAB[id][0];
                  if (first) setTab(first);
                }
              }}
              className={
                "px-3 py-2 -mb-px border-b-2 text-xs font-medium transition-colors " +
                (active
                  ? "text-accent border-accent"
                  : "text-muted border-transparent hover:text-text")
              }
            >
              {t.printerSettings[TOP_TAB_LABEL_KEY[id]]}
            </button>
          );
        })}
      </div>

      <IllustrationFocusProvider>
        <div className="flex-1 flex min-h-0">
          <div className="w-44 shrink-0 border-r border-border bg-surface-2/40 flex flex-col">
            {activeTopTab === 'perLabel' && <PrinterIllustration />}
            <nav className="py-2 flex-1" aria-label={t.printerSettings[activeLabelKey]}>
              {activeTabs.map((id) => (
                <TabRailRow
                  key={id}
                  id={id}
                  active={id === tab}
                  onClick={() => setTab(id)}
                  label={t.printerSettings.tabs[id]}
                  wipLabel={t.printerSettings.wip}
                />
              ))}
            </nav>
            {activeTopTab === 'perLabel' && hasPerLabelOverrides && (
              <div className="px-3 pb-3">
                <ResetPerLabelButton
                  label={t.printerSettings.resetPerLabel}
                  confirmLabel={t.printerSettings.resetPerLabelConfirm}
                  onReset={resetPerLabel}
                />
              </div>
            )}
          </div>

          <section className="flex-1 min-h-0 overflow-y-auto px-5 py-3">
            {ActiveTab && <ActiveTab />}
          </section>
        </div>
      </IllustrationFocusProvider>

      {activeTopTab === 'setupScript' && (
        <PreviewDock
          setupScript={setupScript}
          printerProfile={printerProfile}
          onClear={resetPrinterProfile}
          onSend={() => {
            setTab(null);
            openZebraPrint('setupScript');
          }}
        />
      )}

      <footer className="px-5 py-3 border-t border-border flex items-center justify-between gap-4">
        <span className="text-[11px] text-muted">
          {t.printerSettings.instantApply}
        </span>
        <button
          type="button"
          onClick={() => setTab(null)}
          className="px-4 py-1.5 rounded text-xs bg-surface-2 text-text border border-border hover:bg-surface transition-colors"
        >
          {t.printerSettings.close}
        </button>
      </footer>
    </DialogShell>
  );
}

/** Docked preview pane on the Setup-Script top-tab. Per-Label has no
 *  preview here; its ZPL still lives in the editor's main output. */
function PreviewDock({
  setupScript,
  printerProfile,
  onClear,
  onSend,
}: {
  setupScript: string;
  printerProfile: PrinterProfile;
  onClear: () => void;
  onSend: () => void;
}) {
  const t = useT();
  // Live-clock mode needs the payload generated at click-time.
  const { copy, copied } = useCopyToClipboard(() => generateSetupScript(printerProfile));
  // Collapse frees vertical space on short screens; no animation/persistence by design.
  const [collapsed, setCollapsed] = useState(false);

  const hasScript = !!setupScript;
  const collapseLabel = collapsed ? t.app.expand : t.app.collapse;

  return (
    <div className={`${collapsed ? '' : PREVIEW_HEIGHT} shrink-0 border-t border-border flex flex-col bg-surface`}>
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Tooltip content={collapseLabel}>
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapseLabel}
              aria-expanded={!collapsed}
              className="p-0.5 rounded text-muted hover:text-text hover:bg-border transition-colors"
            >
              {collapsed ? <ChevronUpIcon className="w-3.5 h-3.5" /> : <ChevronDownIcon className="w-3.5 h-3.5" />}
            </button>
          </Tooltip>
          <span className="font-mono text-[10px] text-muted uppercase tracking-widest">
            {t.printerSettings.previewHeading}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Clear: separated from Send by a divider; red hover +
              red focus-visible ring so destructive intent is visible
              to both pointer and keyboard users. */}
          <Tooltip content={t.printerSettings.previewClear}>
            <button
              type="button"
              onClick={onClear}
              disabled={!hasScript}
              className="flex items-center gap-1 font-mono text-[10px] text-muted hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 rounded disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
            >
              <TrashIcon className="w-4 h-4" />
              {t.printerSettings.previewClear}
            </button>
          </Tooltip>
          <span aria-hidden="true" className="w-px h-4 bg-border" />
          <Tooltip content={t.output.copy}>
            <button
              type="button"
              onClick={copy}
              disabled={!hasScript}
              className="flex items-center gap-1 font-mono text-[10px] text-muted hover:text-accent disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
            >
              {copied
                ? <><CheckIcon className="w-4 h-4" />{t.output.copied}</>
                : <><ClipboardDocumentIcon className="w-4 h-4" />{t.output.copy}</>}
            </button>
          </Tooltip>
          <button
            type="button"
            onClick={onSend}
            disabled={!hasScript}
            className="px-3 py-1 rounded text-[11px] bg-accent text-bg hover:bg-accent/90 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
          >
            {t.printerSettings.sendToZebra}
          </button>
        </div>
      </div>

      {!collapsed && (
        <pre className="flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed text-text m-0">
          {hasScript
            ? setupScript.split('\n').map((line, i) => <ZplLine key={i} line={line} />)
            : null
          }
        </pre>
      )}
    </div>
  );
}

function TabRailRow({
  id,
  active,
  onClick,
  label,
  wipLabel,
}: {
  id: PrinterSettingsTab;
  active: boolean;
  onClick: () => void;
  label: string;
  wipLabel: string;
}) {
  const wip = !(id in TAB_COMPONENTS);
  const cls = active
    ? "text-accent border-accent -ml-px bg-accent/5"
    : wip
      ? "text-muted/40 border-transparent cursor-not-allowed"
      : "text-muted border-transparent hover:text-text hover:bg-surface-2";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={wip}
      aria-current={active ? "page" : undefined}
      className={
        "w-full text-left flex items-center justify-between gap-2 px-3 py-1.5 " +
        "font-mono text-[10px] uppercase tracking-wider " +
        "border-l-2 transition-colors " +
        cls
      }
    >
      <span>{label}</span>
      {wip && <span className="text-[9px] text-muted/50">{wipLabel}</span>}
    </button>
  );
}

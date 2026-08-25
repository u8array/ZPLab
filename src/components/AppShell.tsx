import { useState, useEffect, useRef, type ComponentType, type SVGProps } from "react";
import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { makePaletteCollision } from "../dnd/collision";
import { ObjectPalette } from "./Palette/ObjectPalette";
import { PaletteViewToggle } from "./Palette/PaletteViewToggle";
import { PaletteEditToggle } from "./Palette/PaletteEditToggle";
import { LabelCanvas } from "./Canvas/LabelCanvas";
import type { LabelCanvasHandle } from "./Canvas/LabelCanvas";
import { RightSidebar } from "./RightSidebar/RightSidebar";
import { HistoryDropdown } from "./History/HistoryDropdown";
import { ZPLOutput } from "./Output/ZPLOutput";
import { ZplImportModal } from "./Output/ZplImportModal";
import { VariableMappingModal } from "./Variables/VariableMappingModal";
import { ConnectDataWizard } from "./Variables/ConnectDataWizard";
import { CsvImportConfirmDialog } from "./Variables/CsvImportConfirmDialog";
import { PrintToZebraDialog } from "./Output/PrintToZebraDialog";
import {
  DropdownMenu,
  DropdownItem,
  DropdownSeparator,
} from "./ui/DropdownMenu";
import { GitHubIcon } from "./ui/GitHubIcon";
import { Tooltip } from "./ui/Tooltip";
import {
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  ArrowUpTrayIcon,
  ArrowDownTrayIcon,
  DocumentPlusIcon,
  DocumentDuplicateIcon,
  FolderOpenIcon,
  DocumentArrowDownIcon,
  TableCellsIcon,
  PrinterIcon,
  Cog6ToothIcon,
  PaperAirplaneIcon,
  XMarkIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  SunIcon,
  MoonIcon,
  GlobeAltIcon,
} from "@heroicons/react/16/solid";
import { useLabelStore, useHistory, selectLabelaryNoticeRequired, selectEditorFrozen, selectSourceEditing, selectDocumentEmits, selectBatchPrintCount } from "../store/labelStore";
import { datasetTimestamp } from "@zplab/core/types/DataSource";
import { isCurrentDataContext, settleDatasetReplace } from "../store/datasetActions";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { formatTemplate } from "../lib/formatTemplate";
import { buildMenuModel, type MenuItemId } from "../lib/menuModel";
import { NativeMenuBridge } from "./NativeMenuBridge";
import type { MenuHandlers } from "../hooks/useNativeMenu";
import { isDesktopShell, isMacDesktop } from "../lib/platform";
import { openExternal, REPO_URL } from "../lib/openExternal";
import { LabelaryNoticeModal } from "./Output/LabelaryNoticeModal";
import { PrinterSettingsModal } from "./PrinterSettings/PrinterSettingsModal";
import { Gs1ContentModal } from "./Barcode/Gs1ContentModal";
import { ContentBuilderModal } from "./Barcode/ContentBuilderModal";
import { VariableBuilderModal } from "./Properties/VariableBuilderModal";
import { mmToUnit } from "@zplab/core/lib/units";
import { localeOptions } from "../locales";
import { useT } from "../hooks/useT";
import { kbd } from "../lib/kbd";
import { useGlobalShortcuts } from "../hooks/useGlobalShortcuts";
import { useDesignFileActions } from "../hooks/useDesignFileActions";
import { useMcpBridge } from "../hooks/useMcpBridge";
import { useCsvImportActions } from "../hooks/useCsvImportActions";
import { useZplImportExport } from "../hooks/useZplImportExport";
import { useOutputPanel, OUTPUT_DEFAULT_H } from "../hooks/useOutputPanel";
import { useCollapsiblePanel } from "../hooks/useCollapsiblePanel";

/** Thin clickable rail shown in place of a collapsed side panel; clicking it
 *  brings the panel back. Chevrons point toward the canvas (the panel's slot). */
function ExpandStrip({
  side,
  onExpand,
  title,
}: {
  side: "left" | "right";
  onExpand: () => void;
  title: string;
}) {
  const Icon = side === "left" ? ChevronDoubleRightIcon : ChevronDoubleLeftIcon;
  return (
    <Tooltip content={title} className="shrink-0 h-full">
      <button
        onClick={onExpand}
        aria-label={title}
        className={`w-5 h-full ${
          side === "left" ? "border-r" : "border-l"
        } border-border bg-surface hover:bg-surface-2 flex items-start justify-center pt-2 text-muted hover:text-text transition-colors`}
      >
        <Icon className="w-3.5 h-3.5" />
      </button>
    </Tooltip>
  );
}

/** Icons per menu item id, shared by both surfaces: the DOM dropdown renders
 *  them as components, the native menu rasterizes them (useNativeMenu). */
const MENU_ICONS: Partial<Record<MenuItemId, ComponentType<SVGProps<SVGSVGElement>>>> = {
  new: DocumentPlusIcon,
  addPage: DocumentDuplicateIcon,
  importZpl: ArrowUpTrayIcon,
  settings: Cog6ToothIcon,
  exportZpl: ArrowDownTrayIcon,
  exportBatch: ArrowDownTrayIcon,
  openDesign: FolderOpenIcon,
  saveDesign: DocumentArrowDownIcon,
  importCsv: TableCellsIcon,
  connectData: TableCellsIcon,
  print: PrinterIcon,
  sendToZebra: PaperAirplaneIcon,
  undo: ArrowUturnLeftIcon,
  redo: ArrowUturnRightIcon,
  github: GitHubIcon,
};

export function AppShell() {
  const t = useT();
  const label = useLabelStore((s) => s.label);
  const batchPrintCount = useLabelStore(selectBatchPrintCount);
  const pages = useLabelStore((s) => s.pages);
  const selectObject = useLabelStore((s) => s.selectObject);
  const addPage = useLabelStore((s) => s.addPage);
  const setPrinterSettingsTab = useLabelStore((s) => s.setPrinterSettingsTab);
  const theme = useLabelStore((s) => s.theme);
  const setTheme = useLabelStore((s) => s.setTheme);
  const locale = useLabelStore((s) => s.locale);
  const setLocale = useLabelStore((s) => s.setLocale);
  const userError = useLabelStore((s) => s.userError);
  const clearUserError = useLabelStore((s) => s.clearUserError);
  const labelaryEnabled = useLabelStore((s) => s.thirdParty.labelary);
  const noticeRequired = useLabelStore(selectLabelaryNoticeRequired);
  const [showPrintNotice, setShowPrintNotice] = useState(false);
  const appUpdate = useLabelStore((s) => s.appUpdate);
  const checkForAppUpdate = useLabelStore((s) => s.checkForAppUpdate);
  const installAppUpdate = useLabelStore((s) => s.installAppUpdate);
  const relaunchApp = useLabelStore((s) => s.relaunchApp);
  const quitApp = useLabelStore((s) => s.quitApp);
  const dismissAppUpdate = useLabelStore((s) => s.dismissAppUpdate);

  // Silent one-shot update check; only an actual update surfaces a banner.
  useEffect(() => {
    void checkForAppUpdate(false);
  }, [checkForAppUpdate]);

  // Bridge the theme preference to <html data-theme> so the CSS variables in
  // index.css pick it up.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  const { undo, redo, pastStates, futureStates } = useHistory();
  const canvasSettings = useLabelStore((s) => s.canvasSettings);
  const setCanvasSettings = useLabelStore((s) => s.setCanvasSettings);
  const { showGrid, snapEnabled, snapSizeMm, smartSnapEnabled, unit } = canvasSettings;

  // A frozen editor no-ops undo/redo (see useHistory); reflect that on the
  // buttons so they aren't enabled-but-dead, matching the gated history dropdown.
  const historyLocked = useLabelStore(selectEditorFrozen);
  const canUndo = pastStates.length > 0 && !historyLocked;
  const canRedo = futureStates.length > 0 && !historyLocked;
  const hasObjects = pages.some((p) => p.objects.length > 0);
  const documentEmits = useLabelStore(selectDocumentEmits);
  const sourceEditing = useLabelStore(selectSourceEditing);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const paletteEditing = useLabelStore((s) => s.paletteEditing);
  const collisionDetection = makePaletteCollision(paletteEditing);

  useGlobalShortcuts();
  useMcpBridge();
  const { handleNew, handleSave, handleOpen, handleLoad, loadInputRef } = useDesignFileActions();
  const {
    csvInputRef,
    handleCsvImport,
    openCsvPicker,
    pendingImport,
    confirmPendingImport,
    cancelPendingImport,
  } = useCsvImportActions();
  const mappingModalOpen = useLabelStore((s) => s.mappingModalOpen);
  const connectWizardOpen = useLabelStore((s) => s.connectWizardOpen);
  const openConnectWizard = useLabelStore((s) => s.openConnectWizard);
  const pendingDatasetReplace = useLabelStore((s) => s.pendingDatasetReplace);
  const datasetFetchToken = useLabelStore((s) => s.datasetFetchToken);
  // A context bump while the replace confirm is open (doc swap, foreign load)
  // supersedes it; drop actively so the deferred fetch promise settles instead
  // of leaking behind the hidden dialog.
  useEffect(() => {
    if (pendingDatasetReplace && pendingDatasetReplace.token !== datasetFetchToken) {
      settleDatasetReplace(false);
    }
  }, [pendingDatasetReplace, datasetFetchToken]);
  const closeMappingModal = useLabelStore((s) => s.closeMappingModal);
  // Remount the mapping modal when the dataset changes (e.g. importing from its
  // own empty state) so its open-time draft re-seeds with the new data. The
  // timestamp is unique per import/fetch, so it also catches re-loading the
  // same file or table (which a name key would miss).
  const datasetKey = useLabelStore((s) => s.dataset && datasetTimestamp(s.dataset.source));
  const {
    showZplImport,
    openZplImport,
    closeZplImport,
    showZebraPrint,
    openZebraPrint,
    closeZebraPrint,
    currentZpl,
    handleDownload,
    handleExportBatch,
    canBatchExport,
    batchRowCount,
    handlePrint,
  } = useZplImportExport();
  const outputPanel = useOutputPanel(OUTPUT_DEFAULT_H, sourceEditing);
  const leftPanel = useCollapsiblePanel("zpl-panel-left");
  const rightPanel = useCollapsiblePanel("zpl-panel-right");

  // One menu model for both surfaces: the DOM dropdown (web header) and the
  // native OS menu (desktop, where the header row is not rendered at all).
  const menuModel = buildMenuModel(t, {
    hasObjects,
    documentEmits,
    sourceEditing,
    canBatchExport,
    batchRowCount,
    batchPrintCount,
    connectDataWizard: isDesktopShell,
    labelaryEnabled,
    canUndo,
    canRedo,
    // On macOS quit lives in the app submenu (Cmd+Q), not the File section.
    includeQuit: isDesktopShell && !isMacDesktop,
  });
  const menuHandlers: MenuHandlers = {
    new: handleNew,
    addPage,
    importZpl: openZplImport,
    settings: () => setPrinterSettingsTab("appSettings"),
    exportZpl: handleDownload,
    exportBatch: handleExportBatch,
    openDesign: handleOpen,
    saveDesign: handleSave,
    importCsv: openCsvPicker,
    connectData: openConnectWizard,
    // Print routes through Labelary; clicking before the notice has been
    // acknowledged opens the disclosure first, then prints.
    print: () => (noticeRequired ? setShowPrintNotice(true) : void handlePrint()),
    sendToZebra: openZebraPrint,
    undo: () => undo(),
    redo: () => redo(),
    github: () => openExternal(REPO_URL),
    // Desktop-only item (includeQuit); never reached on web.
    quit: () => void quitApp(),
  };
  // Imperative handle to the canvas for actions PropertiesPanel needs live
  // render bboxes for (e.g. align-to-label centring).
  const canvasRef = useRef<LabelCanvasHandle>(null);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-bg text-text font-sans">
      {/* Desktop: the menu model renders as the native OS menu; undo/redo and
          the history timeline ride its Edit menu plus the keyboard shortcuts,
          and theme/language live in the settings. */}
      {isDesktopShell && (
        <NativeMenuBridge
          model={menuModel}
          submenuLabels={{ file: t.app.file, edit: t.app.editMenu, help: t.app.helpMenu, quit: t.app.quitMenu }}
          handlers={menuHandlers}
          icons={MENU_ICONS}
        />
      )}
      {/* Header: web only; the desktop build has no header row. */}
      {!isDesktopShell && (
        <header className="h-11 shrink-0 flex items-center justify-between px-4 border-b border-border bg-surface-2">
          <div className="flex items-center gap-3">
            <button
              onClick={() => selectObject(null)}
              className="text-accent font-semibold tracking-tight text-sm hover:opacity-75 transition-opacity"
            >
              ZPLab
            </button>
            <span className="text-border-2 select-none">·</span>
            <span className="font-mono text-xs text-muted">
              {mmToUnit(label.widthMm, unit)} × {mmToUnit(label.heightMm, unit)} {unit} · {label.dpmm} dpmm
            </span>
          </div>

          <div className="flex items-center gap-1">
            <div className="w-px h-4 bg-border mx-1" />

            <Tooltip content={`${t.app.undo} (${kbd('Z')})`}>
              <button
                onClick={() => undo()}
                disabled={!canUndo}
                aria-label={t.app.undo}
                className="p-1.5 rounded text-muted hover:text-text hover:bg-border disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
              >
                <ArrowUturnLeftIcon className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
            <Tooltip content={`${t.app.redo} (${kbd('Z', { shift: true })})`}>
              <button
                onClick={() => redo()}
                disabled={!canRedo}
                aria-label={t.app.redo}
                className="p-1.5 rounded text-muted hover:text-text hover:bg-border disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
              >
                <ArrowUturnRightIcon className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
            <HistoryDropdown />

            <div className="w-px h-4 bg-border mx-1" />

            {/* Theme, language, GitHub: web-header power gestures, unchanged
                from the pre-native-menu layout. Desktop has no header. */}
            <Tooltip content={theme === "dark" ? t.app.themeLight : t.app.themeDark}>
              <button
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                aria-label={t.app.themeToggle}
                className="p-1.5 rounded text-muted hover:text-text hover:bg-border transition-colors"
              >
                {theme === "dark" ? (
                  <SunIcon className="w-3.5 h-3.5" />
                ) : (
                  <MoonIcon className="w-3.5 h-3.5" />
                )}
              </button>
            </Tooltip>

            <DropdownMenu
              label={<GlobeAltIcon className="w-3.5 h-3.5" />}
              ariaLabel={t.printerSettings.app.language}
              maxHeight="260px"
            >
              {localeOptions().map(({ value, label }) => (
                <DropdownItem
                  key={value}
                  onClick={() => setLocale(value)}
                  shortcut={value === locale ? "✓" : undefined}
                >
                  {label}
                </DropdownItem>
              ))}
            </DropdownMenu>

            <Tooltip content="GitHub">
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub"
                className="p-1.5 rounded text-muted hover:text-text hover:bg-border transition-colors"
              >
                <GitHubIcon className="w-3.5 h-3.5" />
              </a>
            </Tooltip>

            <div className="w-px h-4 bg-border mx-1" />

            <DropdownMenu label={t.app.file}>
              {menuModel.file.map((section, i) => (
                <div key={i} className="contents">
                  {i > 0 && <DropdownSeparator />}
                  {section.map((item) => (
                    <DropdownItem
                      key={item.id}
                      icon={MENU_ICONS[item.id]}
                      onClick={menuHandlers[item.id]}
                      disabled={!item.enabled}
                    >
                      {item.label}
                    </DropdownItem>
                  ))}
                </div>
              ))}
            </DropdownMenu>
          </div>
        </header>
      )}

      {/* Web only: desktop routes open/import through native dialogs
          (lib/fileDialogs), so these inputs never fire there. */}
      {!isDesktopShell && (
        <>
          <input
            ref={loadInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleLoad}
          />
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleCsvImport}
          />
        </>
      )}

      {/* Notices */}
      {(appUpdate.phase === "available" || appUpdate.phase === "installing" || appUpdate.phase === "installed" || appUpdate.phase === "error") && (
        <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-accent-dim border-b border-border font-mono text-[10px] text-text">
          <span className="flex-1">
            {appUpdate.phase === "error"
              ? formatTemplate(t.app.updateErrorFmt, { error: appUpdate.message })
              : appUpdate.phase === "installing"
                ? t.app.updateInstalling
                : appUpdate.phase === "installed"
                  ? t.app.updateInstalled
                  : formatTemplate(t.app.updateAvailableFmt, { version: appUpdate.version })}
          </span>
          {appUpdate.phase === "available" && (
            <button
              onClick={() => void installAppUpdate()}
              className="shrink-0 px-2 py-0.5 rounded bg-accent text-bg hover:opacity-90 transition-opacity"
            >
              {t.app.updateInstall}
            </button>
          )}
          {appUpdate.phase === "installed" && (
            <button
              onClick={() => void relaunchApp()}
              className="shrink-0 px-2 py-0.5 rounded bg-accent text-bg hover:opacity-90 transition-opacity"
            >
              {t.app.updateRestart}
            </button>
          )}
          {appUpdate.phase !== "installing" && (
            <button
              onClick={dismissAppUpdate}
              className="text-muted hover:text-text transition-colors"
              aria-label={t.app.dismiss}
            >
              <XMarkIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
      {userError && (
        <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-red-950/40 border-b border-red-800/50 font-mono text-[10px] text-red-300">
          <span className="flex-1">{userError.message}</span>
          {userError.retryExport && (
            <button
              onClick={handleDownload}
              className="flex items-center gap-1 text-red-300 hover:text-red-100 transition-colors shrink-0"
            >
              <ArrowDownTrayIcon className="w-3.5 h-3.5" />
              {t.app.exportZpl}
            </button>
          )}
          <button
            onClick={clearUserError}
            className="text-red-400 hover:text-red-200 transition-colors"
            aria-label={t.app.dismiss}
          >
            <XMarkIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main area: 3 columns */}
      <DndContext sensors={sensors} collisionDetection={collisionDetection}>
      <div className="flex flex-1 min-h-0">
        {leftPanel.collapsed ? (
          <ExpandStrip side="left" onExpand={leftPanel.expand} title={t.app.expand} />
        ) : (
          <aside className="w-56 shrink-0 border-r border-border bg-surface flex flex-col min-h-0">
            <div className="shrink-0 flex border-b border-border bg-surface">
              <Tooltip content={t.app.collapse}>
                <button
                  onClick={leftPanel.collapse}
                  aria-label={t.app.collapse}
                  className="px-2 flex items-center justify-center border-r border-border text-muted hover:text-text transition-colors"
                >
                  <ChevronDoubleLeftIcon className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
              <div className="flex flex-1 items-center px-2">
                <PaletteEditToggle />
              </div>
              <PaletteViewToggle />
            </div>
            <ObjectPalette />
          </aside>
        )}

        <main className="flex-1 overflow-hidden">
          <LabelCanvas
            ref={canvasRef}
            unit={unit}
            showGrid={showGrid}
            onGridToggle={() => setCanvasSettings({ showGrid: !showGrid })}
            snapEnabled={snapEnabled}
            onSnapToggle={() => setCanvasSettings({ snapEnabled: !snapEnabled })}
            smartSnapEnabled={smartSnapEnabled}
            snapSizeMm={snapSizeMm}
            onSnapSizeChange={(v) => setCanvasSettings({ snapSizeMm: v })}
            zoom={canvasSettings.zoom}
            onZoomChange={(v) => setCanvasSettings({ zoom: v })}
            viewRotation={canvasSettings.viewRotation}
            onViewRotationChange={(v) => setCanvasSettings({ viewRotation: v })}
          />
        </main>

        {rightPanel.collapsed ? (
          <ExpandStrip side="right" onExpand={rightPanel.expand} title={t.app.expand} />
        ) : (
          <RightSidebar canvasRef={canvasRef} onCollapse={rightPanel.collapse} />
        )}
      </div>
      </DndContext>

      {/* Output panel */}
      <div
        className="shrink-0 border-t border-border flex flex-col bg-surface-2"
        style={{ height: outputPanel.collapsed ? "auto" : outputPanel.height }}
      >
        <div className="flex-1 overflow-hidden">
          <ZPLOutput
            collapsed={outputPanel.collapsed}
            onCollapse={outputPanel.collapse}
            onExpand={outputPanel.expand}
            onResizeMouseDown={outputPanel.onMouseDown}
          />
        </div>
      </div>

      {showZplImport && <ZplImportModal onClose={closeZplImport} />}
      {mappingModalOpen && !connectWizardOpen && (
        <VariableMappingModal
          key={datasetKey ?? "none"}
          onClose={closeMappingModal}
          onImportCsv={openCsvPicker}
        />
      )}
      {connectWizardOpen && <ConnectDataWizard />}
      {/* Token gate: a doc/context swap leaves the local pending state stale, so
          hide the dialog rather than let it hover over the new document. */}
      {pendingImport && isCurrentDataContext(pendingImport.token) && (
        <CsvImportConfirmDialog
          pending={pendingImport}
          onConfirm={confirmPendingImport}
          onCancel={cancelPendingImport}
        />
      )}
      {/* Replace confirm for fetched sources (excel/db); same token gate as the
          sibling pending dialogs, and settleDatasetReplace re-checks on click. */}
      {pendingDatasetReplace && isCurrentDataContext(pendingDatasetReplace.token) && (
        <ConfirmDialog
          message={formatTemplate(t.variables.csvReplaceCsvBodyFmt, {
            old: pendingDatasetReplace.oldName,
            new: pendingDatasetReplace.newName,
          })}
          confirmLabel={t.variables.csvReplaceAction}
          cancelLabel={t.variables.cancel}
          onConfirm={() => settleDatasetReplace(true)}
          onCancel={() => settleDatasetReplace(false)}
        />
      )}
      {showZebraPrint && (
        <PrintToZebraDialog zpl={currentZpl()} onClose={closeZebraPrint} />
      )}
      {showPrintNotice && (
        <LabelaryNoticeModal
          onClose={() => setShowPrintNotice(false)}
          onContinue={() => {
            setShowPrintNotice(false);
            handlePrint();
          }}
        />
      )}
      <PrinterSettingsModal />
      <Gs1ContentModal />
      <ContentBuilderModal />
      <VariableBuilderModal />
    </div>
  );
}

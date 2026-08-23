import type { Translations } from '../locales';
import { formatTemplate } from './formatTemplate';

/**
 * Platform-neutral application menu model. The File section is the shared
 * source both surfaces render (web DOM dropdown + desktop native menu), so its
 * items/order/labels/gating cannot drift. Edit and Help are consumed ONLY by
 * the desktop native menu; on web, undo/redo and GitHub are bespoke header
 * controls, so an item added to model.edit or model.help shows on desktop only.
 */

export type MenuItemId =
  | 'new'
  | 'addPage'
  | 'importZpl'
  | 'settings'
  | 'exportZpl'
  | 'exportBatch'
  | 'openDesign'
  | 'saveDesign'
  | 'importCsv'
  | 'connectData'
  | 'print'
  | 'sendToZebra'
  | 'undo'
  | 'redo'
  | 'github'
  | 'quit';

export interface MenuItemModel {
  id: MenuItemId;
  label: string;
  enabled: boolean;
}

/** Items within a section render adjacent; sections separate with a rule. */
export type MenuSection = MenuItemModel[];

export interface MenuModel {
  file: MenuSection[];
  edit: MenuSection[];
  help: MenuSection[];
}

/** Submenu titles for the native menu. `quit` labels the macOS app-submenu
 *  Quit item; on Windows/Linux quit is a File item and this is unused. */
export interface SubmenuLabels {
  file: string;
  edit: string;
  help: string;
  quit: string;
}

/** The undo timeline projected for the desktop Edit>History submenu. Lives
 *  here (not in the hook) so the pure signature/window helpers can depend on
 *  it without a lib->hooks cycle. `index` is the absolute timeline index. */
export interface HistorySubmenu {
  label: string;
  clearLabel: string;
  canClear: boolean;
  items: { index: number; label: string; current: boolean; enabled: boolean }[];
}

export interface MenuFlags {
  hasObjects: boolean;
  /** Overlay pages emit even with zero objects (config-only source apply), so
   *  export/save gate on this, not on hasObjects. */
  documentEmits: boolean;
  /** Live source-edit session: entries that would replace or emit the
   *  document disable (see selectEditorFrozen). */
  sourceEditing: boolean;
  canBatchExport: boolean;
  batchRowCount: number;
  /** Physical labels a batch send produces: rows × per-label ^PQ quantity.
   *  exportBatch keeps batchRowCount (it names file content, not printing). */
  batchPrintCount: number;
  /** Desktop routes every data source through the connect-data wizard (one File
   *  entry); web keeps the direct CSV import as its only supported source. */
  connectDataWizard: boolean;
  /** Labelary gate off hides the print item entirely (matches the dropdown). */
  labelaryEnabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Desktop convention only; a browser tab has no app-quit. */
  includeQuit: boolean;
}

export function buildMenuModel(t: Translations, f: MenuFlags): MenuModel {
  const live = !f.sourceEditing;
  const file: MenuSection[] = [
    [
      { id: 'new', label: t.app.newDesign, enabled: live },
      { id: 'addPage', label: t.app.addPage, enabled: live },
    ],
    [{ id: 'importZpl', label: t.app.importZpl, enabled: live }],
    [
      { id: 'settings', label: t.printerSettings.open, enabled: true },
      { id: 'exportZpl', label: t.app.exportZpl, enabled: f.documentEmits && live },
      ...(f.canBatchExport
        ? [{
            id: 'exportBatch' as const,
            label: formatTemplate(t.app.exportBatchZplFmt, { n: String(f.batchRowCount) }),
            enabled: f.hasObjects && live,
          }]
        : []),
    ],
    [
      { id: 'openDesign', label: t.app.openDesign, enabled: live },
      { id: 'saveDesign', label: t.app.saveDesign, enabled: f.documentEmits && live },
      f.connectDataWizard
        ? { id: 'connectData' as const, label: t.connectData.title, enabled: live }
        : { id: 'importCsv' as const, label: t.app.importCsvData, enabled: live },
    ],
    [
      ...(f.labelaryEnabled
        ? [{ id: 'print' as const, label: t.app.print, enabled: f.hasObjects && live }]
        : []),
      {
        // Sends the full export (a config-only overlay stream is a legitimate
        // setup job), so it follows documentEmits like exportZpl; the Labelary
        // print above stays hasObjects (rendering nothing has no value).
        id: 'sendToZebra',
        label: f.canBatchExport
          ? formatTemplate(t.app.sendToZebraBatchFmt, { n: String(f.batchPrintCount) })
          : t.app.sendToZebra,
        enabled: f.documentEmits && live,
      },
    ],
    ...(f.includeQuit
      ? [[{ id: 'quit' as const, label: t.app.quitMenu, enabled: true }]]
      : []),
  ];
  const edit: MenuSection[] = [
    [
      { id: 'undo', label: t.app.undo, enabled: f.canUndo },
      { id: 'redo', label: t.app.redo, enabled: f.canRedo },
    ],
  ];
  const help: MenuSection[] = [[{ id: 'github', label: 'GitHub', enabled: true }]];
  return { file, edit, help };
}

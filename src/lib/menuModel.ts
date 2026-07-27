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
  const file: MenuSection[] = [
    [
      { id: 'new', label: t.app.newDesign, enabled: true },
      { id: 'addPage', label: t.app.addPage, enabled: true },
    ],
    [{ id: 'importZpl', label: t.app.importZpl, enabled: true }],
    [
      { id: 'settings', label: t.printerSettings.open, enabled: true },
      { id: 'exportZpl', label: t.app.exportZpl, enabled: f.hasObjects },
      ...(f.canBatchExport
        ? [{
            id: 'exportBatch' as const,
            label: formatTemplate(t.app.exportBatchZplFmt, { n: String(f.batchRowCount) }),
            enabled: f.hasObjects,
          }]
        : []),
    ],
    [
      { id: 'openDesign', label: t.app.openDesign, enabled: true },
      { id: 'saveDesign', label: t.app.saveDesign, enabled: f.hasObjects },
      f.connectDataWizard
        ? { id: 'connectData' as const, label: t.connectData.title, enabled: true }
        : { id: 'importCsv' as const, label: t.app.importCsvData, enabled: true },
    ],
    [
      ...(f.labelaryEnabled
        ? [{ id: 'print' as const, label: t.app.print, enabled: f.hasObjects }]
        : []),
      {
        id: 'sendToZebra',
        label: f.canBatchExport
          ? formatTemplate(t.app.sendToZebraBatchFmt, { n: String(f.batchPrintCount) })
          : t.app.sendToZebra,
        enabled: f.hasObjects,
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

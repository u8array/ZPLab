import type { RefObject } from 'react';
import { isDesktopShell } from './platform';
import { triggerDownload } from './triggerDownload';

/** Desktop uses native dialogs because menu callbacks may lack the user
 *  activation input.click() needs. The dynamic imports keep both plugins out of
 *  the web bundle. */

export interface FileFilter {
  name: string;
  extensions: string[];
  mimeType: string;
}

export const DESIGN_FILTER: FileFilter = { name: 'JSON', extensions: ['json'], mimeType: 'application/json' };
export const CSV_FILTER: FileFilter = { name: 'CSV', extensions: ['csv'], mimeType: 'text/csv' };
export const ZPL_FILTER: FileFilter = { name: 'ZPL', extensions: ['zpl'], mimeType: 'text/plain' };
// Zebra tools and print spoolers expect the same bytes under a .prn name.
export const PRN_FILTER: FileFilter = { name: 'PRN', extensions: ['prn'], mimeType: 'text/plain' };
export const PNG_FILTER: FileFilter = { name: 'PNG', extensions: ['png'], mimeType: 'image/png' };
export const ZPL_SAVE_FILTERS: [FileFilter, ...FileFilter[]] = [ZPL_FILTER, PRN_FILTER];

/** The `accept` attribute of a web file input for the same filters. */
export function acceptAttr(...filters: FileFilter[]): string {
  const extensions = filters.flatMap((f) => f.extensions.map((e) => `.${e}`));
  return [...new Set([...extensions, ...filters.map((f) => f.mimeType)])].join(',');
}

// The native dialogs match on extensions, so the mime type stays with the browser picker.
function nativeFilters(filters: readonly FileFilter[]) {
  return filters.map(({ name, extensions }) => ({ name, extensions }));
}

/** Shown when a save/export write fails; domain-neutral so both the design save
 *  and the ZPL export surface the same message. */
export const saveErrorMessage = 'Could not save the file.';

export const basename = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** File-menu entry point shared by open/import: native dialog on desktop,
 *  hidden input on web. `pick` returns null on cancel; a read failure rejects
 *  and routes to onError. */
export function pickViaMenu<T>(
  inputRef: RefObject<HTMLInputElement | null>,
  pick: () => Promise<T | null>,
  onPicked: (value: T) => void,
  onError: () => void,
): void {
  if (!isDesktopShell) {
    inputRef.current?.click();
    return;
  }
  void (async () => {
    try {
      const value = await pick();
      if (value) onPicked(value);
    } catch {
      onError();
    }
  })();
}

/** Open a dialog and read the picked file via `read`. Null on cancel; a read
 *  failure rejects so callers can surface their own error state. */
async function pickFile<T>(
  filter: FileFilter,
  read: (path: string) => Promise<T>,
): Promise<{ name: string; value: T } | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({ multiple: false, directory: false, filters: nativeFilters([filter]) });
  if (!path) return null;
  return { name: basename(path), value: await read(path) };
}

export async function pickFileText(filter: FileFilter): Promise<{ name: string; text: string } | null> {
  const picked = await pickFile(filter, async (path) => {
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    return readTextFile(path);
  });
  return picked && { name: picked.name, text: picked.value };
}

/** Pick a file and read raw bytes (callers that decode themselves, e.g. the
 *  CSV import with its persisted encoding). */
export async function pickFileBytes(filter: FileFilter): Promise<{ name: string; bytes: Uint8Array } | null> {
  const picked = await pickFile(filter, async (path) => {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    return readFile(path);
  });
  return picked && { name: picked.name, bytes: picked.value };
}

interface SaveOptions {
  filename: string;
  filters: [FileFilter, ...FileFilter[]];
}

/** The first filter is the default type. Returns true when a file was written and
 *  false on cancel, so callers clear a stale error only on an actual write. */
export async function saveFile(blob: Blob, opts: SaveOptions): Promise<boolean> {
  if (!isDesktopShell) return saveInBrowser(blob, opts);
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({ defaultPath: opts.filename, filters: nativeFilters(opts.filters) });
  if (!path) return false;
  const { writeFile } = await import('@tauri-apps/plugin-fs');
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  return true;
}

export function saveTextFile(text: string, opts: SaveOptions): Promise<boolean> {
  return saveFile(new Blob([text], { type: opts.filters[0].mimeType }), opts);
}

// lib.dom types the handle but not showSaveFilePicker.
type ShowSaveFilePicker = (opts: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

/** Chromium's picker offers filters. Without it, or when it refuses, the file downloads. */
async function saveInBrowser(blob: Blob, { filename, filters }: SaveOptions): Promise<boolean> {
  const picker = (window as { showSaveFilePicker?: ShowSaveFilePicker }).showSaveFilePicker;
  const download = () => {
    triggerDownload(blob, filename);
    return true;
  };
  if (!picker) return download();
  let handle: FileSystemFileHandle;
  try {
    handle = await picker({
      suggestedName: filename,
      types: filters.map((f) => ({ description: f.name, accept: { [f.mimeType]: f.extensions.map((e) => `.${e}`) } })),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return false;
    return download();
  }
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return true;
}

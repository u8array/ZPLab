import type { DatasetInput } from '@zplab/core/types/DataSource';
import type { DbRows } from './db';

/** Native pick the excel_* commands require a path to come from, see scope::PathGrants.
 *  Null on cancel. */
export async function pickExcelFile(): Promise<string | null> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string | null>('pick_excel_file');
}

export async function excelListSheets(path: string): Promise<string[]> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string[]>('excel_list_sheets', { path });
}

/** Fetch a worksheet as the store's dataset shape, stamping the excel source. */
export async function excelFetchDataset(
  path: string,
  filename: string,
  sheet: string,
): Promise<DatasetInput> {
  const { invoke } = await import('@tauri-apps/api/core');
  const result = await invoke<DbRows>('excel_fetch', { path, sheet });
  return {
    headers: result.headers,
    rows: result.rows,
    source: {
      kind: 'excel',
      filename,
      sheet,
      importedAt: new Date().toISOString(),
      rowCount: result.rows.length,
      truncated: result.truncated,
    },
  };
}

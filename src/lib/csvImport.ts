// Single source of truth for CSV ingestion; no direct papaparse imports elsewhere.
import Papa from "papaparse";
import { ok, err, type Result } from "@zplab/core/lib/result";
import type { CsvDatasetSource } from "@zplab/core/types/DataSource";

export interface CsvParseResult {
  /** Header names from the first row, in source order. */
  headers: string[];
  /** Ragged rows padded to headers.length so consumers can index without bounds-checks. */
  rows: string[][];
  source: CsvDatasetSource;
}

export type CsvParseError =
  | "read_failed"
  | "parse_failed"
  | "empty"
  | "no_headers";

export interface CsvParseOptions {
  /** Empty = PapaParse auto-detect. */
  delimiter?: string;
  /** Metadata only; actual decoding happens before parseCsvText. */
  encoding?: string;
  /** False = synthetic `Column N` names; default true. */
  hasHeaderRow?: boolean;
  /** Skip preamble rows (Excel exports). */
  skipRows?: number;
}

export async function parseCsvFile(
  file: File,
  options: CsvParseOptions = {},
): Promise<Result<CsvParseResult, CsvParseError>> {
  // Blob.text() over PapaParse streaming: jsdom lacks readAsText.
  let text: string;
  try {
    text = await file.text();
  } catch {
    return err("read_failed");
  }
  return parseCsvText(text, { ...options, filename: file.name });
}

export function parseCsvText(
  text: string,
  options: CsvParseOptions & { filename?: string } = {},
): Result<CsvParseResult, CsvParseError> {
  const skipRows = Math.max(0, options.skipRows ?? 0);
  const hasHeaderRow = options.hasHeaderRow !== false;
  const result = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: true,
    delimiter: options.delimiter ?? "",
  });
  const dataAll = result.data;
  if (dataAll.length === 0) return err("empty");
  const data = dataAll.slice(skipRows);
  if (data.length === 0) return err("empty");

  let headers: string[];
  let dataRows: string[][];
  if (hasHeaderRow) {
    headers = data[0] ?? [];
    if (headers.length === 0) return err("no_headers");
    dataRows = data.slice(1);
  } else {
    const width = data.reduce((max, r) => Math.max(max, r.length), 0);
    if (width === 0) return err("no_headers");
    headers = Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
    dataRows = data;
  }
  // Pad ragged so by-index lookup never surfaces undefined.
  const rows = dataRows.map((row) => {
    if (row.length === headers.length) return row;
    if (row.length < headers.length) {
      return [...row, ...Array(headers.length - row.length).fill("")];
    }
    return row.slice(0, headers.length);
  });
  return ok({
    headers,
    rows,
    source: {
      kind: "csv",
      filename: options.filename ?? "(pasted)",
      importedAt: new Date().toISOString(),
      encoding: options.encoding ?? "utf-8",
      delimiter: options.delimiter || result.meta.delimiter || ",",
      rowCount: rows.length,
    },
  });
}

// Outside the store: the raw bytes (can't survive persist), re-decoded per
// chosen encoding by decodeImportedText.
let lastImportedBytes: Uint8Array | null = null;

export function rememberImport(bytes: Uint8Array): void {
  lastImportedBytes = bytes;
}

export function forgetImport(): void {
  lastImportedBytes = null;
}

export function getImportedBytes(): Uint8Array | null {
  return lastImportedBytes;
}

/** Invalid labels throw; modal validates via dropdown. */
export function decodeImportedText(encoding: string): string | null {
  if (!lastImportedBytes) return null;
  return new TextDecoder(encoding).decode(lastImportedBytes);
}

export const csvParseErrors: Record<CsvParseError, string> = {
  read_failed: "Could not read the file.",
  parse_failed: "Could not parse the CSV. Check delimiter and encoding.",
  empty: "The file appears to be empty.",
  no_headers: "First row is empty; CSV needs a header row.",
};

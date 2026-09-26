import { z } from "zod";

/** Persisted pointer to a live database source; only the pointer rides the
 *  design file, rows are session-only. */
export const dbSourceRefSchema = z.object({
  kind: z.literal("db"),
  profileId: z.string(),
  /** Snapshot of the profile name for display when the profile is gone. */
  profileName: z.string(),
  table: z.string(),
});
export type DbSourceRef = z.infer<typeof dbSourceRefSchema>;

export interface CsvDatasetSource {
  kind: "csv";
  filename: string;
  importedAt: string;
  encoding: string;
  delimiter: string;
  rowCount: number;
}

/** Session metadata of a database fetch; extends the persisted pointer with
 *  facts that only exist once rows were actually pulled. */
export interface DbDatasetSource extends DbSourceRef {
  fetchedAt: string;
  /** True when the connector cut the result at its row cap. */
  truncated: boolean;
  rowCount: number;
}

/** Session metadata of an Excel worksheet import (file-based like CSV, but
 *  already tabular like a db fetch). */
export interface ExcelDatasetSource {
  kind: "excel";
  filename: string;
  sheet: string;
  importedAt: string;
  rowCount: number;
  truncated: boolean;
}

/** Session metadata of ^XF recall blocks folded out of an imported ZPL stream. */
export interface ZplDatasetSource {
  kind: "zpl";
  /** The stored format the rows recall. */
  formatPath: string;
  importedAt: string;
  rowCount: number;
}

/** Where loaded rows came from; discriminated on `kind` so UI can show
 *  source-specific affordances (re-import vs. re-fetch). */
export type DatasetSource = CsvDatasetSource | DbDatasetSource | ExcelDatasetSource | ZplDatasetSource;

/** headers+rows+source triple every dataset producer hands the store. */
export interface DatasetInput {
  headers: string[];
  rows: string[][];
  source: DatasetSource;
}

/** Display string for a db link, shared by loaded db sources and the
 *  design-file reconnect pointer (which has no session fetch metadata). */
export function dbRefDisplayName(ref: DbSourceRef): string {
  return `${ref.profileName} · ${ref.table}`;
}

/** One display string per source for badges and confirm dialogs. */
export function datasetDisplayName(source: DatasetSource): string {
  switch (source.kind) {
    case "db":
      return dbRefDisplayName(source);
    case "excel":
      return `${source.filename} · ${source.sheet}`;
    case "csv":
      return source.filename;
    case "zpl":
      return source.formatPath;
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

/** Identity of the loaded data (unique per import/fetch); used as a remount
 *  key so draft state re-seeds when the rows are replaced. */
export function datasetTimestamp(source: DatasetSource): string {
  switch (source.kind) {
    case "db":
      return source.fetchedAt;
    case "excel":
    case "csv":
    case "zpl":
      return source.importedAt;
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

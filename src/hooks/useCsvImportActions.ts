import { useRef, useState, type ChangeEvent } from "react";
import { useLabelStore, selectSourceEditing } from "../store/labelStore";
import {
  parseCsvText,
  rememberImport,
  csvParseErrors,
  type CsvParseResult,
} from "../lib/csvImport";
import { isMappingCompatibleWith, type ColumnMapping } from "@zplab/core/types/Variable";
import { pickFileBytes, pickViaMenu, CSV_FILTER } from "../lib/fileDialogs";
import { datasetDisplayName } from "@zplab/core/types/DataSource";
import { needsMappingReview, currentDataContext, isCurrentDataContext } from "../store/datasetActions";

/** Captures everything decided during parse so the caller can either
 *  apply directly or stash on the pending-import slot until the user
 *  confirms. Bytes live here because a "Cancel" must not pollute the
 *  module-scope cache that the modal re-decodes from. */
interface ParsedImport {
  filename: string;
  bytes: Uint8Array;
  result: CsvParseResult;
}

/** Compatibility decision for the confirm dialog: `same` shows a
 *  single Replace button (mapping carries over); `different` shows
 *  Discard mapping / Keep & remap. */
export type PendingImportKind = "same" | "different";

export interface PendingImport {
  kind: PendingImportKind;
  parsed: ParsedImport;
  /** datasetFetchToken at dialog-open; a mismatch on confirm means the data
   *  context (or the whole document) changed underneath, so the import is
   *  dropped rather than applied to the new context. */
  token: number;
  /** Display name of the dataset being replaced (filename or db link). */
  replacingFilename: string;
  /** True when the previous mapping treated CSV as headerless. Drives
   *  the dialog copy: column-count match vs. column-name match. */
  wasHeaderless: boolean;
  /** Header / column count from the saved mapping. Used in the
   *  dialog body so the user sees what they're comparing against. */
  previousColumnCount: number;
}

/** File-picker hook for "Import CSV data": owns the hidden <input> ref (web),
 *  the native-dialog entry point (desktop), and the pending-import slot that
 *  gates a destructive replace behind a ConfirmDialog. `onApplied` fires after
 *  THIS instance's import committed, so a caller can tell its own load from foreign ones. */
export function useCsvImportActions(onApplied?: () => void) {
  const csvInputRef = useRef<HTMLInputElement>(null);
  const setUserError = useLabelStore((s) => s.setUserError);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);

  const importCsvData = (filename: string, bytes: Uint8Array, token: number) => {
    // The context changed during the pick/read (another document loaded): drop
    // the import rather than commit it into a document it wasn't picked for.
    if (!isCurrentDataContext(token)) return;
    // Re-read store state AFTER the file IO so a discard/replace that
    // happened meanwhile doesn't drive the decision off a stale snapshot.
    const { columnMapping, dataset } = useLabelStore.getState();
    // Re-use the parse options the mapping was last applied with so a
    // headerless / windows-1252 / semicolon-delimited dataset doesn't
    // get re-parsed under defaults and falsely flagged as "different".
    const persistedOpts = columnMapping?.parseOptions;
    const encoding = persistedOpts?.encoding ?? "utf-8";
    let text: string;
    try {
      text = new TextDecoder(encoding).decode(bytes);
    } catch {
      setUserError(csvParseErrors.read_failed);
      return;
    }
    const result = parseCsvText(text, {
      filename,
      delimiter: persistedOpts?.delimiter,
      hasHeaderRow: persistedOpts?.hasHeaderRow,
      skipRows: persistedOpts?.skipRows,
      encoding,
    });
    if (!result.ok) {
      setUserError(csvParseErrors[result.error]);
      return;
    }

    const parsed: ParsedImport = { filename, bytes, result: result.value };

    // Fresh import (nothing to overwrite): commit immediately. The
    // mapping-modal auto-open (driven by absent or incompatible
    // mapping) inside applyImport handles UX from there.
    if (!dataset) {
      applyImport(parsed, { keepMapping: true });
      onApplied?.();
      return;
    }

    // Existing dataset → confirm before overwriting. Compatibility
    // controls the dialog shape (single Replace vs. three-way choice).
    setPendingImport({
      kind:
        columnMapping && isMappingCompatibleWith(columnMapping, result.value.headers)
          ? "same"
          : "different",
      parsed,
      token,
      replacingFilename: datasetDisplayName(dataset.source),
      wasHeaderless: columnMapping?.parseOptions?.hasHeaderRow === false,
      previousColumnCount: columnMapping?.headerSnapshot.length ?? 0,
    });
  };

  const handleCsvImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    // Web: the browser file dialog is modal (no doc swap while it is open), so
    // sampling here, before the read, covers the only exploitable async gap.
    const token = currentDataContext();
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      setUserError(csvParseErrors.read_failed);
      return;
    }
    importCsvData(file.name, bytes, token);
  };

  // No clear here: a cancelled pick keeps any existing error; a committed
  // import clears it in applyImport instead.
  const openCsvPicker = () => {
    // Desktop: sample before the native dialog opens, so an MCP doc-load while
    // the picker is open supersedes this import (parity with the excel picker).
    const token = currentDataContext();
    pickViaMenu(
      csvInputRef,
      () => pickFileBytes(CSV_FILTER),
      (picked) => importCsvData(picked.name, picked.bytes, token),
      () => setUserError(csvParseErrors.read_failed),
    );
  };

  const confirmPendingImport = (opts: { keepMapping: boolean }) => {
    if (!pendingImport) return;
    // Drop the import if the data context changed while the confirm was open
    // (another dataset loaded, or the whole document was replaced): applying
    // it now would overwrite the new context the user moved on to.
    if (isCurrentDataContext(pendingImport.token)) {
      applyImport(pendingImport.parsed, opts);
      onApplied?.();
    }
    setPendingImport(null);
  };

  const cancelPendingImport = () => setPendingImport(null);

  return {
    csvInputRef,
    handleCsvImport,
    openCsvPicker,
    pendingImport,
    confirmPendingImport,
    cancelPendingImport,
  };
}

/** Commit a parsed import to the store + module cache. Optionally
 *  drop the existing mapping (Discard path). Surfaces the mapping
 *  modal whenever the resulting state needs user review: no mapping
 *  (fresh / discarded) or a kept-but-incompatible mapping. */
function applyImport(p: ParsedImport, opts: { keepMapping: boolean }): void {
  const { loadDataset, setColumnMapping, openMappingModal, columnMapping, clearUserError } =
    useLabelStore.getState();
  // All-or-nothing under a source edit: setColumnMapping would be blocked
  // while loadDataset went through, leaving a dataset under a stale mapping.
  if (selectSourceEditing(useLabelStore.getState())) return;
  rememberImport(p.bytes);
  const effectiveMapping: ColumnMapping | null = opts.keepMapping ? columnMapping : null;
  if (!opts.keepMapping) setColumnMapping(null);
  loadDataset(p.result);
  clearUserError();
  if (needsMappingReview(effectiveMapping, p.result.headers)) openMappingModal();
}

import { useEffect, useMemo, useState } from 'react';
import { useLabelStore } from '../../store/labelStore';
import { useT } from '../../hooks/useT';
import {
  nextDefaultVariableName,
  nextFreeFnNumber,
  suggestColumnMapping,
  isValidVariableName,
  isMappingCompatibleWith,
  dbExcelParseOptions,
  type ColumnMapping,
  type CsvParseOptionsPersisted,
  type Variable,
} from '@zplab/core/types/Variable';
import type { DatasetInput } from '@zplab/core/types/DataSource';
import { decodeImportedText, parseCsvText } from '../../lib/csvImport';
import { newId } from '@zplab/core/lib/ids';

export interface DraftOptions {
  /** Stored as PapaParse delimiter string. '' means auto-detect. */
  delimiter: string;
  hasHeaderRow: boolean;
  skipRows: number;
  /** TextDecoder label; the dropdown surfaces a curated subset (any label works). */
  encoding: string;
}

/** Everything the mapping body renders and the chrome (modal / wizard step)
 *  needs to drive its footer. The draft lifecycle (clone on mount, atomic
 *  apply, discard on unmount) lives here so both consumers share one core. */
export interface MappingDraft {
  /** False when there is no dataset or the CSV cache is empty; the chrome then
   *  shows a close-only / import-first affordance instead of the editor. */
  hasEditableDataset: boolean;
  csvSource: boolean;
  draftVariables: Variable[];
  draftBindings: Record<string, string>;
  draftOptions: DraftOptions;
  setDraftOptions: (next: DraftOptions) => void;
  draftRow: number;
  setDraftRow: (n: number) => void;
  virtualHeaders: string[];
  virtualRows: readonly (readonly string[])[];
  initialVariableIds: ReadonlySet<string>;
  duplicateHeaders: ReadonlySet<string>;
  nameErrors: Record<string, string>;
  allSlotsTaken: boolean;
  showMismatchWarning: boolean;
  parseError: boolean;
  setDraftVariableName: (id: string, name: string) => void;
  changeBinding: (variableId: string, value: string) => void;
  removeDraftVariable: (id: string) => void;
  addVariable: () => void;
  /** True when the draft can be committed (valid names, parseable CSV). */
  canApply: boolean;
  /** Commit the whole bundle atomically; caller decides what to do next. */
  apply: () => void;
}

/** Owns the Variable → column mapping draft (variable list, bindings, active
 *  row, CSV parse options), cloned from the store on mount. Live re-parse of
 *  the cached raw text drives the table so option tweaks feel instant. */
export function useMappingDraft(): MappingDraft {
  const tv = useT().variables;
  const variables = useLabelStore((s) => s.variables);
  const columnMapping = useLabelStore((s) => s.columnMapping);
  const dataset = useLabelStore((s) => s.dataset);
  const applyMappingDraft = useLabelStore((s) => s.applyMappingDraft);
  // A db dataset is already tabular: no raw-text cache, no re-parse, no CSV
  // options; the draft binds directly against the fetched headers/rows.
  const csvSource = dataset === null || dataset.source.kind === 'csv';
  const csvMeta = dataset !== null && dataset.source.kind === 'csv' ? dataset.source : null;

  // Lazy useState initialiser, so the store snapshot doesn't re-seed each render.
  const [draftVariables, setDraftVariables] = useState<Variable[]>(() => [...variables]);
  // IDs already in the store at open, so rows that exist only in the draft
  // (added inline) can be flagged "will be created".
  const [initialVariableIds] = useState<ReadonlySet<string>>(
    () => new Set(variables.map((v) => v.id)),
  );
  const [draftOptions, setDraftOptions] = useState<DraftOptions>(() => ({
    // Seed from the persisted mapping first (so a reopen reflects the last
    // Apply), then the dataset's source metadata (import-time values), then
    // library defaults.
    delimiter: columnMapping?.parseOptions?.delimiter ?? csvMeta?.delimiter ?? '',
    hasHeaderRow: columnMapping?.parseOptions?.hasHeaderRow ?? true,
    skipRows: columnMapping?.parseOptions?.skipRows ?? 0,
    encoding: columnMapping?.parseOptions?.encoding ?? csvMeta?.encoding ?? 'utf-8',
  }));

  // Always re-decode the cached raw bytes for the chosen encoding, including
  // utf-8: reusing the import-time text would keep a prior wrong-encoding
  // decode, so switching back to utf-8 couldn't rescue a mis-decoded file.
  const rawText = useMemo(() => {
    if (!csvSource) return null;
    return decodeImportedText(draftOptions.encoding);
  }, [csvSource, draftOptions.encoding]);
  const [draftRow, setDraftRow] = useState<number>(dataset?.activeRowIndex ?? 0);

  // Live re-parse from the (possibly re-decoded) raw text whenever options
  // change. Synchronous + memoised so option tweaks feel instant.
  const draftParse = useMemo(() => {
    if (!rawText) return null;
    return parseCsvText(rawText, {
      delimiter: draftOptions.delimiter || undefined,
      hasHeaderRow: draftOptions.hasHeaderRow,
      skipRows: draftOptions.skipRows,
      encoding: draftOptions.encoding,
      filename: csvMeta?.filename,
    });
  }, [rawText, draftOptions, csvMeta?.filename]);

  const virtualHeaders = useMemo(
    () => (draftParse?.ok ? draftParse.value.headers : dataset?.headers ?? []),
    [draftParse, dataset?.headers],
  );
  const virtualRows = useMemo(
    () => (draftParse?.ok ? draftParse.value.rows : dataset?.rows ?? []),
    [draftParse, dataset?.rows],
  );

  const [draftBindings, setDraftBindings] = useState<Record<string, string>>(() =>
    buildInitialBindings(columnMapping, draftVariables, virtualHeaders),
  );
  // Variables the user explicitly set to (unmapped): auto-suggest must not
  // re-attach a column they just deliberately removed.
  const [explicitlyUnmapped, setExplicitlyUnmapped] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  useEffect(() => {
    setDraftBindings((prev) => {
      const headerSet = new Set(virtualHeaders);
      const filtered: Record<string, string> = {};
      let changed = false;
      for (const [varId, header] of Object.entries(prev)) {
        if (headerSet.has(header)) filtered[varId] = header;
        else changed = true;
      }
      // Inline-added drafts and explicitly-unmapped rows are excluded from
      // auto-suggest, so a freshly added row's default name can't silently
      // attach to a fuzzy-matching header.
      const unboundVars = draftVariables.filter(
        (v) => initialVariableIds.has(v.id) && !(v.id in filtered) && !explicitlyUnmapped.has(v.id),
      );
      const usedHeaders = new Set(Object.values(filtered));
      const freeHeaders = virtualHeaders.filter((h) => !usedHeaders.has(h));
      const suggested = suggestColumnMapping(unboundVars, freeHeaders);
      const merged = { ...filtered, ...suggested };
      if (!changed && Object.keys(suggested).length === 0) return prev;
      return merged;
    });
  }, [virtualHeaders, draftVariables, initialVariableIds, explicitlyUnmapped]);

  // Clamp active-row to virtual rows length (an option change may have shrunk
  // the dataset).
  useEffect(() => {
    if (virtualRows.length === 0) return;
    setDraftRow((r) => Math.min(r, virtualRows.length - 1));
  }, [virtualRows.length]);

  // Headers bound by more than one variable: almost always a mistake, flagged
  // inline so the user notices before Apply.
  const duplicateHeaders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of Object.values(draftBindings)) {
      counts.set(h, (counts.get(h) ?? 0) + 1);
    }
    const dups = new Set<string>();
    for (const [h, n] of counts) if (n > 1) dups.add(h);
    return dups;
  }, [draftBindings]);

  // Name validity per row. Empty is always invalid; duplicate (trimmed) is
  // invalid for every row sharing the value; then the identifier rule.
  const nameErrors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of draftVariables) {
      const trimmed = v.name.trim();
      counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
    }
    const errors: Record<string, string> = {};
    for (const v of draftVariables) {
      const trimmed = v.name.trim();
      if (trimmed === '') errors[v.id] = tv.csvNameEmpty;
      else if ((counts.get(trimmed) ?? 0) > 1) errors[v.id] = tv.csvNameDuplicate;
      else if (!isValidVariableName(trimmed)) errors[v.id] = tv.nameInvalid;
    }
    return errors;
  }, [draftVariables, tv.csvNameEmpty, tv.csvNameDuplicate, tv.nameInvalid]);
  const hasNameError = Object.keys(nameErrors).length > 0;

  const setDraftVariableName = (id: string, name: string) => {
    setDraftVariables((prev) => prev.map((x) => (x.id === id ? { ...x, name } : x)));
  };

  const changeBinding = (variableId: string, value: string) => {
    // Track the explicit (unmapped) so the auto-suggest effect leaves it be.
    setExplicitlyUnmapped((prev) => {
      const next = new Set(prev);
      if (value === '') next.add(variableId);
      else next.delete(variableId);
      return next;
    });
    setDraftBindings((prev) => {
      if (value === '') {
        if (!(variableId in prev)) return prev;
        const { [variableId]: _drop, ...next } = prev;
        void _drop;
        return next;
      }
      return { ...prev, [variableId]: value };
    });
  };

  const removeDraftVariable = (id: string) => {
    setDraftVariables((prev) => prev.filter((v) => v.id !== id));
    setDraftBindings((prev) => {
      if (!(id in prev)) return prev;
      const { [id]: _drop, ...rest } = prev;
      void _drop;
      return rest;
    });
  };

  const addVariable = () => {
    // The updater re-checks against prev so chained adds compute slot/name from
    // the up-to-date list; the caller gates the button on allSlotsTaken.
    setDraftVariables((prev) => {
      const fn = nextFreeFnNumber(prev.map((v) => v.fnNumber));
      if (fn === null) return prev;
      const newVar: Variable = {
        id: newId(),
        name: nextDefaultVariableName(prev),
        fnNumber: fn,
        defaultValue: '',
      };
      return [...prev, newVar];
    });
  };

  const apply = () => {
    // CSV commits the freshly-parsed rows; db/excel commit the already-loaded
    // dataset. dbExcelParseOptions keeps the carried options safe for re-import.
    if (!dataset) return;
    let ds: DatasetInput;
    let parseOptions: CsvParseOptionsPersisted | undefined;
    if (csvSource) {
      if (!draftParse?.ok) return;
      ds = draftParse.value;
      parseOptions = persistableParseOptions(draftOptions);
    } else {
      ds = dataset;
      parseOptions = dbExcelParseOptions(columnMapping?.parseOptions);
    }
    applyMappingDraft({
      variables: draftVariables,
      dataset: ds,
      mapping: { bindings: draftBindings, headerSnapshot: ds.headers, parseOptions },
      activeRowIndex: draftRow,
    });
  };

  // Warn only when the mapping actually stops fitting, not on a pure column
  // reorder (name-based mappings are order-independent).
  const showMismatchWarning =
    columnMapping !== null && !isMappingCompatibleWith(columnMapping, virtualHeaders);
  const allSlotsTaken = nextFreeFnNumber(draftVariables.map((v) => v.fnNumber)) === null;
  const parseError = draftParse !== null && !draftParse.ok;
  const hasEditableDataset = dataset !== null && !(csvSource && !rawText);
  const canApply = !((csvSource && !draftParse?.ok) || hasNameError);

  return {
    hasEditableDataset,
    csvSource,
    draftVariables,
    draftBindings,
    draftOptions,
    setDraftOptions,
    draftRow,
    setDraftRow,
    virtualHeaders,
    virtualRows,
    initialVariableIds,
    duplicateHeaders,
    nameErrors,
    allSlotsTaken,
    showMismatchWarning,
    parseError,
    setDraftVariableName,
    changeBinding,
    removeDraftVariable,
    addVariable,
    canApply,
    apply,
  };
}

/** Build the initial draft-bindings: keep existing mapping entries whose header
 *  is still present in the current parse, then auto-suggest for the rest. */
function buildInitialBindings(
  columnMapping: ColumnMapping | null,
  variables: readonly Variable[],
  headers: readonly string[],
): Record<string, string> {
  const headerSet = new Set(headers);
  // Only carry bindings for variables that still exist; a stale id (deleted
  // variable) would otherwise be re-saved and block its header from auto-suggest.
  const liveIds = new Set(variables.map((v) => v.id));
  const carried: Record<string, string> = {};
  if (columnMapping) {
    for (const [varId, header] of Object.entries(columnMapping.bindings)) {
      if (headerSet.has(header) && liveIds.has(varId)) carried[varId] = header;
    }
  }
  const unmapped = variables.filter((v) => !(v.id in carried));
  const usedHeaders = new Set(Object.values(carried));
  const free = headers.filter((h) => !usedHeaders.has(h));
  const suggested = suggestColumnMapping(unmapped, free);
  return { ...carried, ...suggested };
}

/** Strip default values so a saved mapping only carries options the user
 *  actually customised. */
function persistableParseOptions(d: DraftOptions): CsvParseOptionsPersisted | undefined {
  const opts: CsvParseOptionsPersisted = {};
  if (d.delimiter !== '') opts.delimiter = d.delimiter;
  if (d.hasHeaderRow === false) opts.hasHeaderRow = false;
  if (d.skipRows > 0) opts.skipRows = d.skipRows;
  if (d.encoding !== 'utf-8') opts.encoding = d.encoding;
  return Object.keys(opts).length === 0 ? undefined : opts;
}

import { useEffect, useMemo, useState } from 'react';
import { PlusIcon, TableCellsIcon, XMarkIcon } from '@heroicons/react/16/solid';
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
import {
  decodeImportedText,
  parseCsvText,
} from '../../lib/csvImport';
import { DialogShell } from '../ui/DialogShell';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { inputCls } from '../Properties/styles';
import { Select } from '../ui/Select';
import { getVariableSource } from '@zplab/core/lib/variableBinding';
import { VariableSourceBadge } from './VariableSourceBadge';
import { Tooltip } from '../ui/Tooltip';


import { newId } from "@zplab/core/lib/ids";
interface Props {
  onClose: () => void;
  /** Opens the CSV file picker (the same one as the File menu's import). */
  onImportCsv: () => void;
}

interface DraftOptions {
  /** Stored as PapaParse delimiter string. '' means auto-detect. */
  delimiter: string;
  hasHeaderRow: boolean;
  skipRows: number;
  /** TextDecoder label. 'utf-8' is the default; common alternatives
   *  cover German Excel exports (windows-1252) and legacy Latin
   *  files. The dropdown is curated; arbitrary TextDecoder labels
   *  would also work but aren't surfaced. */
  encoding: string;
}

/** Modal for editing the Variable → CSV-column mapping and the
 *  associated CSV parse options. Full draft pattern: variable list,
 *  bindings, active row and parse options are cloned on open; Apply
 *  commits the whole bundle atomically; Cancel discards everything.
 *  Live re-parse of the cached raw text drives the table whenever
 *  options change, so the user sees the effect immediately. */
export function VariableMappingModal({ onClose, onImportCsv }: Props) {
  const t = useT();
  const tv = t.variables;
  const variables = useLabelStore((s) => s.variables);
  const columnMapping = useLabelStore((s) => s.columnMapping);
  const dataset = useLabelStore((s) => s.dataset);
  const applyMappingDraft = useLabelStore((s) => s.applyMappingDraft);
  // A db dataset is already tabular: no raw-text cache, no re-parse, no CSV
  // options; the draft binds directly against the fetched headers/rows.
  const csvSource = dataset === null || dataset.source.kind === 'csv';
  const csvMeta = dataset !== null && dataset.source.kind === 'csv' ? dataset.source : null;

  // Draft state, initialised once at modal-open. The init-from-prop
  // pattern is the React-blessed way to seed local state from props
  // without re-running on every render.
  const [draftVariables, setDraftVariables] = useState<Variable[]>(() => [
    ...variables,
  ]);
  // Snapshot of variable IDs that were already in the store at
  // modal-open. Used to flag "will be created" on rows that exist
  // only in the draft (added inline via the + Add variable button)
  // so the user understands they haven't committed yet.
  const [initialVariableIds] = useState<ReadonlySet<string>>(
    () => new Set(variables.map((v) => v.id)),
  );
  const [draftOptions, setDraftOptions] = useState<DraftOptions>(() => ({
    // Seed from the persisted mapping first (so a reopen reflects the
    // last Apply), then fall back to the dataset's source metadata
    // (the values active at import time), then to library defaults.
    delimiter:
      columnMapping?.parseOptions?.delimiter ??
      csvMeta?.delimiter ??
      '',
    hasHeaderRow: columnMapping?.parseOptions?.hasHeaderRow ?? true,
    skipRows: columnMapping?.parseOptions?.skipRows ?? 0,
    encoding:
      columnMapping?.parseOptions?.encoding ??
      csvMeta?.encoding ??
      'utf-8',
  }));

  // Always re-decode the cached raw bytes for the chosen encoding, including
  // utf-8: reusing the import-time text would keep a prior wrong-encoding
  // decode, so switching back to utf-8 couldn't rescue a mis-decoded file.
  const rawText = useMemo(() => {
    if (!csvSource) return null;
    return decodeImportedText(draftOptions.encoding);
  }, [csvSource, draftOptions.encoding]);
  const [draftRow, setDraftRow] = useState<number>(
    dataset?.activeRowIndex ?? 0,
  );
  const [addError, setAddError] = useState<string | null>(null);

  // Live re-parse from the (possibly re-decoded) raw text whenever
  // options change. Synchronous + memoised so option-tweaks feel
  // instant.
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

  // Memoise so the useEffect deps below stay reference-stable across
  // renders that didn't change the underlying parse.
  const virtualHeaders = useMemo(
    () => (draftParse?.ok ? draftParse.value.headers : dataset?.headers ?? []),
    [draftParse, dataset?.headers],
  );
  const virtualRows = useMemo(
    () => (draftParse?.ok ? draftParse.value.rows : dataset?.rows ?? []),
    [draftParse, dataset?.rows],
  );

  // Bindings draft. Seeded from existing mapping (only entries whose
  // header still exists in the virtual parse), then auto-suggest fills
  // the rest. Re-derived when virtualHeaders change so newly-vanished
  // headers drop out and newly-appeared ones can be auto-suggested.
  const [draftBindings, setDraftBindings] = useState<Record<string, string>>(
    () => buildInitialBindings(columnMapping, draftVariables, virtualHeaders),
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

  // Clamp active-row to virtual rows length (option-change may have
  // shrunk the dataset).
  useEffect(() => {
    if (virtualRows.length === 0) return;
    setDraftRow((r) => Math.min(r, virtualRows.length - 1));
  }, [virtualRows.length]);

  // Headers that are bound by more than one variable. Almost always a
  // mistake (the same column would feed two slots and produce confusing
  // labels); flagged inline so the user notices before Apply.
  const duplicateHeaders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of Object.values(draftBindings)) {
      counts.set(h, (counts.get(h) ?? 0) + 1);
    }
    const dups = new Set<string>();
    for (const [h, n] of counts) if (n > 1) dups.add(h);
    return dups;
  }, [draftBindings]);

  // Compute name validity per row. Empty-name is always invalid;
  // duplicate-name is invalid for every row sharing the same trimmed
  // value. Duplicates are computed against trimmed text so trailing
  // whitespace doesn't accidentally "fix" the collision. Computed
  // before the defensive early-return so the hook order is stable.
  const nameErrors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of draftVariables) {
      const t = v.name.trim();
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const errors: Record<string, string> = {};
    for (const v of draftVariables) {
      const t = v.name.trim();
      if (t === '') errors[v.id] = tv.csvNameEmpty;
      else if ((counts.get(t) ?? 0) > 1) errors[v.id] = tv.csvNameDuplicate;
      else if (!isValidVariableName(t)) errors[v.id] = tv.nameInvalid;
    }
    return errors;
  }, [draftVariables, tv.csvNameEmpty, tv.csvNameDuplicate, tv.nameInvalid]);
  const hasNameError = Object.keys(nameErrors).length > 0;

  if (!dataset || (csvSource && !rawText)) {
    // Defensive: trigger paths gate on dataset, but if the cache is
    // empty (e.g. user reloaded the page mid-session) show a friendly
    // close-only shell.
    return (
      <DialogShell
        onClose={onClose}
        labelledBy="variable-mapping-title"
        boxClassName="bg-surface border border-border rounded-lg w-80 shadow-2xl"
      >
        <div className="p-4 font-mono text-xs text-muted">
          <p className="mb-3">{tv.csvNoCsvLoaded}</p>
          <div className="flex items-center gap-2">
            <button
              onClick={onImportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono bg-accent text-bg hover:opacity-90 transition-opacity"
            >
              <TableCellsIcon className="w-3.5 h-3.5" />
              {t.app.importCsvData}
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded text-xs font-mono text-text border border-border hover:bg-surface-2 transition-colors"
            >
              {tv.csvClose}
            </button>
          </div>
        </div>
      </DialogShell>
    );
  }

  const handleChangeBinding =
    (variableId: string) => (value: string) => {
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

  const handleRemoveDraftVariable = (id: string) => {
    setDraftVariables((prev) => prev.filter((v) => v.id !== id));
    setDraftBindings((prev) => {
      if (!(id in prev)) return prev;
      const { [id]: _drop, ...rest } = prev;
      void _drop;
      return rest;
    });
  };

  const handleAddVariable = () => {
    // Eligibility check first against the current snapshot so the
    // error message doesn't depend on closure mutation from inside
    // setDraftVariables (StrictMode runs updaters twice, concurrent
    // rendering may defer them). The updater itself re-checks against
    // prev so chained adds compute slot/name from the up-to-date
    // list and don't collide. Residual edge case: two clicks in one
    // batch both pass the outer check, but only the first commits a
    // new row; no error surfaces for the swallowed second.
    if (nextFreeFnNumber(draftVariables.map((v) => v.fnNumber)) === null) {
      setAddError(tv.noSlotsLeft);
      return;
    }
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
    setAddError(null);
  };

  const handleConfirm = () => {
    // CSV commits the freshly-parsed rows; db/excel commit the already-loaded
    // dataset. dbExcelParseOptions keeps the carried options safe for re-import.
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
    onClose();
  };

  // Warn only when the mapping actually stops fitting, not on a pure column
  // reorder (name-based mappings are order-independent, per isMappingCompatibleWith).
  const showMismatchWarning =
    columnMapping !== null && !isMappingCompatibleWith(columnMapping, virtualHeaders);

  const allSlotsTaken =
    nextFreeFnNumber(draftVariables.map((v) => v.fnNumber)) === null;

  const parseError = draftParse && !draftParse.ok;

  return (
    <DialogShell
      onClose={onClose}
      labelledBy="variable-mapping-title"
      boxClassName="bg-surface border border-border rounded-lg w-128 flex flex-col shadow-2xl max-h-[85vh]"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <span
          id="variable-mapping-title"
          className="font-mono text-xs text-muted uppercase tracking-widest"
        >
          {tv.csvMappingTitle}
        </span>
        <button
          onClick={onClose}
          aria-label={tv.csvClose}
          className="p-0.5 rounded text-muted hover:text-text hover:bg-surface-2 transition-colors"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-col gap-4 px-4 py-4 overflow-y-auto">
        <p className="font-mono text-[10px] text-muted leading-relaxed">
          {tv.csvMappingHint}
        </p>

        {showMismatchWarning && (
          <p className="font-mono text-[10px] text-amber-400 leading-relaxed">
            {tv.csvHeaderMismatchWarning}
          </p>
        )}

        {parseError && (
          <p className="font-mono text-[10px] text-amber-400">
            {tv.csvParseError}
          </p>
        )}

        <div className="flex flex-col border border-border/50 rounded">
        <div className="max-h-72 overflow-y-auto">
        <table className="w-full text-xs font-mono">
          <thead className="sticky top-0 bg-surface z-10">
            <tr className="text-left text-muted uppercase text-[10px] tracking-wider">
              <th className="pb-2 pt-2 px-3 font-medium">{tv.csvVariableHeader}</th>
              <th className="pb-2 pt-2 pr-3 font-medium">{tv.csvColumnHeader}</th>
              <th className="pb-2 pt-2 pr-3 font-medium">{tv.csvSampleHeader}</th>
            </tr>
          </thead>
          <tbody>
            {draftVariables.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-3 px-3 text-muted italic text-[10px]">
                  {tv.csvNoVariables}
                </td>
              </tr>
            ) : (
              draftVariables.map((v) => {
                const nameError = nameErrors[v.id];
                const isNew = !initialVariableIds.has(v.id);
                const boundHeader = draftBindings[v.id];
                const isDuplicate =
                  boundHeader !== undefined && duplicateHeaders.has(boundHeader);
                // Classify against the draft (not the committed store
                // state) so the badge reflects live binding edits before
                // Apply. Both inputs synthesised here have the minimal
                // shape getVariableSource needs.
                const draftSource = getVariableSource(
                  v,
                  { headers: virtualHeaders },
                  { bindings: draftBindings, headerSnapshot: virtualHeaders as string[] },
                );
                return (
                  <tr key={v.id} className="border-t border-border/50 align-top">
                    <td className="py-1.5 px-3">
                      <div className="flex items-center gap-1">
                        <VariableSourceBadge
                          source={draftSource}
                          boundHeader={draftBindings[v.id]}
                          size="xs"
                        />
                        <input
                          className={`${inputCls} ${nameError ? 'border-amber-400' : ''}`}
                          value={v.name}
                          onChange={(e) => {
                            const newName = e.target.value;
                            setDraftVariables((prev) =>
                              prev.map((x) => (x.id === v.id ? { ...x, name: newName } : x)),
                            );
                          }}
                        />
                        {isNew && (
                          <Tooltip content={tv.csvRemoveDraftAria}>
                            <button
                              onClick={() => handleRemoveDraftVariable(v.id)}
                              aria-label={tv.csvRemoveDraftAria}
                              className="shrink-0 p-1 rounded text-muted hover:text-amber-400 hover:bg-surface-2 transition-colors"
                            >
                              <XMarkIcon className="w-3 h-3" />
                            </button>
                          </Tooltip>
                        )}
                      </div>
                      {nameError ? (
                        <p className="mt-0.5 font-mono text-[9px] text-amber-400">
                          {nameError}
                        </p>
                      ) : isNew ? (
                        <p className="mt-0.5 font-mono text-[9px] text-accent/70 italic">
                          {tv.csvWillBeCreated}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-1.5 pr-3">
                      <div className={isDuplicate ? 'rounded border border-amber-400' : ''}>
                        <Select<string>
                          value={boundHeader ?? ''}
                          onChange={handleChangeBinding(v.id)}
                          groups={[
                            {
                              options: [
                                { value: '', label: tv.csvIgnoreOption },
                                ...virtualHeaders.map((h) => ({ value: h, label: h })),
                              ],
                            },
                          ]}
                        />
                      </div>
                      {isDuplicate && (
                        <p className="mt-0.5 font-mono text-[9px] text-amber-400">
                          {tv.csvDuplicateColumn}
                        </p>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 align-middle">
                      {(() => {
                        // Sample value for the active preview row. When
                        // bound + header present in current parse →
                        // cell from virtualRows[draftRow]. Otherwise
                        // show the variable's default (or empty marker)
                        // so the user always knows what would print.
                        if (boundHeader !== undefined) {
                          const colIdx = virtualHeaders.indexOf(boundHeader);
                          const cell =
                            colIdx >= 0
                              ? virtualRows[draftRow]?.[colIdx] ?? ''
                              : '';
                          return cell === '' ? (
                            <span className="text-[10px] text-muted italic">
                              {tv.csvSampleEmpty}
                            </span>
                          ) : (
                            <span className="text-[10px] text-text truncate block max-w-[120px]" title={cell}>
                              {cell}
                            </span>
                          );
                        }
                        return (
                          <span
                            className="text-[10px] text-muted italic truncate block max-w-[120px]"
                            title={v.defaultValue || tv.csvSamplePlaceholder}
                          >
                            {v.defaultValue || tv.csvSamplePlaceholder}
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>
        <div className="border-t border-border/50 px-3 py-2 flex flex-col gap-2">
          <button
            onClick={handleAddVariable}
            disabled={allSlotsTaken}
            className="self-start flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono border border-dashed border-border text-muted hover:text-text hover:border-border-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            {tv.add}
          </button>
          {addError && (
            <p className="font-mono text-[10px] text-amber-400">{addError}</p>
          )}
        </div>
        </div>

        {virtualRows.length > 0 && (
          <Tooltip content={tv.csvActiveRowTooltip} className="w-full">
          <div className="flex w-full items-center gap-2 font-mono text-xs text-text">
            <label htmlFor="variable-mapping-preview-row" className="text-muted">
              {tv.csvActiveRowLabel}:
            </label>
            <input
              id="variable-mapping-preview-row"
              type="number"
              min={1}
              max={virtualRows.length}
              // Inline className instead of inputCls because inputCls
              // includes w-full, which would crowd out the inline label
              // and "of N" suffix.
              className="w-20 bg-surface-2 border border-border rounded px-2 py-1 text-xs font-mono text-text focus:border-accent focus:outline-none"
              value={draftRow + 1}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!Number.isNaN(n)) {
                  setDraftRow(Math.max(0, Math.min(n - 1, virtualRows.length - 1)));
                }
              }}
            />
            <span className="text-muted">
              {tv.csvActiveRowOf} {virtualRows.length}
            </span>
          </div>
          </Tooltip>
        )}

        {csvSource && (
          <CollapsibleSection
            id="variable-mapping-csv-options"
            title={tv.csvOptionsTitle}
            defaultOpen={false}
          >
            <CsvOptionsEditor
              value={draftOptions}
              onChange={setDraftOptions}
            />
          </CollapsibleSection>
        )}
      </div>

      <div className="flex justify-end items-center gap-2 px-4 py-3 border-t border-border shrink-0">
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded text-xs font-mono text-muted hover:text-text hover:bg-surface-2 transition-colors"
        >
          {tv.cancel}
        </button>
        <button
          onClick={handleConfirm}
          disabled={(csvSource && !draftParse?.ok) || hasNameError}
          className="px-3 py-1.5 rounded text-xs font-mono bg-accent text-bg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {tv.csvApply}
        </button>
      </div>
    </DialogShell>
  );
}

interface CsvOptionsEditorProps {
  value: DraftOptions;
  onChange: (next: DraftOptions) => void;
}

function CsvOptionsEditor({ value, onChange }: CsvOptionsEditorProps) {
  const tv = useT().variables;
  return (
    <div className="flex flex-col gap-2 pt-2">
      <div className="flex flex-col gap-1">
        <label className="font-mono text-[10px] text-muted uppercase tracking-wider">
          {tv.csvDelimiterLabel}
        </label>
        <Select<string>
          value={value.delimiter}
          onChange={(delimiter) => onChange({ ...value, delimiter })}
          groups={[
            {
              options: [
                { value: '', label: tv.csvDelimiterAuto },
                { value: ',', label: tv.csvDelimiterComma },
                { value: ';', label: tv.csvDelimiterSemicolon },
                { value: '\t', label: tv.csvDelimiterTab },
              ],
            },
          ]}
        />
      </div>

      <label className="flex items-center gap-2 font-mono text-[10px] text-text cursor-pointer">
        <input
          type="checkbox"
          className="accent-accent"
          checked={value.hasHeaderRow}
          onChange={(e) => onChange({ ...value, hasHeaderRow: e.target.checked })}
        />
        {tv.csvHasHeaderRow}
      </label>

      <div className="flex flex-col gap-1">
        <label className="font-mono text-[10px] text-muted uppercase tracking-wider">
          {tv.csvSkipRowsLabel}
        </label>
        <input
          type="number"
          min={0}
          className={inputCls}
          value={value.skipRows}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            onChange({ ...value, skipRows: Math.max(0, Number.isNaN(n) ? 0 : n) });
          }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="font-mono text-[10px] text-muted uppercase tracking-wider">
          {tv.csvEncodingLabel}
        </label>
        <Select<string>
          value={value.encoding}
          onChange={(encoding) => onChange({ ...value, encoding })}
          groups={[
            {
              options: [
                { value: 'utf-8', label: tv.csvEncodingUtf8 },
                { value: 'windows-1252', label: tv.csvEncodingWin1252 },
                { value: 'iso-8859-1', label: tv.csvEncodingIso88591 },
                { value: 'utf-16le', label: tv.csvEncodingUtf16le },
              ],
            },
          ]}
        />
      </div>
    </div>
  );
}

/** Build the initial draft-bindings: keep existing mapping entries
 *  whose header is still present in the current parse, then auto-
 *  suggest for variables that have no binding yet. */
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

/** Strip default values so a saved mapping only carries the options
 *  the user actually customised. */
function persistableParseOptions(d: DraftOptions): CsvParseOptionsPersisted | undefined {
  const opts: CsvParseOptionsPersisted = {};
  if (d.delimiter !== '') opts.delimiter = d.delimiter;
  if (d.hasHeaderRow === false) opts.hasHeaderRow = false;
  if (d.skipRows > 0) opts.skipRows = d.skipRows;
  if (d.encoding !== 'utf-8') opts.encoding = d.encoding;
  return Object.keys(opts).length === 0 ? undefined : opts;
}

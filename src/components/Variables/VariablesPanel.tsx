import { useState, type ChangeEvent } from 'react';
import {
  ArrowPathIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleStackIcon,
  Cog6ToothIcon,
  InformationCircleIcon,
  PlusIcon,
  TableCellsIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/16/solid';
import { useLabelStore, selectPreviewLocksEditor } from '../../store/labelStore';
import { datasetDisplayName, dbRefDisplayName } from '@zplab/core/types/DataSource';
import { currentDataContext, isCurrentDataContext } from '../../store/datasetActions';
import { useDbConnectActions } from '../../hooks/useDbConnectActions';
import { formatTemplate } from '../../lib/formatTemplate';
import { isDesktopShell } from '../../lib/platform';
import {
  FN_NUMBER_MIN,
  FN_NUMBER_MAX,
  nextFreeFnNumber,
  nextDefaultVariableName,
  isValidVariableName,
  type Variable,
} from '@zplab/core/types/Variable';
import { inputCls } from '../Properties/styles';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Tooltip } from '../ui/Tooltip';
import { useT } from '../../hooks/useT';
import type { Translations } from '../../locales';
import { getVariableSource, type VariableSource } from '@zplab/core/lib/variableBinding';
import { countBindings } from '@zplab/core/lib/variableField';
import { VariableSourceBadge } from './VariableSourceBadge';

export function VariablesPanel() {
  const t = useT();
  const tv = t.variables;
  const variables = useLabelStore((s) => s.variables);
  const showZpl = useLabelStore((s) => s.showZplCommands);
  const pages = useLabelStore((s) => s.pages);
  const addVariable = useLabelStore((s) => s.addVariable);
  const updateVariable = useLabelStore((s) => s.updateVariable);
  const removeVariable = useLabelStore((s) => s.removeVariable);
  const dataset = useLabelStore((s) => s.dataset);
  const columnMapping = useLabelStore((s) => s.columnMapping);
  const clearDataset = useLabelStore((s) => s.clearDataset);
  const setActiveRow = useLabelStore((s) => s.setActiveRow);
  const setColumnMapping = useLabelStore((s) => s.setColumnMapping);
  const openMappingModal = useLabelStore((s) => s.openMappingModal);
  const openConnectWizard = useLabelStore((s) => s.openConnectWizard);
  const dataRenderMode = useLabelStore((s) => s.canvasSettings.dataRenderMode);
  const setCanvasSettings = useLabelStore((s) => s.setCanvasSettings);
  const dataSourceRef = useLabelStore((s) => s.dataSourceRef);
  const previewLocked = useLabelStore(selectPreviewLocksEditor);
  const { reconnect } = useDbConnectActions();
  // The discard confirm is destructive and scoped to the dataset it was opened
  // for; hold the data-context epoch (not a bare bool) so a document swap while
  // it's open can't resurface it and clearDataset a different, newer dataset.
  const [discardToken, setDiscardToken] = useState<number | null>(null);
  const discardOpen = discardToken !== null && isCurrentDataContext(discardToken);
  // Preview renders one row, so stepping under it would leave a stale image.
  const rowStepDisabled = dataRenderMode === 'schema' || previewLocked;
  // A db-linked design with no rows this session offers one-click reconnect
  // (desktop only, the connector is native). The saved-mapping hint is the
  // mutually-exclusive fallback, so both gate on this one rule.
  const canReconnect = !dataset && !!dataSourceRef && isDesktopShell;

  // Mapping completeness for the badge's secondary line. Reuse the core
  // "is this variable live-bound" rule (getVariableSource) so this count can't
  // drift from the per-row badges below or VariableCsvPanel's mapped count.
  const mappedCount = variables.filter(
    (v) => getVariableSource(v, dataset, columnMapping) === 'bound',
  ).length;

  const [pendingDelete, setPendingDelete] = useState<Variable | null>(null);

  // Per-row local rejection state. The store silently no-ops invalid
  // updates (collision / range), so the input would visually snap back
  // without explanation. Tracking the rejection here lets us flash a
  // one-line hint under the offending input.
  const [rowError, setRowError] = useState<Record<string, string>>({});
  /** Panel-wide message for the one case that has no row to attach to:
   *  add-variable rejected because all 99 slots are taken. */
  const [panelError, setPanelError] = useState<string | null>(null);

  // An external update (undo/redo, File>Open, MCP push) changes a variable's
  // identity outside tryUpdate, leaving its stale rejection hint. Drop any
  // rowError whose variable object changed since the last render.
  const [prevVars, setPrevVars] = useState(variables);
  if (prevVars !== variables) {
    setPrevVars(variables);
    const byId = new Map(prevVars.map((v) => [v.id, v]));
    setRowError((prev) => {
      const kept = Object.entries(prev).filter(
        ([id]) => variables.find((v) => v.id === id) === byId.get(id),
      );
      return kept.length === Object.keys(prev).length ? prev : Object.fromEntries(kept);
    });
  }

  const bindingCounts = countBindings(pages, variables);
  const allSlotsTaken =
    nextFreeFnNumber(variables.map((v) => v.fnNumber)) === null;

  const handleAdd = () => {
    const base = nextDefaultVariableName(variables);
    const id = addVariable({ name: base });
    if (id === null) {
      // Name collisions on a fresh `var_n` are essentially impossible
      // since `n` is unique; the only realistic null path is exhausted
      // ^FN slots.
      setPanelError(tv.noSlotsLeft);
      return;
    }
    setPanelError(null);
  };

  const setRowMsg = (id: string, msg: string) =>
    setRowError((prev) => ({ ...prev, [id]: msg }));

  const tryUpdate = (id: string, changes: Partial<Variable>, errKey: string) => {
    const before = variables.find((v) => v.id === id);
    updateVariable(id, changes);
    const after = useLabelStore.getState().variables.find((v) => v.id === id);
    // The store applies updates by reference replacement; if nothing
    // changed the rejection happened (uniqueness / range). `before` is a
    // snapshot of the pre-update entry, so reference equality means the
    // store kept the old one verbatim.
    if (before && after === before) {
      setRowMsg(id, errKey);
    } else {
      setRowError((prev) => {
        if (!(id in prev)) return prev;
        // Destructure-omit the cleared key. Dynamic `delete` is linted
        // out for hot-paths; rest-spread is the idiomatic alternative.
        const { [id]: _drop, ...next } = prev;
        void _drop;
        return next;
      });
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      {variables.length > 0 && (
        <div className="flex items-start justify-between gap-2">
          {/* Persistent entry: the empty-state CTA is gone once variables exist,
              but connecting data is exactly then most useful. */}
          <button
            onClick={openConnectWizard}
            className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-muted hover:text-text hover:bg-surface-2 border border-border transition-colors"
          >
            <TableCellsIcon className="w-3 h-3" />
            {tv.connectData}
          </button>
          <Tooltip
            content={
              dataRenderMode === 'preview'
                ? dataset
                  ? tv.csvBadgePreviewTip
                  : tv.csvBadgePreviewTipNoCsv
                : tv.csvBadgeSchemaTip
            }
          >
            <button
              onClick={() =>
                setCanvasSettings({
                  dataRenderMode:
                    dataRenderMode === 'preview' ? 'schema' : 'preview',
                })
              }
              className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                dataRenderMode === 'preview'
                  ? 'text-accent bg-[--color-accent-dim]'
                  : 'text-muted hover:text-text hover:bg-surface-2 border border-border'
              }`}
            >
              {dataRenderMode === 'preview' ? tv.csvBadgePreviewMode : tv.csvBadgeSchemaMode}
            </button>
          </Tooltip>
        </div>
      )}

      {canReconnect && dataSourceRef && (
        /* Design carries a database link but no rows in this session;
           one click re-fetches (or falls back to the connect dialog when
           the saved profile is gone on this machine). */
        <div className="flex flex-col gap-1 px-2 py-1.5 rounded border border-amber-500/40 bg-amber-500/5 font-mono text-[10px] text-text">
          <div className="flex items-center gap-1.5">
            <CircleStackIcon className="w-3 h-3 shrink-0 text-amber-400" />
            <span className="flex-1 min-w-0 truncate text-amber-300">
              {tv.dbReconnectTitle}
            </span>
          </div>
          <p className="text-muted truncate">
            {dbRefDisplayName(dataSourceRef)}
          </p>
          <button
            onClick={reconnect}
            className="self-start flex items-center gap-1.5 px-2 py-1 rounded text-[10px] border border-border text-text hover:bg-surface-2 transition-colors"
          >
            <ArrowPathIcon className="w-3 h-3" />
            {tv.dbReconnectAction}
          </button>
        </div>
      )}

      {/* Web can't reconnect (Rust connector), so a db-linked design falls
          back to the generic saved-mapping hint there. */}
      {!dataset && !canReconnect && columnMapping && Object.keys(columnMapping.bindings).length > 0 && (
        /* Mapping persisted (design.json or localStorage) but no CSV
           data in this session; reload, Discard CSV, or opening a
           saved design. Surface it so the saved bindings don't look
           lost. User re-imports via the File menu's "Import CSV data"
           to bring values back; the X here drops the mapping entirely. */
        <div className="flex flex-col gap-1 px-2 py-1.5 rounded border border-amber-500/40 bg-amber-500/5 font-mono text-[10px] text-text">
          <div className="flex items-center gap-1.5">
            <TableCellsIcon className="w-3 h-3 shrink-0 text-amber-400" />
            <span className="flex-1 min-w-0 text-amber-300">
              {tv.csvSavedMappingTitle}
            </span>
            <Tooltip content={tv.csvSavedMappingDiscard}>
              <button
                onClick={() => setColumnMapping(null)}
                aria-label={tv.csvSavedMappingDiscard}
                className="shrink-0 text-muted hover:text-amber-400 transition-colors"
              >
                <XMarkIcon className="w-3 h-3" />
              </button>
            </Tooltip>
          </div>
          <p className="text-muted">
            {tv.csvSavedMappingDescFmt
              .replace('{mapped}', String(Object.keys(columnMapping.bindings).length))
              .replace('{total}', String(variables.length))}
          </p>
        </div>
      )}

      {dataset && (
        <div className="flex flex-col gap-1 px-2 py-1.5 rounded border border-border bg-surface-2 font-mono text-[10px] text-text">
          <div className="flex items-center gap-1.5">
            <TableCellsIcon className="w-3 h-3 shrink-0 text-muted" />
            <span
              className="truncate flex-1 min-w-0"
              title={datasetDisplayName(dataset.source)}
            >
              {datasetDisplayName(dataset.source)}
            </span>
            <Tooltip content={tv.csvBadgeConfigureMapping}>
              <button
                onClick={openMappingModal}
                aria-label={tv.csvBadgeConfigureMapping}
                className="shrink-0 text-muted hover:text-text transition-colors"
              >
                <Cog6ToothIcon className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
            <Tooltip content={tv.csvBadgeDiscardCsv}>
              <button
                onClick={() => setDiscardToken(currentDataContext())}
                aria-label={tv.csvBadgeDiscardCsv}
                className="shrink-0 text-muted hover:text-amber-400 transition-colors"
              >
                <XMarkIcon className="w-3 h-3" />
              </button>
            </Tooltip>
          </div>
          <p className="text-muted">
            {tv.csvBadgeRowsMappedFmt
              .replace('{rowCount}', String(dataset.source.rowCount))
              .replace('{mapped}', String(mappedCount))
              .replace('{total}', String(variables.length))}
          </p>
          {dataset.source.kind !== 'csv' && dataset.source.truncated && (
            <p className="text-amber-400">
              {formatTemplate(tv.dbTruncatedFmt, { n: String(dataset.source.rowCount) })}
            </p>
          )}
          {dataset.rows.length > 0 && (
            <div className="flex items-center gap-1 pt-0.5">
              <Tooltip content={tv.csvBadgePrevRow}>
                <button
                  onClick={() => setActiveRow(dataset.activeRowIndex - 1)}
                  disabled={dataset.activeRowIndex === 0 || rowStepDisabled}
                  aria-label={tv.csvBadgePrevRow}
                  className="p-0.5 rounded text-muted hover:text-text hover:bg-surface-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeftIcon className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
              <span className="text-muted">{tv.csvBadgeRowLabel}</span>
              <input
                type="number"
                min={1}
                max={dataset.rows.length}
                value={dataset.activeRowIndex + 1}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (!Number.isNaN(n)) setActiveRow(n - 1);
                }}
                disabled={rowStepDisabled}
                className="w-10 bg-surface-2 border border-border rounded px-1 py-0 text-[10px] font-mono text-text focus:border-accent focus:outline-none text-center disabled:opacity-30 disabled:cursor-not-allowed"
              />
              <span className="text-muted">/ {dataset.rows.length}</span>
              <Tooltip content={tv.csvBadgeNextRow}>
                <button
                  onClick={() => setActiveRow(dataset.activeRowIndex + 1)}
                  disabled={dataset.activeRowIndex === dataset.rows.length - 1 || rowStepDisabled}
                  aria-label={tv.csvBadgeNextRow}
                  className="p-0.5 rounded text-muted hover:text-text hover:bg-surface-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRightIcon className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
            </div>
          )}
        </div>
      )}

      {variables.length === 0 ? (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[10px] text-muted italic">{tv.empty}</p>
          <button
            onClick={openConnectWizard}
            className="self-start mt-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-mono bg-accent text-bg hover:opacity-90 transition-opacity"
          >
            <TableCellsIcon className="w-3.5 h-3.5" />
            {tv.connectData}
          </button>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {variables.map((entry) => {
            const source = getVariableSource(entry, dataset, columnMapping);
            const boundHeader = columnMapping?.bindings[entry.id];
            return (
              <VariableRow
                key={entry.id}
                variable={entry}
                bindings={bindingCounts.get(entry.id) ?? 0}
                source={source}
                boundHeader={boundHeader}
                error={rowError[entry.id]}
                showZpl={showZpl}
                tv={tv}
                onChangeName={(name) =>
                  tryUpdate(
                    entry.id,
                    { name },
                    isValidVariableName(name.trim()) ? tv.nameInUse : tv.nameInvalid,
                  )
                }
                onChangeFnNumber={(fnNumber) =>
                  tryUpdate(entry.id, { fnNumber }, tv.slotInUse)
                }
                onChangeDefault={(defaultValue) =>
                  tryUpdate(entry.id, { defaultValue }, '')
                }
                onRequestDelete={() => setPendingDelete(entry)}
                onDirtyChange={() =>
                  setRowError((prev) => {
                    if (!(entry.id in prev)) return prev;
                    const { [entry.id]: _drop, ...rest } = prev;
                    void _drop;
                    return rest;
                  })
                }
              />
            );
          })}
        </ul>
      )}

      <div className="flex items-center gap-1.5">
        <button
          onClick={handleAdd}
          disabled={allSlotsTaken}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs font-mono border border-dashed border-border text-muted hover:text-text hover:border-border-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <PlusIcon className="w-3.5 h-3.5" />
          {tv.add}
        </button>
        <Tooltip content={tv.panelHint}>
          <button type="button" aria-label={tv.panelHint} className="shrink-0 text-muted/60 hover:text-text cursor-help">
            <InformationCircleIcon className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </Tooltip>
      </div>

      {panelError && (
        <p className="font-mono text-[10px] text-amber-400">{panelError}</p>
      )}

      {pendingDelete && (
        <ConfirmDialog
          message={formatDeleteMessage(
            tv,
            pendingDelete.name,
            bindingCounts.get(pendingDelete.id) ?? 0,
          )}
          confirmLabel={tv.confirmDelete}
          cancelLabel={tv.cancel}
          destructive
          onConfirm={() => {
            removeVariable(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {discardOpen && dataset && (
        <ConfirmDialog
          message={
            dataset.source.kind === 'db'
              ? tv.dbDiscardConfirmFmt
              : dataset.source.kind === 'excel'
                ? tv.excelDiscardConfirm
                : tv.csvDiscardConfirmFmt.replace('{filename}', dataset.source.filename)
          }
          confirmLabel={tv.csvDiscardConfirmAction}
          cancelLabel={tv.cancel}
          destructive
          onConfirm={() => {
            clearDataset();
            setDiscardToken(null);
          }}
          onCancel={() => setDiscardToken(null)}
        />
      )}
    </div>
  );
}

interface RowProps {
  variable: Variable;
  bindings: number;
  source: VariableSource;
  boundHeader: string | undefined;
  error?: string;
  /** Power-user flag: reveals the editable ^FN slot field. */
  showZpl: boolean;
  tv: Translations['variables'];
  onChangeName: (next: string) => void;
  onChangeFnNumber: (next: number) => void;
  onChangeDefault: (next: string) => void;
  onRequestDelete: () => void;
  /** Called when any input value diverges from the committed value so
   *  the panel can clear a stale rowError. Without this a duplicate-
   *  name rejection would linger after the user kept typing. */
  onDirtyChange: () => void;
}

function VariableRow({
  variable,
  bindings,
  source,
  boundHeader,
  error,
  showZpl,
  tv,
  onChangeName,
  onChangeFnNumber,
  onChangeDefault,
  onRequestDelete,
  onDirtyChange,
}: RowProps) {
  // Mirror inputs locally so the user can transiently type invalid values
  // (empty name, mid-edit number) without the store snapping them back on
  // each keystroke. Commit on blur.
  const [name, setName] = useState(variable.name);
  const [fn, setFn] = useState(String(variable.fnNumber));
  const [def, setDef] = useState(variable.defaultValue);
  // Render-time adjust (the React derived-state pattern): an external store
  // update to this id (undo, file load, MCP push) must flow back into the
  // mirror, or a later blur would write the stale values over it.
  const [prevVar, setPrevVar] = useState(variable);
  if (prevVar !== variable) {
    setPrevVar(variable);
    setName(variable.name);
    setFn(String(variable.fnNumber));
    setDef(variable.defaultValue);
  }

  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === variable.name) {
      setName(variable.name);
      return;
    }
    onChangeName(trimmed);
  };

  const commitFn = () => {
    const n = parseInt(fn, 10);
    if (Number.isNaN(n) || n === variable.fnNumber) {
      setFn(String(variable.fnNumber));
      return;
    }
    onChangeFnNumber(n);
  };

  const commitDef = () => {
    if (def === variable.defaultValue) return;
    onChangeDefault(def);
  };

  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <input
          // Indigo = variable identity (matches the token chips); dimmed to
          // muted when the variable is placed nowhere in the label. The `!`
          // beats `text-text` from inputCls (same specificity, later in sheet).
          className={`${inputCls} flex-1 min-w-0 ${bindings === 0 ? "text-muted!" : "text-indigo!"}`}
          aria-label={tv.nameLabel}
          value={name}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setName(e.target.value);
            onDirtyChange();
          }}
          onBlur={commitName}
        />
        {/* ^FN slot is a ZPL low-level detail (auto-assigned otherwise); only
            the power-user flag reveals the editable field. */}
        {showZpl && (
          <div className="flex items-center gap-1 shrink-0">
            <span className="font-mono text-[10px] text-muted/60">FN</span>
            <input
              type="number"
              min={FN_NUMBER_MIN}
              max={FN_NUMBER_MAX}
              className={`${inputCls} w-12`}
              aria-label={tv.fnLabel}
              value={fn}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setFn(e.target.value);
                onDirtyChange();
              }}
              onBlur={commitFn}
            />
          </div>
        )}
        <button
          onClick={onRequestDelete}
          aria-label={tv.removeAriaFmt.replace('{name}', variable.name)}
          className="p-1.5 rounded text-muted hover:text-amber-400 hover:bg-surface-2 transition-colors shrink-0"
        >
          <TrashIcon className="w-3.5 h-3.5" />
        </button>
      </div>
      <input
        className={inputCls}
        aria-label={tv.defaultLabel}
        placeholder={tv.defaultLabel}
        value={def}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setDef(e.target.value)}
        onBlur={commitDef}
      />
      <div className="flex justify-between items-center font-mono text-[9px] uppercase tracking-wider text-muted gap-2">
        <span className={bindings === 0 ? 'opacity-60' : undefined}>
          {bindings === 0
            ? tv.noBindings
            : bindings === 1
              ? tv.bindingsSingular
              : tv.bindingsPluralFmt.replace('{n}', String(bindings))}
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {/* Length a «marker» of this variable reserves in builders/char
              counts (inherited from the default; live while typing). */}
          <Tooltip content={tv.inheritsLengthHint}>
            <span className={def.length === 0 ? 'opacity-60' : undefined}>
              {tv.inheritsLengthFmt.replace('{n}', String(def.length))}
            </span>
          </Tooltip>
          {/* getVariableSource returns 'default' when there is no dataset, so
              this hides the redundant default badge when nothing is loaded. */}
          {error ? (
            <span className="text-amber-400">{error}</span>
          ) : source !== 'default' ? (
            <VariableSourceBadge source={source} boundHeader={boundHeader} size="xs" showLabel />
          ) : null}
        </span>
      </div>
    </li>
  );
}

/** Build the delete-confirmation message from the parameterised locale
 *  templates. Lives outside the component so the locale format is a
 *  pure transformation, not a hook-bound side effect. */
function formatDeleteMessage(
  tv: Translations['variables'],
  name: string,
  count: number,
): string {
  const template = count === 0 ? tv.deleteUnboundFmt : tv.deleteBoundFmt;
  return template.replace('{name}', name).replace('{n}', String(count));
}


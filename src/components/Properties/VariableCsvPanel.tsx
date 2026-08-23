import { TableCellsIcon, ArrowTopRightOnSquareIcon } from "@heroicons/react/16/solid";
import { useT } from "../../hooks/useT";
import { useLabelStore, selectEditorFrozen } from "../../store/labelStore";
import { datasetDisplayName } from "@zplab/core/types/DataSource";
import { isDesktopShell } from "../../lib/platform";
import {
  buildActiveRow,
  getVariableSource,
  resolveVariableValue,
} from "@zplab/core/lib/variableBinding";

/** Read-only CSV context: file, mapped count, row stepper, and the selected
 *  variable's mapping + live active-row value. Mapping and import stay in the
 *  Variables tab (one source of truth); the link hands off there. */
export function VariableCsvPanel({
  selectedVarName,
  onLeave,
}: {
  selectedVarName: string | null;
  /** Close the modal (content is already live); used by the deep-link out to the
   *  Variables tab. */
  onLeave: () => void;
}) {
  const t = useT();
  const tv = t.variableBuilder;
  const dataset = useLabelStore((s) => s.dataset);
  const columnMapping = useLabelStore((s) => s.columnMapping);
  const variables = useLabelStore((s) => s.variables);
  const setActiveRow = useLabelStore((s) => s.setActiveRow);
  const openMappingModal = useLabelStore((s) => s.openMappingModal);
  const dataSourceRef = useLabelStore((s) => s.dataSourceRef);
  // setActiveRow no-ops while the editor is frozen, so match VariablesPanel
  // and disable the steppers rather than leave a dead affordance.
  const editorFrozen = useLabelStore(selectEditorFrozen);
  const setPrinterSettingsTab = useLabelStore((s) => s.setPrinterSettingsTab);

  const goManage = () => {
    onLeave();
    // A db-linked design without loaded rows dead-ends in the mapping
    // modal's CSV shell; route to the reconnect surface instead.
    if (!dataset && dataSourceRef && isDesktopShell) setPrinterSettingsTab('dataSources');
    else openMappingModal();
  };

  const header = (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[9px] font-mono uppercase tracking-wider text-muted">{tv.dataSourceTitle}</span>
      <button type="button" disabled={editorFrozen} className="inline-flex items-center gap-0.5 text-[10px] text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors" onClick={goManage}>
        {tv.variablesTabLink}
        <ArrowTopRightOnSquareIcon className="w-2.5 h-2.5" />
      </button>
    </div>
  );

  if (!dataset) {
    return (
      <section className="rounded-[9px] bg-bg border border-border p-3 flex flex-col gap-2">
        {header}
        <p className="text-[10px] text-muted">{tv.noDataSource}</p>
      </section>
    );
  }

  const total = dataset.rows.length;
  const mapped = variables.filter((v) => getVariableSource(v, dataset, columnMapping) === "bound").length;
  const active = buildActiveRow(dataset, columnMapping);
  const rowNo = total > 0 ? dataset.activeRowIndex + 1 : 0;

  const selectedVar = selectedVarName ? variables.find((v) => v.name === selectedVarName) : undefined;
  const selHeader = selectedVar ? columnMapping?.bindings[selectedVar.id] : undefined;
  const selValue = selectedVar && active ? resolveVariableValue(selectedVar, active, "preview") : "";

  return (
    <section className="rounded-[9px] bg-bg border border-border p-3 flex flex-col gap-2">
      {header}

      <div className="flex items-center gap-2 text-[11px] text-text">
        <TableCellsIcon className="w-3.5 h-3.5 text-muted shrink-0" />
        <span className="min-w-0 truncate font-mono">{datasetDisplayName(dataset.source)}</span>
        <span className="ml-auto shrink-0 text-muted">{total} {tv.rowsLabel}</span>
      </div>

      <div className="flex items-center justify-between gap-2 text-[10px] text-muted">
        <span>{mapped} / {variables.length} {tv.mappedLabel}</span>
        <span className="inline-flex items-center gap-1.5">
          <button type="button" aria-label={tv.prevRow} className="px-1 leading-none hover:text-text disabled:opacity-30" disabled={rowNo <= 1 || editorFrozen} onClick={() => setActiveRow(dataset.activeRowIndex - 1)}>‹</button>
          <span className="font-mono text-text">{tv.rowLabel} {rowNo}/{total}</span>
          <button type="button" aria-label={tv.nextRow} className="px-1 leading-none hover:text-text disabled:opacity-30" disabled={rowNo >= total || editorFrozen} onClick={() => setActiveRow(dataset.activeRowIndex + 1)}>›</button>
        </span>
      </div>

      {selectedVar && (
        <div className="rounded border border-border bg-surface-2/40 px-2 py-1.5 flex flex-col gap-1">
          {selHeader ? (
            <>
              <div className="text-[11px] font-mono text-text">
                <span className="text-indigo">{selectedVar.name}</span>
                <span className="text-muted"> ← {selHeader}</span>
              </div>
              <div className="text-[10px] text-muted">
                {tv.rowLabel} {rowNo}: <span className="text-accent font-mono">{selValue}</span> · {tv.fallbackNote}
              </div>
            </>
          ) : (
            <button type="button" disabled={editorFrozen} className="text-[10px] text-muted hover:text-text text-left inline-flex items-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed" onClick={goManage}>
              {tv.noColumn} · {tv.assignLink}
              <ArrowTopRightOnSquareIcon className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      )}
    </section>
  );
}

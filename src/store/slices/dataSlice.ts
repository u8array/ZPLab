import type { StateCreator } from 'zustand';
import { forgetImport } from '../../lib/csvImport';
import type { DatasetInput, DatasetSource, DbSourceRef } from '@zplab/core/types/DataSource';
import {
  validateVariablesUnique,
  type ColumnMapping,
  type Variable,
} from '@zplab/core/types/Variable';
import { selectEditorFrozen, selectSourceEditing } from '../labelStore.selectors';
import { rewriteTemplateMarkersMap } from '../labelStore.internals';
import type { LabelState } from '../labelStore';

/** The persisted pointer a dataset implies: db sources round-trip through the
 *  design file, file-based sources don't (the file path is machine-local). */
function refOf(source: DatasetSource): DbSourceRef | null {
  if (source.kind !== 'db') return null;
  const { profileId, profileName, table } = source;
  return { kind: 'db', profileId, profileName, table };
}

/** Snapshot of loaded rows plus the row the canvas is currently
 *  previewing. Distinct from the Variable→header mapping (which lives
 *  in the design file): this struct is the data itself, transient. */
export interface Dataset extends DatasetInput {
  /** Clamped into [0, rows.length - 1] by setters; meaningless when empty. */
  activeRowIndex: number;
}

export interface DataSlice {
  /** Session-only rows (NOT in persist-partialize; too bulky + leaky). */
  dataset: Dataset | null;
  /** Pointer to the database behind `dataset` (or behind the design file's
   *  saved link before any fetch happened). Derived from every dataset load
   *  so it can't drift; null for file-based sources. */
  dataSourceRef: DbSourceRef | null;
  /** Persistent mapping between Variables and dataset column names. Lives
   *  in the design file (round-tripped via Save/Load) so a user can
   *  re-load the same data structure later without re-mapping. */
  columnMapping: ColumnMapping | null;
  /** Mapping-modal visibility flag. Lives in the store so the
   *  auto-open trigger (after import, on header mismatch) and the
   *  manual-open trigger share one flag without prop drilling. */
  mappingModalOpen: boolean;
  /** The guided connect-data wizard is open; while true AppShell suppresses the
   *  standalone mapping modal so the wizard owns the mapping step. */
  connectWizardOpen: boolean;
  /** Monotonic epoch of the current data context; bumped by every load/clear/
   *  cancel and by loadDesign. Async producers and pending dialogs capture it
   *  and skip their commit if it changed. Session-only. */
  datasetFetchToken: number;
  /** Render payload for the fetched-dataset replace confirm; the deferred
   *  input itself stays module-side in datasetActions (not serializable).
   *  `token` = the data-context epoch it was raised in, for staleness gating. */
  pendingDatasetReplace: { oldName: string; newName: string; token: number } | null;

  /** Replace the entire dataset and reset the active row to 0. */
  loadDataset: (result: DatasetInput) => void;
  /** Supersede any in-flight async dataset fetch without loading anything
   *  (e.g. the user cancels the excel sheet dialog). */
  invalidateDatasetFetches: () => void;
  /** Drop the current dataset. Does not touch `columnMapping`. */
  clearDataset: () => void;
  /** Move the canvas preview to a different row. Out-of-range indices
   *  are silently clamped; no-op when no dataset is loaded. */
  setActiveRow: (index: number) => void;
  setColumnMapping: (mapping: ColumnMapping | null) => void;
  /** Mapping-modal Apply: one atomic, single-undo-step mutation of variables,
   *  dataset, mapping and active row. Undo tracks variables+mapping only (rows
   *  are too bulky), so a reverted mapping degrades to orphan badges/defaults. */
  applyMappingDraft: (input: {
    variables: Variable[];
    dataset: DatasetInput;
    mapping: ColumnMapping;
    activeRowIndex: number;
  }) => void;
  openMappingModal: () => void;
  closeMappingModal: () => void;
  openConnectWizard: () => void;
  closeConnectWizard: () => void;
  setPendingDatasetReplace: (
    payload: { oldName: string; newName: string; token: number } | null,
  ) => void;
  /** Put the data context back to a captured state (wizard abort): dataset,
   *  design link and mapping together, bumping the epoch like any load. */
  restoreDataSnapshot: (snap: DataSnapshot) => void;
}

export interface DataSnapshot {
  dataset: LabelState['dataset'];
  dataSourceRef: DbSourceRef | null;
  columnMapping: ColumnMapping | null;
}

export const createDataSlice: StateCreator<LabelState, [], [], DataSlice> = (set, get) => ({
  dataset: null,
  dataSourceRef: null,
  columnMapping: null,
  mappingModalOpen: false,
  connectWizardOpen: false,
  datasetFetchToken: 0,
  pendingDatasetReplace: null,

  // Replacing the dataset invalidates any active preview snapshot; tear the
  // preview down and apply, rather than no-op under the lock (which would let
  // callers close dialogs / clear state as if the load had succeeded).
  loadDataset: (result) => {
    get().exitPreviewMode();
    set((s) => ({
      dataset: {
        headers: result.headers,
        rows: result.rows,
        source: result.source,
        activeRowIndex: 0,
      },
      dataSourceRef: refOf(result.source),
      datasetFetchToken: s.datasetFetchToken + 1,
    }));
  },

  invalidateDatasetFetches: () =>
    set((s) => ({ datasetFetchToken: s.datasetFetchToken + 1 })),

  clearDataset: () => {
    get().exitPreviewMode();
    forgetImport();
    set((s) => ({ dataset: null, datasetFetchToken: s.datasetFetchToken + 1 }));
  },

  setActiveRow: (index) =>
    set((state) => {
      // Locked while the editor is frozen: the preview overlay renders one row
      // (stale image if stepped under), and a source buffer freezes the model.
      if (selectEditorFrozen(state)) return {};
      const ds = state.dataset;
      if (!ds || ds.rows.length === 0) return {};
      const clamped = Math.max(0, Math.min(index, ds.rows.length - 1));
      if (clamped === ds.activeRowIndex) return {};
      return { dataset: { ...ds, activeRowIndex: clamped } };
    }),

  setColumnMapping: (mapping) => {
    // Preview/source asymmetry: see selectSourceEditing's doc.
    if (selectSourceEditing(get())) return;
    get().exitPreviewMode();
    set({ columnMapping: mapping });
  },

  applyMappingDraft: ({ variables: rawVariables, dataset, mapping, activeRowIndex }) => {
    // Writes variables, mapping AND pages; blocked while a source buffer owns
    // the model (see setColumnMapping for the preview/source asymmetry).
    if (selectSourceEditing(get())) return;
    // Applying a mapping changes the previewed data, so exit the (now stale)
    // preview and commit, instead of silently discarding the user's Apply.
    get().exitPreviewMode();
    set((state) => {
      // Canonicalise names (trim), but keep each object's ref when unchanged and
      // the array ref when nothing changed, so the history classifier reads a
      // pure mapping Apply as a 'dataset' step, not a 'variable' one.
      const trimmed = rawVariables.map((v) => {
        const name = v.name.trim();
        return name === v.name ? v : { ...v, name };
      });
      if (!validateVariablesUnique(trimmed)) return {};
      const variables =
        trimmed.length === state.variables.length &&
        trimmed.every((v, i) => v === state.variables[i])
          ? state.variables
          : trimmed;
      const rows = dataset.rows;
      const clampedIdx =
        rows.length === 0
          ? 0
          : Math.max(0, Math.min(activeRowIndex, rows.length - 1));
      // Renaming an existing variable here must ripple to its `«name»` markers,
      // else bound fields orphan and print the marker literally. Diff by id, then
      // rewrite in ONE pass against the original names so a name swap is safe.
      const oldNameById = new Map(state.variables.map((v) => [v.id, v.name]));
      const renames = new Map<string, string>();
      for (const v of variables) {
        const oldName = oldNameById.get(v.id);
        if (oldName !== undefined && oldName !== v.name) renames.set(oldName, v.name);
      }
      let pages = state.pages;
      if (renames.size > 0) {
        pages = state.pages.map((p) => {
          const objects = rewriteTemplateMarkersMap(p.objects, renames);
          return objects === p.objects ? p : { ...p, objects };
        });
      }
      return {
        variables,
        dataset: {
          headers: dataset.headers,
          rows: dataset.rows,
          source: dataset.source,
          activeRowIndex: clampedIdx,
        },
        dataSourceRef: refOf(dataset.source),
        columnMapping: mapping,
        datasetFetchToken: state.datasetFetchToken + 1,
        ...(pages !== state.pages ? { pages } : {}),
      };
    });
  },

  openMappingModal: () => {
    if (selectSourceEditing(get())) return;
    set({ mappingModalOpen: true });
  },
  closeMappingModal: () => set({ mappingModalOpen: false }),
  // Clearing the flag on open dismisses a standalone review explicitly (the
  // wizard's mapping step supersedes it); clearing on close keeps the flag the
  // wizard's own loads set (applyImport -> openMappingModal) from popping after.
  openConnectWizard: () => {
    if (selectSourceEditing(get())) return;
    set({ connectWizardOpen: true, mappingModalOpen: false });
  },
  closeConnectWizard: () => set({ connectWizardOpen: false, mappingModalOpen: false }),
  setPendingDatasetReplace: (payload) => set({ pendingDatasetReplace: payload }),
  restoreDataSnapshot: (snap) => {
    if (selectSourceEditing(get())) return;
    get().exitPreviewMode();
    set((s) => ({
      dataset: snap.dataset,
      dataSourceRef: snap.dataSourceRef,
      columnMapping: snap.columnMapping,
      datasetFetchToken: s.datasetFetchToken + 1,
    }));
  },
});

import { isMappingCompatibleWith, type ColumnMapping } from '@zplab/core/types/Variable';
import { datasetDisplayName } from '@zplab/core/types/DataSource';
import { useLabelStore } from './labelStore';
import type { DatasetInput } from '@zplab/core/types/DataSource';

/** The one auto-open-mapping-modal rule, shared by every dataset producer. */
export function needsMappingReview(
  mapping: ColumnMapping | null,
  headers: readonly string[],
): boolean {
  return !mapping || !isMappingCompatibleWith(mapping, headers);
}

/** Snapshot of the current data-context epoch; a deferred commit captures it and
 *  later checks {@link isCurrentDataContext} to abandon if the context changed.
 *  The one place the store field is read. */
export function currentDataContext(): number {
  return useLabelStore.getState().datasetFetchToken;
}

/** True if `token` (from {@link currentDataContext}) is still the live context,
 *  i.e. nothing loaded/cleared/cancelled it or replaced the document since. */
export function isCurrentDataContext(token: number): boolean {
  return token === useLabelStore.getState().datasetFetchToken;
}

/** Apply an already-tabular fetch (db, excel) to the store: dataset plus mapping
 *  review. Internal on purpose: the only caller is {@link loadFetchedDataset},
 *  so every fetched dataset passes the context guard. */
function applyFetchedDataset(input: DatasetInput): void {
  const { loadDataset, columnMapping, openMappingModal, clearUserError } =
    useLabelStore.getState();
  loadDataset(input);
  clearUserError();
  // db/excel always carry real named headers, so a headerless CSV mapping
  // (bound to synthetic `Column N`) can't match despite the column-count
  // shortcut in isMappingCompatibleWith; force a review.
  const headerless = columnMapping?.parseOptions?.hasHeaderRow === false;
  if (headerless || needsMappingReview(columnMapping, input.headers)) openMappingModal();
}

// Fetched input + resolver held module-side while the replace confirm is open;
// the store carries only the render payload (names), keeping it serializable.
let pendingReplace: {
  input: DatasetInput;
  token: number;
  resolve: (applied: boolean) => void;
} | null = null;

/** The one gated entry for async dataset fetches: commits only if the context
 *  is still `token` (false if superseded). Replacing a mapping-incompatible
 *  dataset defers behind a user confirm; the promise resolves with the decision. */
export async function loadFetchedDataset(
  producer: () => Promise<DatasetInput>,
  token: number = currentDataContext(),
): Promise<boolean> {
  const input = await producer();
  if (!isCurrentDataContext(token)) return false;
  const { dataset, columnMapping } = useLabelStore.getState();
  const headerless = columnMapping?.parseOptions?.hasHeaderRow === false;
  if (dataset && (headerless || needsMappingReview(columnMapping, input.headers))) {
    return new Promise<boolean>((resolve) => {
      pendingReplace?.resolve(false); // a newer fetch supersedes an open confirm
      pendingReplace = { input, token, resolve };
      useLabelStore.getState().setPendingDatasetReplace({
        oldName: datasetDisplayName(dataset.source),
        newName: datasetDisplayName(input.source),
        token,
      });
    });
  }
  applyFetchedDataset(input);
  return true;
}

/** Commit or drop the fetch held behind the replace confirm. Applies only if
 *  the data context is still the one the fetch was sampled in. */
export function settleDatasetReplace(confirmed: boolean): void {
  const pending = pendingReplace;
  pendingReplace = null;
  useLabelStore.getState().setPendingDatasetReplace(null);
  if (!pending) return;
  if (confirmed && isCurrentDataContext(pending.token)) {
    applyFetchedDataset(pending.input);
    pending.resolve(true);
  } else {
    pending.resolve(false);
  }
}

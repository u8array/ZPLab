import { pageLabelConfig, type LabelObject } from '@zplab/core/types/Group';
import { isDefaultHost, resolveHost, resolveApiKey } from '../lib/labelary';
import { isDesktopShell } from '../lib/platform';
import type { Dataset } from './slices/dataSlice';
import type { ColumnMapping } from '@zplab/core/types/Variable';
import type { LabelState } from './labelStore';
import type { PageState } from './labelStore.internals';
import { designAsPageLabel, PER_LABEL_ZPL_FIELDS, type JmDensity, type LabelConfig, type PageLabel } from '@zplab/core/types/LabelConfig';

export const currentObjects = (state: PageState): LabelObject[] =>
  state.pages[state.currentPageIndex]?.objects ?? [];

// pageLabelConfig builds a fresh object per override, which a zustand selector
// would hand back as a new reference on every store read. Cache per (design
// label, density) so subscribers only re-render when one of them changes.
const overrideCache = new WeakMap<LabelConfig, Map<JmDensity, PageLabel>>();

/** The label as the current page prints it: its ^JM override wins so every
 *  editor-geometry root (mm<->dots, bounds, snap, preflight) and single-page
 *  emit works in this page's density. Design-scope reads keep `state.label`. */
export const currentPageLabel = (state: LabelState): PageLabel => {
  const jm = state.pages[state.currentPageIndex]?.jmDensity;
  // No divergence means the design label already IS this page's resolved label.
  if (jm === undefined || jm === state.label.jmDensity) return designAsPageLabel(state.label);
  let byDensity = overrideCache.get(state.label);
  if (!byDensity) {
    byDensity = new Map();
    overrideCache.set(state.label, byDensity);
  }
  const cached = byDensity.get(jm);
  if (cached) return cached;
  const built = pageLabelConfig(state.label, { jmDensity: jm });
  byDensity.set(jm, built);
  return built;
};

/** True while any per-label print override is set; drives the reset button's
 *  visibility so its disappearance after a reset doubles as feedback. */
export const selectHasPerLabelOverrides = (s: LabelState): boolean =>
  PER_LABEL_ZPL_FIELDS.some((k) => s.label[k] !== undefined);

/** True when a Labelary network call is permitted: the integration is on
 *  AND, on the public host, the user has acknowledged the privacy notice.
 *  A custom host needs no acknowledgement (the operator owns the endpoint),
 *  mirroring {@link selectLabelaryNoticeRequired}. UI buttons read
 *  `thirdParty.labelary` and `labelaryNoticeAcknowledged` separately
 *  to distinguish "hide" (gate off) from "show notice first". */
export const canCallLabelary = (s: LabelState): boolean =>
  s.thirdParty.labelary && (!isDefaultHost(s.labelaryHost) || s.labelaryNoticeAcknowledged);

/** True when clicking a Labelary-backed action must first surface the
 *  privacy notice modal. A custom-host build implies the operator
 *  already controls the endpoint and no third-party disclosure is needed. */
export const selectLabelaryNoticeRequired = (s: LabelState): boolean =>
  isDefaultHost(s.labelaryHost) && !s.labelaryNoticeAcknowledged;

/** Effective Labelary endpoint: the runtime host/key resolved against the
 *  build env fallback. Single owner of the store-field to resolver mapping,
 *  shared by the preview overlay and the print-to-window flow. */
export const selectLabelaryEndpoint = (s: LabelState): { host: string; apiKey?: string } => ({
  host: resolveHost(s.labelaryHost),
  apiKey: resolveApiKey(s.labelaryApiKey),
});

/** The provider the preview will actually use: the printer path needs the
 *  desktop shell's raw sockets, so a persisted 'printer' choice degrades to
 *  Labelary in the web build instead of dead-ending the preview button. */
export const selectEffectivePreviewProvider = (s: LabelState): 'labelary' | 'printer' =>
  s.previewProvider === 'printer' && isDesktopShell ? 'printer' : 'labelary';

/** True while the preview overlay is taking input away from the editor.
 *  Loading and active both qualify (loading blocks edits so the snapshot
 *  isn't already stale); error and idle return false so the user can
 *  keep working after dismissing a failure. */
export const selectPreviewLocksEditor = (s: LabelState): boolean =>
  s.previewMode.status === 'loading' || s.previewMode.status === 'active';

/** The dataset + mapping pair batch emit needs, or null when a batch would be
 *  no different from a single label: needs loaded rows and at least one LIVE
 *  binding (else an all-orphan mapping just prints N identical defaults). */
export const selectBatchInputs = (
  s: LabelState,
): { dataset: Dataset; mapping: ColumnMapping } | null => {
  const { dataset, columnMapping } = s;
  if (!dataset || dataset.rows.length === 0) return null;
  if (!columnMapping) return null;
  const headers = new Set(dataset.headers);
  const hasLiveBinding = s.variables.some((v) => {
    const header = columnMapping.bindings[v.id];
    return header !== undefined && headers.has(header);
  });
  if (!hasLiveBinding) return null;
  return { dataset: dataset, mapping: columnMapping };
};

/** Boolean form of {@link selectBatchInputs}. */
export const selectCanBatchExport = (s: LabelState): boolean =>
  selectBatchInputs(s) !== null;

/** Physical labels a batch print emits: dataset rows x per-label ^PQ
 *  (printQuantity multiplies every recall). 0 when there is no batch. */
export const selectBatchPrintCount = (s: LabelState): number => {
  const batch = selectBatchInputs(s);
  return batch ? batch.dataset.rows.length * (s.label.printQuantity ?? 1) : 0;
};

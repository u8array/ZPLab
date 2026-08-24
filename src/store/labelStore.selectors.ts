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

const resolvedPageLabel = (label: LabelConfig, jm: JmDensity | undefined): PageLabel => {
  // No divergence means the design label already IS this page's resolved label.
  if (jm === undefined || jm === label.jmDensity) return designAsPageLabel(label);
  let byDensity = overrideCache.get(label);
  if (!byDensity) {
    byDensity = new Map();
    overrideCache.set(label, byDensity);
  }
  const cached = byDensity.get(jm);
  if (cached) return cached;
  const built = pageLabelConfig(label, { jmDensity: jm });
  byDensity.set(jm, built);
  return built;
};

/** The label as the current page prints it: its ^JM override wins so every
 *  editor-geometry root (mm<->dots, bounds, snap, preflight) and single-page
 *  emit works in this page's density. Design-scope reads keep `state.label`. */
export const currentPageLabel = (state: LabelState): PageLabel =>
  resolvedPageLabel(state.label, state.pages[state.currentPageIndex]?.jmDensity);

/* Render source: during a source-edit session the view follows the master
 * buffer, so every renderer-facing question (objects, page label, variables,
 * page count) derives from the parsed shadow through this one seam; live
 * state otherwise. Model-facing reads keep the plain fields. */

export const selectRenderPages = (s: LabelState) => s.sourceShadow?.doc?.pages ?? s.pages;

export const selectRenderVariables = (s: LabelState) =>
  s.sourceShadow?.doc?.variables ?? s.variables;

export const selectRenderDesignLabel = (s: LabelState): LabelConfig =>
  s.sourceShadow?.doc?.label ?? s.label;

export const selectRenderColumnMapping = (s: LabelState) =>
  s.sourceShadow?.doc ? s.sourceShadow.doc.columnMapping : s.columnMapping;

/** The shadow can have fewer pages than the live index points at. */
export const selectRenderPageIndex = (s: LabelState): number =>
  Math.min(s.currentPageIndex, selectRenderPages(s).length - 1);

export const selectRenderObjects = (s: LabelState): LabelObject[] =>
  selectRenderPages(s)[selectRenderPageIndex(s)]?.objects ?? [];

export const selectRenderPageLabel = (s: LabelState): PageLabel =>
  resolvedPageLabel(
    selectRenderDesignLabel(s),
    selectRenderPages(s)[selectRenderPageIndex(s)]?.jmDensity,
  );

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

/** True when the document exports non-trivial ZPL: an overlay page replays
 *  its bytes even with zero objects. Gates panel and export/save entries;
 *  canvas affordances keep their own objects-only question. */
export const selectDocumentEmits = (s: LabelState): boolean =>
  s.pages.some((p) => p.objects.length > 0 || p.overlay !== undefined);

/** True while a source-edit session owns the model. Consumers that block
 *  ONLY for source edit (the preview conflict resolves by exiting the preview
 *  instead) read this; everything else reads {@link selectEditorFrozen}. */
export const selectSourceEditing = (s: LabelState): boolean =>
  s.sourceEdit.status === 'editing';

/** True while the session holds unapplied text; the guard for every path that
 *  would destroy the buffer (MCP push refusal, discard confirmation). */
export const selectSourceEditDirty = (s: LabelState): boolean =>
  s.sourceEdit.status === 'editing' && s.sourceEdit.draft !== s.sourceEdit.baseline;

/** True while the object model is frozen against editor mutations: the
 *  preview overlay holds input, or the source buffer is Master. Every
 *  mutation/history guard reads this; preview-specific UI (the overlay
 *  itself, Escape-to-exit) keeps {@link selectPreviewLocksEditor}. */
export const selectEditorFrozen = (s: LabelState): boolean =>
  selectPreviewLocksEditor(s) || selectSourceEditing(s);

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

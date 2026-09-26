import type { StateCreator } from 'zustand';
import { releaseStaged, stageImages, type CachedImage } from '@zplab/core/lib/imageCache';
import { commitUsedImages } from '@zplab/core/lib/imageUsage';

import type { SourceApplyOk, SourceRefusalInfo } from '@zplab/core/lib/zplSourceEdit';
import type { ImportFinding } from '@zplab/core/lib/importReport';
import type { LabelConfig } from '@zplab/core/types/LabelConfig';
import type { Page } from '@zplab/core/types/Group';
import type { ColumnMapping, Variable } from '@zplab/core/types/Variable';
import { selectEditorFrozen, clampPageIndex } from '../labelStore.selectors';
import type { LabelState } from '../labelStore';
import type { WithTemporal } from '../labelStore.internals';
import type { Dataset } from './dataSlice';

export const SHADOW_IMAGE_OWNER = 'sourceShadow';

/** Every session end passes through here, so the shadow's staged rows never outlive it. */
export function endSourceSession(): Pick<LabelState, 'sourceEdit' | 'sourceShadow'> {
  releaseStaged(SHADOW_IMAGE_OWNER);
  return { sourceEdit: { status: 'off' }, sourceShadow: null };
}

export type SourceEditMode =
  | { status: 'off' }
  | { status: 'editing'; draft: string; baseline: string; session: number };

/** The draft parsed for display: what applying the buffer would commit, plus
 *  the refusal the apply would raise right now (the doc then lags the buffer).
 *  Volatile view state, session-scoped, never persisted or in the timeline. */
export interface SourceShadow {
  doc: {
    label: LabelConfig;
    pages: Page[];
    variables: Variable[];
    columnMapping: ColumnMapping | null;
    /** The buffer's recall rows, which the apply would load in place of the live dataset. */
    dataset?: Dataset;
  } | null;
  refusal: SourceRefusalInfo | null;
  /** Spanned import findings of the parse that produced `draft`; empty under
   *  a refusal (their offsets would describe a text the doc rejected). */
  findings: readonly ImportFinding[];
  /** The text `refusal` was parsed from; `doc` can be older (it keeps the
   *  last good parse). The debounced parse lags the live draft, so position
   *  consumers must check identity first. */
  draft: string;
}

/** Canonical stored shape: callers hand in whatever they hold (a plan carries
 *  its own `ok`), and the slot keeps one object per verdict. */
function refusalInfo(r: SourceRefusalInfo): SourceRefusalInfo {
  if (r.reason === 'unbalanced') return { reason: r.reason, unbalanced: r.unbalanced };
  if (r.reason === 'blobLine') {
    return r.command === undefined ? { reason: r.reason } : { reason: r.reason, command: r.command };
  }
  return { reason: r.reason };
}

// Session identity, not just status: dialog state and plans hang off the
// session, so a session ended and re-entered must not resurrect them.
let nextSession = 1;

export interface SourceEditSlice {
  sourceEdit: SourceEditMode;
  sourceShadow: SourceShadow | null;
  /** Seeds draft and baseline from the panel's current export text, so the
   *  buffer starts as exactly what the user was looking at. No-op under the
   *  preview lock. */
  enterSourceEdit: (currentZpl: string) => void;
  setSourceDraft: (draft: string) => void;
  /** Written by the shadow-parse effect and by a refused apply; ignored
   *  outside a session so a late parse cannot resurrect a preview.
   *  `images` stay staged until the next shadow or the session end. */
  setSourceShadow: (shadow: SourceShadow, images?: readonly CachedImage[]) => void;
  /** Refusal only, keeping the last good doc: the one "set a refusal" op.
   *  `draft` is the text the refusal describes. */
  setSourceRefusal: (refusal: SourceShadow['refusal'], draft: string) => void;
  cancelSourceEdit: () => void;
  /** Commits a prepared plan as ONE undo step. Unlike loadDesign this keeps
   *  history and dataset: the document keeps its identity, only its ZPL
   *  representation was rewritten. `session` is the id the plan was built
   *  under; a mismatch means the world changed and the plan dies. */
  applyZplSource: (plan: SourceApplyOk, session: number) => void;
}

export const createSourceEditSlice: StateCreator<LabelState, [], [], SourceEditSlice> = (
  set,
  get,
  api,
) => ({
  sourceEdit: { status: 'off' },
  sourceShadow: null,

  enterSourceEdit: (currentZpl) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      return {
        sourceEdit: {
          status: 'editing',
          draft: currentZpl,
          baseline: currentZpl,
          session: nextSession++,
        },
        // Supersede in-flight dataset fetches like loadDesign does: one landing
        // mid-session would commit data under the frozen model and skip its
        // mapping review (the open dialogs are token-gated the same way).
        datasetFetchToken: state.datasetFetchToken + 1,
      };
    }),

  setSourceDraft: (draft) =>
    set((state) =>
      state.sourceEdit.status === 'editing' ? { sourceEdit: { ...state.sourceEdit, draft } } : {},
    ),

  setSourceShadow: (shadow, images = []) => {
    if (get().sourceEdit.status !== 'editing') return;
    // No shadow document means the live model is the buffer again, and its rows are persistent.
    if (shadow.doc === null) releaseStaged(SHADOW_IMAGE_OWNER);
    else stageImages(SHADOW_IMAGE_OWNER, images);
    set({ sourceShadow: shadow });
  },

  setSourceRefusal: (refusal, draft) =>
    set((state) =>
      state.sourceEdit.status === 'editing'
        ? {
            sourceShadow: {
              doc: state.sourceShadow?.doc ?? null,
              refusal: refusal && refusalInfo(refusal),
              findings: [],
              draft,
            },
          }
        : {},
    ),

  cancelSourceEdit: () => {
    if (get().sourceEdit.status === 'off') return;
    const ended = endSourceSession();
    set((state) => ({
      ...ended,
      // The session allowed paging through shadow-only pages; the live
      // document may not have them.
      currentPageIndex: clampPageIndex(state.currentPageIndex, state.pages.length),
    }));
  },

  applyZplSource: (plan, session) => {
    // loadDesign cancels the session, so its stale plan dies here too.
    const current = get().sourceEdit;
    if (current.status !== 'editing' || current.session !== session) return;
    commitUsedImages(plan.next.pages, plan.images);
    // Raw setState: the freshly parsed dirty flags and overlays are
    // authoritative, so the dirty-tracking diff must not restamp them.
    api.setState({
      label: plan.next.label,
      pages: plan.next.pages,
      variables: plan.next.variables,
      printerProfile: plan.next.printerProfile,
      columnMapping: plan.next.columnMapping,
      // The implicit blur-apply must not yank a multi-page edit to page 1.
      currentPageIndex: clampPageIndex(get().currentPageIndex, plan.next.pages.length),
      selectedIds: [],
      // Mapping drafts seed from variable ids and the settings modal from the
      // profile, both at mount; the apply replaces both sources. Unlike
      // loadDesign, an apply without recall rows keeps the dataset and its fetch token.
      mappingModalOpen: false,
      connectWizardOpen: false,
      printerSettingsTab: null,
      ...endSourceSession(),
    });
    if (plan.batch) {
      get().loadDataset(plan.batch.dataset);
      // The rows sit outside the timeline, so an undo would pair the old mapping with them.
      (api as unknown as WithTemporal).temporal.getState().clear();
    }
  },
});

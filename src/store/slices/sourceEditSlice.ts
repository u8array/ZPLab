import type { StateCreator } from 'zustand';
import type { SourceApplyOk } from '@zplab/core/lib/zplSourceEdit';
import { selectEditorFrozen } from '../labelStore.selectors';
import type { LabelState } from '../labelStore';

export type SourceEditMode =
  | { status: 'off' }
  | { status: 'editing'; draft: string; baseline: string; session: number };

// Session identity, not just status: dialog state and plans hang off the
// session, so a session ended and re-entered must not resurrect them.
let nextSession = 1;

export interface SourceEditSlice {
  sourceEdit: SourceEditMode;
  /** Seeds draft and baseline from the panel's current export text, so the
   *  buffer starts as exactly what the user was looking at. No-op under the
   *  preview lock. */
  enterSourceEdit: (currentZpl: string) => void;
  setSourceDraft: (draft: string) => void;
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

  cancelSourceEdit: () =>
    set((state) => (state.sourceEdit.status === 'off' ? {} : { sourceEdit: { status: 'off' } })),

  applyZplSource: (plan, session) => {
    // loadDesign cancels the session, so its stale plan dies here too.
    const current = get().sourceEdit;
    if (current.status !== 'editing' || current.session !== session) return;
    // Raw setState: the freshly parsed dirty flags and overlays are
    // authoritative, so the dirty-tracking diff must not restamp them.
    api.setState({
      label: plan.next.label,
      pages: plan.next.pages,
      variables: plan.next.variables,
      printerProfile: plan.next.printerProfile,
      columnMapping: plan.next.columnMapping,
      currentPageIndex: 0,
      selectedIds: [],
      // Mapping drafts seed from variable ids and the settings modal from the
      // profile, both at mount; the apply replaces both sources. Unlike
      // loadDesign, datasetFetchToken stays: the dataset survives on purpose.
      mappingModalOpen: false,
      connectWizardOpen: false,
      printerSettingsTab: null,
      sourceEdit: { status: 'off' },
    });
  },
});

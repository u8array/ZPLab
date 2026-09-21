import type { StateCreator } from 'zustand';
import { getAllLeaves } from '@zplab/core/types/Group';
import { selectDesignText, selectDocumentEmits, selectSourceEditDirty } from '../labelStore.selectors';
import type { LabelState } from '../labelStore';

/** Past this the slot would double what a graphics-heavy design already costs in memory. */
export const MAX_REPLACED_DESIGN_CHARS = 8_000_000;

export interface ReplacedDesign {
  text: string;
  objects: number;
  /** Who displaced it: the agent's push, or the user's restore of what the push displaced. */
  source: 'agent' | 'restore';
}

export interface RestoreSlice {
  /** The design the last replace displaced. Session-only: neither persisted nor undoable. */
  replacedDesign: ReplacedDesign | null;
  /** open_in_app's apply. */
  openPushedDesign: (designText: string) => { ok: boolean; replacedObjects: number; restorable: boolean };
  /** Swaps, so the design it displaces takes the slot and nothing is lost. */
  restoreReplacedDesign: () => boolean;
  dismissReplacedDesign: () => void;
}

export const createRestoreSlice: StateCreator<LabelState, [], [], RestoreSlice> = (set, get) => ({
  replacedDesign: null,

  openPushedDesign: (designText) => {
    const { objects, text } = keepCurrent(get());
    const ok = get().loadDesignText(designText);
    if (!ok) return { ok, replacedObjects: 0, restorable: false };
    // After the load: loadDesign clears the slot with the rest of the displaced document.
    set({ replacedDesign: text === null ? null : { text, objects, source: 'agent' } });
    return { ok, replacedObjects: objects, restorable: text !== null };
  },

  restoreReplacedDesign: () => {
    const slot = get().replacedDesign;
    if (slot === null || selectSourceEditDirty(get())) return false;
    const { objects, text } = keepCurrent(get());
    if (!get().loadDesignText(slot.text)) return false;
    set({ replacedDesign: text === null ? null : { text, objects, source: slot.source === 'agent' ? 'restore' : 'agent' } });
    return true;
  },

  dismissReplacedDesign: () => set({ replacedDesign: null }),
});

/** The open design as slot content. The text is null when nothing can be kept, the count stays a fact. */
function keepCurrent(state: LabelState): { text: string | null; objects: number } {
  const text = selectDesignText(state);
  const objects = state.pages.reduce((n, p) => n + getAllLeaves(p.objects).length, 0);
  const keepable = selectDocumentEmits(state) && text.length <= MAX_REPLACED_DESIGN_CHARS;
  return { text: keepable ? text : null, objects };
}

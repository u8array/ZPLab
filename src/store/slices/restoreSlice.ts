import type { StateCreator } from 'zustand';
import { getAllLeaves } from '@zplab/core/types/Group';
import { selectDesignText, selectDocumentEmits, selectSourceEditDirty } from '../labelStore.selectors';
import type { LabelState } from '../labelStore';

/** Past this the slot would double what a graphics-heavy design already costs in memory. */
export const MAX_REPLACED_DESIGN_CHARS = 8_000_000;

export interface ReplacedDesign {
  text: string;
  objects: number;
}

export interface RestoreSlice {
  /** The design an agent push displaced. Session-only: neither persisted nor undoable. */
  replacedDesign: ReplacedDesign | null;
  /** open_in_app's apply. */
  openPushedDesign: (designText: string) => { ok: boolean; replacedObjects: number; restorable: boolean };
  restoreReplacedDesign: () => boolean;
  dismissReplacedDesign: () => void;
}

export const createRestoreSlice: StateCreator<LabelState, [], [], RestoreSlice> = (set, get) => ({
  replacedDesign: null,

  openPushedDesign: (designText) => {
    const state = get();
    const text = selectDesignText(state);
    const objects = state.pages.reduce((n, p) => n + getAllLeaves(p.objects).length, 0);
    // An empty document is nothing to take back.
    const restorable = selectDocumentEmits(state) && text.length <= MAX_REPLACED_DESIGN_CHARS;
    const ok = get().loadDesignText(designText);
    if (!ok) return { ok, replacedObjects: 0, restorable: false };
    // After the load: loadDesign clears the slot with the rest of the displaced document.
    set({ replacedDesign: restorable ? { text, objects } : null });
    return { ok, replacedObjects: objects, restorable };
  },

  restoreReplacedDesign: () => {
    const slot = get().replacedDesign;
    if (slot === null || selectSourceEditDirty(get())) return false;
    return get().loadDesignText(slot.text);
  },

  dismissReplacedDesign: () => set({ replacedDesign: null }),
});

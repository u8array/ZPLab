import type { StateCreator } from 'zustand';
import { selectEditorFrozen, currentObjects } from '../labelStore.selectors';
import type { LabelState } from '../labelStore';
import { updateCurrentObjects } from '../labelStore.internals';

export interface SelectionSlice {
  selectedIds: string[];
  /** Objects created blank and never yet deselected: their emptyContent
   *  preflight AND the canvas warning styling (orange frame/placeholder)
   *  stay suppressed while the user is still configuring the fresh drop
   *  (form "touched" semantics). Ephemeral UI state, excluded from persist
   *  and the undo timeline; the first-deselect latch lives as one store
   *  subscription in labelStore.ts, not in every selection writer. */
  pristineEmptyIds: string[];
  selectObject: (id: string | null) => void;
  toggleSelectObject: (id: string) => void;
  selectObjects: (ids: string[]) => void;
  /** Delete every non-locked selected object on the current page;
   *  locked items survive and remain selected so the user can see what
   *  the Delete keystroke spared. Cross-writes pages; owned by
   *  objectSlice but the trigger lives with the selection it acts on. */
  removeSelectedObjects: () => void;
  /** Set the locked flag on every selected top-level object. Single owner for
   *  the lock-the-selection op (action bar + Ctrl+L); delegates to updateObjects
   *  whose lock-bypass lets a locked object toggle its own flag. */
  setSelectionLocked: (locked: boolean) => void;
}

export const createSelectionSlice: StateCreator<LabelState, [], [], SelectionSlice> = (set, get) => ({
  selectedIds: [],
  pristineEmptyIds: [],

  // Selection freezes with the rest of the editor (see selectEditorFrozen).
  selectObject: (id) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      const next = id ? [id] : [];
      const same =
        state.selectedIds.length === next.length &&
        state.selectedIds[0] === next[0];
      if (same) return {};
      return { selectedIds: next };
    }),

  toggleSelectObject: (id) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      return {
        selectedIds: state.selectedIds.includes(id)
          ? state.selectedIds.filter((s) => s !== id)
          : [...state.selectedIds, id],
      };
    }),

  selectObjects: (ids) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      const same =
        state.selectedIds.length === ids.length &&
        state.selectedIds.every((id, i) => id === ids[i]);
      if (same) return {};
      return { selectedIds: ids };
    }),

  removeSelectedObjects: () =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      const sel = new Set(state.selectedIds);
      const objs = currentObjects(state);
      const lockedIds = objs.flatMap((o) => sel.has(o.id) && o.locked ? [o.id] : []);
      return {
        ...updateCurrentObjects(state, (curr) =>
          curr.filter((o) => !sel.has(o.id) || o.locked),
        ),
        selectedIds: lockedIds,
      };
    }),

  setSelectionLocked: (locked) => {
    const { selectedIds, updateObjects } = get();
    updateObjects(selectedIds.map((id) => ({ id, changes: { locked } })));
  },
});

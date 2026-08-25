import type { StateCreator } from 'zustand';
import type { ObjectChanges } from '@zplab/core/types/LabelObject';
import {
  isGroup,
  getAllLeaves,
  isSelectionLocked,
  mapObjectById,
  findObjectById,
  hasLockedAncestor,
  reparentNodes,
  type GroupObject,
  type LabelObject,
  type Page,
} from '@zplab/core/types/Group';
import { getEntry } from '@zplab/core/registry';
import { anchorRepin } from '../anchorRepin';
import { reorderForZ, type ZOrderDir } from '../../lib/zorder';
import { makeReverseBackingBox, precedingBackingExists, isOwnReverseBacking } from '@zplab/core/lib/reverseBacking';
import { spawnRotationOverride } from '../../lib/spawn';
import {
  applyObjectChanges,
  DUPLICATE_OFFSET_DOTS,
  buildOffsetCopies,
  cloneChildrenFresh,
  freshPasteCopies,
  updateCurrentObjects,
} from '../labelStore.internals';
import { selectEditorFrozen, selectPreviewLocksEditor, selectRenderPages, clampPageIndex, currentObjects, currentPageLabel } from '../labelStore.selectors';
import type { LabelState } from '../labelStore';

import { newId } from "@zplab/core/lib/ids";
export interface ObjectSlice {
  pages: Page[];
  currentPageIndex: number;
  clipboard: LabelObject[];
  pasteCount: number;

  addObject: (
    type: string,
    position?: { x: number; y: number },
    propsOverride?: object,
  ) => void;
  updateObject: (id: string, changes: ObjectChanges) => void;
  updateObjects: (updates: { id: string; changes: ObjectChanges }[]) => void;
  /** Insert a black backing box just behind a reverse text so its ^FR knockout
   *  prints white-on-black; the box is a normal editable object. */
  addReverseBackground: (textId: string) => void;
  /** Remove a covering black backing sitting behind a text (e.g. after turning
   *  reverse off, so a stale black box doesn't hide the now-black text). */
  removeReverseBackground: (textId: string) => void;
  /** Replace a leaf node wholesale via `mapper` (e.g. line<->box: swaps `type`
   *  and the entire props object, which `updateObject` cannot do since props
   *  merge and `type` is excluded from ObjectChanges). Refuses locked nodes and
   *  groups; one history entry. */
  convertObjectType: (id: string, mapper: (obj: LabelObject) => LabelObject) => void;
  removeObject: (id: string) => void;
  duplicateObject: (id: string) => void;
  duplicateSelectedObjects: () => void;
  copySelectedObjects: () => void;
  pasteObjects: () => void;
  /** Paste the clipboard anchored so its top-left origin lands at the given
   *  point (in dots); used by the context menu's "paste here". */
  pasteObjectsAt: (xDots: number, yDots: number) => void;
  /** Wraps every selected top-level, unlocked object in a new GroupObject
   *  at the position of the topmost (last-in-array) selected item. */
  groupSelection: () => void;
  /** Replaces every selected top-level group with its children. */
  ungroup: () => void;
  /** Like `ungroup`, but operates on an explicit id list. */
  ungroupIds: (ids: readonly string[]) => void;
  /** Move `id` to a new tree position. `parentId: null` targets top
   *  level; otherwise a group. Silently refuses cycles. */
  reparentObject: (id: string, target: { parentId: string | null; index: number }) => void;
  /** Move several nodes as one block (multi-select layer drag). Only roots of
   *  the set move; invalid drops (non-group target, cycle) are no-ops. */
  reparentObjects: (ids: readonly string[], target: { parentId: string | null; index: number }) => void;
  /** Append an empty group at the top level and select it. */
  addGroup: () => void;

  moveObjectForward: (id: string) => void;
  moveObjectBackward: (id: string) => void;
  moveObjectToFront: (id: string) => void;
  moveObjectToBack: (id: string) => void;
  reorderObject: (id: string, toIndex: number) => void;
  /** Stacking-order move for the current top-level selection (front/back/
   *  forward/backward); nested-only selections are a no-op. */
  reorderSelection: (dir: ZOrderDir) => void;

  addPage: () => void;
  removePage: (index: number) => void;
  duplicatePage: (index: number) => void;
  setCurrentPage: (index: number) => void;
}

export const createObjectSlice: StateCreator<LabelState, [], [], ObjectSlice> = (set, get) => ({
  pages: [{ objects: [] }],
  currentPageIndex: 0,
  clipboard: [],
  pasteCount: 0,

  addObject: (type, position = { x: 50, y: 50 }, propsOverride) => {
    if (selectEditorFrozen(get())) return;
    const definition = getEntry(type);
    if (!definition) return;

    const props = {
      ...definition.defaultProps,
      ...propsOverride,
      ...spawnRotationOverride(type, propsOverride, get().canvasSettings.viewRotation),
    };
    const obj = {
      id: newId(),
      type,
      x: position.x,
      y: position.y,
      rotation: 0,
      props,
    } as LabelObject;
    // A blank-born object gets the untouched-field grace: its emptyContent
    // warning stays suppressed until the first deselect (selectionSlice).
    const blank = (props as { content?: string }).content?.trim() === '';

    set((state) => ({
      ...updateCurrentObjects(state, (objs) => [...objs, obj]),
      selectedIds: [obj.id],
      ...(blank ? { pristineEmptyIds: [...state.pristineEmptyIds, obj.id] } : {}),
    }));
  },

  addReverseBackground: (textId) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      const objs = currentObjects(state);
      const text = findObjectById(objs, textId);
      if (!text || isGroup(text) || text.type !== 'text') return {};
      if (text.locked || hasLockedAncestor(objs, textId)) return {};
      const box = makeReverseBackingBox(text, currentPageLabel(state));
      // Insert into the text's own container, right before it, so it renders
      // behind. Idempotent: skip if a backing already sits there.
      let inserted = false;
      const insertBehind = (list: LabelObject[]): LabelObject[] => {
        const i = list.findIndex((o) => o.id === textId);
        if (i >= 0) {
          if (precedingBackingExists(list, i, text, currentPageLabel(state))) return list;
          inserted = true;
          const next = [...list];
          next.splice(i, 0, box);
          return next;
        }
        return list.map((o) =>
          isGroup(o) ? { ...o, children: insertBehind(o.children) } : o,
        );
      };
      const updated = updateCurrentObjects(state, insertBehind);
      if (!inserted) return {};
      return { ...updated, selectedIds: [box.id] };
    }),

  removeReverseBackground: (textId) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      const objs = currentObjects(state);
      const text = findObjectById(objs, textId);
      if (!text || isGroup(text) || text.type !== 'text') return {};
      if (text.locked || hasLockedAncestor(objs, textId)) return {};
      let removedId: string | undefined;
      const removeBehind = (list: LabelObject[]): LabelObject[] => {
        const i = list.findIndex((o) => o.id === textId);
        if (i >= 0) {
          // Closest feature-style backing before the text (z-order: nearest
          // behind). Strict match so a shared banner/header isn't deleted.
          for (let j = i - 1; j >= 0 && !removedId; j--) {
            if (isOwnReverseBacking(list[j], text, currentPageLabel(state))) removedId = list[j]?.id;
          }
          return removedId ? list.filter((o) => o.id !== removedId) : list;
        }
        return list.map((o) =>
          isGroup(o) ? { ...o, children: removeBehind(o.children) } : o,
        );
      };
      const updated = updateCurrentObjects(state, removeBehind);
      if (!removedId) return {};
      return { ...updated, selectedIds: [textId] };
    }),

  updateObject: (id, changes) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      const objs = currentObjects(state);
      const ancestorLocked = hasLockedAncestor(objs, id);
      return updateCurrentObjects(state, (curr) =>
        mapObjectById(curr, id, (obj) =>
          applyObjectChanges(obj, changes, ancestorLocked, state.label),
        ),
      );
    }),

  convertObjectType: (id, mapper) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      const objs = currentObjects(state);
      const target = findObjectById(objs, id);
      if (!target || isGroup(target) || target.locked) return {};
      if (hasLockedAncestor(objs, id)) return {};
      // Wholesale node replacement, so registry normalizeChanges is bypassed by
      // design; the mapper owns the result's validity (line/box have no hook).
      // The type/props change is stamped dirty centrally by the dirtyTracking
      // middleware.
      // anchorRepin still runs: a type switch changes the measured width, so
      // the justified edge must hold like on any value edit.
      const next = mapObjectById(objs, id, (o) => {
        const mapped = mapper(o);
        return mapped === o ? o : anchorRepin(o, { props: {} }, mapped);
      });
      // A no-op mapper must not rebuild pages: the fresh array would record a
      // phantom undo step (temporalEquality is a ref compare).
      if (next === objs) return {};
      return updateCurrentObjects(state, () => next);
    }),

  updateObjects: (updates) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      if (updates.length === 0) return {};
      // Single tree walk, identity-preserving; inheritedLocked cascades
      // so leaves in locked groups stay locked without ancestor re-walks.
      const updateMap = new Map(updates.map((u) => [u.id, u.changes]));
      const applyUpdates = (
        nodes: LabelObject[],
        inheritedLocked: boolean,
      ): LabelObject[] => {
        let changed = false;
        const next = nodes.map((n) => {
          const changes = updateMap.get(n.id);
          let updated = changes
            ? applyObjectChanges(n, changes, inheritedLocked, state.label)
            : n;
          if (isGroup(updated)) {
            const childLocked = inheritedLocked || !!updated.locked;
            const nextChildren = applyUpdates(updated.children, childLocked);
            if (nextChildren !== updated.children) {
              updated = { ...updated, children: nextChildren };
            }
          }
          if (updated !== n) changed = true;
          return updated;
        });
        return changed ? next : nodes;
      };
      return updateCurrentObjects(state, (objs) => applyUpdates(objs, false));
    }),

  removeObject: (id) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      const obj = currentObjects(state).find((o) => o.id === id);
      if (obj?.locked) return {};
      return {
        ...updateCurrentObjects(state, (objs) => objs.filter((o) => o.id !== id)),
        selectedIds: state.selectedIds.filter((s) => s !== id),
      };
    }),

  duplicateObject: (id) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      const copies = buildOffsetCopies(currentObjects(state), [id]);
      if (copies.length === 0) return {};
      return {
        ...updateCurrentObjects(state, (curr) => [...curr, ...copies]),
        selectedIds: copies.map((c) => c.id),
      };
    }),

  duplicateSelectedObjects: () =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      if (state.selectedIds.length === 0) return {};
      const copies = buildOffsetCopies(currentObjects(state), state.selectedIds);
      return {
        ...updateCurrentObjects(state, (curr) => [...curr, ...copies]),
        selectedIds: copies.map((c) => c.id),
      };
    }),

  copySelectedObjects: () => {
    const state = get();
    if (selectEditorFrozen(state)) return;
    const objs = currentObjects(state);
    const clipboard = state.selectedIds.flatMap((id) => {
      const obj = objs.find((o) => o.id === id);
      if (!obj) return [];
      if (isGroup(obj)) {
        return [{ ...obj, children: cloneChildrenFresh(obj.children) }];
      }
      return [{ ...obj, props: { ...obj.props } } as LabelObject];
    });
    set({ clipboard, pasteCount: 0 });
  },

  pasteObjects: () =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      if (state.clipboard.length === 0) return {};
      const pasteCount = state.pasteCount + 1;
      const offset = pasteCount * DUPLICATE_OFFSET_DOTS;
      const copies = freshPasteCopies(state.clipboard, offset, offset);
      return {
        ...updateCurrentObjects(state, (curr) => [...curr, ...copies]),
        selectedIds: copies.map((c) => c.id),
        pasteCount,
      };
    }),

  pasteObjectsAt: (xDots, yDots) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      if (state.clipboard.length === 0) return {};
      // Anchor the clipboard's visual top-left to the point. Groups are
      // structural (x/y 0, absolute children), so the bound must come from the
      // leaves, not the top-level x/y.
      const leaves = state.clipboard.flatMap((o) =>
        isGroup(o) ? getAllLeaves(o.children) : [o],
      );
      const minX = Math.min(...leaves.map((l) => l.x));
      const minY = Math.min(...leaves.map((l) => l.y));
      const dx = xDots - minX;
      const dy = yDots - minY;
      const copies = freshPasteCopies(state.clipboard, dx, dy);
      return {
        ...updateCurrentObjects(state, (curr) => [...curr, ...copies]),
        selectedIds: copies.map((c) => c.id),
        pasteCount: 0,
      };
    }),

  groupSelection: () =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      const objs = currentObjects(state);
      const sel = new Set(state.selectedIds);
      // Only top-level objects of the current page; nested children of an
      // existing group need ungroup first.
      const candidates = objs.flatMap((o) =>
        sel.has(o.id) && !o.locked ? [o] : [],
      );
      if (candidates.length === 0) return {};
      const candidateIds = new Set(candidates.map((o) => o.id));
      // Insert at the position of the last (topmost) selected item so
      // the group lands where the user's eye is.
      const lastIndex = objs.reduce(
        (acc, o, i) => (candidateIds.has(o.id) ? i : acc),
        -1,
      );
      const group: GroupObject = {
        id: newId(),
        type: 'group',
        x: 0,
        y: 0,
        rotation: 0,
        children: candidates,
      };
      const remaining = objs.filter((o) => !candidateIds.has(o.id));
      // lastIndex is pre-filter; convert by counting removed items before it.
      const removedBefore = objs
        .slice(0, lastIndex + 1)
        .filter((o) => candidateIds.has(o.id)).length;
      const insertPos = lastIndex + 1 - removedBefore;
      const next = [
        ...remaining.slice(0, insertPos),
        group,
        ...remaining.slice(insertPos),
      ];
      return {
        ...updateCurrentObjects(state, () => next),
        selectedIds: [group.id],
      };
    }),

  // Single reparent is just a one-element block; reparentNodes owns the
  // detach/insert/cycle/non-group logic so the two paths can't diverge.
  reparentObject: (id, target) => get().reparentObjects([id], target),

  reparentObjects: (ids, target) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      const objs = currentObjects(state);
      const next = reparentNodes(objs, ids, target);
      if (next === objs) return {};
      return updateCurrentObjects(state, () => next);
    }),

  addGroup: () =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      const group: GroupObject = {
        id: newId(),
        type: 'group',
        x: 0,
        y: 0,
        rotation: 0,
        children: [],
      };
      return {
        ...updateCurrentObjects(state, (objs) => [...objs, group]),
        selectedIds: [group.id],
      };
    }),

  ungroup: () => get().ungroupIds(get().selectedIds),

  ungroupIds: (ids) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      const wanted = new Set(ids);
      const objs = currentObjects(state);
      const targets = objs.flatMap((o) =>
        wanted.has(o.id) && isGroup(o) && !o.locked ? [o] : [],
      );
      if (targets.length === 0) return {};
      const targetIds = new Set(targets.map((g) => g.id));
      const next: LabelObject[] = [];
      const newSelection: string[] = [];
      for (const o of objs) {
        if (targetIds.has(o.id) && isGroup(o)) {
          next.push(...o.children);
          newSelection.push(...o.children.map((c) => c.id));
        } else {
          next.push(o);
        }
      }
      return {
        ...updateCurrentObjects(state, () => next),
        selectedIds: newSelection,
      };
    }),

  moveObjectToFront: (id) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      const objs = currentObjects(state);
      const idx = objs.findIndex((o) => o.id === id);
      if (idx === -1 || idx === objs.length - 1) return {};
      return updateCurrentObjects(state, (curr) => {
        const next = [...curr];
        const [moved] = next.splice(idx, 1);
        if (moved) next.push(moved);
        return next;
      });
    }),

  moveObjectToBack: (id) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      const objs = currentObjects(state);
      const idx = objs.findIndex((o) => o.id === id);
      if (idx <= 0) return {};
      return updateCurrentObjects(state, (curr) => {
        const next = [...curr];
        const [moved] = next.splice(idx, 1);
        if (moved) next.unshift(moved);
        return next;
      });
    }),

  moveObjectForward: (id) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      const objs = currentObjects(state);
      const idx = objs.findIndex((o) => o.id === id);
      if (idx === -1 || idx === objs.length - 1) return {};
      return updateCurrentObjects(state, (curr) => {
        const next = [...curr];
        const tmp = next[idx + 1] as LabelObject;
        next[idx + 1] = next[idx] as LabelObject;
        next[idx] = tmp;
        return next;
      });
    }),

  moveObjectBackward: (id) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      const objs = currentObjects(state);
      const idx = objs.findIndex((o) => o.id === id);
      if (idx <= 0) return {};
      return updateCurrentObjects(state, (curr) => {
        const next = [...curr];
        const tmp = next[idx - 1] as LabelObject;
        next[idx - 1] = next[idx] as LabelObject;
        next[idx] = tmp;
        return next;
      });
    }),

  reorderObject: (id, toIndex) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      const objs = currentObjects(state);
      const fromIndex = objs.findIndex((o) => o.id === id);
      if (fromIndex === -1 || fromIndex === toIndex) return {};
      return updateCurrentObjects(state, (curr) => {
        const next = [...curr];
        const [item] = next.splice(fromIndex, 1);
        if (item) next.splice(toIndex, 0, item);
        return next;
      });
    }),

  reorderSelection: (dir) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      const objs = currentObjects(state);
      // Lock blocks reordering too, mirroring delete/group/ungroup.
      if (isSelectionLocked(objs, state.selectedIds)) return {};
      const next = reorderForZ(objs, new Set(state.selectedIds), dir);
      if (next === objs) return {};
      return updateCurrentObjects(state, () => next as LabelObject[]);
    }),

  addPage: () =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      const insertPos = state.currentPageIndex + 1;
      const newPages = [
        ...state.pages.slice(0, insertPos),
        { objects: [] },
        ...state.pages.slice(insertPos),
      ];
      return {
        pages: newPages,
        currentPageIndex: insertPos,
        selectedIds: [],
      };
    }),

  removePage: (index) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      if (state.pages.length <= 1) return {};
      if (index < 0 || index >= state.pages.length) return {};
      const newPages = state.pages.filter((_, i) => i !== index);
      let newIndex = state.currentPageIndex;
      if (index < state.currentPageIndex) {
        newIndex = state.currentPageIndex - 1;
      } else if (index === state.currentPageIndex) {
        newIndex = clampPageIndex(state.currentPageIndex, newPages.length);
      }
      return {
        pages: newPages,
        currentPageIndex: newIndex,
        selectedIds: [],
      };
    }),

  duplicatePage: (index) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      if (index < 0 || index >= state.pages.length) return {};
      const source = state.pages[index];
      if (!source) return {};
      // Fresh ids + dropped provenance: the clone is net-new (no overlay), so
      // it regenerates from the model. Omitting `overlay` keeps it that way.
      // The ^JM override travels along: the cloned dots are in its density.
      const cloned: Page = { objects: cloneChildrenFresh(source.objects) };
      if (source.jmDensity !== undefined) cloned.jmDensity = source.jmDensity;
      const insertPos = index + 1;
      const newPages = [
        ...state.pages.slice(0, insertPos),
        cloned,
        ...state.pages.slice(insertPos),
      ];
      return {
        pages: newPages,
        currentPageIndex: insertPos,
        selectedIds: [],
      };
    }),

  setCurrentPage: (index) =>
    set((state) => {
      // View-only op: allowed during a source-edit session (the shadow can
      // carry more pages than the model), blocked only under a preview.
      if (selectPreviewLocksEditor(state)) return {};
      if (index < 0 || index >= selectRenderPages(state).length) return {};
      if (index === state.currentPageIndex) return {};
      return { currentPageIndex: index, selectedIds: [] };
    }),
});

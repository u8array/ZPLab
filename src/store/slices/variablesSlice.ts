import type { StateCreator } from 'zustand';
import {
  nextFreeFnNumber,
  validateVariablesUnique,
  isValidVariableName,
  stripMarkerDelimiters,
  isUsableSlot,
  type Variable,
  type VariableInput,
} from '@zplab/core/types/Variable';
import { rewriteTemplateMarkers } from '../labelStore.internals';
import { dropPageOverlays } from '@zplab/core/lib/pageOverlay';
import { removeVariables } from '@zplab/core/lib/variableRemoval';
import { selectEditorFrozen } from '../labelStore.selectors';
import type { LabelState } from '../labelStore';

import { newId } from "@zplab/core/lib/ids";
export interface VariablesSlice {
  /** Document-level template variables. Fields reference them via `«name»`
   *  content markers; export emits `^FN{fnNumber}^FD{defaultValue}^FS`.
   *  Order is user-controlled and surfaces in the Variables panel. */
  variables: Variable[];

  /** Create a new variable. Returns the id, or null when all 99 slots
   *  are taken or the supplied fnNumber is out of range / already used. */
  addVariable: (input: VariableInput) => string | null;
  /** Patch fields on an existing variable. Validates name + fnNumber
   *  uniqueness; rejects silently (no-op) on conflict. A name change ripples
   *  through every `«oldName»` content marker; an fnNumber/default change drops
   *  page overlays so headers regenerate. */
  updateVariable: (id: string, changes: Partial<Omit<Variable, 'id'>>) => void;
  /** Delete a variable and unbind every field that referenced it
   *  across every page. */
  removeVariable: (id: string) => void;
  /** Bulk-replace the variables list. Used by the mapping-modal Apply
   *  path so add-variable-inline commits atomically with the new
   *  mapping. Cleanup of bindings still goes through `removeVariable`. */
  setVariables: (variables: Variable[]) => void;
}

export const createVariablesSlice: StateCreator<LabelState, [], [], VariablesSlice> = (set, get) => ({
  variables: [],

  addVariable: (input) => {
    const state = get();
    if (selectEditorFrozen(state)) return null;
    const trimmedName = input.name.trim();
    if (!isValidVariableName(trimmedName)) return null;
    if (state.variables.some((v) => v.name === trimmedName)) return null;

    let fnNumber: number;
    if (input.fnNumber !== undefined) {
      if (!isUsableSlot(input.fnNumber)) return null;
      if (state.variables.some((v) => v.fnNumber === input.fnNumber)) return null;
      fnNumber = input.fnNumber;
    } else {
      const next = nextFreeFnNumber(state.variables.map((v) => v.fnNumber));
      if (next === null) return null;
      fnNumber = next;
    }

    const variable: Variable = {
      id: newId(),
      name: trimmedName,
      fnNumber,
      // A default is a literal fallback; strip marker delimiters so it can't
      // smuggle a nested «marker» that preview resolves but single-bind export
      // emits verbatim (silent preview/export drift).
      defaultValue: stripMarkerDelimiters(input.defaultValue ?? ''),
      ...(input.comment !== undefined ? { comment: input.comment } : {}),
    };
    set((s) => ({ variables: [...s.variables, variable] }));
    return variable.id;
  },

  updateVariable: (id, changes) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      const existing = state.variables.find((v) => v.id === id);
      if (!existing) return {};

      let patched = changes;
      if (changes.name !== undefined) {
        const trimmed = changes.name.trim();
        if (!isValidVariableName(trimmed)) return {};
        if (state.variables.some((v) => v.id !== id && v.name === trimmed)) return {};
        patched = { ...patched, name: trimmed };
      }
      if (changes.fnNumber !== undefined) {
        if (!isUsableSlot(changes.fnNumber)) return {};
        if (state.variables.some((v) => v.id !== id && v.fnNumber === changes.fnNumber)) return {};
      }
      // A default is a literal fallback: strip marker delimiters so it can't
      // carry a nested «marker» (preview would resolve it, single-bind export
      // emits it verbatim).
      if (changes.defaultValue !== undefined) {
        patched = { ...patched, defaultValue: stripMarkerDelimiters(changes.defaultValue) };
      }

      const next: Partial<LabelState> = {
        variables: state.variables.map((v) => (v.id === id ? { ...v, ...patched } : v)),
      };
      let pages = state.pages;
      // Rename ripple: every `«oldName»` marker in any object's content
      // needs to point at the new name, otherwise the templates dangle.
      if (patched.name !== undefined && patched.name !== existing.name) {
        const oldName = existing.name;
        const newName = patched.name;
        pages = pages.map((page) => ({
          ...page,
          objects: rewriteTemplateMarkers(page.objects, oldName, newName),
        }));
      }
      // fnNumber / defaultValue feed both inline ^FN{n}^FD{default} (single-bind)
      // and the header ^FN declarations of marker-based template fields, the
      // latter living in raw overlay segments. Drop overlays so those pages
      // regenerate the headers instead of replaying stale ones.
      const fnChanged = patched.fnNumber !== undefined && patched.fnNumber !== existing.fnNumber;
      const defChanged =
        patched.defaultValue !== undefined && patched.defaultValue !== existing.defaultValue;
      if (fnChanged || defChanged) pages = dropPageOverlays(pages);
      if (pages !== state.pages) next.pages = pages;
      return next;
    }),

  setVariables: (variables) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      if (!validateVariablesUnique(variables)) return {};
      return { variables };
    }),

  removeVariable: (id) =>
    set((state) => {
      if (selectEditorFrozen(state)) return {};
      const next = removeVariables(state, new Set([id]));
      if (next === state) return {};
      return {
        variables: next.variables,
        ...(next.pages !== state.pages ? { pages: next.pages } : {}),
        ...(next.columnMapping !== state.columnMapping ? { columnMapping: next.columnMapping } : {}),
      };
    }),
});

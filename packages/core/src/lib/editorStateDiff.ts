import { isGroup, type LabelObject, type Page } from "../types/Group";
import { matchVariablesByFn, type Variable } from "../types/Variable";

/** Editor state a full-document reparse loses: ZPL has no wire form for any of it.
 *  What sourceApplyCarry brings back is not lost, so it never counts. */
export interface EditorStateDiff {
  groupsDissolved: number;
  namesLost: number;
  lockedLost: number;
  hiddenLost: number;
  /** Excluded nodes gone after the apply, subtree included. */
  excludedLost: number;
  /** Variables whose ^FN slot vanished from the stream entirely. */
  variablesLost: string[];
  /** The wire carries no variable names (only ^FN slots), so a reparse
   *  renames every non-hinted variable; matched by slot. */
  variablesRenamed: { from: string; to: string; fnNumber: number }[];
  mappingLost: number;
}

export type EditorLossAxis = 'groups' | 'names' | 'flags' | 'excluded' | 'variables' | 'mapping';

/** The loss axes with a non-zero count, the ONE answer to "is this diff a
 *  loss" for both the confirmation gate and the displayed lines. `excluded`
 *  is its own axis: those objects are dropped, not flag-reset. */
export function editorLossAxes(d: EditorStateDiff): { axis: EditorLossAxis; n: number }[] {
  const axes: { axis: EditorLossAxis; n: number }[] = [
    { axis: 'groups', n: d.groupsDissolved },
    { axis: 'names', n: d.namesLost },
    { axis: 'flags', n: d.lockedLost + d.hiddenLost },
    { axis: 'excluded', n: d.excludedLost },
    { axis: 'variables', n: d.variablesRenamed.length + d.variablesLost.length },
    { axis: 'mapping', n: d.mappingLost },
  ];
  return axes.filter((a) => a.n > 0);
}

export function hasEditorLoss(d: EditorStateDiff): boolean {
  return editorLossAxes(d).length > 0;
}

export interface EditorSnapshot {
  pages: readonly Page[];
  variables: readonly Variable[];
}

/** The editor-only state a reparse cannot express, as one patch: unset fields are
 *  omitted so it never clobbers the parse; carrying a field is what keeps `count` from scoring it. */
export function pickEditorState(o: LabelObject): Partial<LabelObject> {
  return {
    ...(o.includeInExport === false ? { includeInExport: false } : {}),
    ...(o.name !== undefined ? { name: o.name } : {}),
    ...(o.locked ? { locked: true } : {}),
    ...(o.visible === false ? { visible: false } : {}),
  };
}

/** `mappingLost` comes from the caller's one remapBindingsByFn run, so diff
 *  and committed mapping cannot disagree. */
export function diffEditorState(
  prev: EditorSnapshot,
  next: EditorSnapshot,
  mappingLost = 0,
): EditorStateDiff {
  // An excluded node drops its whole subtree (the exportableLeaves rule);
  // those nodes count on the excluded axis alone, never twice.
  const count = (pages: readonly Page[]) => {
    const c = { groups: 0, names: 0, locked: 0, hidden: 0, excluded: 0 };
    const walk = (list: readonly Page["objects"][number][], underExcluded: boolean): void => {
      for (const o of list) {
        const dropped = underExcluded || o.includeInExport === false;
        if (dropped) c.excluded++;
        else {
          if (isGroup(o)) c.groups++;
          if (o.name) c.names++;
          if (o.locked) c.locked++;
          if (o.visible === false) c.hidden++;
        }
        if (isGroup(o)) walk(o.children, dropped);
      }
    };
    for (const page of pages) walk(page.objects, false);
    return c;
  };
  const before = count(prev.pages);
  const after = count(next.pages);
  const lostCount = (b: number, a: number) => Math.max(0, b - a);

  const { kept, dropped } = matchVariablesByFn(prev.variables, next.variables);
  const variablesLost = dropped.map((v) => v.name);
  const variablesRenamed = kept
    .filter((p) => p.from.name !== p.to.name)
    .map((p) => ({ from: p.from.name, to: p.to.name, fnNumber: p.from.fnNumber }));

  return {
    groupsDissolved: lostCount(before.groups, after.groups),
    namesLost: lostCount(before.names, after.names),
    lockedLost: lostCount(before.locked, after.locked),
    hiddenLost: lostCount(before.hidden, after.hidden),
    excludedLost: lostCount(before.excluded, after.excluded),
    variablesLost,
    variablesRenamed,
    mappingLost,
  };
}
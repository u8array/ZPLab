import { isGroup, type Page } from "../types/Group";
import type { Variable } from "../types/Variable";

/** What a full-document reparse cannot carry over: ZPL has no wire form for
 *  any of these, so an apply loses them. */
export interface EditorStateDiff {
  groupsDissolved: number;
  namesLost: number;
  lockedLost: number;
  hiddenLost: number;
  /** Objects the export cascade drops (self or an ancestor excluded). */
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

  const nextByFn = new Map(next.variables.map((v) => [v.fnNumber, v]));
  const variablesLost: string[] = [];
  const variablesRenamed: { from: string; to: string; fnNumber: number }[] = [];
  for (const v of prev.variables) {
    const kept = nextByFn.get(v.fnNumber);
    if (!kept) variablesLost.push(v.name);
    else if (kept.name !== v.name) {
      variablesRenamed.push({ from: v.name, to: kept.name, fnNumber: v.fnNumber });
    }
  }

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
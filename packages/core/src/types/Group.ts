import type { LeafObject } from '../registry/leafObject';
import type { LabelObjectBase } from './LabelObject';
import type { BlockOverlay } from '../lib/zplOverlay/overlay';
import { withJmDensity, type JmDensity, type LabelConfig } from './LabelConfig';
export type { LeafObject };
/** Non-leaf container; cascades lock/visibility/inclusion. Intentionally
 *  outside the registry (no toZPL/defaultSize/PropertiesPanel). */
export type GroupObject = LabelObjectBase & {
  type: 'group';
  children: LabelObject[];
};

/** Tree node: leaf or group. Lives here (not in registry) to break the
 *  registry <-> types cycle. */
export type LabelObject = LeafObject | GroupObject;

export interface Page {
  objects: LabelObject[];
  /** ^JM override for this page, set only where the imported block's density
   *  diverges from the design's; export falls back to `label.jmDensity`, so a
   *  density change in the UI still reaches every non-diverging page. */
  jmDensity?: JmDensity;
  /** Source-patch overlay of the ^XA…^XZ block this page was imported from,
   *  letting export replay untouched bytes verbatim. Absent on fresh designs
   *  and on pages the parser couldn't fully link; those regenerate from the
   *  model. Rides persist + zundo as part of the page. */
  overlay?: BlockOverlay;
}

/** The label as this page prints it: its own ^JM wins, so a block imported at
 *  a diverging density keeps that density through export (coordinates included,
 *  since every dots<->mm boundary reads it through effectiveDpmm). */
export function pageLabelConfig(label: LabelConfig, page: Pick<Page, 'jmDensity'>): LabelConfig {
  return withJmDensity(label, page.jmDensity);
}

export function isGroup(obj: LabelObject): obj is GroupObject {
  return obj.type === 'group';
}

/** DFS yielding parent before children, in render order. */
export function* walkObjects(objects: readonly LabelObject[]): Iterable<LabelObject> {
  for (const obj of objects) {
    yield obj;
    if (isGroup(obj)) {
      yield* walkObjects(obj.children);
    }
  }
}

/** Leaves that actually export: an `includeInExport=false` node hides its
 *  whole subtree. Also the preflight leaf set, so checks track what prints. */
export function exportableLeaves(objects: readonly LabelObject[]): LeafObject[] {
  const out: LeafObject[] = [];
  const walk = (list: readonly LabelObject[]): void => {
    for (const o of list) {
      if (o.includeInExport === false) continue;
      if (isGroup(o)) walk(o.children);
      else out.push(o);
    }
  };
  walk(objects);
  return out;
}

/** Flat list of every leaf descendant of `objects`. Skips group nodes themselves. */
export function getAllLeaves(objects: LabelObject[]): LeafObject[] {
  const out: LeafObject[] = [];
  for (const obj of walkObjects(objects)) {
    if (!isGroup(obj)) out.push(obj);
  }
  return out;
}

/** Find a node by id anywhere in the tree, or undefined if not present. */
export function findObjectById(
  objects: LabelObject[],
  id: string,
): LabelObject | undefined {
  for (const obj of walkObjects(objects)) {
    if (obj.id === id) return obj;
  }
  return undefined;
}

/** Group ancestors outermost-first; empty for top-level or missing. */
export function findAncestors(
  objects: LabelObject[],
  id: string,
): GroupObject[] {
  const trail: GroupObject[] = [];
  const visit = (nodes: LabelObject[]): boolean => {
    for (const n of nodes) {
      if (n.id === id) return true;
      if (isGroup(n)) {
        trail.push(n);
        if (visit(n.children)) return true;
        trail.pop();
      }
    }
    return false;
  };
  visit(objects);
  return trail;
}

/** Figma auto-select-parent: outermost group containing `id`, else `id`. */
export function selectionTargetId(objects: LabelObject[], id: string): string {
  return findAncestors(objects, id)[0]?.id ?? id;
}

/** True when any ancestor group of `id` is locked (lock cascades down). The
 *  node's own `locked` is the caller's check; some sites treat it differently
 *  (lock-bypass meta keys). */
export function hasLockedAncestor(objects: LabelObject[], id: string): boolean {
  return findAncestors(objects, id).some((g) => !!g.locked);
}

/** Identity-preserving: unaffected subtrees keep their original references. */
export function mapObjectById(
  objects: LabelObject[],
  id: string,
  mapper: (obj: LabelObject) => LabelObject,
): LabelObject[] {
  let changed = false;
  const next = objects.map((o) => {
    if (o.id === id) {
      const updated = mapper(o);
      if (updated !== o) changed = true;
      return updated;
    }
    if (isGroup(o)) {
      const nextChildren = mapObjectById(o.children, id, mapper);
      if (nextChildren !== o.children) {
        changed = true;
        return { ...o, children: nextChildren };
      }
    }
    return o;
  });
  return changed ? next : objects;
}

/** Returns tree with `id` removed plus the removed node (or null). */
export function detachObjectById(
  objects: LabelObject[],
  id: string,
): { removed: LabelObject | null; rest: LabelObject[] } {
  let removed: LabelObject | null = null;
  const visit = (nodes: LabelObject[]): LabelObject[] => {
    const out: LabelObject[] = [];
    for (const n of nodes) {
      if (n.id === id) {
        removed = n;
        continue;
      }
      if (isGroup(n)) out.push({ ...n, children: visit(n.children) });
      else out.push(n);
    }
    return out;
  };
  const rest = visit(objects);
  return { removed, rest };
}

/** Reparent cycle guard. */
export function isSelfOrDescendant(
  objects: LabelObject[],
  id: string,
  ancestorId: string,
): boolean {
  const node = findObjectById(objects, id);
  if (!node) return false;
  for (const n of walkObjects([node])) {
    if (n.id === ancestorId) return true;
  }
  return false;
}

/** The roots of a selection in tree (data) order: every selected node that has
 *  no selected ancestor (descendants ride along, so they're skipped). Walks the
 *  full tree, so it also catches selected nodes inside collapsed groups. Used to
 *  resolve a multi-select layer drag into the block that actually moves. */
export function selectionRoots(
  objects: LabelObject[],
  selected: ReadonlySet<string>,
): LabelObject[] {
  const out: LabelObject[] = [];
  const visit = (nodes: LabelObject[]) => {
    for (const n of nodes) {
      if (selected.has(n.id)) {
        out.push(n); // a root: don't descend, its subtree moves with it
        continue;
      }
      if (isGroup(n)) visit(n.children);
    }
  };
  visit(objects);
  return out;
}

/** Explicit selection plus any group whose every child is (effectively)
 *  selected, post-order so it propagates up the tree. Drives the layer-row
 *  highlight: selecting all of a group's members reads as the group selected
 *  too. NOT for deciding what a drag moves (that uses the explicit set). */
export function effectiveSelection(
  objects: LabelObject[],
  selectedIds: readonly string[],
): Set<string> {
  const sel = new Set(selectedIds);
  const visit = (node: LabelObject) => {
    if (!isGroup(node)) return;
    node.children.forEach(visit);
    if (node.children.length > 0 && node.children.every((c) => sel.has(c.id))) sel.add(node.id);
  };
  objects.forEach(visit);
  return sel;
}

/** Ids that move when the row `id` is dragged: just `[id]` unless it's part of
 *  the EXPLICIT multi-selection, in which case the selection's unlocked roots
 *  move as a block. Falls back to `[id]` when the grabbed row's root was a
 *  locked group that dropped out, so a locked parent can't redirect the drag or
 *  swallow it. Uses the explicit set, not the highlight's auto-promoted groups,
 *  so dragging one leaf in a single-child chain doesn't move its ancestor. */
export function dragBlockIds(
  objects: LabelObject[],
  selectedIds: readonly string[],
  id: string,
): string[] {
  const sel = new Set(selectedIds);
  if (!sel.has(id)) return [id];
  const roots = selectionRoots(objects, sel).filter((n) => !n.locked);
  const covered = roots.some((r) => isSelfOrDescendant(objects, r.id, id));
  return covered ? roots.map((n) => n.id) : [id];
}

/** Move several nodes as one block to `target`, preserving the given order.
 *  Pure: returns the new tree, or the SAME reference (no-op) when the move is
 *  invalid. Single source for multi-select layer drag, mirroring the single
 *  reparent: ids nested under another moved id are dropped (only roots move);
 *  the move aborts (unchanged) if the target isn't a group, or sits inside one
 *  of the moved subtrees (cycle). The block lands contiguously at `target.index`. */
export function reparentNodes(
  objects: LabelObject[],
  ids: readonly string[],
  target: { parentId: string | null; index: number },
): LabelObject[] {
  const idSet = new Set(ids);
  // Keep only roots: drop any id that lives under another moved id.
  const roots = ids.filter(
    (id) => !findAncestors(objects, id).some((a) => idSet.has(a.id)),
  );
  if (roots.length === 0) return objects;
  const parentId = target.parentId;
  if (parentId !== null) {
    const parent = findObjectById(objects, parentId);
    if (!parent || !isGroup(parent)) return objects;
    if (roots.some((id) => isSelfOrDescendant(objects, id, parentId))) return objects;
  }
  // Detach every root, collecting the nodes in `roots` order.
  let rest = objects;
  const moved: LabelObject[] = [];
  for (const id of roots) {
    const { removed, rest: next } = detachObjectById(rest, id);
    if (!removed) return objects; // unknown id: abort rather than move a partial block
    moved.push(removed);
    rest = next;
  }
  const insertBlock = (arr: LabelObject[]): LabelObject[] => {
    const at = Math.max(0, Math.min(target.index, arr.length));
    return [...arr.slice(0, at), ...moved, ...arr.slice(at)];
  };
  const result =
    target.parentId === null
      ? insertBlock(rest)
      : mapObjectById(rest, target.parentId, (p) =>
          isGroup(p) ? { ...p, children: insertBlock(p.children) } : p,
        );
  // Dropping a block back into its own slot rebuilds an identical tree; return
  // the original ref so callers can skip a no-op commit (no phantom undo step).
  return sameStructure(objects, result) ? objects : result;
}

/** Structural equality by id, order, and nesting (ignores props). Cheap enough
 *  for a one-off drop; used to detect a no-op reparent. */
function sameStructure(a: LabelObject[], b: LabelObject[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (!x || !y || x.id !== y.id) return false;
    const xg = isGroup(x);
    if (xg !== isGroup(y)) return false;
    if (xg && isGroup(y) && !sameStructure(x.children, y.children)) return false;
  }
  return true;
}

/** True when groupSelection() would act (>=1 top-level unlocked). */
export function canGroupSelection(
  objects: LabelObject[],
  selectedIds: readonly string[],
): boolean {
  return selectedIds.some((id) =>
    objects.some((o) => o.id === id && !o.locked),
  );
}

/** True when removeSelectedObjects() would act (>=1 top-level unlocked). */
export function canDeleteSelection(
  objects: LabelObject[],
  selectedIds: readonly string[],
): boolean {
  return selectedIds.some((id) =>
    objects.some((o) => o.id === id && !o.locked),
  );
}

/** True when ungroup() would act: a selected top-level object is an unlocked
 *  group. The lock check mirrors ungroupIds, which skips locked groups. */
export function canUngroupSelection(
  objects: LabelObject[],
  selectedIds: readonly string[],
): boolean {
  return objects.some(
    (o) => selectedIds.includes(o.id) && isGroup(o) && !o.locked,
  );
}

/** True when the selection is non-empty and every selected top-level object
 *  is locked; drives the lock/unlock toggle direction. */
export function isSelectionLocked(
  objects: LabelObject[],
  selectedIds: readonly string[],
): boolean {
  if (selectedIds.length === 0) return false;
  return selectedIds.every((id) =>
    objects.some((o) => o.id === id && !!o.locked),
  );
}

/** Expand group ids to their descendant leaves; leaf ids pass through. */
export function expandSelection(
  objects: LabelObject[],
  selectedIds: readonly string[],
): string[] {
  const byId = new Map<string, LabelObject>();
  for (const n of walkObjects(objects)) byId.set(n.id, n);
  const out: string[] = [];
  for (const id of selectedIds) {
    const node = byId.get(id);
    if (!node) continue;
    if (isGroup(node)) {
      for (const leaf of getAllLeaves(node.children)) out.push(leaf.id);
    } else {
      out.push(id);
    }
  }
  return out;
}

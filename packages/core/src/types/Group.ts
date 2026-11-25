import type { LeafObject } from '../registry/leafObject';
import type { LabelObjectBase } from './LabelObject';
import type { BlockOverlay } from '../lib/zplOverlay/overlay';
import { withJmDensity, type JmDensity, type LabelConfig, type PageLabel, type StoredFormatDelivery } from './LabelConfig';
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
  /** ^DF: the printer stores this page's block under the path instead of printing it. */
  storedFormatPath?: string;
  /** How this page's ^DF reaches the printer without this design storing it again. */
  storedFormatDelivery?: StoredFormatDelivery;
  /** Host commands in canonical spelling, such as `~HS` or `^HWR:*.*`: a regenerated block asks what its source asked. */
  hostCommands?: readonly string[];
  /** Source-patch overlay of the ^XA…^XZ block this page was imported from,
   *  letting export replay untouched bytes verbatim. Absent on fresh designs
   *  and on pages the parser couldn't fully link; those regenerate from the
   *  model. Rides persist + zundo as part of the page. */
  overlay?: BlockOverlay;
}

/** The questions a page asks, an empty list being none. */
export const pageHostCommands = (page: Pick<Page, 'hostCommands'>): readonly string[] | undefined =>
  page.hostCommands?.length ? page.hostCommands : undefined;

/** The fields of a label that are one page's own, so a label handed in with another page's values drops them. */
const PAGE_SCOPED_KEYS = ['storedFormatPath', 'storedFormatDelivery', 'hostCommands'] as const;

/** The label as this page prints it: its own ^JM wins, so a block imported at
 *  a diverging density keeps that density through export (coordinates included,
 *  since every dots<->mm boundary reads it through effectiveDpmm). */
export function pageLabelConfig(label: LabelConfig, page: Pick<Page, 'jmDensity' | 'storedFormatPath' | 'storedFormatDelivery' | 'hostCommands'>): PageLabel {
  // The only mint backed by a real resolution: folding the page's ^JM, ^DF and host commands in.
  const folded = withJmDensity(label, page.jmDensity) as PageLabel;
  const own: Partial<Pick<PageLabel, (typeof PAGE_SCOPED_KEYS)[number]>> = {};
  if (page.storedFormatPath !== undefined) {
    own.storedFormatPath = page.storedFormatPath;
    if (page.storedFormatDelivery !== undefined) own.storedFormatDelivery = page.storedFormatDelivery;
  }
  const questions = pageHostCommands(page);
  if (questions !== undefined) own.hostCommands = questions;
  if (Object.keys(own).length === 0 && PAGE_SCOPED_KEYS.every((key) => folded[key] === undefined)) return folded;
  const { storedFormatPath: _path, storedFormatDelivery: _delivery, hostCommands: _questions, ...base } = folded;
  return { ...base, ...own };
}

/** Content the design keeps: objects or questions. An empty replayed block is none. */
export function pageHasContent(page: Pick<Page, 'objects' | 'hostCommands'>): boolean {
  return page.objects.length > 0 || pageHostCommands(page) !== undefined;
}

/** True when the page exports bytes: objects, a replayed overlay, or a question for the printer. */
export function pageEmits(page: Pick<Page, 'objects' | 'overlay' | 'hostCommands'>): boolean {
  return page.objects.length > 0 || page.overlay !== undefined || pageHostCommands(page) !== undefined;
}

/** The label for a render that must print and ask nothing: a preview never stores or queries. */
export function withoutStoredFormat(label: LabelConfig): PageLabel {
  return pageLabelConfig(label, {});
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

export type ExportStep = { leaf: LeafObject } | { excluded: LabelObject };

/** Render-order walk of the export cascade: the leaves that print, and the
 *  topmost `includeInExport=false` nodes, whose subtrees are not entered. */
export function* walkExportOrder(objects: readonly LabelObject[]): Iterable<ExportStep> {
  for (const o of objects) {
    if (o.includeInExport === false) yield { excluded: o };
    else if (isGroup(o)) yield* walkExportOrder(o.children);
    else yield { leaf: o };
  }
}

/** The leaves that print; also the preflight leaf set, so checks track what prints. */
export function exportableLeaves(objects: readonly LabelObject[]): LeafObject[] {
  const out: LeafObject[] = [];
  for (const step of walkExportOrder(objects)) if ("leaf" in step) out.push(step.leaf);
  return out;
}

/** Deep copy of a node moved by (dx, dy), its ids from `idOf`. Children carry absolute coords,
 *  so the move recurses into them. A copied leaf has no source bytes, so it drops `dirty`. */
export function cloneTree(src: LabelObject, dx: number, dy: number, idOf: (o: LabelObject) => string): LabelObject {
  if (isGroup(src)) {
    return { ...src, id: idOf(src), x: src.x + dx, y: src.y + dy, children: src.children.map((c) => cloneTree(c, dx, dy, idOf)) };
  }
  const { dirty: _dirty, ...leaf } = src;
  return { ...leaf, id: idOf(src), x: src.x + dx, y: src.y + dy, props: { ...src.props } } as LabelObject;
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

/** Carries the cascaded group lock, so one list serves snap, select and
 *  transform and none of them can target what is not drawn. */
export function visibleLeaves(objects: readonly LabelObject[]): LeafObject[] {
  const out: LeafObject[] = [];
  const walk = (nodes: readonly LabelObject[], inheritedLocked: boolean) => {
    for (const n of nodes) {
      if (n.visible === false) continue;
      const locked = inheritedLocked || !!n.locked;
      if (isGroup(n)) walk(n.children, locked);
      else out.push(locked && !n.locked ? { ...n, locked: true } : n);
    }
  };
  walk(objects, false);
  return out;
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

/** The object without its repeat mark. */
export function withoutRepeat<T extends LabelObject>(obj: T): T {
  if (!("repeat" in obj)) return obj;
  const { repeat: _repeat, ...plain } = obj;
  return plain as T;
}

export const isRepeating = (obj: LabelObject): boolean => obj.repeat === true;

export const withRepeatMark = <T extends LabelObject>(obj: T): T => ({ ...obj, repeat: true });

/** The children a dissolved group frees, which go on repeating where it did. */
export const ungrouped = (group: GroupObject): LabelObject[] =>
  isRepeating(group) ? group.children.map(withRepeatMark) : group.children;

/** A moved node as its new place holds it. In a group nothing repeats. A child of a repeating group
 *  goes on repeating at the top level, as after an ungroup. */
function arriving(objects: LabelObject[], node: LabelObject, parentId: string | null): LabelObject {
  if (parentId !== null) return withoutRepeat(node);
  const from = findAncestors(objects, node.id)[0];
  return from && isRepeating(from) ? withRepeatMark(node) : node;
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
    moved.push(arriving(objects, removed, parentId));
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

/** The selected top-level objects an action may change, so the unlocked ones. */
export function selectedTopObjects(objects: readonly LabelObject[], selectedIds: readonly string[]): LabelObject[] {
  return objects.filter((o) => !o.locked && selectedIds.includes(o.id));
}

export const selectedTopGroups = (objects: readonly LabelObject[], selectedIds: readonly string[]): GroupObject[] =>
  selectedTopObjects(objects, selectedIds).filter(isGroup);

/** True when groupSelection() would act (>=1 top-level unlocked). */
export const canGroupSelection = (objects: readonly LabelObject[], selectedIds: readonly string[]): boolean =>
  selectedTopObjects(objects, selectedIds).length > 0;

/** True when removeSelectedObjects() would act (>=1 top-level unlocked). */
export const canDeleteSelection = (objects: readonly LabelObject[], selectedIds: readonly string[]): boolean =>
  selectedTopObjects(objects, selectedIds).length > 0;

/** True when ungroupIds would act, which skips locked groups. */
export const canUngroupSelection = (objects: readonly LabelObject[], selectedIds: readonly string[]): boolean =>
  selectedTopGroups(objects, selectedIds).length > 0;

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

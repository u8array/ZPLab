import { isGroup, type LabelObject, type Page } from '@zplab/core/types/Group';
import type { ObjectChanges } from '@zplab/core/types/LabelObject';
import { isLocaleCode, type LocaleCode } from '../locales';
import { renameTemplateMarkers, substituteTemplateMarker } from '@zplab/core/lib/fnTemplate';
import { getObjectStringContent } from '@zplab/core/lib/variableBinding';
import { getEntry } from '@zplab/core/registry';
import { anchorRepin } from './anchorRepin';

/** Meta fields that remain editable on a locked object so the user can
 *  release the lock or annotate without unlocking first. Everything else
 *  (position, props, rotation, positionType) is blocked. */
const LOCK_BYPASS_KEYS = new Set(['locked', 'visible', 'includeInExport', 'comment', 'name']);

export function isLockBypass(changes: ObjectChanges): boolean {
  const keys = Object.keys(changes);
  return keys.length > 0 && keys.every((k) => LOCK_BYPASS_KEYS.has(k));
}

/** Object keys whose change alters emitted ZPL bytes, invalidating the
 *  overlay's verbatim replay for that object. `comment` is included because it
 *  emits as a leading `^FX`. Pure metadata (lock/visible/name/includeInExport)
 *  keeps the replay valid. The `dirtyTracking` middleware reads this to stamp
 *  `dirty` centrally; mutators no longer set it themselves. */
export const EMIT_AFFECTING_KEYS = new Set(['x', 'y', 'rotation', 'positionType', 'fieldJustify', 'props', 'comment', 'type']);

/** Label-config keys that never reach emitted ZPL (design-time editor aids
 *  only). Everything else maps to a config command, so changing it would make
 *  a page overlay's raw config bytes stale. Exported for a tripwire test: a key
 *  wrongly added here would silently skip the overlay drop and emit stale config. */
export const NON_EMITTING_CONFIG_KEYS = new Set(['safeAreaMm']);

/** Prop keys that never reach emitted ZPL: a props diff touching only these
 *  must not stamp dirty and drop the verbatim overlay. Classifies globally by
 *  key name (membership locked in anchorRepin.test.ts). */
export const NON_EMITTING_PROP_KEYS = new Set(['preSerialContent']);

/** True when a config patch changes a field that reaches emitted ZPL. Used to
 *  drop page overlays: until config-segment linkage lands, an overlay replays
 *  config verbatim, so an emit-affecting edit must force full regeneration. */
export function configPatchAffectsEmit(
  prev: Record<string, unknown>,
  patch: Record<string, unknown>,
): boolean {
  return Object.keys(patch).some(
    (k) => !NON_EMITTING_CONFIG_KEYS.has(k) && prev[k] !== patch[k],
  );
}

/** Drop round-trip provenance from a leaf: a clone/copy is a net-new object with
 *  a new id, so it has no overlay segment and must regenerate from the model. */
function dropProvenance<T extends LabelObject>(node: T): T {
  if (node.dirty === undefined) return node;
  const next = { ...node };
  delete next.dirty;
  return next;
}

/** Apply `renameTemplateMarker` to every leaf's `content` in a subtree.
 *  Identity-preserving: returns the same array (and same node refs)
 *  when no markers needed rewriting, so React memoisation downstream
 *  stays effective for the common case where the rename touched no
 *  templates. */
export function rewriteTemplateMarkers(
  objects: LabelObject[],
  oldName: string,
  newName: string,
): LabelObject[] {
  return rewriteTemplateMarkersMap(objects, new Map([[oldName, newName]]));
}

/** Like `rewriteTemplateMarkers` but renames many names in ONE pass per leaf,
 *  looking each marker up against the original name. Order-independent and
 *  collision-safe (swaps/chains can't cascade). Identity-preserving. */
export function rewriteTemplateMarkersMap(
  objects: LabelObject[],
  renames: ReadonlyMap<string, string>,
): LabelObject[] {
  if (renames.size === 0) return objects;
  let changed = false;
  const next = objects.map((obj) => {
    if (isGroup(obj)) {
      const nextChildren = rewriteTemplateMarkersMap(obj.children, renames);
      if (nextChildren === obj.children) return obj;
      changed = true;
      return { ...obj, children: nextChildren };
    }
    const content = getObjectStringContent(obj);
    if (content === undefined) return obj;
    const renamed = renameTemplateMarkers(content, renames);
    if (renamed === content) return obj;
    changed = true;
    const props = (obj as { props: object }).props;
    return { ...obj, props: { ...props, content: renamed } } as LabelObject;
  });
  return changed ? next : objects;
}

/** Replace every `«name»` marker with `replacement` across a subtree's leaf
 *  `content`. Identity-preserving when nothing matched (see
 *  {@link rewriteTemplateMarkers}). Used on variable deletion. */
export function substituteTemplateMarkers(
  objects: LabelObject[],
  name: string,
  replacement: string,
): LabelObject[] {
  let changed = false;
  const next = objects.map((obj) => {
    if (isGroup(obj)) {
      const nextChildren = substituteTemplateMarkers(obj.children, name, replacement);
      if (nextChildren === obj.children) return obj;
      changed = true;
      return { ...obj, children: nextChildren };
    }
    const content = getObjectStringContent(obj);
    if (content === undefined) return obj;
    const substituted = substituteTemplateMarker(content, name, replacement);
    if (substituted === content) return obj;
    changed = true;
    const props = (obj as { props: object }).props;
    return { ...obj, props: { ...props, content: substituted } } as LabelObject;
  });
  return changed ? next : objects;
}

export function applyObjectChanges(
  obj: LabelObject,
  changes: ObjectChanges,
  ancestorLocked = false,
): LabelObject {
  // Lock cascades from any ancestor group: a leaf inside a locked group
  // accepts only bypass keys (locked / visible / includeInExport /
  // comment / name) so the user can still toggle visibility or release
  // the lock from the layers panel. Load-bearing; `expandSelection`-
  // driven callers (arrow-key nudges, shift-multi-drag) target the
  // group's leaf children directly and would otherwise sidestep the
  // group's own `locked` flag.
  if ((obj.locked || ancestorLocked) && !isLockBypass(changes)) return obj;
  if (isGroup(obj)) {
    // Groups have no registry entry (no normalize hook) and no props to
    // merge; apply top-level changes only. Children stay untouched;
    // tree updates reach them through their own mapObjectById call.
    return { ...obj, ...changes } as LabelObject;
  }
  const normalize = getEntry(obj.type)?.normalizeChanges;
  const normalized = normalize ? normalize(obj, changes) : changes;
  const next = {
    ...obj,
    ...normalized,
    props: normalized.props ? Object.assign({}, obj.props, normalized.props) : obj.props,
  } as LabelObject;
  // Dirty-tracking is centralized in the dirtyTracking middleware (a state diff),
  // so this mutator no longer stamps dirty itself.
  return anchorRepin(obj, normalized, next);
}

export function detectLocale(): LocaleCode {
  const tag = navigator.language.toLowerCase();
  // Chinese needs the script subtag: the generic 2-char slice ('zh') matches
  // no locale and silently fell through to English for every Chinese browser.
  if (tag.startsWith('zh')) {
    const traditional = tag.includes('hant')
      || tag.startsWith('zh-tw') || tag.startsWith('zh-hk') || tag.startsWith('zh-mo');
    return traditional ? 'zh-hant' : 'zh-hans';
  }
  const lang = tag.slice(0, 2);
  // Norwegian browsers report the written standard (nb/nn), not the
  // macrolanguage code our locale uses.
  if (lang === 'nb' || lang === 'nn') return 'no';
  return isLocaleCode(lang) ? lang : 'en';
}

export function detectInitialTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/** Build-time defaults for third-party services. Vite injects VITE_THIRD_PARTY_*
 *  env values; missing values fall back to enabled. Tauri/Docker builds can flip
 *  the default by setting VITE_THIRD_PARTY_LABELARY=false in their build env. */
export function thirdPartyDefaults(): { labelary: boolean } {
  return {
    labelary: import.meta.env.VITE_THIRD_PARTY_LABELARY !== 'false',
  };
}

/** Base offset (in dots) used to stagger duplicate / paste copies so they
 *  don't sit exactly on top of the source. 20 dots ≈ 2.5 mm at 8dpmm. */
export const DUPLICATE_OFFSET_DOTS = 20;

/** Deep-clone a children list with fresh ids and shallow-cloned props on
 *  every leaf. Recurses through nested groups. */
export function cloneChildrenFresh(children: LabelObject[]): LabelObject[] {
  return children.map((c) => {
    if (isGroup(c)) {
      return {
        ...c,
        id: crypto.randomUUID(),
        children: cloneChildrenFresh(c.children),
      };
    }
    return dropProvenance({
      ...c,
      id: crypto.randomUUID(),
      props: { ...c.props },
    } as LabelObject);
  });
}

/** Deep-clone one node with fresh ids, shifted by (dx, dy). Group children
 *  carry absolute coords, so the shift recurses into them; shifting only the
 *  group's structural x/y would leave the copy on top of the original. */
export function cloneShifted(src: LabelObject, dx: number, dy: number): LabelObject {
  if (isGroup(src)) {
    return {
      ...src,
      id: crypto.randomUUID(),
      x: src.x + dx,
      y: src.y + dy,
      children: src.children.map((c) => cloneShifted(c, dx, dy)),
    };
  }
  return dropProvenance({
    ...src,
    id: crypto.randomUUID(),
    x: src.x + dx,
    y: src.y + dy,
    props: { ...src.props },
  } as LabelObject);
}

/** Clone clipboard entries with fresh ids, shifted by (dx, dy). Fresh ids per
 *  paste avoid collisions across repeated pastes from the same clipboard. */
export function freshPasteCopies(
  clipboard: readonly LabelObject[],
  dx: number,
  dy: number,
): LabelObject[] {
  return clipboard.map((src) => cloneShifted(src, dx, dy));
}

/** Build offset copies of objects identified by `ids`. Missing ids are
 *  silently dropped. Props are shallow-cloned to avoid sharing the
 *  reference with the original. */
export function buildOffsetCopies(objs: LabelObject[], ids: readonly string[]): LabelObject[] {
  const byId = new Map(objs.map((o) => [o.id, o]));
  return ids.flatMap((id) => {
    const src = byId.get(id);
    if (!src) return [];
    return [cloneShifted(src, DUPLICATE_OFFSET_DOTS, DUPLICATE_OFFSET_DOTS)];
  });
}

/** Subset of LabelState that paged mutators read. Slices that touch pages
 *  via `set((state) => updateCurrentObjects(state, fn))` use this shape. */
export interface PageState {
  pages: Page[];
  currentPageIndex: number;
}

export function updateCurrentObjects(
  state: PageState,
  fn: (objects: LabelObject[]) => LabelObject[]
): { pages: Page[] } {
  return {
    pages: state.pages.map((p, i) =>
      i === state.currentPageIndex ? { ...p, objects: fn(p.objects) } : p
    ),
  };
}

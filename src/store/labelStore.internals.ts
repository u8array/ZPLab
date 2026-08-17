import { isGroup, type LabelObject, type Page } from '@zplab/core/types/Group';
import type { ObjectChanges } from '@zplab/core/types/LabelObject';
import { NON_EMITTING_CONFIG_FIELDS } from '@zplab/core/types/LabelConfig';
import { isLocaleCode, type LocaleCode } from '../locales';
export {
  rewriteTemplateMarkers,
  rewriteTemplateMarkersMap,
  substituteTemplateMarkers,
} from '@zplab/core/lib/templateObjects';
import { applyChanges } from '@zplab/core/lib/anchorRepin';
import type { DeviceFontLabel } from '@zplab/core/lib/customFonts';
import { probeBarcodeFootprint } from './anchorRepin';

import { newId } from "@zplab/core/lib/ids";
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
 *  a page overlay's raw config bytes stale. Derived from the `emits` axis of
 *  LABEL_CONFIG_FIELDS; a tripwire test pins the membership. */
export const NON_EMITTING_CONFIG_KEYS: ReadonlySet<string> = new Set<string>(
  NON_EMITTING_CONFIG_FIELDS,
);

// Shared with the MCP boundary, so it lives in core.
export { NON_EMITTING_PROP_KEYS } from '@zplab/core/types/LabelObject';

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

export function applyObjectChanges(
  obj: LabelObject,
  changes: ObjectChanges,
  ancestorLocked = false,
  label?: DeviceFontLabel,
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
  // Dirty-tracking is centralized in the dirtyTracking middleware (a state diff),
  // so this mutator no longer stamps dirty itself.
  return applyChanges(obj, changes, probeBarcodeFootprint, { label });
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
        id: newId(),
        children: cloneChildrenFresh(c.children),
      };
    }
    return dropProvenance({
      ...c,
      id: newId(),
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
      id: newId(),
      x: src.x + dx,
      y: src.y + dy,
      children: src.children.map((c) => cloneShifted(c, dx, dy)),
    };
  }
  return dropProvenance({
    ...src,
    id: newId(),
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

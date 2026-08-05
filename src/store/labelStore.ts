import { create, useStore } from 'zustand';
import { temporal } from 'zundo';
import { persist, createJSONStorage } from 'zustand/middleware';
import { dirtyTracking } from './dirtyTracking';
import type { ObjectChanges } from '@zplab/core/types/LabelObject';
import { PRINTER_PROFILE_FIELDS, printerProfileSchema } from '@zplab/core/types/PrinterProfile';
import { visitLeavesInPages, foldSerialLeaf, fixTlc39SlotsLeaf, bindSingleMarkerLeaf, sanitiseVariableNames, safeUniqueNameById } from '@zplab/core/lib/objectTree';
import { insertReverseBackingBoxes, pageNeedsReverseBacking } from '@zplab/core/lib/reverseBacking';
import { dropLegacyFontBindings } from '@zplab/core/lib/customFonts';
import { reconstructLegacyJmDensity } from '@zplab/core/lib/designFile';
import type { DesignFilePage } from '@zplab/core/lib/designFile';
import type { CustomFontMapping, JmDensity, LabelConfig } from '@zplab/core/types/LabelConfig';
import type { LabelObject } from '@zplab/core/types/Group';
import {
  createPrinterProfileSlice,
  type PrinterProfileSlice,
} from './slices/printerProfileSlice';
import { createUiSlice, type UiSlice } from './slices/uiSlice';
import { createSelectionSlice, type SelectionSlice } from './slices/selectionSlice';
import { createPreviewSlice, type PreviewSlice } from './slices/previewSlice';
import { createDataSlice, type DataSlice } from './slices/dataSlice';
import { createDbSlice, type DbSlice } from './slices/dbSlice';
import { createVariablesSlice, type VariablesSlice } from './slices/variablesSlice';
import { createLabelConfigSlice, type LabelConfigSlice } from './slices/labelConfigSlice';
import { createObjectSlice, type ObjectSlice } from './slices/objectSlice';
import { createAppUpdateSlice, type AppUpdateSlice } from './slices/appUpdateSlice';
import { createFeedbackSlice, type FeedbackSlice } from './slices/feedbackSlice';
import { createLifecycleSlice, type LifecycleSlice } from './slices/lifecycleSlice';
import type { Variable, VariableInput } from '@zplab/core/types/Variable';

export { __resetPreviewCacheForTests } from './slices/previewSlice';
export type { ObjectChanges };
export type { Variable, VariableInput };

/** Composed store shape; intersection of every slice. */
export type LabelState =
  & ObjectSlice
  & PrinterProfileSlice
  & UiSlice
  & SelectionSlice
  & PreviewSlice
  & DataSlice
  & DbSlice
  & VariablesSlice
  & LabelConfigSlice
  & AppUpdateSlice
  & FeedbackSlice
  & LifecycleSlice;

export {
  currentObjects,
  currentPageLabel,
  canCallLabelary,
  selectLabelaryNoticeRequired,
  selectEffectivePreviewProvider,
  selectPreviewLocksEditor,
  selectHasPerLabelOverrides,
  selectBatchInputs,
  selectCanBatchExport,
  selectBatchPrintCount,
} from './labelStore.selectors';
import { currentObjects, selectPreviewLocksEditor } from './labelStore.selectors';

export function migrateLegacy(persistedState: unknown, version: number): unknown {
  if (!persistedState || typeof persistedState !== 'object') return persistedState;
  let s = persistedState as Record<string, unknown>;

  // v0→v1: top-level objects array → pages
  if (version < 1 && Array.isArray(s.objects) && !Array.isArray(s.pages)) {
    s = { ...s, pages: [{ objects: s.objects }], currentPageIndex: 0 };
  }

  // v1→v2: viewRotation was added after version 1 shipped; patch it if absent.
  if (version < 2) {
    const cs = s.canvasSettings;
    if (cs && typeof cs === 'object' && !('viewRotation' in cs)) {
      s = { ...s, canvasSettings: { ...(cs as Record<string, unknown>), viewRotation: 0 } };
    }
  }

  // v2→v3: `circle` was folded into `ellipse` with `lockAspect:true`. Old
  // saves still carry `type:'circle'` with `props.diameter`; rewrite them so
  // the rest of the app only ever sees the unified ellipse shape.
  if (version < 3) {
    s = { ...s, pages: migrateCirclesInPages(s.pages) };
  }

  // v3→v4: canvasSettings.dataRenderMode added for the schema/preview toggle.
  // Default to 'preview' so existing sessions keep showing data-substituted
  // canvas exactly as before.
  if (version < 4) {
    const cs = s.canvasSettings;
    if (cs && typeof cs === 'object' && !('dataRenderMode' in cs)) {
      s = { ...s, canvasSettings: { ...(cs as Record<string, unknown>), dataRenderMode: 'preview' } };
    }
  }

  // v4→v5: Setup-Script fields move out of labelConfig into a new
  // printerProfile slice (see PrinterProfile.ts). Extract any of the
  // 14 profile fields that lived on `label`, hoist them onto a fresh
  // `printerProfile`, and strip them from the label so the per-label
  // config no longer carries per-installation state.
  if (version < 5) {
    const label = s.label;
    if (label && typeof label === 'object') {
      const profileFields = new Set<string>(PRINTER_PROFILE_FIELDS);
      const profile: Record<string, unknown> = {};
      const nextLabel: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(label as Record<string, unknown>)) {
        if (profileFields.has(k)) profile[k] = v;
        else nextLabel[k] = v;
      }
      s = { ...s, label: nextLabel, printerProfile: profile };
    }
  }

  // Invariant: rehydrated state must carry `printerProfile`, else
  // every `s.printerProfile.foo` selector throws. Later migrations
  // assume this shape and don't re-seed it.
  if (!('printerProfile' in (s as Record<string, unknown>))) {
    s = { ...s, printerProfile: {} };
  }

  // v5→v6: gs1databar props.moduleWidth → props.magnification. The
  // value was always semantically the ^BR magnification multiplier
  // (1-10), not a dot quantity; the rename clarifies that.
  if (version < 6) {
    s = { ...s, pages: migrateGs1DatabarInPages(s.pages) };
  }

  // v6→v7: ^MA/^MI type codes corrected to match spec (R/C instead of
  // H/R). The legacy 'H' meant "head cleaning"; the spec letter is 'C'.
  // 'R' (replacement) was already correct.
  if (version < 7) {
    const pp = (s as Record<string, unknown>).printerProfile;
    if (pp && typeof pp === 'object') {
      s = { ...s, printerProfile: migrateMaintenanceTypeCodes(pp as Record<string, unknown>) };
    }
  }

  // v7→v8: drop path-less canvas-only font bindings left by the removed
  // built-in preview feature. They still resolve on canvas via alias but
  // only persist in saved JSON; scrub them so legacy sessions are clean.
  if (version < 8) {
    const label = s.label;
    if (label && typeof label === 'object') {
      const l = label as Record<string, unknown>;
      if (Array.isArray(l.customFonts)) {
        s = {
          ...s,
          label: {
            ...l,
            customFonts: dropLegacyFontBindings(l.customFonts as CustomFontMapping[]),
          },
        };
      }
    }
  }

  // v8→v9: paletteRows replaced the old paletteFavorites and gained a stable
  // `id` (the sortable/reorder key). Saves from before the field rehydrate with
  // id=undefined, collapsing every sortable id to `palrow-undefined`, so dnd-kit
  // keeps only the last row. Drop the dead favorites key and backfill ids,
  // guaranteeing uniqueness so the fallback can't recreate the collision.
  if (version < 9) {
    if ('paletteFavorites' in s) {
      s = { ...s };
      delete (s as Record<string, unknown>).paletteFavorites;
    }
    if (Array.isArray(s.paletteRows)) {
      const seen = new Set<string>();
      s = {
        ...s,
        paletteRows: (s.paletteRows as unknown[]).map((r, i) => {
          const row = r && typeof r === 'object' ? (r as Record<string, unknown>) : {};
          const type = typeof row.type === 'string' ? row.type : 'text';
          let id = typeof row.id === 'string' && row.id ? row.id : '';
          if (!id || seen.has(id)) {
            let n = i;
            do {
              id = `${type}-${n++}`;
            } while (seen.has(id));
          }
          seen.add(id);
          return { ...row, id };
        }),
      };
    }
  }

  // v15→v16: TLC39 props move to the real ^BT slots (w2/h2, wideRatio);
  // emit and canvas read the new shape unguarded.
  if (version < 16 && Array.isArray(s.pages)) {
    visitLeavesInPages(s.pages, fixTlc39SlotsLeaf);
  }

  // v9→v10: reverse text dropped its synthesized self-background ^GB for a
  // spec-true ^FR knockout. Give every legacy reverse text a real black box
  // behind it so the white-on-black look survives the model change.
  if (version < 10 && Array.isArray((s as Record<string, unknown>).pages)) {
    const label = (s as Record<string, unknown>).label as
      | Pick<LabelConfig, 'customFonts' | 'defaultFontId'>
      | undefined;
    s = {
      ...s,
      pages: ((s as Record<string, unknown>).pages as unknown[]).map((pg) => {
        const p = pg && typeof pg === 'object' ? (pg as Record<string, unknown>) : {};
        if (!Array.isArray(p.objects)) return p;
        const objects = p.objects as LabelObject[];
        // Drop the overlay on a touched page: a new model object the overlay
        // doesn't link would force full regeneration and lose its bytes.
        const next: Record<string, unknown> = {
          ...p,
          objects: insertReverseBackingBoxes(objects, label),
        };
        if (pageNeedsReverseBacking(objects, label)) delete next.overlay;
        return next;
      }),
    };
  }

  // v10→v11: the standalone `serial` object type became a text field mode
  // (props.serial). Rewrite persisted serial objects, or they rehydrate with a
  // type that has no registry entry and silently render/emit nothing. Mirrors
  // designFile.migrateSerialToTextMode for the live localStorage session. Also
  // remap the palette variant id `serial` → `text-serial`, else that saved row
  // no longer resolves (resolveAddable returns null) and vanishes from the list.
  if (version < 11) {
    s = { ...s, pages: migrateSerialTypeInPages(s.pages) };
    if (Array.isArray(s.paletteRows)) {
      s = {
        ...s,
        paletteRows: (s.paletteRows as unknown[]).map((r) =>
          r && typeof r === "object" && (r as { variant?: unknown }).variant === "serial"
            ? { ...(r as object), variant: "text-serial" }
            : r,
        ),
      };
    }
  }

  // v11→v12: single-bind `variableId` dissolved into the content model. A field
  // bound to a variable becomes content === «name» (classifies as single-bind on
  // emit, byte-identical), and the variableId field is dropped. Overlays are kept:
  // the captured bytes don't change, and the overlay doesn't key on variableId.
  if (version < 12 && Array.isArray(s.pages)) {
    const vars = Array.isArray(s.variables)
      ? (s.variables as { id?: unknown; name?: unknown; fnNumber?: unknown }[])
      : [];
    // Resolve the unique, marker-safe name PER ID first (renames the variables),
    // so duplicate legacy names don't collapse two ids onto one marker.
    const nameById = safeUniqueNameById(vars);
    s = { ...s, pages: migrateSingleBindInPages(s.pages, nameById) };
  }

  // v12→v13: the favorites palette dropped the curated-type/variant/fixed row
  // model for a flat one-object-per-row list. A row's `variant` already was an
  // AddableEntry id, so it becomes `entryId`; `type`/`fixed` are dropped. The
  // view key `'list'` (which was the favorites tab) is renamed to `'favorites'`.
  if (version < 13) {
    if (Array.isArray(s.paletteRows)) {
      // entryId is unique per favorites list now (a row is pinned or not), so
      // collapse legacy duplicates: the old model allowed two rows of one
      // variant, which would otherwise both vanish on a single star-unpin.
      const seen = new Set<string>();
      s = {
        ...s,
        paletteRows: (s.paletteRows as unknown[]).flatMap((r) => {
          const row = r && typeof r === 'object' ? (r as Record<string, unknown>) : {};
          const id = typeof row.id === 'string' ? row.id : '';
          const entryId =
            typeof row.entryId === 'string'
              ? row.entryId
              : typeof row.variant === 'string'
                ? row.variant
                : '';
          if (!id || !entryId || seen.has(entryId)) return [];
          seen.add(entryId);
          return [{ id, entryId }];
        }),
      };
    }
    if (s.paletteView === 'list') s = { ...s, paletteView: 'favorites' };
  }

  // v13→v14: canvasSettings.smartSnapEnabled added; default true so existing
  // sessions keep object snapping on (it was implicitly on whenever grid snap
  // was off). Without this patch the persisted canvasSettings (which replaces
  // the default wholesale) would rehydrate the flag as undefined → snap off.
  if (version < 14) {
    const cs = s.canvasSettings;
    if (cs && typeof cs === 'object' && !('smartSnapEnabled' in cs)) {
      s = { ...s, canvasSettings: { ...(cs as Record<string, unknown>), smartSnapEnabled: true } };
    }
  }

  // v14→v15: dataset model generalised beyond CSV; persisted keys renamed
  // csvMapping → columnMapping and canvasSettings.csvRenderMode → dataRenderMode.
  if (version < 15) {
    if ('csvMapping' in s) {
      const { csvMapping, ...rest } = s;
      s = { ...rest, columnMapping: csvMapping };
    }
    const cs = s.canvasSettings;
    if (cs && typeof cs === 'object' && 'csvRenderMode' in cs) {
      const { csvRenderMode, ...restCs } = cs as Record<string, unknown>;
      s = { ...s, canvasSettings: { ...restCs, dataRenderMode: csvRenderMode } };
    }
  }

  // Enforce the marker-safe variable-name invariant on any rehydrated session
  // (old data may carry names like `clock:Y` that the content-marker model
  // can't represent). Renames offenders + rewrites their markers in place.
  if (Array.isArray(s.variables) && Array.isArray(s.pages)) {
    sanitiseVariableNames(s.variables as { name?: unknown; fnNumber?: unknown }[], s.pages);
  }

  // Unconditional (not version-gated): main-era sessions persist at the current
  // version but carry legacy overlays whose head ^JM rode only in the bytes, so
  // a full regen would drop it. Latch the density back as a page override.
  if (Array.isArray(s.pages)) {
    const label = s.label as { jmDensity?: JmDensity } | undefined;
    if (label) reconstructLegacyJmDensity(label, s.pages as DesignFilePage[]);
  }

  // Re-validate the rehydrated profile so a legacy snapshot that
  // violates the schema or a cross-field rule can't crash the slice's
  // safeParse on the next patch. Cross-field issues report a path
  // that may already be absent (clockMode='TOL' without
  // clockTolerance: path is ['clockTolerance']), so a single delete
  // pass is not enough. Fixpoint-loop until stable.
  const profile = (s as Record<string, unknown>).printerProfile;
  if (profile && typeof profile === 'object') {
    let next = { ...(profile as Record<string, unknown>) };
    for (let i = 0; i < 8; i++) {
      const validation = printerProfileSchema.safeParse(next);
      if (validation.success) break;
      const drop = new Set<string>();
      for (const issue of validation.error.issues) {
        const topKey = issue.path[0];
        if (typeof topKey === 'string' && topKey in next) drop.add(topKey);
      }
      // No present top-key to drop means the residual violation isn't
      // something the loop can resolve; bail to {} rather than spin.
      if (drop.size === 0) {
        next = {};
        break;
      }
      next = Object.fromEntries(Object.entries(next).filter(([k]) => !drop.has(k)));
    }
    s = { ...s, printerProfile: next };
  }

  return s;
}

function migrateMaintenanceTypeCodes(pp: Record<string, unknown>): Record<string, unknown> {
  const out = { ...pp };
  const remap = (obj: unknown): unknown => {
    if (!obj || typeof obj !== 'object') return obj;
    const o = obj as Record<string, unknown>;
    if (o.type === 'H') return { ...o, type: 'C' };
    return obj;
  };
  if (out.maintenanceAlert) out.maintenanceAlert = remap(out.maintenanceAlert);
  if (out.maintenanceMessage) out.maintenanceMessage = remap(out.maintenanceMessage);
  return out;
}

function migrateSerialTypeInPages(pages: unknown): unknown {
  // Mutates in place via the shared leaf walker (recurses groups); pages is the
  // persisted payload, not the live store, so mutation is safe.
  visitLeavesInPages(pages, foldSerialLeaf);
  return pages;
}

function migrateSingleBindInPages(
  pages: unknown,
  nameById: ReadonlyMap<string, string>,
): unknown {
  // Mutates in place via the shared leaf walker; pages is the persisted payload,
  // not the live store, so mutation is safe.
  visitLeavesInPages(pages, (leaf) => bindSingleMarkerLeaf(leaf, nameById));
  return pages;
}

function migrateGs1DatabarInPages(pages: unknown): unknown {
  // Mutates in place via the shared leaf walker; pages is the persisted
  // payload not the live store, so mutation is safe.
  visitLeavesInPages(pages, (leaf) => {
    if (
      leaf.type !== 'gs1databar' ||
      !leaf.props ||
      typeof leaf.props !== 'object'
    ) return;
    const props = leaf.props as Record<string, unknown>;
    if (!('moduleWidth' in props) || 'magnification' in props) return;
    props.magnification = props.moduleWidth;
    delete props.moduleWidth;
  });
  return pages;
}

function migrateCirclesInPages(pages: unknown): unknown {
  if (!Array.isArray(pages)) return pages;
  return pages.map((page) => {
    if (!page || typeof page !== 'object') return page;
    const p = page as { objects?: unknown };
    if (!Array.isArray(p.objects)) return page;
    return { ...p, objects: p.objects.map(migrateCircleObject) };
  });
}

function migrateCircleObject(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  const o = obj as { type?: unknown; props?: unknown; children?: unknown };
  if (Array.isArray(o.children)) {
    return { ...o, children: o.children.map(migrateCircleObject) };
  }
  if (o.type !== 'circle' || !o.props || typeof o.props !== 'object') return obj;
  const cp = o.props as { diameter?: number; thickness?: number; filled?: boolean; color?: 'B' | 'W' };
  const d = typeof cp.diameter === 'number' ? cp.diameter : 100;
  return {
    ...o,
    type: 'ellipse',
    props: {
      width: d,
      height: d,
      thickness: typeof cp.thickness === 'number' ? cp.thickness : 3,
      filled: cp.filled === true,
      color: cp.color === 'W' ? 'W' : 'B',
      lockAspect: true,
    },
  };
}

/** localStorage persist subset. `thirdParty` is intentionally OUT: the
 *  build-time env (VITE_THIRD_PARTY_*) is the single source of truth. */
export const persistPartialize = (state: LabelState) => ({
  label: state.label,
  printerProfile: state.printerProfile,
  pages: state.pages,
  currentPageIndex: state.currentPageIndex,
  locale: state.locale,
  theme: state.theme,
  labelaryNoticeAcknowledged: state.labelaryNoticeAcknowledged,
  labelaryHost: state.labelaryHost,
  previewProvider: state.previewProvider,
  canvasSettings: state.canvasSettings,
  paletteRows: state.paletteRows,
  paletteView: state.paletteView,
  showZplCommands: state.showZplCommands,
  mcpServerEnabled: state.mcpServerEnabled,
  mcpServerPort: state.mcpServerPort,
  variables: state.variables,
  columnMapping: state.columnMapping,
  dataSourceRef: state.dataSourceRef,
  dbProfiles: state.dbProfiles,
});

/** zundo undo-timeline subset; narrower than persist. currentPageIndex rides
 *  the snapshot so undo/redo keep it in range when the page count changes, but
 *  it is excluded from change-detection (see TEMPORAL_VIEW_KEYS) so plain page
 *  navigation is not itself an undoable step. */
export const temporalPartialize = (state: LabelState) => ({
  label: state.label,
  printerProfile: state.printerProfile,
  pages: state.pages,
  currentPageIndex: state.currentPageIndex,
  variables: state.variables,
  columnMapping: state.columnMapping,
  // dataSourceRef is deliberately NOT temporal: it pairs with the (equally
  // non-temporal) dataset, and an undo must not silently drop the saved DB
  // link while the fetched rows stay on the canvas.
});

type TemporalSlice = ReturnType<typeof temporalPartialize>;

/** Partialized fields that are restored with a snapshot but do not, on their
 *  own, constitute a new undoable step. Switching the active page is view
 *  state, not a document edit. */
const TEMPORAL_VIEW_KEYS = new Set<keyof TemporalSlice>(["currentPageIndex"]);

/** zundo records on every set() unless equality reports the tracked slice
 *  unchanged. The store is identity-preserving, so a shallow ref-compare
 *  suppresses phantom history entries from selection-only (or other
 *  non-document) sets that leave the partialized fields untouched. Keys are
 *  read from `partialize` itself (minus the view-only ones) so a new tracked
 *  field is change-triggering by default and can never be silently dropped. */
const temporalEquality = (a: TemporalSlice, b: TemporalSlice) =>
  (Object.keys(a) as (keyof TemporalSlice)[]).every(
    (k) => TEMPORAL_VIEW_KEYS.has(k) || a[k] === b[k],
  );

export const useLabelStore = create<LabelState>()(
  temporal(
    dirtyTracking(
    persist(
    (set, get, store) => ({
      ...createObjectSlice(set, get, store),
      ...createPrinterProfileSlice(set, get, store),
      ...createUiSlice(set, get, store),
      ...createSelectionSlice(set, get, store),
      ...createPreviewSlice(set, get, store),
      ...createDataSlice(set, get, store),
      ...createDbSlice(set, get, store),
      ...createVariablesSlice(set, get, store),
      ...createLabelConfigSlice(set, get, store),
      ...createAppUpdateSlice(set, get, store),
      ...createFeedbackSlice(set, get, store),
      ...createLifecycleSlice(set, get, store),
    }),
    {
      name: 'zpl-designer-session',
      version: 16,
      migrate: (persistedState, version) => migrateLegacy(persistedState, version) as LabelState,
      storage: createJSONStorage(() => localStorage),
      partialize: persistPartialize,
    }
    )
    ),
    {
      limit: 100,
      partialize: temporalPartialize,
      equality: temporalEquality,
    }
  )
);

// First-deselect latch for pristineEmptyIds: one subscription instead of a
// prune in each of the dozen actions that write selectedIds. Dropping out of
// the selection once ends the untouched-field grace for good.
useLabelStore.subscribe((state, prev) => {
  if (state.selectedIds === prev.selectedIds || state.pristineEmptyIds.length === 0) return;
  const sel = new Set(state.selectedIds);
  const next = state.pristineEmptyIds.filter((id) => sel.has(id));
  if (next.length !== state.pristineEmptyIds.length) {
    useLabelStore.setState({ pristineEmptyIds: next });
  }
});

export const useCurrentObjects = () => useLabelStore(currentObjects);

/** Non-reactive sibling of `useCurrentObjects` for use inside event handlers
 *  and callbacks where a one-time read is wanted. */
export const getCurrentObjects = (): LabelObject[] =>
  currentObjects(useLabelStore.getState());

// Wraps zundo so undo/redo become no-ops under the preview lock;
// `canUndo`/`canRedo` still reflect real history for button state.
const noopHistoryAction = () => {
  /* preview lock active */
};
export const useHistory = () => {
  const history = useStore(useLabelStore.temporal);
  const locked = useLabelStore(selectPreviewLocksEditor);
  if (!locked) return history;
  return { ...history, undo: noopHistoryAction, redo: noopHistoryAction };
};

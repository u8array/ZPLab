import type { StateCreator } from 'zustand';
import { fetchPreview, labelaryErrorMessage } from '../../lib/labelary';
import {
  bitmapToDataUrl,
  fetchPrinterPreview,
  printerRenderDims,
  type PrinterRenderDims,
} from '../../lib/printerPreview';
import { buildActiveRow } from '@zplab/core/lib/variableBinding';
import { printerFailureMessage } from '../../lib/printerQuery';
import { queryTargetKey, resolveQueryTarget, type QueryTarget } from '../../lib/printTarget';
import { buildPreviewZpl } from '../../lib/printPreview';
import { currentObjects, currentPageLabel, selectEffectivePreviewProvider, selectLabelaryEndpoint, selectSourceEditing } from '../labelStore.selectors';
import type { LabelState } from '../labelStore';
import { isDesktopShell } from '../../lib/platform';

/** A finished render. `printerDims` (printer provider only; Labelary already
 *  fits the label) drives the overlay's crop and mismatch hatching. */
export interface PreviewRender {
  url: string;
  printerDims?: PrinterRenderDims;
}

export type PreviewMode =
  | { status: 'idle' }
  | { status: 'loading' }
  | ({ status: 'active' } & PreviewRender)
  | { status: 'error'; error: string };

/** Single-entry render cache keyed by provider + the ZPL that produced it.
 *  Module-level: blob URLs are non-serialisable, persisting them would
 *  resurrect stale identifiers across reloads. (revokeObjectURL on the
 *  printer provider's data URLs is a harmless no-op.) */
const previewCache = (() => {
  let entry: { key: string; render: PreviewRender } | null = null;
  return {
    get(key: string): PreviewRender | null {
      return entry && entry.key === key ? entry.render : null;
    },
    set(key: string, render: PreviewRender): void {
      if (entry) URL.revokeObjectURL(entry.render.url);
      entry = { key, render };
    },
    /** Test-only: drop the cached entry without revoking. */
    _resetForTests(): void {
      entry = null;
    },
  };
})();

/** Test-only handle to clear the preview cache between test cases. */
export const __resetPreviewCacheForTests = (): void => previewCache._resetForTests();

export interface PreviewSlice {
  previewMode: PreviewMode;
  /** Caller-checked: only call when `previewMode.status` is `idle` or `error`. A no-op without a renderer. */
  enterPreviewMode: () => Promise<void>;
  /** Reset to `idle`; blob URL stays cached for re-toggle. */
  exitPreviewMode: () => void;
}

export const createPreviewSlice: StateCreator<LabelState, [], [], PreviewSlice> = (set, get) => ({
  previewMode: { status: 'idle' },

  enterPreviewMode: async () => {
    // First Labelary preview after a cold start races the async keychain read;
    // await it once (gated on the loaded flag) so the request isn't sent keyless.
    // Placed before the snapshot+guard so the captured design can't go stale and
    // a concurrent enter can't slip past the status guard.
    // The first preview after an upgrade must not race the fire-and-forget
    // startup migration, or the still-legacy key stays unbound and the fetch
    // goes keyless; await the migration once here too.
    if (selectEffectivePreviewProvider(get()) === 'labelary' && !get().labelaryApiKeyLoaded) {
      if (isDesktopShell) await get().migrateLabelaryKey().catch(() => undefined);
      await get().hydrateLabelaryApiKey();
    }
    const state = get();
    if (state.previewMode.status === 'loading' || state.previewMode.status === 'active') {
      return;
    }
    // Without a renderer there is nothing to overlay, so a stray call is a no-op rather than an error.
    if (selectEffectivePreviewProvider(state) === 'none') return;
    // Mirror of enterSourceEdit's preview guard: the two frozen modes must
    // never coexist, and the invariant belongs to the store, not a button.
    if (selectSourceEditing(state)) return;
    // Re-read after the await: switching the provider mid-hydrate exits the
    // preview, so a stale value would render the wrong renderer.
    const provider = selectEffectivePreviewProvider(state);
    const objs = currentObjects(state);
    const active = buildActiveRow(state.dataset, state.columnMapping);
    const pageLabel = currentPageLabel(state);
    const zpl = buildPreviewZpl(pageLabel, objs, state.variables, active, { blankSamples: true });
    // The printer target resolves before the cache lookup so the key can fold
    // the device in; an unconfigured target fails here, before 'loading'.
    let printerTarget: QueryTarget | null = null;
    if (provider === 'printer') {
      const resolved = resolveQueryTarget(state.printTarget);
      if ('failure' in resolved) {
        set({ previewMode: { status: 'error', error: printerFailureMessage(resolved.failure) } });
        return;
      }
      printerTarget = resolved.target;
    }
    // Cache the render so an off/on toggle doesn't re-fetch when nothing changed.
    // Labelary folds host+key in so a runtime endpoint change invalidates the old
    // render; the printer path folds the target in instead. NUL-joined so a ':'
    // inside any field can't shift a boundary and collide.
    const endpoint = selectLabelaryEndpoint(state);
    const printerKey = (t: QueryTarget): string => [provider, queryTargetKey(t), zpl].join('\0');
    const serveCached = (k: string): boolean => {
      const hit = previewCache.get(k);
      if (hit) set({ previewMode: { status: 'active', ...hit } });
      return hit !== null;
    };
    const cacheKey = printerTarget
      ? printerKey(printerTarget)
      : [provider, endpoint.host, endpoint.apiKey ?? '', String(state.labelaryKeyEpoch), zpl].join('\0');
    if (serveCached(cacheKey)) return;
    set({ previewMode: { status: 'loading' } });
    // Stale-request guard: status check catches an exit mid-fetch; the
    // reference-equality check catches re-entry with a different design
    // (status is `loading` again but for a different request whose result
    // we mustn't overwrite). Refs change on every mutation thanks to
    // immutable updates.
    const isStale = (): boolean =>
      get().previewMode.status !== 'loading' ||
      currentPageLabel(get()) !== pageLabel ||
      currentObjects(get()) !== objs;

    if (printerTarget) {
      // Firmware render over raw TCP or USB; errors stay plain strings like
      // labelary's so the UI maps both providers the same.
      const fail = (error: string): void => {
        if (!isStale()) set({ previewMode: { status: 'error', error } });
      };
      let target = printerTarget;
      let key = cacheKey;
      let result = await fetchPrinterPreview(target, zpl);
      if (isStale()) return;
      // USB device gone: preview over network without touching the persisted USB choice.
      if (target.kind === 'usb' && result.kind === 'not_found') {
        const net = get().printTarget;
        if (net.host) {
          target = { kind: 'network', host: net.host, port: net.port };
          key = printerKey(target);
          if (serveCached(key)) return;
          result = await fetchPrinterPreview(target, zpl);
          if (isStale()) return;
        }
      }
      switch (result.kind) {
        case 'ok': {
          const url = bitmapToDataUrl(result.value);
          if (!url) {
            fail('Could not decode the printer preview.');
            return;
          }
          const render: PreviewRender = {
            url,
            printerDims: printerRenderDims(result.value),
          };
          previewCache.set(key, render);
          set({ previewMode: { status: 'active', ...render } });
          return;
        }
        case 'unconfigured':
        case 'busy':
        case 'unparsed':
        case 'ignored':
        case 'refused':
        case 'unreachable':
        case 'not_found':
        case 'permission_denied':
        case 'error':
          fail(printerFailureMessage(result));
          return;
        default: {
          // Exhaustive: a new result kind must be handled here, not silently
          // fall through to the Labelary path below with printer-specific ZPL.
          const _exhaustive: never = result;
          throw new Error(`unhandled preview result: ${JSON.stringify(_exhaustive)}`);
        }
      }
    }

    try {
      // Physical head, not the page density: the URL picks the printer the
      // stream's ^JM is then interpreted against.
      const url = await fetchPreview(zpl, state.label, endpoint.host, endpoint.apiKey);
      if (isStale()) {
        URL.revokeObjectURL(url);
        return;
      }
      previewCache.set(cacheKey, { url });
      set({ previewMode: { status: 'active', url } });
    } catch (e) {
      if (isStale()) return;
      set({ previewMode: { status: 'error', error: labelaryErrorMessage(e) } });
    }
  },

  exitPreviewMode: () =>
    set((state) => {
      if (state.previewMode.status === 'idle') return {};
      return { previewMode: { status: 'idle' } };
    }),
});

import type { StateCreator } from 'zustand';
import type { Update } from '@tauri-apps/plugin-updater';
import { isDesktopShell } from '../../lib/platform';
import { appUpdateSupported } from '../../lib/appUpdate';
import { errorMessage } from '../../lib/errorMessage';
import type { LabelState } from '../labelStore';
import { selectAppUpdateBusy, selectAppUpdateSettled } from '../labelStore.selectors';

/** installed: downloadAndInstall succeeded but relaunch failed or is pending.
 *  The update applies on the next start, so re-checking would be misleading.
 *  unsupported: this install updates through its package. */
export type AppUpdatePhase =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'available'; version: string; update: Update }
  | { phase: 'installing' }
  | { phase: 'installed' }
  | { phase: 'upToDate' }
  | { phase: 'error'; message: string }
  | { phase: 'unsupported' };

export interface AppUpdateSlice {
  /** Session-only (not persisted, not undoable): single source for the
   *  startup banner and the settings tab, so both surfaces agree and a
   *  second install cannot start while one is in flight. */
  appUpdate: AppUpdatePhase;
  /** explicit false is the silent startup check: it ends at 'idle' unless it finds an
   *  update. explicit true drives the settings button to upToDate or error. */
  checkForAppUpdate: (explicit: boolean) => Promise<void>;
  installAppUpdate: () => Promise<void>;
  dismissAppUpdate: () => void;
}

const CHECK_TIMEOUT_MS = 30_000;

export const createAppUpdateSlice: StateCreator<LabelState, [], [], AppUpdateSlice> = (
  set,
  get,
) => ({
  appUpdate: { phase: 'idle' },

  checkForAppUpdate: async (explicit) => {
    if (!isDesktopShell) return;
    if (selectAppUpdateBusy(get()) || selectAppUpdateSettled(get())) return;
    set({ appUpdate: { phase: 'checking' } });
    try {
      if (!(await appUpdateSupported())) {
        set({ appUpdate: { phase: 'unsupported' } });
        return;
      }
      const { check } = await import('@tauri-apps/plugin-updater');
      // Bounded: a request that never answers would hold 'checking' for the session.
      const update = await check({ timeout: CHECK_TIMEOUT_MS });
      if (update) {
        set({ appUpdate: { phase: 'available', version: update.version, update } });
      } else {
        set({ appUpdate: { phase: explicit ? 'upToDate' : 'idle' } });
      }
    } catch (e) {
      // The silent startup check must never disturb the editor.
      set({ appUpdate: explicit ? { phase: 'error', message: errorMessage(e) } : { phase: 'idle' } });
    }
  },

  installAppUpdate: async () => {
    const state = get().appUpdate;
    if (state.phase !== 'available') return;
    set({ appUpdate: { phase: 'installing' } });
    try {
      await state.update.downloadAndInstall();
      set({ appUpdate: { phase: 'installed' } });
      await get().relaunchApp();
    } catch (e) {
      set({ appUpdate: { phase: 'error', message: errorMessage(e) } });
    }
  },

  dismissAppUpdate: () => {
    set({ appUpdate: { phase: 'idle' } });
  },
});

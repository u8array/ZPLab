import { describe, it, expect, vi, afterEach } from 'vitest';

/** Verifies that VITE_THIRD_PARTY_LABELARY=false flips the Labelary gate
 *  off at store init. The UI gates Print/Preview buttons on
 *  `thirdParty.labelary` directly, so a false default keeps both buttons
 *  hidden on Tauri/Docker builds, even though the user can still
 *  acknowledge the notice (in-memory) for the lifetime of the session.
 *
 *  Lives in a dedicated file because each case needs to re-import the
 *  store module after stubbing import.meta.env. */
// Re-importing the labelStore module graph can exceed 5s under full-suite load.
vi.setConfig({ testTimeout: 20_000 });

describe('thirdParty defaults from env', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults Labelary gate to true when env is unset', async () => {
    vi.stubEnv('VITE_THIRD_PARTY_LABELARY', '');
    vi.resetModules();
    const { useLabelStore } = await import('./labelStore');
    expect(useLabelStore.getState().thirdParty.labelary).toBe(true);
  });

  it('defaults Labelary gate to false when env is "false"', async () => {
    vi.stubEnv('VITE_THIRD_PARTY_LABELARY', 'false');
    vi.resetModules();
    const { useLabelStore, canCallLabelary } = await import('./labelStore');
    const s = useLabelStore.getState();
    expect(s.thirdParty.labelary).toBe(false);
    // Acknowledgement alone must not unlock Labelary when the gate is off.
    s.acknowledgeLabelaryNotice();
    expect(canCallLabelary(useLabelStore.getState())).toBe(false);
  });

  it('treats other env values as "enabled" (only "false" disables)', async () => {
    vi.stubEnv('VITE_THIRD_PARTY_LABELARY', 'true');
    vi.resetModules();
    const { useLabelStore } = await import('./labelStore');
    expect(useLabelStore.getState().thirdParty.labelary).toBe(true);
  });
});

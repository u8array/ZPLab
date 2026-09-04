import { describe, it, expect } from 'vitest';
import { useLabelStore, persistPartialize, temporalPartialize } from './labelStore';

/** Snapshot the stable surface every slice extraction must preserve. */

const EXPECTED_PERSIST_KEYS = [
  'canvasSettings',
  'columnMapping',
  'currentPageIndex',
  'dataSourceRef',
  'dbProfiles',
  'keepExportMetadata',
  'label',
  'labelaryHost',
  'labelaryNoticeAcknowledged',
  'locale',
  'mcpServerEnabled',
  'mcpServerPort',
  // mcpServerToken deliberately absent: keychain-held (see hydrateMcpToken).
  'pages',
  'paletteRows',
  'paletteView',
  'previewProvider',
  'printerProfile',
  'showZplCommands',
  'theme',
  'variables',
].sort();

const EXPECTED_TEMPORAL_KEYS = [
  'columnMapping',
  'currentPageIndex',
  'label',
  'pages',
  'printerProfile',
  'variables',
].sort();

const EXPECTED_PUBLIC_SELECTORS = [
  'canCallLabelary',
  'currentObjects',
  'getCurrentObjects',
  'selectBatchInputs',
  'selectCanBatchExport',
  'selectDocumentEmits',
  'selectEditorFrozen',
  'selectLabelaryNoticeRequired',
  'selectPreviewLocksEditor',
  'selectSourceEditDirty',
  'selectSourceEditing',
  'useCurrentObjects',
  'useHistory',
];

describe('labelStore tripwires', () => {
  it('persist partialize covers exactly the agreed key set', () => {
    const subset = persistPartialize(useLabelStore.getState());
    expect(Object.keys(subset).sort()).toEqual(EXPECTED_PERSIST_KEYS);
  });

  it('temporal partialize covers exactly the agreed key set', () => {
    const subset = temporalPartialize(useLabelStore.getState());
    expect(Object.keys(subset).sort()).toEqual(EXPECTED_TEMPORAL_KEYS);
  });

  it('public state selectors stay exported and callable', async () => {
    const mod = await import('./labelStore');
    for (const name of EXPECTED_PUBLIC_SELECTORS) {
      expect(mod, `selector "${name}"`).toHaveProperty(name);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(typeof (mod as any)[name], `selector "${name}" type`).toBe('function');
    }
    // Spot-call each against the current state to confirm signature compat.
    const state = useLabelStore.getState();
    expect(mod.currentObjects(state)).toBeDefined();
    expect(typeof mod.canCallLabelary(state)).toBe('boolean');
    expect(typeof mod.selectLabelaryNoticeRequired(state)).toBe('boolean');
    expect(typeof mod.selectPreviewLocksEditor(state)).toBe('boolean');
    expect(typeof mod.selectEditorFrozen(state)).toBe('boolean');
    expect(typeof mod.selectSourceEditing(state)).toBe('boolean');
    expect(mod.selectBatchInputs(state)).toBeDefined();
    expect(typeof mod.selectCanBatchExport(state)).toBe('boolean');
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type * as Labelary from '../lib/labelary';
import {
  useLabelStore,
  currentObjects,
  selectHasPerLabelOverrides,
  selectBatchInputs,
  __resetPreviewCacheForTests,
  migrateLegacy,
} from './labelStore';
import { currentPageLabel } from './labelStore.selectors';
import { importZplText } from '@zplab/core/lib/zplImportService';
import { dotsToMm } from '@zplab/core/lib/coordinates';
import { effectiveDpmm } from '@zplab/core/types/LabelConfig';
import { loadFetchedDataset, currentDataContext, isCurrentDataContext } from './datasetActions';
import { isGroup, getAllLeaves, type LabelObject } from '@zplab/core/types/Group';
import { DEFAULT_CANVAS_SETTINGS } from './slices/uiSlice';
import { toggleShapeMode } from '../lib/lineBoxConvert';
import { defined, props } from '../test/helpers';

// Mock the Labelary client so cache tests run without network I/O.
// `fetchPreview` returns a unique blob URL on each call so the test can
// see when a re-fetch happened vs. a cache hit (same URL = cached).
vi.mock('../lib/labelary', async (importOriginal) => {
  const actual = await importOriginal<typeof Labelary>();
  let counter = 0;
  return {
    ...actual,
    fetchPreview: vi.fn(async () => `blob:mock-${++counter}`),
  };
});

// URL.revokeObjectURL is a no-op stub in jsdom by default but emits a
// warning in some setups; provide an explicit spy so we can also assert
// the cache revokes the previous URL on miss without flagging warnings.
// Also drop any cached preview entry so the cache tests stay isolated.
beforeEach(() => {
  globalThis.URL.revokeObjectURL = vi.fn();
  __resetPreviewCacheForTests();
});

/** Reset store to clean state before each test. */
function reset() {
  useLabelStore.setState({
    label: { widthMm: 100, heightMm: 60, dpmm: 8 },
    printerProfile: {},
    pages: [{ objects: [] }],
    currentPageIndex: 0,
    selectedIds: [],
    clipboard: [],
    pasteCount: 0,
    variables: [],
    dataset: null,
    dataSourceRef: null,
    dbProfiles: [],
    datasetFetchToken: 0,
    columnMapping: null,
    mappingModalOpen: false,
    previewMode: { status: 'idle' },
    previewProvider: 'labelary',
    canvasSettings: { ...DEFAULT_CANVAS_SETTINGS },
    pristineEmptyIds: [],
    // Pre-load so enterPreviewMode skips the one-shot keychain-hydrate await;
    // these tests exercise the fetch/cache path, not key loading.
    labelaryApiKeyLoaded: true,
  });
}

function state() {
  return useLabelStore.getState();
}

function objs(): LabelObject[] {
  return currentObjects(state());
}

function ids() {
  return objs().map((o) => o.id);
}

// ── setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => reset());

// ── addObject ─────────────────────────────────────────────────────────────────

describe('addObject', () => {
  it('creates object with registry defaults and selects it', () => {
    state().addObject('text');
    expect(objs()).toHaveLength(1);
    const obj = defined(objs()[0]);
    expect(obj.type).toBe('text');
    expect(obj.x).toBe(50); // default position
    expect(obj.y).toBe(50);
    expect(obj.rotation).toBe(0);
    expect(props(obj)).toHaveProperty('content');
    expect(state().selectedIds).toEqual([obj.id]);
  });

  it('respects a custom position', () => {
    state().addObject('box', { x: 200, y: 300 });
    expect(defined(objs()[0]).x).toBe(200);
    expect(defined(objs()[0]).y).toBe(300);
  });

  it('ignores unknown types', () => {
    state().addObject('nonexistent_type_xyz');
    expect(objs()).toHaveLength(0);
  });

  it('spawns step-rotation types pre-rotated in a rotated view', () => {
    state().setCanvasSettings({ viewRotation: 90 });
    state().addObject('text');
    expect(props(defined(objs()[0])).rotation).toBe('B');
  });

  it('leaves shapes and explicit rotation overrides alone in a rotated view', () => {
    state().setCanvasSettings({ viewRotation: 90 });
    state().addObject('box');
    state().addObject('text', undefined, { rotation: 'R' });
    expect(props(defined(objs()[0]))).not.toHaveProperty('rotation');
    expect(props(defined(objs()[1])).rotation).toBe('R');
  });

  it('gives each object a unique id', () => {
    state().addObject('text');
    state().addObject('text');
    const [a, b] = objs();
    expect(defined(a).id).not.toBe(defined(b).id);
  });
});

describe('addReverseBackground', () => {
  it('inserts a black backing just before a reverse text and selects it', () => {
    state().addObject('text');
    const text = defined(objs()[0]);
    state().updateObject(text.id, { props: { reverse: true } });
    state().addReverseBackground(text.id);
    const after = objs();
    expect(after).toHaveLength(2);
    const bg = defined(after[0]); // renders behind the text
    expect(['box', 'line']).toContain(bg.type);
    expect(props(bg).color).toBe('B');
    expect(defined(after[1]).id).toBe(text.id);
    expect(state().selectedIds).toEqual([bg.id]);
  });

  it('is idempotent: no second backing when one already sits behind', () => {
    state().addObject('text');
    const text = defined(objs()[0]);
    state().updateObject(text.id, { props: { reverse: true } });
    state().addReverseBackground(text.id);
    state().addReverseBackground(text.id);
    expect(objs()).toHaveLength(2); // not 3
  });

  it('ignores a non-text target', () => {
    state().addObject('box');
    const box = defined(objs()[0]);
    state().addReverseBackground(box.id);
    expect(objs()).toHaveLength(1);
  });
});

describe('removeReverseBackground', () => {
  it('removes the covering backing behind a text', () => {
    state().addObject('text');
    const text = defined(objs()[0]);
    state().updateObject(text.id, { props: { reverse: true } });
    state().addReverseBackground(text.id);
    expect(objs()).toHaveLength(2);
    state().removeReverseBackground(text.id);
    const after = objs();
    expect(after).toHaveLength(1);
    expect(defined(after[0]).id).toBe(text.id);
  });

  it('no-ops when there is no backing behind', () => {
    state().addObject('text');
    const text = defined(objs()[0]);
    state().removeReverseBackground(text.id);
    expect(objs()).toHaveLength(1);
  });
});

// ── updateObject (props merging) ──────────────────────────────────────────────

describe('updateObject — props merging', () => {
  it('merges partial props instead of replacing them', () => {
    state().addObject('text');
    const obj = defined(objs()[0]);
    state().updateObject(obj.id, { props: { content: 'Hello' } });
    state().updateObject(obj.id, { props: { fontHeight: 99 } });
    const updated = defined(objs()[0]);
    expect(props(updated).fontHeight).toBe(99);
    expect(props(updated).content).toBe('Hello');
  });

  it('updates top-level fields (x, y) without touching props', () => {
    state().addObject('text');
    const obj = defined(objs()[0]);
    state().updateObject(obj.id, { props: { content: 'Hello' } });
    state().updateObject(obj.id, { x: 999 });
    expect(defined(objs()[0]).x).toBe(999);
    expect(props(defined(objs()[0])).content).toBe('Hello');
  });
});

// ── pristineEmptyIds (untouched-field grace) ──────────────────────────────────

describe('pristineEmptyIds', () => {
  it('marks a blank-born object; the first deselect ends the grace for good', () => {
    state().addObject('text');
    const id = defined(objs()[0]).id;
    expect(state().pristineEmptyIds).toEqual([id]);
    state().selectObject(null);
    expect(state().pristineEmptyIds).toEqual([]);
    // Re-selecting must not restore the grace (panel click-through stability).
    state().selectObject(id);
    expect(state().pristineEmptyIds).toEqual([]);
  });

  it('adding a second object moves the selection and ends the first grace', () => {
    state().addObject('text');
    state().addObject('code128');
    expect(state().pristineEmptyIds).toEqual([ids()[1]]);
  });

  it('does not mark objects born with content or without a content field', () => {
    state().addObject('text', undefined, { content: '001' });
    state().addObject('box');
    expect(state().pristineEmptyIds).toEqual([]);
  });
});

// ── convertObjectType ─────────────────────────────────────────────────────────

describe('convertObjectType', () => {
  it('replaces type and props wholesale (no stale prop leak)', () => {
    state().addObject('line', { x: 0, y: 0 });
    const obj = defined(objs()[0]);
    state().convertObjectType(obj.id, (o) => ({
      ...o,
      type: 'box',
      props: { width: 200, height: 3, thickness: 3, filled: true, color: 'B', rounding: 0 },
    }));
    const next = defined(objs()[0]);
    expect(next.id).toBe(obj.id);
    expect(next.type).toBe('box');
    expect(props(next)).not.toHaveProperty('angle');
    expect(props(next)).not.toHaveProperty('length');
  });

  it('refuses to convert a locked object', () => {
    state().addObject('line');
    const id = defined(objs()[0]).id;
    state().updateObject(id, { locked: true });
    state().convertObjectType(id, toggleShapeMode);
    expect(defined(objs()[0]).type).toBe('line');
  });

  it('leaves pages untouched on a no-op mapper (no phantom undo entry)', () => {
    state().addObject('line');
    const id = defined(objs()[0]).id;
    const pagesBefore = state().pages;
    state().convertObjectType(id, (o) => o);
    // Same ref: a rebuilt array would record a zundo step (ref-compare equality).
    expect(state().pages).toBe(pagesBefore);
  });

  it('converts a line to a box end-to-end via the real toggleShapeMode mapper', () => {
    state().addObject('line', { x: 0, y: 0 });
    const id = defined(objs()[0]).id;
    state().convertObjectType(id, toggleShapeMode);
    const next = defined(objs()[0]);
    expect(next.type).toBe('box');
    expect(props(next)).toMatchObject({ width: 200, height: 3, filled: true });
    expect(props(next)).not.toHaveProperty('angle');
  });

  it('refuses to convert a leaf inside a locked group', () => {
    state().addObject('line');
    state().addObject('line');
    state().selectObjects(ids());
    state().groupSelection();
    const group = defined(objs()[0]);
    state().updateObject(group.id, { locked: true });
    const leafId = getAllLeaves(objs())[0]!.id;
    state().convertObjectType(leafId, toggleShapeMode);
    expect(getAllLeaves(objs()).every((l) => l.type === 'line')).toBe(true);
  });

  it('converts a leaf inside an unlocked group', () => {
    state().addObject('line');
    state().addObject('line');
    state().selectObjects(ids());
    state().groupSelection();
    const leafId = getAllLeaves(objs())[0]!.id;
    state().convertObjectType(leafId, toggleShapeMode);
    expect(getAllLeaves(objs()).find((l) => l.id === leafId)?.type).toBe('box');
  });

  it('is a single undo entry and keeps the selection', () => {
    state().addObject('line', { x: 0, y: 0 });
    const id = defined(objs()[0]).id;
    state().selectObject(id);
    useLabelStore.temporal.getState().clear();
    state().convertObjectType(id, toggleShapeMode);
    expect(useLabelStore.temporal.getState().pastStates.length).toBe(1);
    expect(state().selectedIds).toContain(id);
  });
});

// ── palette rows ──────────────────────────────────────────────────────────────

describe('palette rows', () => {
  const ids = (rows: { entryId: string }[]) => rows.map((r) => r.entryId);
  beforeEach(() => {
    useLabelStore.setState({ paletteRows: [{ id: 'text-fb', entryId: 'text-fb' }] });
    state().setPaletteView('favorites');
  });

  it('togglePaletteRow appends an absent entry with a distinct id', () => {
    state().togglePaletteRow('box-filled');
    expect(ids(state().paletteRows)).toEqual(['text-fb', 'box-filled']);
    // Generated id (entryId + suffix), distinct from the entryId and other rows.
    expect(state().paletteRows[1]?.id).toMatch(/^box-filled-/);
    expect(state().paletteRows[1]?.id).not.toBe(state().paletteRows[0]?.id);
  });

  it('togglePaletteRow removes an already-pinned entry', () => {
    state().togglePaletteRow('box-filled');
    state().togglePaletteRow('box-filled');
    expect(ids(state().paletteRows)).toEqual(['text-fb']);
  });

  it('removePaletteRow drops by index', () => {
    state().togglePaletteRow('box-filled');
    state().removePaletteRow(0);
    expect(ids(state().paletteRows)).toEqual(['box-filled']);
  });

  it('setPaletteView toggles the view', () => {
    state().setPaletteView('flat');
    expect(state().paletteView).toBe('flat');
  });

  it('reorderPaletteRows moves a row by id; no-ops on unknown or equal id', () => {
    useLabelStore.setState({
      paletteRows: [
        { id: 'a', entryId: 'text-fb' },
        { id: 'b', entryId: 'box-filled' },
        { id: 'c', entryId: 'image' },
      ],
    });
    state().reorderPaletteRows('c', 'a');
    expect(state().paletteRows.map((r) => r.id)).toEqual(['c', 'a', 'b']);
    state().reorderPaletteRows('a', 'a');
    state().reorderPaletteRows('missing', 'a');
    expect(state().paletteRows.map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('togglePaletteEditing flips the curation flag', () => {
    expect(state().paletteEditing).toBe(false);
    state().togglePaletteEditing();
    expect(state().paletteEditing).toBe(true);
    state().togglePaletteEditing();
    expect(state().paletteEditing).toBe(false);
  });
});

// ── removeObject ──────────────────────────────────────────────────────────────

describe('removeObject', () => {
  it('removes the object and deselects it', () => {
    state().addObject('text');
    const id = defined(objs()[0]).id;
    state().selectObject(id);
    state().removeObject(id);
    expect(objs()).toHaveLength(0);
    expect(state().selectedIds).toEqual([]);
  });
});

// ── locking ───────────────────────────────────────────────────────────────────

describe('lock', () => {
  it('blocks position changes on a locked object', () => {
    state().addObject('text', { x: 100, y: 100 });
    const id = defined(objs()[0]).id;
    state().updateObject(id, { locked: true });
    state().updateObject(id, { x: 999, y: 999 });
    expect(defined(objs()[0]).x).toBe(100);
    expect(defined(objs()[0]).y).toBe(100);
  });

  it('blocks prop changes on a locked object', () => {
    state().addObject('text');
    const id = defined(objs()[0]).id;
    state().updateObject(id, { locked: true });
    state().updateObject(id, { props: { fontHeight: 99 } });
    expect(props(defined(objs()[0])).fontHeight).not.toBe(99);
  });

  it('allows the lock itself to be toggled off', () => {
    state().addObject('text');
    const id = defined(objs()[0]).id;
    state().updateObject(id, { locked: true });
    state().updateObject(id, { locked: false });
    state().updateObject(id, { x: 500 });
    expect(defined(objs()[0]).x).toBe(500);
  });

  it('allows visibility, includeInExport and comment edits while locked', () => {
    state().addObject('text');
    const id = defined(objs()[0]).id;
    state().updateObject(id, { locked: true });
    state().updateObject(id, { visible: false });
    state().updateObject(id, { includeInExport: false });
    state().updateObject(id, { comment: 'note' });
    const o = defined(objs()[0]);
    expect(o.visible).toBe(false);
    expect(o.includeInExport).toBe(false);
    expect(o.comment).toBe('note');
  });

  it('protects locked objects from removeObject', () => {
    state().addObject('text');
    const id = defined(objs()[0]).id;
    state().updateObject(id, { locked: true });
    state().removeObject(id);
    expect(objs()).toHaveLength(1);
  });

  it('protects locked objects from removeSelectedObjects but removes unlocked siblings', () => {
    state().addObject('text', { x: 0, y: 0 });
    state().addObject('text', { x: 10, y: 10 });
    const lockedId = defined(objs()[0]).id;
    const otherId = defined(objs()[1]).id;
    state().updateObject(lockedId, { locked: true });
    state().selectObjects([lockedId, otherId]);
    state().removeSelectedObjects();
    expect(ids()).toEqual([lockedId]);
    expect(state().selectedIds).toEqual([lockedId]);
  });
});

// ── setSelectionLocked ────────────────────────────────────────────────────────

describe('setSelectionLocked', () => {
  it('locks every selected top-level object', () => {
    state().addObject('text');
    state().addObject('text');
    const a = defined(objs()[0]).id;
    const b = defined(objs()[1]).id;
    state().selectObjects([a, b]);
    state().setSelectionLocked(true);
    expect(objs().every((o) => o.locked)).toBe(true);
  });

  it('unlocks a locked selection (lock-bypass permits the toggle)', () => {
    state().addObject('text');
    const id = defined(objs()[0]).id;
    state().updateObject(id, { locked: true });
    state().selectObjects([id]);
    state().setSelectionLocked(false);
    expect(defined(objs()[0]).locked).toBeFalsy();
  });

  it('leaves unselected objects untouched', () => {
    state().addObject('text');
    state().addObject('text');
    const a = defined(objs()[0]).id;
    const b = defined(objs()[1]).id;
    state().selectObjects([a]);
    state().setSelectionLocked(true);
    expect(objs().find((o) => o.id === a)?.locked).toBe(true);
    expect(objs().find((o) => o.id === b)?.locked).toBeFalsy();
  });
});

// ── duplicateObject ───────────────────────────────────────────────────────────

describe('duplicateObject', () => {
  it('creates a copy offset by +20/+20 with a new id', () => {
    state().addObject('text', { x: 100, y: 100 });
    const original = defined(objs()[0]);
    state().duplicateObject(original.id);

    expect(objs()).toHaveLength(2);
    const copy = defined(objs()[1]);
    expect(copy.id).not.toBe(original.id);
    expect(copy.x).toBe(120);
    expect(copy.y).toBe(120);
    expect(copy.type).toBe('text');
  });

  it('selects only the new copy', () => {
    state().addObject('text');
    state().duplicateObject(defined(objs()[0]).id);
    expect(state().selectedIds).toHaveLength(1);
    expect(state().selectedIds[0]).toBe(defined(objs()[1]).id);
  });

  it('does nothing for a nonexistent id', () => {
    state().addObject('text');
    state().duplicateObject('fake-id');
    expect(objs()).toHaveLength(1);
  });
});

// ── duplicateSelectedObjects ──────────────────────────────────────────────────

describe('duplicateSelectedObjects', () => {
  it('staggers consecutive duplicates linearly (+20 from current selection)', () => {
    state().addObject('text', { x: 100, y: 100 });
    state().selectObject(defined(objs()[0]).id);

    state().duplicateSelectedObjects();
    state().duplicateSelectedObjects();
    state().duplicateSelectedObjects();

    expect(objs()).toHaveLength(4);
    // Selection follows the new copy each time, so the offsets compound
    // linearly: 100, 120, 140, 160; never quadratic.
    expect(objs().map((o) => o.x)).toEqual([100, 120, 140, 160]);
    expect(objs().map((o) => o.y)).toEqual([100, 120, 140, 160]);
  });

  it('selects only the new copies', () => {
    state().addObject('text');
    state().addObject('text');
    state().selectObjects(objs().map((o) => o.id));

    state().duplicateSelectedObjects();

    expect(state().selectedIds).toHaveLength(2);
    expect(state().selectedIds).toEqual([objs()[2]!.id, objs()[3]!.id]);
  });

  it('is a no-op when nothing is selected', () => {
    state().addObject('text');
    state().selectObject(null);
    state().duplicateSelectedObjects();
    expect(objs()).toHaveLength(1);
  });
});

// ── copy / paste ──────────────────────────────────────────────────────────────

describe('copy / paste', () => {
  it('paste is a no-op when clipboard is empty', () => {
    state().pasteObjects();
    expect(objs()).toHaveLength(0);
  });

  it('paste increments offset with each call (+20, +40, …)', () => {
    state().addObject('text', { x: 100, y: 100 });
    state().selectObject(defined(objs()[0]).id);
    state().copySelectedObjects();

    state().pasteObjects();
    expect(objs()).toHaveLength(2);
    expect(defined(objs()[1]).x).toBe(120); // +20

    state().pasteObjects();
    expect(objs()).toHaveLength(3);
    expect(defined(objs()[2]).x).toBe(140); // +40
  });

  it('paste creates new ids (not reusing clipboard ids)', () => {
    state().addObject('text');
    state().selectObject(defined(objs()[0]).id);
    state().copySelectedObjects();
    state().pasteObjects();
    state().pasteObjects();
    const allIds = ids();
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('pasteObjectsAt anchors the clipboard top-left to the point', () => {
    state().addObject('text', { x: 100, y: 60 });
    state().selectObject(defined(objs()[0]).id);
    state().copySelectedObjects();
    state().pasteObjectsAt(300, 200);
    expect(objs()).toHaveLength(2);
    const pasted = defined(objs()[1]);
    expect(pasted.x).toBe(300);
    expect(pasted.y).toBe(200);
    expect(state().selectedIds).toEqual([pasted.id]);
  });

  it('pasteObjectsAt is a no-op with an empty clipboard', () => {
    state().pasteObjectsAt(50, 50);
    expect(objs()).toHaveLength(0);
  });

  it('repeated paste of a group regenerates child ids (no collisions)', () => {
    state().addObject('text', { x: 10, y: 10 });
    state().addObject('box', { x: 40, y: 40 });
    state().selectObjects(objs().map((o) => o.id));
    state().groupSelection();
    state().copySelectedObjects();
    state().pasteObjects();
    state().pasteObjectsAt(200, 200);
    const allLeafIds = getAllLeaves(objs()).map((l) => l.id);
    expect(new Set(allLeafIds).size).toBe(allLeafIds.length);
  });

  it('pasteObjectsAt anchors a group visual top-left to the point (children shift)', () => {
    state().addObject('text', { x: 10, y: 10 });
    state().addObject('box', { x: 40, y: 40 });
    state().selectObjects(objs().map((o) => o.id));
    state().groupSelection();
    state().copySelectedObjects();
    state().pasteObjectsAt(300, 200);
    const pasted = defined(objs().find((o) => isGroup(o) && state().selectedIds.includes(o.id)));
    const leaves = getAllLeaves([pasted]);
    expect(Math.min(...leaves.map((l) => l.x))).toBe(300);
    expect(Math.min(...leaves.map((l) => l.y))).toBe(200);
  });

  it('duplicating a group offsets its children, not just the structural x/y', () => {
    state().addObject('text', { x: 10, y: 10 });
    state().addObject('box', { x: 40, y: 40 });
    state().selectObjects(objs().map((o) => o.id));
    state().groupSelection();
    state().duplicateSelectedObjects();
    const dup = defined(objs().find((o) => isGroup(o) && state().selectedIds.includes(o.id)));
    const leaves = getAllLeaves([dup]);
    expect(Math.min(...leaves.map((l) => l.x))).toBe(30); // 10 + DUPLICATE_OFFSET
    expect(Math.min(...leaves.map((l) => l.y))).toBe(30);
  });
});

// ── selection ─────────────────────────────────────────────────────────────────

describe('toggleSelectObject', () => {
  it('adds to selection, then removes on second call', () => {
    state().addObject('text');
    state().addObject('box');
    const [a, b] = objs();

    state().selectObject(null); // clear
    state().toggleSelectObject(defined(a).id);
    expect(state().selectedIds).toEqual([defined(a).id]);

    state().toggleSelectObject(defined(b).id);
    expect(state().selectedIds).toEqual([defined(a).id, defined(b).id]);

    state().toggleSelectObject(defined(a).id);
    expect(state().selectedIds).toEqual([defined(b).id]);
  });
});

describe('removeSelectedObjects', () => {
  it('removes all selected objects and clears selection', () => {
    state().addObject('text');
    state().addObject('box');
    state().addObject('line');
    state().selectObjects(ids().slice(0, 2));

    state().removeSelectedObjects();
    expect(objs()).toHaveLength(1);
    expect(defined(objs()[0]).type).toBe('line');
    expect(state().selectedIds).toEqual([]);
  });
});

// ── reorder ───────────────────────────────────────────────────────────────────

describe('resetPerLabelConfig', () => {
  it('clears every per-label override but keeps design-time fields', () => {
    state().setLabelConfig({ darkness: 25, labelHomeX: 40, printQuantity: 5, widthMm: 80 });
    expect(selectHasPerLabelOverrides(state())).toBe(true);

    state().resetPerLabelConfig();

    expect(selectHasPerLabelOverrides(state())).toBe(false);
    expect(state().label.darkness).toBeUndefined();
    expect(state().label.labelHomeX).toBeUndefined();
    expect(state().label.printQuantity).toBeUndefined();
    // Design-time size is not a per-label override and survives the reset.
    expect(state().label.widthMm).toBe(80);
  });

  it('is inert while the preview lock holds (routes through setLabelConfig)', () => {
    state().setLabelConfig({ darkness: 25 });
    useLabelStore.setState({ previewMode: { status: 'active', url: 'x' } });
    state().resetPerLabelConfig();
    expect(state().label.darkness).toBe(25);
  });
});

describe('moveObjectToFront', () => {
  it('moves the object to the last position in the array', () => {
    state().addObject('text');
    state().addObject('box');
    state().addObject('line');
    const first = defined(ids()[0]);

    state().moveObjectToFront(first);
    expect(ids()[2]).toBe(first);
  });

  it('is a no-op if already at the front', () => {
    state().addObject('text');
    state().addObject('box');
    const before = ids();
    state().moveObjectToFront(defined(before[1]));
    expect(ids()).toEqual(before);
  });
});

describe('moveObjectToBack', () => {
  it('moves the object to the first position', () => {
    state().addObject('text');
    state().addObject('box');
    state().addObject('line');
    const last = defined(ids()[2]);

    state().moveObjectToBack(last);
    expect(ids()[0]).toBe(last);
  });

  it('is a no-op if already at the back', () => {
    state().addObject('text');
    state().addObject('box');
    const before = ids();
    state().moveObjectToBack(defined(before[0]));
    expect(ids()).toEqual(before);
  });
});

describe('moveObjectForward', () => {
  it('swaps with the next object', () => {
    state().addObject('text');
    state().addObject('box');
    state().addObject('line');
    const [a, b, c] = ids();

    state().moveObjectForward(defined(a));
    expect(ids()).toEqual([b, a, c]);
  });
});

describe('moveObjectBackward', () => {
  it('swaps with the previous object', () => {
    state().addObject('text');
    state().addObject('box');
    state().addObject('line');
    const [a, b, c] = ids();

    state().moveObjectBackward(defined(c));
    expect(ids()).toEqual([a, c, b]);
  });
});

describe('reorderObject', () => {
  it('moves an object to an arbitrary index', () => {
    state().addObject('text');
    state().addObject('box');
    state().addObject('line');
    const [a, b, c] = ids();

    state().reorderObject(defined(c), 0);
    expect(ids()).toEqual([c, a, b]);
  });

  it('is a no-op when source equals target', () => {
    state().addObject('text');
    state().addObject('box');
    const before = ids();
    state().reorderObject(defined(before[1]), 1);
    expect(ids()).toEqual(before);
  });
});

describe('reorderSelection', () => {
  it('reorders the selection when unlocked', () => {
    state().addObject('text');
    state().addObject('box');
    state().addObject('line');
    const before = ids();
    state().selectObject(defined(before[1]));
    state().reorderSelection('front');
    expect(ids()).not.toEqual(before);
  });

  it('is a no-op for a locked selection (lock blocks reordering)', () => {
    state().addObject('text');
    state().addObject('box');
    state().addObject('line');
    const before = ids();
    state().selectObject(defined(before[1]));
    state().setSelectionLocked(true);
    state().reorderSelection('front');
    expect(ids()).toEqual(before);
  });
});

// ── loadDesign ────────────────────────────────────────────────────────────────

describe('loadDesign', () => {
  it('replaces label config, pages, and clears selection', () => {
    state().addObject('text');
    state().selectObject(defined(objs()[0]).id);

    const newLabel = { widthMm: 50, heightMm: 30, dpmm: 12 };
    const newObjects = [
      { id: 'x1', type: 'box' as const, x: 10, y: 10, rotation: 0, props: { width: 50, height: 50, thickness: 3, filled: false, color: 'B' as const, rounding: 0 } },
    ] satisfies LabelObject[];

    state().loadDesign(newLabel, [{ objects: newObjects }]);
    expect(state().label).toEqual(newLabel);
    expect(state().pages).toHaveLength(1);
    expect(objs()).toHaveLength(1);
    expect(state().currentPageIndex).toBe(0);
    expect(state().selectedIds).toEqual([]);
  });

  it('falls back to a single empty page when given an empty pages array', () => {
    state().loadDesign({ widthMm: 50, heightMm: 30, dpmm: 8 }, []);
    expect(state().pages).toHaveLength(1);
    expect(objs()).toHaveLength(0);
    expect(state().currentPageIndex).toBe(0);
  });

  it('drops legacy path-less customFonts bindings on load', () => {
    state().loadDesign(
      {
        widthMm: 50,
        heightMm: 30,
        dpmm: 8,
        customFonts: [
          { alias: 'A' },
          { alias: 'B', path: 'E:MY.TTF' },
        ],
      },
      [{ objects: [] }],
    );
    expect(state().label.customFonts).toEqual([{ alias: 'B', path: 'E:MY.TTF' }]);
  });
});

// ── appendPages ───────────────────────────────────────────────────────────────

describe('appendPages', () => {
  const sampleObject: LabelObject = {
    id: 'imp1',
    type: 'box',
    x: 5,
    y: 5,
    rotation: 0,
    props: { width: 20, height: 20, thickness: 1, filled: false, color: 'B', rounding: 0 },
  };

  it('appends pages, keeps the existing label config, and focuses the first appended page', () => {
    state().addObject('text');
    const originalLabel = state().label;
    state().selectObject(defined(objs()[0]).id);

    state().appendPages([{ objects: [sampleObject] }, { objects: [] }]);

    expect(state().label).toEqual(originalLabel);
    expect(state().pages).toHaveLength(3);
    expect(state().currentPageIndex).toBe(1);
    expect(state().selectedIds).toEqual([]);
  });

  it('is a no-op when given an empty pages array', () => {
    state().addObject('text');
    const before = state().pages;
    state().appendPages([]);
    expect(state().pages).toBe(before);
  });
});

// ── setLabelConfig (partial merge) ────────────────────────────────────────────

describe('setLabelConfig', () => {
  it('merges partial config without losing other fields', () => {
    state().setLabelConfig({ widthMm: 200 });
    expect(state().label.widthMm).toBe(200);
    expect(state().label.heightMm).toBe(60); // unchanged
    expect(state().label.dpmm).toBe(8);      // unchanged
  });
});

// ── pages ─────────────────────────────────────────────────────────────────────

describe('addPage', () => {
  it('inserts a blank page after the current and switches to it', () => {
    expect(state().pages).toHaveLength(1);
    state().addPage();
    expect(state().pages).toHaveLength(2);
    expect(state().currentPageIndex).toBe(1);
    expect(objs()).toHaveLength(0);
  });

  it('clears selection when switching to the new page', () => {
    state().addObject('text');
    state().selectObject(defined(objs()[0]).id);
    expect(state().selectedIds).toHaveLength(1);
    state().addPage();
    expect(state().selectedIds).toEqual([]);
  });

  it('preserves objects on the previous page', () => {
    state().addObject('text');
    const firstPageObjId = defined(objs()[0]).id;
    state().addPage();
    expect(objs()).toHaveLength(0);
    state().setCurrentPage(0);
    expect(defined(objs()[0]).id).toBe(firstPageObjId);
  });

  it('inserts in the middle when current page is not the last', () => {
    state().addPage(); // pages [0, 1], current=1
    state().addPage(); // pages [0, 1, 2], current=2
    state().setCurrentPage(0);
    state().addPage(); // inserts at index 1, current=1
    expect(state().pages).toHaveLength(4);
    expect(state().currentPageIndex).toBe(1);
  });
});

describe('removePage', () => {
  it('refuses to remove the last remaining page', () => {
    state().removePage(0);
    expect(state().pages).toHaveLength(1);
  });

  it('removes the requested page and adjusts currentPageIndex when removing earlier page', () => {
    state().addPage(); // current=1
    state().addPage(); // current=2
    state().removePage(0);
    expect(state().pages).toHaveLength(2);
    expect(state().currentPageIndex).toBe(1);
  });

  it('clamps currentPageIndex when removing the current (last) page', () => {
    state().addPage(); // current=1
    state().removePage(1);
    expect(state().pages).toHaveLength(1);
    expect(state().currentPageIndex).toBe(0);
  });

  it('keeps currentPageIndex stable when removing a later page', () => {
    state().addPage(); // current=1
    state().addPage(); // current=2
    state().setCurrentPage(0);
    state().removePage(2);
    expect(state().pages).toHaveLength(2);
    expect(state().currentPageIndex).toBe(0);
  });

  it('ignores out-of-range indices', () => {
    state().addPage();
    const before = state().pages.length;
    state().removePage(99);
    expect(state().pages).toHaveLength(before);
  });
});

describe('duplicatePage', () => {
  it('clones the page at index with new object ids', () => {
    state().addObject('text');
    const originalId = defined(objs()[0]).id;
    state().duplicatePage(0);
    expect(state().pages).toHaveLength(2);
    expect(state().currentPageIndex).toBe(1);
    expect(objs()).toHaveLength(1);
    expect(defined(objs()[0]).id).not.toBe(originalId);
  });

  it('keeps the ^JM override, so the clone prints at the density its dots use', () => {
    useLabelStore.setState({ pages: [{ objects: [], jmDensity: 'B' }] });
    state().duplicatePage(0);
    expect(defined(state().pages[1]).jmDensity).toBe('B');
  });
});

describe('currentPageLabel', () => {
  it('lets a page ^JM override the design density (batch export, preview)', () => {
    useLabelStore.setState({
      pages: [{ objects: [] }, { objects: [], jmDensity: 'B' }],
      currentPageIndex: 1,
    });
    expect(currentPageLabel(state()).jmDensity).toBe('B');
    state().setCurrentPage(0);
    expect(currentPageLabel(state()).jmDensity).toBeUndefined();
  });

  // A fresh object per read would re-render every subscriber on every store
  // write, which in a zustand selector means an endless render loop.
  it('is reference-stable across reads', () => {
    useLabelStore.setState({ pages: [{ objects: [], jmDensity: 'B' }], currentPageIndex: 0 });
    expect(currentPageLabel(state())).toBe(currentPageLabel(state()));
    const before = currentPageLabel(state());
    state().setLabelConfig({ widthMm: 80 });
    expect(currentPageLabel(state())).not.toBe(before);
  });

  it('reads the editor geometry of an imported ^JMB page at the halved density', () => {
    const r = importZplText(
      '^XA^FO10,10^A0N,30,30^FDa^FS^XZ\n^XA^JMB^FO10,10^A0N,30,30^FDb^FS^XZ',
      8,
    );
    useLabelStore.setState({
      label: { ...state().label, ...r.labelConfig },
      pages: r.pages,
      currentPageIndex: 1,
    });
    // 8 dpmm head, halved by ^JMB: the page's 100 dots are 25 mm, not 12.5.
    expect(dotsToMm(100, effectiveDpmm(currentPageLabel(state())))).toBe(25);
    state().setCurrentPage(0);
    expect(dotsToMm(100, effectiveDpmm(currentPageLabel(state())))).toBe(12.5);
  });

  it('builds the preview stream at the current page density', async () => {
    const labelary = await import('../lib/labelary');
    const fetchSpy = vi.mocked(labelary.fetchPreview);
    fetchSpy.mockClear();
    useLabelStore.setState({
      pages: [{ objects: [] }, { objects: [], jmDensity: 'B' }],
      currentPageIndex: 1,
      labelaryNoticeAcknowledged: true,
    });
    state().addObject('text');
    await state().enterPreviewMode();
    expect(fetchSpy.mock.calls[0]?.[0]).toContain('^JMB');
  });
});

describe('setCurrentPage', () => {
  it('switches pages and clears selection', () => {
    state().addObject('text');
    state().selectObject(defined(objs()[0]).id);
    state().addPage();
    expect(state().currentPageIndex).toBe(1);
    state().setCurrentPage(0);
    expect(state().currentPageIndex).toBe(0);
    expect(state().selectedIds).toEqual([]);
  });

  it('ignores out-of-range indices', () => {
    state().setCurrentPage(99);
    expect(state().currentPageIndex).toBe(0);
  });
});

describe('per-page object isolation', () => {
  it('addObject only affects the current page', () => {
    state().addObject('text');
    state().addPage();
    state().addObject('box');
    expect(objs()).toHaveLength(1);
    expect(defined(objs()[0]).type).toBe('box');
    state().setCurrentPage(0);
    expect(objs()).toHaveLength(1);
    expect(defined(objs()[0]).type).toBe('text');
  });

  it('paste targets the current page', () => {
    state().addObject('text');
    state().selectObject(defined(objs()[0]).id);
    state().copySelectedObjects();
    state().addPage();
    state().pasteObjects();
    expect(objs()).toHaveLength(1);
    state().setCurrentPage(0);
    expect(objs()).toHaveLength(1);
  });
});

// ── groupSelection / ungroup ──────────────────────────────────────────────────

describe('groupSelection', () => {
  it('wraps selected objects in a single group and selects it', () => {
    state().addObject('text');
    state().addObject('box');
    const [a, b] = objs();
    state().selectObjects([defined(a).id, defined(b).id]);
    state().groupSelection();
    expect(objs()).toHaveLength(1);
    const g = defined(objs()[0]);
    expect(isGroup(g)).toBe(true);
    if (isGroup(g)) expect(g.children).toHaveLength(2);
    expect(state().selectedIds).toEqual([g.id]);
  });

  it('inserts the group at the topmost selected position', () => {
    state().addObject('text');
    state().addObject('box');
    state().addObject('ellipse');
    const [a, b, c] = objs();
    // Select first and second; group should land where the second one was.
    state().selectObjects([defined(a).id, defined(b).id]);
    state().groupSelection();
    expect(objs().map((o) => o.type)).toEqual(['group', 'ellipse']);
    expect(defined(objs()[1]).id).toBe(defined(c).id);
  });

  it('is a no-op with empty selection', () => {
    state().addObject('text');
    state().selectObject(null);
    state().groupSelection();
    expect(objs()).toHaveLength(1);
    expect(isGroup(defined(objs()[0]))).toBe(false);
  });

  it('skips locked objects', () => {
    state().addObject('text');
    state().addObject('box');
    const [a, b] = objs();
    state().updateObject(defined(a).id, { locked: true });
    state().selectObjects([defined(a).id, defined(b).id]);
    state().groupSelection();
    // Only the box made it into a group; the locked text stayed at top level.
    const objects = objs();
    expect(objects).toHaveLength(2);
    const grp = objects.find((o) => isGroup(o));
    expect(grp).toBeDefined();
    if (grp && isGroup(grp)) {
      expect(grp.children).toHaveLength(1);
      expect(defined(grp.children[0]).type).toBe('box');
    }
  });

  it('allows grouping a single object (idiomatic in design tools)', () => {
    state().addObject('text');
    state().selectObject(defined(objs()[0]).id);
    state().groupSelection();
    expect(objs()).toHaveLength(1);
    expect(isGroup(defined(objs()[0]))).toBe(true);
  });
});

describe('updateObject — leaves inside groups', () => {
  it('reaches into a group to update a nested leaf', () => {
    state().addObject('text', { x: 10, y: 10 });
    state().addObject('box', { x: 50, y: 50 });
    const [a, b] = objs();
    state().selectObjects([defined(a).id, defined(b).id]);
    state().groupSelection();
    state().updateObject(defined(a).id, { x: 999 });
    // Group still at top level; updated leaf is found via tree walk.
    const grp = defined(objs()[0]);
    if (!isGroup(grp)) throw new Error('expected group');
    const updated = grp.children.find((c) => c.id === defined(a).id);
    expect(defined(updated).x).toBe(999);
  });

  it('keeps unrelated leaves and siblings unchanged', () => {
    state().addObject('text');
    state().addObject('box');
    const [a, b] = objs();
    state().selectObjects([defined(a).id, defined(b).id]);
    state().groupSelection();
    state().updateObject(defined(a).id, { x: 123 });
    const grp = defined(objs()[0]);
    if (!isGroup(grp)) throw new Error('expected group');
    const sibling = grp.children.find((c) => c.id === defined(b).id);
    expect(defined(sibling).x).toBe(50); // default position from addObject
  });
});

describe('ungroup', () => {
  it('replaces a selected group with its children at the same position', () => {
    state().addObject('text');
    state().addObject('box');
    state().addObject('ellipse');
    const [, b, c] = objs();
    state().selectObjects([defined(b).id, defined(c).id]);
    state().groupSelection();
    const groupId = defined(state().selectedIds[0]);
    state().selectObject(groupId);
    state().ungroup();
    expect(objs().map((o) => o.type)).toEqual(['text', 'box', 'ellipse']);
    // Selection follows the freed children.
    expect(state().selectedIds).toHaveLength(2);
  });

  it('is a no-op when no group is selected', () => {
    state().addObject('text');
    state().selectObject(defined(objs()[0]).id);
    state().ungroup();
    expect(objs()).toHaveLength(1);
    expect(isGroup(defined(objs()[0]))).toBe(false);
  });

  it('skips locked groups', () => {
    state().addObject('text');
    state().selectObject(defined(objs()[0]).id);
    state().groupSelection();
    const gid = defined(state().selectedIds[0]);
    state().updateObject(gid, { locked: true });
    state().ungroup();
    expect(objs()).toHaveLength(1);
    expect(isGroup(defined(objs()[0]))).toBe(true);
  });

  it('reparentObject moves a top-level leaf into a group', () => {
    state().addObject('text'); // a
    state().addObject('box');  // b
    state().addObject('ellipse'); // c
    const [a, b, c] = objs();
    // Group b and c
    state().selectObjects([defined(b).id, defined(c).id]);
    state().groupSelection();
    const gid = defined(state().selectedIds[0]);
    // Move 'a' into the group
    state().reparentObject(defined(a).id, { parentId: gid, index: 1 });
    expect(objs()).toHaveLength(1); // only the group at top level
    const grp = defined(objs()[0]);
    if (!isGroup(grp)) throw new Error('expected group');
    expect(grp.children.map((c) => c.id)).toEqual([
      defined(b).id, defined(a).id, defined(c).id,
    ]);
  });

  it('reparentObject moves a child out of a group to top level', () => {
    state().addObject('text');
    state().addObject('box');
    const [a, b] = objs();
    state().selectObjects([defined(a).id, defined(b).id]);
    state().groupSelection();
    const gid = defined(state().selectedIds[0]);
    // Extract 'a' to top level at index 0 (before the group)
    state().reparentObject(defined(a).id, { parentId: null, index: 0 });
    expect(objs()).toHaveLength(2);
    expect(defined(objs()[0]).id).toBe(defined(a).id);
    const grp = defined(objs()[1]);
    if (!isGroup(grp)) throw new Error('expected group');
    expect(grp.children.map((c) => c.id)).toEqual([defined(b).id]);
    expect(grp.id).toBe(gid);
  });

  it('reparentObject refuses to move a group into itself', () => {
    state().addObject('text');
    state().selectObject(defined(objs()[0]).id);
    state().groupSelection();
    const gid = defined(state().selectedIds[0]);
    const before = JSON.stringify(objs());
    state().reparentObject(gid, { parentId: gid, index: 0 });
    expect(JSON.stringify(objs())).toBe(before);
  });

  it('reparentObject refuses to move a group into one of its descendants', () => {
    state().addObject('text');
    state().addObject('box');
    const [a, b] = objs();
    state().selectObjects([defined(a).id, defined(b).id]);
    state().groupSelection();
    const outerGid = defined(state().selectedIds[0]);
    // Create an inner group containing only 'a' (manually via grouping
    // the existing children would need ungroup-then-group; this test
    // simulates the cycle case by trying to move outerGid into 'a'.)
    const before = JSON.stringify(objs());
    state().reparentObject(outerGid, { parentId: defined(a).id, index: 0 });
    // No-op because 'a' is a leaf, not a group → defensive check.
    expect(JSON.stringify(objs())).toBe(before);
  });

  it('addGroup appends an empty group and selects it', () => {
    state().addGroup();
    expect(objs()).toHaveLength(1);
    const g = defined(objs()[0]);
    expect(isGroup(g)).toBe(true);
    if (isGroup(g)) expect(g.children).toEqual([]);
    expect(state().selectedIds).toEqual([g.id]);
  });

  it('addGroup leaves existing top-level objects in place', () => {
    state().addObject('text');
    const textId = defined(objs()[0]).id;
    state().addGroup();
    expect(objs()).toHaveLength(2);
    // Group is appended at the end of the array = topmost in display.
    expect(defined(objs()[0]).id).toBe(textId);
    expect(isGroup(defined(objs()[1]))).toBe(true);
  });

  it('ungroupIds operates on the passed list, not the current selection', () => {
    state().addObject('text');
    state().addObject('box');
    const [a, b] = objs();
    state().selectObjects([defined(a).id, defined(b).id]);
    state().groupSelection();
    const gid = defined(state().selectedIds[0]);
    // Move selection elsewhere; the layers-panel button calls ungroupIds
    // without changing what the user has selected.
    state().selectObject(null);
    state().ungroupIds([gid]);
    expect(objs()).toHaveLength(2);
    expect(objs().every((o) => !isGroup(o))).toBe(true);
  });

  describe('lock cascade', () => {
    /** Set up "one text leaf inside a locked group" and return the leaf id. */
    function setupLockedGroup(): string {
      state().addObject('text');
      const leafId = defined(objs()[0]).id;
      state().selectObject(leafId);
      state().groupSelection();
      const gid = defined(state().selectedIds[0]);
      state().updateObject(gid, { locked: true });
      return leafId;
    }

    function childLeaf(): LabelObject {
      const g = defined(objs()[0]);
      if (!isGroup(g)) throw new Error('expected group');
      return defined(g.children[0]);
    }

    it('blocks position changes on a child of a locked group via updateObject', () => {
      const leafId = setupLockedGroup();
      const before = childLeaf().x;
      state().updateObject(leafId, { x: before + 50 });
      expect(childLeaf().x).toBe(before);
    });

    it('blocks position changes on a child of a locked group via updateObjects', () => {
      const leafId = setupLockedGroup();
      const before = childLeaf().x;
      state().updateObjects([{ id: leafId, changes: { x: before + 50 } }]);
      expect(childLeaf().x).toBe(before);
    });

    it('still allows bypass keys (visible, locked) on a child of a locked group', () => {
      const leafId = setupLockedGroup();
      state().updateObject(leafId, { visible: false });
      expect(childLeaf().visible).toBe(false);
    });
  });

  describe('preview lock blocks design mutations', () => {
    function enterPreview() {
      // Push the store directly into the active state; the real
      // `enterPreviewMode` would talk to Labelary and can't run in tests.
      useLabelStore.setState({
        previewMode: { status: 'active', url: 'blob:test' },
      });
    }

    it('blocks addObject', () => {
      enterPreview();
      state().addObject('text');
      expect(objs()).toHaveLength(0);
    });

    it('blocks updateObject', () => {
      state().addObject('text');
      const id = defined(objs()[0]).id;
      const before = defined(objs()[0]).x;
      enterPreview();
      state().updateObject(id, { x: before + 100 });
      expect(defined(objs()[0]).x).toBe(before);
    });

    it('blocks updateObjects', () => {
      state().addObject('text');
      const id = defined(objs()[0]).id;
      const before = defined(objs()[0]).x;
      enterPreview();
      state().updateObjects([{ id, changes: { x: before + 100 } }]);
      expect(defined(objs()[0]).x).toBe(before);
    });

    it('blocks removeSelectedObjects', () => {
      state().addObject('text');
      const id = defined(objs()[0]).id;
      state().selectObject(id);
      enterPreview();
      state().removeSelectedObjects();
      expect(objs()).toHaveLength(1);
    });

    it('blocks groupSelection', () => {
      state().addObject('text');
      state().addObject('box');
      state().selectObjects(objs().map((o) => o.id));
      enterPreview();
      state().groupSelection();
      expect(objs().some(isGroup)).toBe(false);
    });

    it('blocks setLabelConfig', () => {
      const before = state().label.widthMm;
      enterPreview();
      state().setLabelConfig({ widthMm: before + 50 });
      expect(state().label.widthMm).toBe(before);
    });

    it('blocks setCurrentPage', () => {
      state().addPage();
      const before = state().currentPageIndex;
      enterPreview();
      state().setCurrentPage(0);
      expect(state().currentPageIndex).toBe(before);
    });

    it('blocks pasteObjects', () => {
      state().addObject('text');
      state().selectObjects([defined(objs()[0]).id]);
      state().copySelectedObjects();
      enterPreview();
      state().pasteObjects();
      expect(objs()).toHaveLength(1);
    });

    it('does not block selection actions (selecting is harmless)', () => {
      state().addObject('text');
      const id = defined(objs()[0]).id;
      enterPreview();
      state().selectObject(id);
      expect(state().selectedIds).toEqual([id]);
    });

    it('does not block exitPreviewMode', () => {
      enterPreview();
      state().exitPreviewMode();
      expect(state().previewMode.status).toBe('idle');
    });
  });

  describe('preview cache', () => {
    function activeUrl(): string | null {
      const mode = state().previewMode;
      return mode.status === 'active' ? mode.url : null;
    }

    it('skips the fetch when the ZPL is unchanged across toggles', async () => {
      const labelary = await import('../lib/labelary');
      const fetchSpy = vi.mocked(labelary.fetchPreview);
      fetchSpy.mockClear();

      await state().enterPreviewMode();
      expect(state().previewMode.status).toBe('active');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const firstUrl = activeUrl();

      state().exitPreviewMode();
      expect(state().previewMode.status).toBe('idle');

      // Re-open with no changes: cache hit, no extra fetch, same URL.
      await state().enterPreviewMode();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(activeUrl()).toBe(firstUrl);
    });

    it('discards a stale in-flight fetch when the user exits, edits, and re-enters', async () => {
      // Scenario: user opens preview (fetch 1 in flight), exits, mutates
      // design, opens preview again (fetch 2 in flight). Without the
      // stale-fetch guard, fetch 1 resolves while status is `loading`
      // (from fetch 2) and would overwrite state with the previous
      // design's URL.
      const labelary = await import('../lib/labelary');
      const fetchSpy = vi.mocked(labelary.fetchPreview);
      fetchSpy.mockClear();

      // Hand-controlled promises so we can interleave the two fetches.
      type Resolver = (url: string) => void;
      const noop: Resolver = () => undefined;
      let resolveFirst: Resolver = noop;
      let resolveSecond: Resolver = noop;
      fetchSpy.mockImplementationOnce(
        () => new Promise<string>((r) => (resolveFirst = r)),
      );
      fetchSpy.mockImplementationOnce(
        () => new Promise<string>((r) => (resolveSecond = r)),
      );

      const first = state().enterPreviewMode();
      state().exitPreviewMode();
      state().addObject('text'); // changes the ZPL
      const second = state().enterPreviewMode();

      resolveFirst('blob:stale-1');
      await first;

      // Status must still be `loading` for fetch 2; fetch 1's URL was
      // for the previous design and must have been discarded + revoked.
      expect(state().previewMode.status).toBe('loading');
      expect(vi.mocked(globalThis.URL.revokeObjectURL)).toHaveBeenCalledWith(
        'blob:stale-1',
      );

      resolveSecond('blob:fresh-2');
      await second;

      expect(state().previewMode.status).toBe('active');
      expect(activeUrl()).toBe('blob:fresh-2');
    });

    it('re-fetches and revokes the stale URL when the ZPL changes', async () => {
      const labelary = await import('../lib/labelary');
      const fetchSpy = vi.mocked(labelary.fetchPreview);
      fetchSpy.mockClear();
      const revokeSpy = vi.mocked(globalThis.URL.revokeObjectURL);

      await state().enterPreviewMode();
      const firstUrl = activeUrl();
      expect(firstUrl).toBeTruthy();
      state().exitPreviewMode();

      // Mutate the design; the next enterPreviewMode generates different
      // ZPL and must hit the API again, revoking the prior blob.
      state().addObject('text');
      await state().enterPreviewMode();

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(revokeSpy).toHaveBeenCalledWith(firstUrl);
      expect(activeUrl()).not.toBe(firstUrl);
    });

    it('degrades a persisted printer provider to Labelary outside the desktop shell', async () => {
      // jsdom is the web build (no Tauri): the printer path has no raw
      // sockets, so the effective provider must fall back to Labelary.
      const labelary = await import('../lib/labelary');
      const fetchSpy = vi.mocked(labelary.fetchPreview);
      fetchSpy.mockClear();

      useLabelStore.setState({ previewProvider: 'printer' });
      await state().enterPreviewMode();

      expect(state().previewMode.status).toBe('active');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});

describe('migrateLegacy — v2→v3 circle→ellipse', () => {
  it('rewrites top-level circle objects to ellipses with lockAspect', () => {
    const persisted = {
      pages: [
        {
          objects: [
            {
              id: 'c1',
              type: 'circle',
              x: 10,
              y: 20,
              rotation: 0,
              props: { diameter: 80, thickness: 4, filled: false, color: 'B' },
            },
          ],
        },
      ],
    };
    const migrated = migrateLegacy(persisted, 2) as typeof persisted;
    const obj = migrated.pages[0]?.objects[0] as { type: string; props: Record<string, unknown> };
    expect(obj.type).toBe('ellipse');
    expect(obj.props).toEqual({
      width: 80,
      height: 80,
      thickness: 4,
      filled: false,
      color: 'B',
      lockAspect: true,
    });
  });

  it('rewrites circles nested in groups', () => {
    const persisted = {
      pages: [
        {
          objects: [
            {
              id: 'g1',
              type: 'group',
              x: 0,
              y: 0,
              rotation: 0,
              children: [
                {
                  id: 'c1',
                  type: 'circle',
                  x: 5,
                  y: 5,
                  rotation: 0,
                  props: { diameter: 50, thickness: 2, filled: true, color: 'W' },
                },
              ],
            },
          ],
        },
      ],
    };
    const migrated = migrateLegacy(persisted, 2) as typeof persisted;
    const group = migrated.pages[0]?.objects[0] as { children: { type: string; props: Record<string, unknown> }[] };
    expect(group.children[0]?.type).toBe('ellipse');
    expect(group.children[0]?.props).toEqual({
      width: 50,
      height: 50,
      thickness: 2,
      filled: true,
      color: 'W',
      lockAspect: true,
    });
  });

  it('leaves non-circle objects untouched', () => {
    const persisted = {
      pages: [
        {
          objects: [
            { id: 'b1', type: 'box', x: 0, y: 0, rotation: 0, props: { width: 10, height: 10 } },
          ],
        },
      ],
    };
    const migrated = migrateLegacy(persisted, 2) as typeof persisted;
    expect(migrated.pages[0]?.objects[0]).toEqual(persisted.pages[0]?.objects[0]);
  });
});

describe('migrateLegacy — v13→v14 smartSnapEnabled', () => {
  it('backfills smartSnapEnabled=true so old sessions keep object snapping', () => {
    const persisted = {
      canvasSettings: { showGrid: false, snapEnabled: false, snapSizeMm: 1, zoom: 1, unit: 'mm', viewRotation: 0, csvRenderMode: 'preview' },
    };
    const migrated = migrateLegacy(persisted, 13) as { canvasSettings: Record<string, unknown> };
    expect(migrated.canvasSettings.smartSnapEnabled).toBe(true);
  });

  it('preserves an explicit smartSnapEnabled=false from a newer snapshot', () => {
    const persisted = {
      canvasSettings: { showGrid: false, snapEnabled: false, snapSizeMm: 1, smartSnapEnabled: false, zoom: 1, unit: 'mm', viewRotation: 0, csvRenderMode: 'preview' },
    };
    const migrated = migrateLegacy(persisted, 13) as { canvasSettings: Record<string, unknown> };
    expect(migrated.canvasSettings.smartSnapEnabled).toBe(false);
  });
});

describe('migrateLegacy — v14→v15 dataset-model renames', () => {
  it('renames csvMapping → columnMapping and csvRenderMode → dataRenderMode', () => {
    const persisted = {
      csvMapping: { bindings: { v1: 'sku' }, headerSnapshot: ['sku'] },
      canvasSettings: { zoom: 1, csvRenderMode: 'schema' },
    };
    const migrated = migrateLegacy(persisted, 14) as Record<string, unknown> & {
      canvasSettings: Record<string, unknown>;
    };
    expect(migrated.columnMapping).toEqual({ bindings: { v1: 'sku' }, headerSnapshot: ['sku'] });
    expect('csvMapping' in migrated).toBe(false);
    expect(migrated.canvasSettings.dataRenderMode).toBe('schema');
    expect('csvRenderMode' in migrated.canvasSettings).toBe(false);
  });

  it('leaves state without the legacy keys untouched', () => {
    const persisted = { canvasSettings: { zoom: 1, dataRenderMode: 'preview' } };
    const migrated = migrateLegacy(persisted, 14) as { canvasSettings: Record<string, unknown> };
    expect(migrated.canvasSettings.dataRenderMode).toBe('preview');
  });
});

describe('migrateLegacy — v9→v10 reverse text backing', () => {
  it('inserts a black backing before a legacy reverse text', () => {
    const persisted = {
      pages: [
        {
          objects: [
            {
              id: 't',
              type: 'text',
              x: 50,
              y: 50,
              rotation: 0,
              props: { content: 'Hi', fontHeight: 30, fontWidth: 0, rotation: 'N', reverse: true },
            },
          ],
        },
      ],
    };
    const migrated = migrateLegacy(persisted, 9) as typeof persisted;
    const objs = migrated.pages[0]?.objects ?? [];
    expect(objs).toHaveLength(2);
    expect(['box', 'line']).toContain((objs[0] as { type: string }).type);
    expect((objs[1] as { type: string }).type).toBe('text');
  });

  it('leaves a non-reverse text untouched', () => {
    const persisted = {
      pages: [
        {
          objects: [
            {
              id: 't',
              type: 'text',
              x: 50,
              y: 50,
              rotation: 0,
              props: { content: 'Hi', fontHeight: 30, fontWidth: 0, rotation: 'N' },
            },
          ],
        },
      ],
    };
    const migrated = migrateLegacy(persisted, 9) as typeof persisted;
    expect(migrated.pages[0]?.objects).toHaveLength(1);
  });
});

describe('migrateLegacy — v11→v12 single-bind variableId to content marker', () => {
  const persisted = (objects: unknown[]) => ({
    variables: [{ id: 'v1', name: 'sku', fnNumber: 1, defaultValue: 'X' }],
    pages: [{ objects }],
  });

  it('rewrites a single-bind leaf to a «name» marker and drops variableId', () => {
    const p = persisted([
      { id: 't', type: 'text', x: 0, y: 0, rotation: 0, variableId: 'v1', props: { content: 'X' } },
    ]);
    const migrated = migrateLegacy(p, 11) as typeof p;
    const leaf = migrated.pages[0]!.objects[0] as { variableId?: unknown; props: { content: string } };
    expect(leaf.props.content).toBe('«sku»');
    expect('variableId' in leaf).toBe(false);
  });

  it('drops an orphan variableId, leaving the literal fallback content', () => {
    const p = persisted([
      { id: 't', type: 'text', x: 0, y: 0, rotation: 0, variableId: 'ghost', props: { content: 'plain' } },
    ]);
    const migrated = migrateLegacy(p, 11) as typeof p;
    const leaf = migrated.pages[0]!.objects[0] as { variableId?: unknown; props: { content: string } };
    expect(leaf.props.content).toBe('plain');
    expect('variableId' in leaf).toBe(false);
  });

  it('descends into groups', () => {
    const p = persisted([
      {
        id: 'g', type: 'group', x: 0, y: 0, rotation: 0,
        children: [
          { id: 't', type: 'text', x: 0, y: 0, rotation: 0, variableId: 'v1', props: { content: 'X' } },
        ],
      },
    ]);
    const migrated = migrateLegacy(p, 11) as typeof p;
    const group = migrated.pages[0]!.objects[0] as { children: { props: { content: string } }[] };
    expect(group.children[0]!.props.content).toBe('«sku»');
  });

  it('is a no-op for a field that already uses a marker', () => {
    const p = persisted([
      { id: 't', type: 'text', x: 0, y: 0, rotation: 0, props: { content: '«sku»' } },
    ]);
    const migrated = migrateLegacy(p, 11) as typeof p;
    expect((migrated.pages[0]!.objects[0] as { props: { content: string } }).props.content).toBe('«sku»');
  });

  it('disambiguates duplicate legacy names per id (no cross-binding)', () => {
    const p = {
      variables: [
        { id: 'v1', name: 'sku', fnNumber: 1, defaultValue: 'X' },
        { id: 'v2', name: 'sku', fnNumber: 2, defaultValue: 'Y' },
      ],
      pages: [
        {
          objects: [
            { id: 'a', type: 'text', x: 0, y: 0, rotation: 0, variableId: 'v1', props: { content: 'X' } },
            { id: 'b', type: 'text', x: 0, y: 0, rotation: 0, variableId: 'v2', props: { content: 'Y' } },
          ],
        },
      ],
    };
    const migrated = migrateLegacy(p, 11) as typeof p;
    expect(migrated.variables.map((v) => v.name)).toEqual(['sku', 'sku_2']);
    const objs = migrated.pages[0]!.objects as { props: { content: string } }[];
    expect(objs[0]!.props.content).toBe('«sku»');
    expect(objs[1]!.props.content).toBe('«sku_2»');
  });
});

describe('migrateLegacy — v4→v5 printerProfile extraction', () => {
  it('hoists profile fields off label and clears them from the per-label config', () => {
    const persisted = {
      label: {
        widthMm: 100,
        heightMm: 50,
        dpmm: 8,
        // Profile fields that lived on labelConfig pre-v5.
        reprintAfterError: 'Y',
        headTestInterval: 250,
        tearOffAdjust: 15,
        clockFormat: '1',
        printerName: 'lab-zpl-01',
      },
      pages: [{ objects: [] }],
    };
    const migrated = migrateLegacy(persisted, 4) as typeof persisted & {
      printerProfile: Record<string, unknown>;
    };
    expect(migrated.label).toEqual({ widthMm: 100, heightMm: 50, dpmm: 8 });
    expect(migrated.printerProfile).toEqual({
      reprintAfterError: 'Y',
      headTestInterval: 250,
      tearOffAdjust: 15,
      clockFormat: '1',
      printerName: 'lab-zpl-01',
    });
  });

  it('seeds an empty printerProfile when the legacy label has no profile fields', () => {
    const persisted = {
      label: { widthMm: 100, heightMm: 50, dpmm: 8 },
      pages: [{ objects: [] }],
    };
    const migrated = migrateLegacy(persisted, 4) as typeof persisted & {
      printerProfile: Record<string, unknown>;
    };
    expect(migrated.printerProfile).toEqual({});
    expect(migrated.label).toEqual({ widthMm: 100, heightMm: 50, dpmm: 8 });
  });

  it('belt: defensively seeds printerProfile when version is current but slice is missing', () => {
    const persisted = {
      label: { widthMm: 100, heightMm: 50, dpmm: 8 },
      pages: [{ objects: [] }],
    };
    const migrated = migrateLegacy(persisted, 5) as typeof persisted & {
      printerProfile: Record<string, unknown>;
    };
    expect(migrated.printerProfile).toEqual({});
  });

  it('drops the schema-rejected sub-field on rehydrate', () => {
    // Legacy persist that violates the cross-field superRefine. The
    // repair walks Zod's issue paths: the cross-field rule flags the
    // message side, so the alert stays and the (stale) message is
    // dropped instead of silently rewriting on the next edit.
    const persisted = {
      label: { widthMm: 100, heightMm: 50, dpmm: 8 },
      pages: [{ objects: [] }],
      printerProfile: {
        maintenanceAlert: { type: 'H', print: 'Y', threshold: 5, frequency: 1, units: 'M' },
        maintenanceMessage: { type: 'R', text: 'Replace head' },
      },
    };
    const migrated = migrateLegacy(persisted, 6) as typeof persisted & {
      printerProfile: Record<string, unknown>;
    };
    expect(migrated.printerProfile.maintenanceAlert).toEqual({
      type: 'C', print: 'Y', threshold: 5, frequency: 1, units: 'M',
    });
    expect(migrated.printerProfile.maintenanceMessage).toBeUndefined();
  });

  it('drops clockMode "TOL" when clockTolerance is missing on rehydrate', () => {
    // superRefine reports path ['clockTolerance'], which is already
    // absent; a single-pass delete would be a no-op and leave the
    // invariant violation in place. The fixpoint loop catches this.
    const persisted = {
      label: { widthMm: 100, heightMm: 50, dpmm: 8 },
      pages: [{ objects: [] }],
      printerProfile: { clockMode: 'TOL' },
    };
    const migrated = migrateLegacy(persisted, 6) as typeof persisted & {
      printerProfile: Record<string, unknown>;
    };
    expect(migrated.printerProfile.clockMode).toBeUndefined();
  });

  it('v7→v8 drops legacy path-less customFonts on rehydrate', () => {
    const persisted = {
      label: {
        widthMm: 100,
        heightMm: 50,
        dpmm: 8,
        customFonts: [
          { alias: 'A' },
          { alias: 'B', path: 'E:MY.TTF' },
        ],
      },
      pages: [{ objects: [] }],
    };
    const migrated = migrateLegacy(persisted, 7) as typeof persisted;
    expect(migrated.label.customFonts).toEqual([{ alias: 'B', path: 'E:MY.TTF' }]);
  });

  it('v7→v8 clears customFonts to undefined when only legacy entries remain', () => {
    const persisted = {
      label: { widthMm: 100, heightMm: 50, dpmm: 8, customFonts: [{ alias: 'A' }] },
      pages: [{ objects: [] }],
    };
    const migrated = migrateLegacy(persisted, 7) as {
      label: Record<string, unknown>;
    };
    expect(migrated.label.customFonts).toBeUndefined();
  });

  it('v8→v9 backfills unique paletteRow ids so sortable keys never collide', () => {
    const persisted = {
      paletteRows: [
        { type: 'text', variant: 'text' },
        { type: 'shape', variant: 'line' },
        { type: 'shape', variant: 'box' },
      ],
    };
    const migrated = migrateLegacy(persisted, 8) as { paletteRows: { id: string }[] };
    const ids = migrated.paletteRows.map((r) => r.id);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('v8→v9 keeps already-valid unique ids untouched', () => {
    const persisted = {
      paletteRows: [
        { id: 'text', type: 'text', variant: 'text' },
        { id: 'image', type: 'image', variant: 'image' },
      ],
    };
    const migrated = migrateLegacy(persisted, 8) as { paletteRows: { id: string }[] };
    expect(migrated.paletteRows.map((r) => r.id)).toEqual(['text', 'image']);
  });

  it('v8→v9 drops the dead paletteFavorites key', () => {
    const persisted = { paletteFavorites: ['text', 'box'] };
    const migrated = migrateLegacy(persisted, 8) as Record<string, unknown>;
    expect('paletteFavorites' in migrated).toBe(false);
  });

  it('v8→v9 backfill stays unique when a legacy id collides with the fallback', () => {
    // 'shape-1' is exactly what the id-less second row would generate.
    const persisted = {
      paletteRows: [
        { id: 'shape-1', type: 'text', variant: 'text' },
        { type: 'shape', variant: 'line' },
      ],
    };
    const migrated = migrateLegacy(persisted, 8) as { paletteRows: { id: string }[] };
    const ids = migrated.paletteRows.map((r) => r.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('migrateLegacy — v9→v10 serial type → text mode', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props = (o: unknown) => (o as any).props as Record<string, unknown>;

  it('rewrites a persisted serial object to a text field with serial prop', () => {
    const persisted = {
      label: { widthMm: 100, heightMm: 50, dpmm: 8 },
      printerProfile: {},
      pages: [{ objects: [
        { id: 's', type: 'serial', x: 10, y: 20, rotation: 0,
          props: { content: '001', increment: 5, fontHeight: 30, fontWidth: 0, rotation: 'N', zplMode: 'SF' } },
      ] }],
    };
    const migrated = migrateLegacy(persisted, 9) as typeof persisted;
    const obj = migrated.pages[0]!.objects[0]!;
    expect((obj as { type: string }).type).toBe('text');
    expect(props(obj).serial).toEqual({ increment: 5, zplMode: 'SF' });
    expect(props(obj).content).toBe('001');
    expect(props(obj).increment).toBeUndefined();
    expect(props(obj).zplMode).toBeUndefined();
  });

  it('migrates a serial object nested in a group', () => {
    const persisted = {
      label: { widthMm: 100, heightMm: 50, dpmm: 8 },
      printerProfile: {},
      pages: [{ objects: [
        { id: 'g', type: 'group', x: 0, y: 0, rotation: 0, children: [
          { id: 's', type: 'serial', x: 0, y: 0, rotation: 0,
            props: { content: '1', increment: 1, fontHeight: 30, fontWidth: 0, rotation: 'N', zplMode: 'SN' } },
        ] },
      ] }],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const migrated = migrateLegacy(persisted, 9) as any;
    const child = migrated.pages[0].objects[0].children[0];
    expect(child.type).toBe('text');
    expect(props(child).serial).toEqual({ increment: 1, zplMode: 'SN' });
  });

  it('remaps the legacy "serial" palette variant to "text-serial"', () => {
    const persisted = {
      label: { widthMm: 100, heightMm: 50, dpmm: 8 },
      printerProfile: {},
      pages: [{ objects: [] }],
      paletteRows: [
        { id: 'r1', type: 'text', variant: 'serial' },
        { id: 'r2', type: 'text', variant: 'text' },
      ],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const migrated = migrateLegacy(persisted, 9) as any;
    // v11 remaps the variant serial->text-serial, then v13 folds variant->entryId.
    expect(migrated.paletteRows[0]).toEqual({ id: 'r1', entryId: 'text-serial' });
    expect(migrated.paletteRows[1]).toEqual({ id: 'r2', entryId: 'text' });
  });

  it('v13 folds variant->entryId, dedupes shared entryIds, and renames the view', () => {
    const persisted = {
      label: { widthMm: 100, heightMm: 50, dpmm: 8 },
      printerProfile: {},
      pages: [{ objects: [] }],
      paletteRows: [
        { id: 'a', type: 'shape', variant: 'line' },
        { id: 'b', type: 'shape', variant: 'line' }, // legacy duplicate of 'a'
        { id: 'c', type: 'text', variant: 'text' },
      ],
      paletteView: 'list',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const migrated = migrateLegacy(persisted, 12) as any;
    expect(migrated.paletteRows).toEqual([
      { id: 'a', entryId: 'line' },
      { id: 'c', entryId: 'text' },
    ]);
    expect(migrated.paletteView).toBe('favorites');
  });
});

describe('variables', () => {
  beforeEach(reset);

  it('addVariable assigns sequential fnNumbers starting at 1', () => {
    const id1 = state().addVariable({ name: 'sku' });
    const id2 = state().addVariable({ name: 'qty' });
    expect(id1).not.toBeNull();
    expect(id2).not.toBeNull();
    const vars = state().variables;
    expect(vars).toHaveLength(2);
    expect(vars[0]?.fnNumber).toBe(1);
    expect(vars[1]?.fnNumber).toBe(2);
  });

  it('addVariable fills the lowest free fnNumber when earlier ones were taken explicitly', () => {
    state().addVariable({ name: 'a', fnNumber: 3 });
    state().addVariable({ name: 'b', fnNumber: 1 });
    const id = state().addVariable({ name: 'c' });
    expect(id).not.toBeNull();
    const c = state().variables.find((v) => v.name === 'c');
    expect(c?.fnNumber).toBe(2);
  });

  it('addVariable rejects duplicate names', () => {
    state().addVariable({ name: 'sku' });
    const dup = state().addVariable({ name: 'sku' });
    expect(dup).toBeNull();
    expect(state().variables).toHaveLength(1);
  });

  it('addVariable rejects duplicate fnNumbers', () => {
    state().addVariable({ name: 'a', fnNumber: 5 });
    const dup = state().addVariable({ name: 'b', fnNumber: 5 });
    expect(dup).toBeNull();
    expect(state().variables).toHaveLength(1);
  });

  it('addVariable rejects fnNumbers outside 1-99', () => {
    expect(state().addVariable({ name: 'a', fnNumber: 0 })).toBeNull();
    expect(state().addVariable({ name: 'b', fnNumber: 100 })).toBeNull();
    expect(state().variables).toHaveLength(0);
  });

  it('addVariable rejects empty / whitespace-only names', () => {
    expect(state().addVariable({ name: '' })).toBeNull();
    expect(state().addVariable({ name: '   ' })).toBeNull();
    expect(state().variables).toHaveLength(0);
  });

  it('addVariable trims the name', () => {
    state().addVariable({ name: '  sku  ' });
    expect(state().variables[0]?.name).toBe('sku');
  });

  it('updateVariable patches fields when valid', () => {
    const id = defined(state().addVariable({ name: 'sku', defaultValue: 'x' }));
    state().updateVariable(id, { defaultValue: 'y' });
    expect(state().variables[0]?.defaultValue).toBe('y');
  });

  it('updateVariable default change is one undo entry; bound content stays the marker', () => {
    state().addObject('text');
    const objId = defined(ids()[0]);
    const varId = defined(state().addVariable({ name: 'sku', defaultValue: 'x' }));
    state().updateObject(objId, { props: { content: '«sku»' } });
    useLabelStore.temporal.getState().clear();

    state().updateVariable(varId, { defaultValue: 'NEW' });

    expect(state().variables.find((v) => v.id === varId)?.defaultValue).toBe('NEW');
    // Content is the marker, not a mirror; preview re-resolves to the new default.
    expect(props(objs().find((o) => o.id === objId)).content).toBe('«sku»');
    expect(useLabelStore.temporal.getState().pastStates.length).toBe(1);
  });

  it('updateVariable is a no-op for an unknown variable id', () => {
    const before = state().variables.length;
    state().updateVariable('ghost', { defaultValue: 'NEW' });
    expect(state().variables.length).toBe(before);
  });

  it('updateVariable rejects renaming to an existing name', () => {
    state().addVariable({ name: 'a' });
    const id = defined(state().addVariable({ name: 'b' }));
    state().updateVariable(id, { name: 'a' });
    expect(state().variables.find((v) => v.id === id)?.name).toBe('b');
  });

  it('updateVariable rejects fnNumber collisions', () => {
    state().addVariable({ name: 'a', fnNumber: 1 });
    const id = defined(state().addVariable({ name: 'b', fnNumber: 2 }));
    state().updateVariable(id, { fnNumber: 1 });
    expect(state().variables.find((v) => v.id === id)?.fnNumber).toBe(2);
  });

  it('removeVariable substitutes the lone single-bind marker across pages', () => {
    const varId = defined(state().addVariable({ name: 'sku', defaultValue: 'X' }));
    useLabelStore.setState({
      pages: [
        {
          objects: [
            {
              id: 'obj-1',
              type: 'text',
              x: 0,
              y: 0,
              rotation: 0,
              props: { content: '«sku»', fontHeight: 30, fontWidth: 30, rotation: 'N' },
            } as LabelObject,
          ],
        },
        {
          objects: [
            {
              id: 'grp-1',
              type: 'group',
              x: 0,
              y: 0,
              rotation: 0,
              children: [
                {
                  id: 'obj-2',
                  type: 'text',
                  x: 0,
                  y: 0,
                  rotation: 0,
                  props: { content: '«sku»', fontHeight: 30, fontWidth: 30, rotation: 'N' },
                } as LabelObject,
              ],
            } as LabelObject,
          ],
        },
      ],
    });

    state().removeVariable(varId);

    expect(state().variables).toHaveLength(0);
    expect(props(state().pages[0]?.objects[0]).content).toBe('X');
    const group = state().pages[1]?.objects[0];
    if (!group || !isGroup(group)) throw new Error('expected group');
    expect(props(group.children[0]).content).toBe('X');
  });

  it('removeVariable substitutes template markers with the default in leaf + group', () => {
    const varId = defined(state().addVariable({ name: 'sku', defaultValue: 'ABC' }));
    useLabelStore.setState({
      pages: [
        {
          objects: [
            {
              id: 'obj-1',
              type: 'text',
              x: 0,
              y: 0,
              rotation: 0,
              props: { content: 'Hello «sku»', fontHeight: 30, fontWidth: 30, rotation: 'N' },
            } as LabelObject,
            {
              id: 'grp-1',
              type: 'group',
              x: 0,
              y: 0,
              rotation: 0,
              children: [
                {
                  id: 'obj-2',
                  type: 'text',
                  x: 0,
                  y: 0,
                  rotation: 0,
                  props: { content: '«sku»/«sku»', fontHeight: 30, fontWidth: 30, rotation: 'N' },
                } as LabelObject,
              ],
            } as LabelObject,
          ],
        },
      ],
    });

    state().removeVariable(varId);

    expect(props(state().pages[0]?.objects[0]).content).toBe('Hello ABC');
    const group = state().pages[0]?.objects[1];
    if (!group || !isGroup(group)) throw new Error('expected group');
    expect(props(group.children[0]).content).toBe('ABC/ABC');
  });

  it('removeVariable strips marker delimiters from the substituted default (no phantom re-bind)', () => {
    const varId = defined(state().addVariable({ name: 'sku', defaultValue: '«lot»' }));
    useLabelStore.setState({
      pages: [
        {
          objects: [
            {
              id: 'obj-1',
              type: 'text',
              x: 0,
              y: 0,
              rotation: 0,
              props: { content: '«sku»', fontHeight: 30, fontWidth: 30, rotation: 'N' },
            } as LabelObject,
          ],
        },
      ],
    });

    state().removeVariable(varId);

    // The default «lot» must not survive as a marker, else the field re-binds.
    expect(props(state().pages[0]?.objects[0]).content).toBe('lot');
  });

  it('removeVariable leaves pages untouched when no field referenced the variable', () => {
    const varId = defined(state().addVariable({ name: 'sku' }));
    const pagesBefore = state().pages;
    state().removeVariable(varId);
    expect(state().pages).toBe(pagesBefore);
  });

  it('loadDesign replaces the variable list', () => {
    state().addVariable({ name: 'a' });
    state().loadDesign(
      { widthMm: 50, heightMm: 30, dpmm: 8 },
      [{ objects: [] }],
      [{ id: 'v1', name: 'fresh', fnNumber: 7, defaultValue: '' }],
    );
    expect(state().variables).toEqual([
      { id: 'v1', name: 'fresh', fnNumber: 7, defaultValue: '' },
    ]);
  });

  it('loadDesign resets variables to empty when none supplied', () => {
    state().addVariable({ name: 'a' });
    state().loadDesign({ widthMm: 50, heightMm: 30, dpmm: 8 }, [{ objects: [] }]);
    expect(state().variables).toEqual([]);
  });
});

describe('dataset', () => {
  beforeEach(reset);

  const sampleResult = {
    headers: ['sku', 'qty'],
    rows: [['A1', '10'], ['B2', '5'], ['C3', '7']],
    source: {
      kind: 'csv' as const,
      filename: 'test.csv',
      importedAt: '2026-05-23T00:00:00.000Z',
      encoding: 'utf-8',
      delimiter: ',',
      rowCount: 3,
    },
  };

  it('loadDataset stores headers, rows, source and resets activeRowIndex to 0', () => {
    state().loadDataset(sampleResult);
    const ds = state().dataset;
    expect(ds?.headers).toEqual(['sku', 'qty']);
    expect(ds?.rows).toHaveLength(3);
    expect(ds?.source.kind === 'csv' && ds.source.filename).toBe('test.csv');
    expect(ds?.activeRowIndex).toBe(0);
  });

  it('clearDataset drops the dataset', () => {
    state().loadDataset(sampleResult);
    state().clearDataset();
    expect(state().dataset).toBeNull();
  });

  it('setActiveRow updates within bounds', () => {
    state().loadDataset(sampleResult);
    state().setActiveRow(2);
    expect(state().dataset?.activeRowIndex).toBe(2);
  });

  it('setActiveRow clamps below 0 and above rows.length - 1', () => {
    state().loadDataset(sampleResult);
    state().setActiveRow(-5);
    expect(state().dataset?.activeRowIndex).toBe(0);
    state().setActiveRow(99);
    expect(state().dataset?.activeRowIndex).toBe(2);
  });

  it('setActiveRow is a no-op when no CSV is loaded', () => {
    state().setActiveRow(5);
    expect(state().dataset).toBeNull();
  });

  const dbResult = {
    headers: ['sku'],
    rows: [['A1']],
    source: {
      kind: 'db' as const,
      profileId: 'p1',
      profileName: 'Prod',
      table: 'items',
      fetchedAt: '2026-07-20T00:00:00.000Z',
      rowCount: 1,
      truncated: false,
    },
  };

  it('loadDataset records no undo step (dataset AND ref are non-temporal)', () => {
    useLabelStore.temporal.getState().clear();
    state().loadDataset(dbResult);
    expect(useLabelStore.temporal.getState().pastStates).toHaveLength(0);
  });

  it('loadDataset derives dataSourceRef from a db source', () => {
    state().loadDataset(dbResult);
    expect(state().dataSourceRef).toEqual({
      kind: 'db',
      profileId: 'p1',
      profileName: 'Prod',
      table: 'items',
    });
  });

  it('loadDataset clears dataSourceRef when a file source replaces db data', () => {
    state().loadDataset(dbResult);
    state().loadDataset(sampleResult);
    expect(state().dataSourceRef).toBeNull();
  });

  it('clearDataset keeps dataSourceRef so the reconnect link survives a discard', () => {
    state().loadDataset(dbResult);
    state().clearDataset();
    expect(state().dataset).toBeNull();
    expect(state().dataSourceRef).not.toBeNull();
  });

  it('loadDesign seeds dataSourceRef from the design file and resets it otherwise', () => {
    state().loadDataset(dbResult);
    state().loadDesign({ widthMm: 50, heightMm: 30, dpmm: 8 }, [{ objects: [] }]);
    expect(state().dataSourceRef).toBeNull();
    state().loadDesign(
      { widthMm: 50, heightMm: 30, dpmm: 8 },
      [{ objects: [] }],
      [],
      null,
      { kind: 'db', profileId: 'p9', profileName: 'X', table: 't' },
    );
    expect(state().dataSourceRef?.profileId).toBe('p9');
  });

  it('applyMappingDraft keeps the ref for db datasets', () => {
    const varId = defined(state().addVariable({ name: 'sku' }));
    state().applyMappingDraft({
      variables: state().variables.slice(),
      dataset: dbResult,
      mapping: { bindings: { [varId]: 'sku' }, headerSnapshot: ['sku'] },
      activeRowIndex: 0,
    });
    expect(state().dataSourceRef?.table).toBe('items');
  });

  it('selectBatchInputs requires at least one live binding, not just any entry', () => {
    const varId = defined(state().addVariable({ name: 'sku' }));
    state().loadDataset(sampleResult); // headers ['sku','qty']
    // Binding points at a header that is NOT in the dataset -> all-orphan.
    state().setColumnMapping({ bindings: { [varId]: 'gone' }, headerSnapshot: ['gone'] });
    expect(selectBatchInputs(state())).toBeNull();
    // Re-point to a live header.
    state().setColumnMapping({ bindings: { [varId]: 'sku' }, headerSnapshot: ['sku'] });
    expect(selectBatchInputs(state())).not.toBeNull();
  });

  it('loadFetchedDataset forces mapping review for a headerless mapping', async () => {
    const varId = defined(state().addVariable({ name: 'sku' }));
    // Headerless CSV mapping, compatible only by column count.
    state().setColumnMapping({
      bindings: { [varId]: 'Column 1' },
      headerSnapshot: ['Column 1', 'Column 2'],
      parseOptions: { hasHeaderRow: false },
    });
    await loadFetchedDataset(async () => ({
      headers: ['sku', 'qty'],
      rows: [['A', '1']],
      source: {
        kind: 'db', profileId: 'p', profileName: 'X', table: 't',
        fetchedAt: '', rowCount: 1, truncated: false,
      },
    }));
    expect(state().mappingModalOpen).toBe(true);
  });

  it('loadFetchedDataset drops a result superseded while the fetch was in flight', async () => {
    state().loadDataset(sampleResult);
    const applied = await loadFetchedDataset(async () => {
      state().invalidateDatasetFetches(); // a newer op lands mid-fetch
      return dbResult;
    });
    expect(applied).toBe(false);
    expect(state().dataset?.source.kind).toBe('csv');
    expect(state().dataset?.rows).toHaveLength(3);
  });

  it('loadFetchedDataset applies when nothing supersedes it', async () => {
    const applied = await loadFetchedDataset(async () => dbResult);
    expect(applied).toBe(true);
    expect(state().dataset?.source.kind).toBe('db');
  });

  it('loadFetchedDataset with a pre-sampled token drops if the context changed since', async () => {
    // loadFromDb samples before awaitCredWrites; a doc load during that wait
    // must supersede the fetch even though the fetch is initiated afterwards.
    const token = currentDataContext();
    state().loadDataset(sampleResult);
    const applied = await loadFetchedDataset(async () => dbResult, token);
    expect(applied).toBe(false);
    expect(state().dataset?.source.kind).toBe('csv');
  });

  it('loadDesign supersedes a fetch started before the document swap', async () => {
    state().loadDataset(sampleResult);
    const applied = await loadFetchedDataset(async () => {
      // Document replaced (File>New/Open, MCP) while the fetch was in flight.
      state().loadDesign({ widthMm: 50, heightMm: 30, dpmm: 8 }, [{ objects: [] }]);
      return dbResult;
    });
    expect(applied).toBe(false);
    expect(state().dataset).toBeNull();
  });

  it('loadDesign closes the settings and mapping modals so stale selections cannot load', () => {
    useLabelStore.setState({ printerSettingsTab: 'dataSources', mappingModalOpen: true });
    state().loadDesign({ widthMm: 50, heightMm: 30, dpmm: 8 }, [{ objects: [] }]);
    expect(state().printerSettingsTab).toBeNull();
    expect(state().mappingModalOpen).toBe(false);
  });

  it('isCurrentDataContext tracks the epoch a held-open dialog captured', () => {
    const token = currentDataContext();
    expect(isCurrentDataContext(token)).toBe(true);
    state().loadDataset(sampleResult); // any dataset op bumps the epoch
    expect(isCurrentDataContext(token)).toBe(false);
  });

  it('loadDesign clears undo history so an undo cannot strand dataSourceRef', () => {
    state().loadDataset(dbResult);
    state().addVariable({ name: 'x' }); // create at least one undo step
    expect(useLabelStore.temporal.getState().pastStates.length).toBeGreaterThan(0);
    state().loadDesign({ widthMm: 50, heightMm: 30, dpmm: 8 }, [{ objects: [] }]);
    expect(useLabelStore.temporal.getState().pastStates).toHaveLength(0);
  });

  it('setActiveRow is a no-op while preview locks the editor', () => {
    state().loadDataset(sampleResult); // 3 rows
    useLabelStore.setState({ previewMode: { status: 'active', url: 'blob:x' } });
    state().setActiveRow(2);
    expect(state().dataset?.activeRowIndex).toBe(0);
  });

  it('loadDataset exits an active preview and applies (no silent drift)', () => {
    useLabelStore.setState({ previewMode: { status: 'active', url: 'blob:x' } });
    state().loadDataset(sampleResult);
    expect(state().dataset).not.toBeNull();
    expect(state().previewMode.status).toBe('idle');
  });

  it('clearDataset exits an active preview and discards', () => {
    state().loadDataset(sampleResult);
    useLabelStore.setState({ previewMode: { status: 'active', url: 'blob:x' } });
    state().clearDataset();
    expect(state().dataset).toBeNull();
    expect(state().previewMode.status).toBe('idle');
  });

  it('loadDataset with subsequent loadDataset replaces dataset and resets activeRowIndex', () => {
    state().loadDataset(sampleResult);
    state().setActiveRow(2);
    state().loadDataset({
      ...sampleResult,
      rows: [['X', '1']],
      source: { ...sampleResult.source, rowCount: 1, filename: 'other.csv' },
    });
    const src = state().dataset?.source;
    expect(src?.kind === 'csv' && src.filename).toBe('other.csv');
    expect(state().dataset?.activeRowIndex).toBe(0);
    expect(state().dataset?.rows).toHaveLength(1);
  });
});

describe('dbProfiles', () => {
  beforeEach(reset);

  it('add/update/remove round-trip', () => {
    state().addDbProfile({ id: 'p1', name: 'Prod', driver: 'sqlite', path: 'C:/x.sqlite' });
    state().updateDbProfile({ id: 'p1', name: 'Prod DB', driver: 'sqlite', path: 'C:/x.sqlite' });
    expect(state().dbProfiles).toEqual([
      { id: 'p1', name: 'Prod DB', driver: 'sqlite', path: 'C:/x.sqlite' },
    ]);
    state().removeDbProfile('p1');
    expect(state().dbProfiles).toEqual([]);
  });

  it('updateDbProfile can switch the driver shape (full replace)', () => {
    state().addDbProfile({ id: 'p2', name: 'Net', driver: 'sqlite', path: 'C:/y.sqlite' });
    state().updateDbProfile({
      id: 'p2', name: 'Net', driver: 'postgres', host: 'db.local', database: 'wms', user: 'label',
    });
    expect(state().dbProfiles[0]).toEqual({
      id: 'p2', name: 'Net', driver: 'postgres', host: 'db.local', database: 'wms', user: 'label',
    });
  });
});

describe('sidebar tab + content-editor focus request', () => {
  beforeEach(reset);

  it('setSidebarTab updates the visible tab', () => {
    expect(state().sidebarTab).toBe('properties');
    state().setSidebarTab('layers');
    expect(state().sidebarTab).toBe('layers');
  });

  it('requestContentEditorFocus(id) sets a fresh focus request scoped to that id', () => {
    expect(state().editorFocusRequest).toBeNull();
    state().requestContentEditorFocus('obj-1');
    const first = state().editorFocusRequest;
    expect(first?.id).toBe('obj-1');
    expect(first?.nonce).toBe(1);
  });

  it('requestContentEditorFocus does NOT change the sidebar tab (caller composes)', () => {
    state().setSidebarTab('layers');
    state().requestContentEditorFocus('obj-1');
    expect(state().sidebarTab).toBe('layers');
  });

  it('repeated requestContentEditorFocus bumps the nonce so consumers re-fire on the same id', () => {
    state().requestContentEditorFocus('obj-1');
    const firstNonce = state().editorFocusRequest?.nonce;
    state().requestContentEditorFocus('obj-1');
    const secondNonce = state().editorFocusRequest?.nonce;
    expect(secondNonce).toBe((firstNonce ?? 0) + 1);
    expect(state().editorFocusRequest?.id).toBe('obj-1');
  });

  it('requestContentEditorFocus with a different id retargets', () => {
    state().requestContentEditorFocus('obj-1');
    state().requestContentEditorFocus('obj-2');
    expect(state().editorFocusRequest?.id).toBe('obj-2');
  });
});

describe('printerProfile actions', () => {
  beforeEach(() => { reset(); });

  it('patchPrinterProfile merges fields and drops undefined keys', () => {
    state().patchPrinterProfile({ reprintAfterError: 'Y', headTestInterval: 250 });
    expect(state().printerProfile).toEqual({
      reprintAfterError: 'Y',
      headTestInterval: 250,
    });
    state().patchPrinterProfile({ reprintAfterError: undefined });
    expect(state().printerProfile).toEqual({ headTestInterval: 250 });
  });

  it('resetPrinterProfile clears all profile fields', () => {
    state().patchPrinterProfile({
      reprintAfterError: 'Y',
      headTestInterval: 250,
      printerName: 'lab-zpl-01',
    });
    expect(Object.keys(state().printerProfile).length).toBeGreaterThan(0);
    state().resetPrinterProfile();
    expect(state().printerProfile).toEqual({});
  });

  it('resetPrinterProfile is a no-op while preview locks the editor', () => {
    state().patchPrinterProfile({ reprintAfterError: 'Y' });
    useLabelStore.setState({ previewMode: { status: 'active', url: 'blob:x' } });
    state().resetPrinterProfile();
    expect(state().printerProfile).toEqual({ reprintAfterError: 'Y' });
  });

  it('patchPrinterProfile throws on schema-invalid patches in dev (tests run in DEV)', () => {
    // clockMode 'TOL' without clockTolerance is schema-invalid.
    // Vitest sets import.meta.env.DEV === true, so the store action
    // throws instead of warn-and-drop. This is the contract for HMR
    // / test sessions; prod builds get warn-and-drop instead.
    expect(() => state().patchPrinterProfile({ clockMode: 'TOL' })).toThrow(
      /rejected invalid patch/,
    );
    expect(state().printerProfile).toEqual({});
  });

  it('patchPrinterProfile accepts the TOL+tolerance pair as one atomic patch', () => {
    state().patchPrinterProfile({ clockMode: 'TOL', clockTolerance: 30 });
    expect(state().printerProfile).toEqual({ clockMode: 'TOL', clockTolerance: 30 });
  });
});

describe('applyMappingDraft — rename ripple', () => {
  it('rewrites «oldName» markers when a variable is renamed in the mapping modal', () => {
    const id = defined(state().addVariable({ name: 'sku', defaultValue: 'X' }));
    const fn = defined(state().variables[0]).fnNumber;
    useLabelStore.setState({
      pages: [
        {
          objects: [
            {
              id: 'o1', type: 'text', x: 0, y: 0, rotation: 0,
              props: { content: 'Item «sku»', fontHeight: 30, fontWidth: 30, rotation: 'N' },
            } as LabelObject,
          ],
        },
      ],
    });

    state().applyMappingDraft({
      variables: [{ id, name: 'price', fnNumber: fn, defaultValue: 'X' }],
      dataset: {
        headers: [],
        rows: [],
        source: { kind: 'csv' as const, filename: 'f.csv', importedAt: '', encoding: 'utf-8', delimiter: ',', rowCount: 0 },
      },
      mapping: { bindings: {}, headerSnapshot: [] },
      activeRowIndex: 0,
    });

    expect(state().variables[0]?.name).toBe('price');
    expect(props(state().pages[0]?.objects[0]).content).toBe('Item «price»');
  });

  it('preserves the variables ref when only the mapping changed (history reads a dataset step)', () => {
    const id = defined(state().addVariable({ name: 'sku', defaultValue: 'X' }));
    const before = state().variables;
    state().applyMappingDraft({
      variables: [...before], // same element refs, like the modal's draft seed; no edit
      dataset: {
        headers: ['sku'], rows: [['A']],
        source: { kind: 'csv' as const, filename: 'f.csv', importedAt: '', encoding: 'utf-8', delimiter: ',', rowCount: 1 },
      },
      mapping: { bindings: { [id]: 'sku' }, headerSnapshot: ['sku'] },
      activeRowIndex: 0,
    });
    expect(state().variables).toBe(before);
    expect(state().columnMapping?.bindings[id]).toBe('sku');
  });

  it('handles a name swap in one pass (markers do not cascade)', () => {
    const a = defined(state().addVariable({ name: 'sku', defaultValue: 'X' }));
    const b = defined(state().addVariable({ name: 'lot', defaultValue: 'Y' }));
    const fnA = defined(state().variables.find((v) => v.id === a)).fnNumber;
    const fnB = defined(state().variables.find((v) => v.id === b)).fnNumber;
    useLabelStore.setState({
      pages: [
        {
          objects: [
            {
              id: 'o1', type: 'text', x: 0, y: 0, rotation: 0,
              props: { content: '«sku» «lot»', fontHeight: 30, fontWidth: 30, rotation: 'N' },
            } as LabelObject,
          ],
        },
      ],
    });

    state().applyMappingDraft({
      variables: [
        { id: a, name: 'lot', fnNumber: fnA, defaultValue: 'X' },
        { id: b, name: 'sku', fnNumber: fnB, defaultValue: 'Y' },
      ],
      dataset: {
        headers: [],
        rows: [],
        source: { kind: 'csv' as const, filename: 'f.csv', importedAt: '', encoding: 'utf-8', delimiter: ',', rowCount: 0 },
      },
      mapping: { bindings: {}, headerSnapshot: [] },
      activeRowIndex: 0,
    });

    // «sku» bound to A (now "lot") -> «lot»; «lot» bound to B (now "sku") -> «sku».
    expect(props(state().pages[0]?.objects[0]).content).toBe('«lot» «sku»');
  });
});

import { useEffect, useState, type ComponentType, type SVGProps } from 'react';
import type { Image as TauriImage } from '@tauri-apps/api/image';
import type {
  CheckMenuItem as TauriCheckMenuItem,
  IconMenuItem as TauriIconMenuItem,
  MenuItem as TauriMenuItem,
  Submenu as TauriSubmenu,
} from '@tauri-apps/api/menu';
import { isDesktopShell, isMacDesktop } from '../lib/platform';
import { rasterizeIcon } from '../lib/rasterizeIcon';
import { menuStructureKey, menuContentSignature } from '../lib/menuSignature';
import type { HistorySubmenu, MenuItemId, MenuModel, MenuSection, SubmenuLabels } from '../lib/menuModel';

/** Handler per menu item id; looked up at click time via module state so menu
 *  updates depend only on the content signature, not on identities. */
export type MenuHandlers = Record<MenuItemId, () => void>;

export type MenuIcons = Partial<Record<MenuItemId, ComponentType<SVGProps<SVGSVGElement>>>>;

interface MenuData {
  model: MenuModel;
  submenuLabels: SubmenuLabels;
  handlers: MenuHandlers;
  icons: MenuIcons;
  history: HistorySubmenu;
  onHistoryJump: (index: number) => void;
  onHistoryClear: () => void;
  onInitError: () => void;
  dark: boolean;
}

/** Native menu icons render at the classic menu glyph size. */
const ICON_SIZE = 16;
const GLYPH_LIGHT = '#4b5563';
const GLYPH_DARK = '#d1d5db';

/** Tauri menu/image objects are Rust-side resources freed only by an explicit
 *  close(); nothing garbage-collects them, so every full rebuild tracks what
 *  it created and closes the superseded tree. */
interface Closable {
  close: () => Promise<void>;
}

const closeAll = (resources: Closable[]) => {
  void Promise.allSettled(resources.map((r) => r.close()));
};

/** Native Image resources per item id and glyph color; icons are static per
 *  session, so rebuilds reuse them (they are deliberately never closed). */
const imageCache = new Map<string, TauriImage>();

interface ItemHandle {
  handle: TauriMenuItem | TauriIconMenuItem;
  label: string;
  enabled: boolean;
}

/** One recycled step per submenu position. `label`/`current`/`enabled` are the
 *  last-applied values (diffed on patch to skip unchanged steps), and `index`
 *  is the absolute timeline index the click jumps to, kept current as the
 *  window slides so a recycled item never targets a stale step. */
interface HistoryStep {
  item: TauriCheckMenuItem;
  label: string;
  current: boolean;
  enabled: boolean;
  index: number;
}

interface HistoryHandles {
  submenu: TauriSubmenu;
  submenuLabel: string;
  submenuEnabled: boolean;
  clear: TauriMenuItem;
  clearLabel: string;
  clearEnabled: boolean;
  steps: HistoryStep[];
}

interface InstalledMenu {
  structureKey: string;
  resources: Closable[];
  submenus: { file: TauriSubmenu; edit: TauriSubmenu; help: TauriSubmenu };
  submenuLabels: { file: string; edit: string; help: string };
  items: Map<MenuItemId, ItemHandle>;
  history: HistoryHandles;
}

/** Single-mount module state (NativeMenuBridge mounts this once on desktop).
 *  `latest` backs all late-bound reads so recycled item actions and the queued
 *  update always see current data without churning menu rebuilds. */
let latest: MenuData | null = null;
let installed: InstalledMenu | null = null;
let updateGen = 0;
let queue: Promise<void> = Promise.resolve();
/** The OS toggles a clicked CheckMenuItem's checkmark itself; after a jump we
 *  re-assert every step's checkmark so that stray toggle can't linger. */
let checkmarkDirty = false;

// Vite HMR replaces this module while the OS menu still lives in Rust; close
// the installed tree so a dev session doesn't leak menu items per menu edit.
// Stripped from the production build (import.meta.hot is undefined there).
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    // Invalidate queued rebuilds and drain the in-flight update before closing,
    // so a mid-await patch/rebuild can't touch freed handles.
    updateGen += 1;
    queue = queue.then(() => {
      if (installed) closeAll(installed.resources);
      installed = null;
    });
  });
}

async function itemIcon(id: MenuItemId, icons: MenuIcons, dark: boolean): Promise<TauriImage | null> {
  const Icon = icons[id];
  if (!Icon) return null;
  const glyphColor = dark ? GLYPH_DARK : GLYPH_LIGHT;
  const key = `${id}:${glyphColor}`;
  const cached = imageCache.get(key);
  if (cached) return cached;
  try {
    const rgba = await rasterizeIcon(Icon, glyphColor, ICON_SIZE);
    if (!rgba) return null;
    const { Image } = await import('@tauri-apps/api/image');
    const image = await Image.new(rgba, ICON_SIZE, ICON_SIZE);
    imageCache.set(key, image);
    return image;
  } catch {
    // Icons are polish; a failed rasterize must never break the menu.
    return null;
  }
}

/** The click reads its CURRENT index off the live `steps` array (which becomes
 *  hist.steps), so sliding the window never leaves a stale jump target. */
async function makeStepItem(
  steps: HistoryStep[],
  position: number,
  step: HistorySubmenu['items'][number],
): Promise<HistoryStep> {
  const { CheckMenuItem } = await import('@tauri-apps/api/menu');
  const item = await CheckMenuItem.new({
    text: step.label,
    checked: step.current,
    enabled: step.enabled,
    action: () => {
      const index = steps[position]?.index;
      if (index === undefined) return;
      checkmarkDirty = true;
      latest?.onHistoryJump(index);
    },
  });
  return { item, label: step.label, current: step.current, enabled: step.enabled, index: step.index };
}

/** Full build + menubar swap; cold path (first mount, locale-independent
 *  structure change, OS theme flip). */
async function rebuildMenu(structureKey: string, d: MenuData, gen: number): Promise<void> {
  const created: Closable[] = [];
  const track = <T extends Closable>(resource: T): T => {
    created.push(resource);
    return resource;
  };
  try {
    const { Menu, Submenu, MenuItem, IconMenuItem, PredefinedMenuItem } =
      await import('@tauri-apps/api/menu');

    const items = new Map<MenuItemId, ItemHandle>();
    const buildItem = async (item: { id: MenuItemId; label: string; enabled: boolean }) => {
      // Nothing here names a menu item: Tauri keys click channels by menu id and drops one when that
      // id closes, so a rebuild's old tree would take the new tree's channels. Its own ids are unique.
      const base = {
        text: item.label,
        enabled: item.enabled,
        action: () => latest?.handlers[item.id]?.(),
      };
      const icon = await itemIcon(item.id, d.icons, d.dark);
      const handle = track(icon ? await IconMenuItem.new({ ...base, icon }) : await MenuItem.new(base));
      items.set(item.id, { handle, label: item.label, enabled: item.enabled });
      return handle;
    };

    const sectionsToItems = async (sections: MenuSection[]) => {
      const out = [];
      for (const [i, section] of sections.entries()) {
        if (i > 0) out.push(track(await PredefinedMenuItem.new({ item: 'Separator' })));
        out.push(...(await Promise.all(section.map(buildItem))));
      }
      return out;
    };

    const steps: HistoryStep[] = [];
    for (const [p, s] of d.history.items.entries()) {
      const hstep = await makeStepItem(steps, p, s);
      track(hstep.item);
      steps.push(hstep);
    }
    const clear = track(await MenuItem.new({
      text: d.history.clearLabel,
      enabled: d.history.canClear,
      action: () => latest?.onHistoryClear(),
    }));
    const submenuEnabled = d.history.items.length > 0;
    const submenu = track(await Submenu.new({
      text: d.history.label,
      enabled: submenuEnabled,
      items: [...steps.map((s) => s.item), track(await PredefinedMenuItem.new({ item: 'Separator' })), clear],
    }));
    const hist: HistoryHandles = {
      submenu,
      submenuLabel: d.history.label,
      submenuEnabled,
      clear,
      clearLabel: d.history.clearLabel,
      clearEnabled: d.history.canClear,
      steps,
    };

    const fileSub = track(await Submenu.new({ text: d.submenuLabels.file, items: await sectionsToItems(d.model.file) }));
    // macOS routes clipboard shortcuts through Edit-menu items bound to the
    // standard selectors; without these, Cmd+C/V/X are dead in the webview.
    // Windows/Linux webviews handle those keys natively, so no items there.
    const clipboard = isMacDesktop
      ? [
          track(await PredefinedMenuItem.new({ item: 'Separator' })),
          track(await PredefinedMenuItem.new({ item: 'Cut' })),
          track(await PredefinedMenuItem.new({ item: 'Copy' })),
          track(await PredefinedMenuItem.new({ item: 'Paste' })),
          track(await PredefinedMenuItem.new({ item: 'SelectAll' })),
        ]
      : [];
    const editSub = track(await Submenu.new({
      text: d.submenuLabels.edit,
      items: [
        ...(await sectionsToItems(d.model.edit)),
        ...clipboard,
        track(await PredefinedMenuItem.new({ item: 'Separator' })),
        hist.submenu,
      ],
    }));
    const helpSub = track(await Submenu.new({ text: d.submenuLabels.help, items: await sectionsToItems(d.model.help) }));
    // AppKit renders the FIRST submenu as the application menu, so macOS needs
    // a leading app submenu (standard items + Quit) or File gets swallowed.
    const appSub = isMacDesktop
      ? [track(await Submenu.new({
          text: 'ZPLab',
          items: [
            track(await PredefinedMenuItem.new({ item: { About: null } })),
            track(await PredefinedMenuItem.new({ item: 'Separator' })),
            track(await PredefinedMenuItem.new({ item: 'Services' })),
            track(await PredefinedMenuItem.new({ item: 'Separator' })),
            track(await PredefinedMenuItem.new({ item: 'Hide' })),
            track(await PredefinedMenuItem.new({ item: 'HideOthers' })),
            track(await PredefinedMenuItem.new({ item: 'ShowAll' })),
            track(await PredefinedMenuItem.new({ item: 'Separator' })),
            track(await PredefinedMenuItem.new({ item: 'Quit', text: d.submenuLabels.quit })),
          ],
        }))]
      : [];
    const menu = track(await Menu.new({ items: [...appSub, fileSub, editSub, helpSub] }));

    // A newer update superseded us while we were building: discard rather than
    // swap the menubar, so rapid structure changes flicker once, not twice.
    if (gen !== updateGen) {
      closeAll(created);
      return;
    }
    await menu.setAsAppMenu();
    if (installed) closeAll(installed.resources);
    installed = {
      structureKey,
      resources: created,
      submenus: { file: fileSub, edit: editSub, help: helpSub },
      submenuLabels: { ...d.submenuLabels },
      items,
      history: hist,
    };
  } catch (err) {
    closeAll(created);
    // A failed rebuild leaves any previously installed menu live, so only the
    // first-mount failure strands the desktop: it has no header, and the menu
    // carries open/save/import/settings/print. Surface that one loudly.
    if (!installed) {
      console.error('Native menu init failed', err);
      latest?.onInitError();
    }
  }
}

/** Hot path: patches live handles instead of Menu.new/setAsAppMenu, so nothing
 *  flickers per edit; independent property sets batch into one IPC flush. */
async function patchMenu(inst: InstalledMenu, d: MenuData): Promise<void> {
  const ops: Promise<unknown>[] = [];
  try {
    (['file', 'edit', 'help'] as const).forEach((k) => {
      if (inst.submenuLabels[k] !== d.submenuLabels[k]) {
        ops.push(inst.submenus[k].setText(d.submenuLabels[k]));
        inst.submenuLabels[k] = d.submenuLabels[k];
      }
    });

    for (const item of [...d.model.file.flat(), ...d.model.edit.flat(), ...d.model.help.flat()]) {
      const h = inst.items.get(item.id);
      if (!h) continue;
      if (h.label !== item.label) {
        ops.push(h.handle.setText(item.label));
        h.label = item.label;
      }
      if (h.enabled !== item.enabled) {
        ops.push(h.handle.setEnabled(item.enabled));
        h.enabled = item.enabled;
      }
    }

    const hist = inst.history;
    if (hist.submenuLabel !== d.history.label) {
      ops.push(hist.submenu.setText(d.history.label));
      hist.submenuLabel = d.history.label;
    }
    if (hist.clearLabel !== d.history.clearLabel) {
      ops.push(hist.clear.setText(d.history.clearLabel));
      hist.clearLabel = d.history.clearLabel;
    }
    if (hist.clearEnabled !== d.history.canClear) {
      ops.push(hist.clear.setEnabled(d.history.canClear));
      hist.clearEnabled = d.history.canClear;
    }

    const want = d.history.items;
    const forceCheck = checkmarkDirty;
    checkmarkDirty = false;
    const shared = Math.min(want.length, hist.steps.length);
    for (let p = 0; p < shared; p++) {
      const w = want[p];
      const step = hist.steps[p];
      if (!w || !step) continue;
      // `index` reflects the position's current meaning (the store is already
      // at the new timeline), so a click targets the right step even if two
      // adjacent steps share a label and no setText was queued.
      step.index = w.index;
      if (step.label !== w.label) ops.push(step.item.setText(w.label));
      if (forceCheck || step.current !== w.current) ops.push(step.item.setChecked(w.current));
      if (step.enabled !== w.enabled) ops.push(step.item.setEnabled(w.enabled));
      step.label = w.label;
      step.current = w.current;
      step.enabled = w.enabled;
    }
    await Promise.all(ops);

    if (want.length > hist.steps.length) {
      const grown: TauriCheckMenuItem[] = [];
      for (let p = hist.steps.length; p < want.length; p++) {
        const w = want[p];
        if (!w) continue;
        const hstep = await makeStepItem(hist.steps, p, w);
        grown.push(hstep.item);
        inst.resources.push(hstep.item);
        hist.steps.push(hstep);
      }
      // Steps sit before the trailing [separator, clear]; inserting at the old
      // step count keeps them there without touching the rest.
      await hist.submenu.insert(grown, hist.steps.length - grown.length);
    } else if (want.length < hist.steps.length) {
      for (let p = hist.steps.length - 1; p >= want.length; p--) {
        await hist.submenu.removeAt(p);
        const removed = hist.steps.pop();
        if (removed) {
          const at = inst.resources.indexOf(removed.item);
          if (at >= 0) inst.resources.splice(at, 1);
          closeAll([removed.item]);
        }
      }
    }

    const submenuEnabled = want.length > 0;
    if (hist.submenuEnabled !== submenuEnabled) {
      await hist.submenu.setEnabled(submenuEnabled);
      hist.submenuEnabled = submenuEnabled;
    }
  } catch {
    // Applied-state bookkeeping may be inconsistent now; discard this menu and
    // rebuild from scratch on the very next queued update instead of waiting
    // for the next unrelated signature change.
    if (installed) closeAll(installed.resources);
    installed = null;
    const gen = ++updateGen;
    queue = queue.then(() => runUpdate(gen)).catch(() => undefined);
  }
}

async function runUpdate(gen: number): Promise<void> {
  // Superseded while queued: a newer run behind us reads fresher data.
  if (gen !== updateGen || !latest) return;
  const d = latest;
  const key = menuStructureKey(d.dark, d.model, isMacDesktop ? d.submenuLabels.quit : undefined);
  if (installed && installed.structureKey === key) await patchMenu(installed, d);
  else await rebuildMenu(key, d, gen);
}

/** Desktop only, no-op on web. First build swaps the menubar in; edits then
 *  patch live items in place, because a setAsAppMenu swap flickers and
 *  re-layouts the window on Windows. */
export function useNativeMenu(
  model: MenuModel,
  submenuLabels: SubmenuLabels,
  handlers: MenuHandlers,
  icons: MenuIcons,
  history: HistorySubmenu,
  onHistoryJump: (index: number) => void,
  onHistoryClear: () => void,
  onInitError: () => void,
): void {
  // The OS menu follows the OS theme, not the app theme, so track
  // prefers-color-scheme and rebuild the glyphs when it flips.
  const [dark, setDark] = useState(
    () => isDesktopShell && window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    if (!isDesktopShell) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Refresh the module-wide latest data before the queued update reads it
  // (declared before the update effect, so it runs first each commit).
  useEffect(() => {
    latest = { model, submenuLabels, handlers, icons, history, onHistoryJump, onHistoryClear, onInitError, dark };
  });

  const signature = menuContentSignature(dark, submenuLabels, model, history);

  useEffect(() => {
    if (!isDesktopShell) return;
    const gen = ++updateGen;
    queue = queue.then(() => runUpdate(gen)).catch(() => undefined);
    // Invalidate a queued-but-unstarted update on re-run/unmount (StrictMode
    // remounts included); the re-run queues a fresh one.
    return () => {
      updateGen += 1;
    };
  }, [signature]);
}

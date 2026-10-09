// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { buildMenuModel, type MenuFlags, type HistorySubmenu, type SubmenuLabels } from "../lib/menuModel";
import { fallbackTranslations as en } from "../locales";
import type { MenuHandlers, useNativeMenu as nativeMenuHook } from "./useNativeMenu";

interface MockItem {
  id: string;
  text?: string;
  items?: MockItem[];
  close: () => Promise<void>;
  setAsAppMenu: () => Promise<void>;
}

/** Mirrors tauri 2.12.0: `menu/plugin.rs` keys click channels by menu id, the `Drop` in
 *  `menu/mod.rs` removes one by that id, and `muda` hands out a counter value when no id is given. */
const tauri = vi.hoisted(() => ({
  channels: new Map<string, (id: string) => void>(),
  installed: [] as Record<string, unknown>[],
  closed: [] as string[],
  seq: 0,
}));

vi.mock("../lib/platform", () => ({ isDesktopShell: true, isMacDesktop: false }));

vi.mock("@tauri-apps/api/menu", () => {
  const create = async (opts: Record<string, unknown> = {}) => {
    const id = typeof opts.id === "string" ? opts.id : `auto-${tauri.seq++}`;
    const action = opts.action as ((id: string) => void) | undefined;
    if (action) tauri.channels.set(id, action);
    const item = {
      ...opts,
      id,
      close: async () => {
        tauri.closed.push(id);
        tauri.channels.delete(id);
      },
      setText: async () => undefined,
      setEnabled: async () => undefined,
      setChecked: async () => undefined,
      insert: async () => undefined,
      removeAt: async () => undefined,
      setAsAppMenu: async () => {
        tauri.installed.push(item);
      },
    };
    return item;
  };
  const kind = { new: create };
  return { Menu: kind, Submenu: kind, MenuItem: kind, IconMenuItem: kind, PredefinedMenuItem: kind, CheckMenuItem: kind };
});

const BASE_FLAGS: MenuFlags = {
  hasObjects: true,
  documentEmits: true,
  sourceEditing: false,
  canBatchExport: false,
  batchRowCount: 0,
  connectDataWizard: true,
  canBatchPdf: false,
  pdfCurrentPageOnly: false,
  canUndo: false,
  canRedo: false,
  includeQuit: true,
};
const BATCH_FLAGS: MenuFlags = { ...BASE_FLAGS, canBatchExport: true, batchRowCount: 3 };

const LABELS: SubmenuLabels = { file: "File", edit: "Edit", help: "Help", quit: "Quit" };
const HISTORY: HistorySubmenu = {
  label: "History",
  clearLabel: "Clear history",
  canClear: true,
  items: [
    { index: 0, label: "Add text", current: false, enabled: true },
    { index: 1, label: "Move text", current: true, enabled: true },
  ],
};

const model = (flags: MenuFlags) => buildMenuModel(en, flags);

const spyHandlers = (): MenuHandlers => {
  const out: Partial<MenuHandlers> = {};
  const full = model(BATCH_FLAGS);
  for (const item of [...full.file.flat(), ...full.edit.flat(), ...full.help.flat()]) out[item.id] = vi.fn();
  return out as MenuHandlers;
};

const liveItems = (): MockItem[] => {
  const walk = (items: MockItem[]): MockItem[] => items.flatMap((i) => [i, ...walk(i.items ?? [])]);
  return walk(((tauri.installed.at(-1) as MockItem | undefined)?.items ?? []));
};

/** Fires the click the way Rust does, with the item's own id as the payload. */
const click = (text: string) => {
  const item = liveItems().find((i) => i.text === text);
  expect(item, `item "${text}" on the menubar`).toBeTruthy();
  const channel = tauri.channels.get((item as MockItem).id);
  expect(channel, `click channel of "${text}"`).toBeTruthy();
  (channel as (id: string) => void)((item as MockItem).id);
};

let useNativeMenu: typeof nativeMenuHook;

beforeEach(async () => {
  tauri.channels.clear();
  tauri.installed.length = 0;
  tauri.closed.length = 0;
  tauri.seq = 0;
  // The hook keeps the installed tree in module state, so every case starts with no menu.
  vi.resetModules();
  ({ useNativeMenu } = await import("./useNativeMenu"));
});

/** The swap closes the superseded tree without awaiting it, so a click before that is no proof. */
const swapped = (trees: number) =>
  waitFor(() => {
    expect(tauri.installed).toHaveLength(trees);
    expect(tauri.closed.length).toBeGreaterThan(0);
  });

interface Rebuilt {
  handlers: MenuHandlers;
  onHistoryJump: (index: number) => void;
  onHistoryClear: () => void;
  onInitError: () => void;
}

async function rebuild(next: { flags?: MenuFlags; dark?: boolean }): Promise<Rebuilt> {
  const handlers = spyHandlers();
  const onHistoryJump = vi.fn();
  const onHistoryClear = vi.fn();
  const onInitError = vi.fn();
  const { rerender } = renderHook(
    ({ flags }: { flags: MenuFlags }) =>
      useNativeMenu(model(flags), LABELS, handlers, {}, HISTORY, onHistoryJump, onHistoryClear, onInitError),
    { initialProps: { flags: BASE_FLAGS } },
  );
  await waitFor(() => expect(tauri.installed).toHaveLength(1));
  if (next.dark !== undefined) act(() => setDark(next.dark as boolean));
  rerender({ flags: next.flags ?? BASE_FLAGS });
  await swapped(2);
  expect(onInitError).not.toHaveBeenCalled();
  return { handlers, onHistoryJump, onHistoryClear, onInitError };
}

/** The jsdom stub in the test setup never changes, so the theme needs its own. */
let listeners: (() => void)[] = [];
let darkScheme = false;
function setDark(dark: boolean) {
  darkScheme = dark;
  for (const fire of listeners) fire();
}
beforeEach(() => {
  listeners = [];
  darkScheme = false;
  // The hook reads `matches` off the object it subscribed with, so the flag has to be live on it.
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes("dark") && darkScheme;
    },
    addEventListener: (_: string, fire: () => void) => listeners.push(fire),
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});

describe("useNativeMenu after a rebuild", () => {
  it("keeps every command of the new tree clickable when batch entries change the structure", async () => {
    const { handlers } = await rebuild({ flags: BATCH_FLAGS });

    click(en.app.newDesign);
    click(en.zebraPrint.outputHeading);
    click(en.app.exportBatchZplFmt.replace("{n}", "3"));

    expect(handlers.new).toHaveBeenCalledOnce();
    expect(handlers.output).toHaveBeenCalledOnce();
    expect(handlers.exportBatch).toHaveBeenCalledOnce();
  });

  it("keeps the history submenu clickable too, the steps and the clear entry", async () => {
    const { onHistoryJump, onHistoryClear } = await rebuild({ flags: BATCH_FLAGS });

    // The steps have no id of their own either, so they belong in this guard.
    click("Move text");
    click("Clear history");

    expect(onHistoryJump).toHaveBeenCalledWith(1);
    expect(onHistoryClear).toHaveBeenCalledOnce();
  });

  it("keeps the commands clickable when the OS theme flips", async () => {
    const { handlers } = await rebuild({ dark: true });

    click(en.app.newDesign);
    click(en.zebraPrint.outputHeading);

    expect(handlers.new).toHaveBeenCalledOnce();
    expect(handlers.output).toHaveBeenCalledOnce();
  });
});

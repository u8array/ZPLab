import type { StateCreator } from 'zustand';
import type { Unit } from '@zplab/core/lib/units';
import type { ViewRotation } from '@zplab/core/registry/rotation';
import { fallbackTranslations, loadLocale, type LocaleCode, type Translations } from '../../locales';
import {
  detectLocale,
  detectInitialTheme,
  thirdPartyDefaults,
} from '../labelStore.internals';
import type { LabelState } from '../labelStore';
import { defaultPaletteRows } from '../../registry/paletteTypes';
import { makeCredentialHydrator, setCredential, setLabelaryKeyBound, migrateLabelaryKeyBinding, LABELARY_KEY_CRED } from '../../lib/credentialStore';
import { isDesktopShell } from '../../lib/platform';
import { resolveHost } from '../../lib/labelary';
import { generateMcpToken, stopMcpServer } from '../../lib/mcpServer';
import { selectEffectivePreviewProvider } from '../labelStore.selectors';

import { newId } from "@zplab/core/lib/ids";
/** Credential-store account name for the Labelary API key. */

/** Credential-store account name for the MCP loopback bearer token. */
const MCP_TOKEN_CRED = 'mcp-server-token';

/** Fallback slot for systems without a working credential store: a token
 *  lost on reboot breaks wired-up client configs, which outweighs plaintext
 *  storage THERE. Cleared whenever a keychain write succeeds. */
const MCP_TOKEN_FALLBACK_LS = 'zpl-mcp-token-fallback';

function persistMcpToken(token: string): void {
  void setCredential(MCP_TOKEN_CRED, token)
    .then(() => localStorage.removeItem(MCP_TOKEN_FALLBACK_LS))
    .catch(() => localStorage.setItem(MCP_TOKEN_FALLBACK_LS, token));
}

export interface CanvasSettings {
  showGrid: boolean;
  snapEnabled: boolean;
  snapSizeMm: number;
  /** Object-to-object alignment snapping (guides). On by default; a held
   *  Ctrl/Cmd bypasses it per-gesture (move, resize, line reshape via the
   *  shared useSnapBypassRef), this switch disables it entirely. */
  smartSnapEnabled: boolean;
  zoom: number;
  unit: Unit;
  viewRotation: ViewRotation;
  /** Controls how bound variables render on the canvas.
   *  - 'preview': substitute the active CSV row's cell (falls back to
   *    defaultValue when no row data is available for the variable).
   *  - 'schema': render the placeholder `«variableName»` so the user
   *    sees the field structure regardless of data.
   *  Only meaningful while a `dataset` is loaded; the toolbar
   *  toggle is hidden otherwise. */
  dataRenderMode: 'preview' | 'schema';
}

export type ThemePreference = 'light' | 'dark';

/** Which renderer the label preview asks: Labelary (software approximation)
 *  or the connected printer's own firmware (^IS/^HY, desktop only). */
export type PreviewProvider = 'labelary' | 'printer';

/** Tab IDs for the Printer Settings modal. Adding a tab is a one-line
 *  union extension plus the matching locale-key + content component. */
export type PrinterSettingsTab =
  | 'appSettings'
  | 'previewSettings'
  | 'mcpServer'
  | 'dataSources'
  | 'mediaFeed'
  | 'printQuality'
  | 'output'
  | 'clockTime'
  | 'encodingLanguage'
  | 'fonts'
  | 'identity'
  | 'maintenance';

export type SidebarTab = 'properties' | 'layers' | 'variables' | 'fonts';

/** One favorites row: a single concrete object, identified by its
 *  {@link AddableEntry} id (a registry type or a preset id). `id` is the stable
 *  per-row key drag-reorder needs; `entryId` is the object it spawns/pins. */
export interface PaletteRow {
  id: string;
  entryId: string;
}
export type PaletteView = 'favorites' | 'flat';

/** What a ^FB block's resize handles edit: the wrap frame (blockWidth /
 *  line cap) or the glyphs (font width = stretch / height). Alt+drag flips
 *  it for one drag. Transient editor state; never stored in the design. */
export type BlockDragMode = 'frame' | 'glyph';

/** Reference frame for the "Align" section's toggle. 'selection' = the
 *  selection union bbox, 'key' = the last-selected object (selection order is
 *  preserved, so the key is the final entry of selectedIds). The "Align to
 *  label" section always uses the label rect and so is not part of this union.
 *  Transient editor tool state; never persisted (not in partialize). */
export type AlignSelectionRef = 'selection' | 'key';

export interface UiSlice {
  /** The user's language PREFERENCE (persisted). Can briefly differ from
   *  `loadedLocale` while a chunk loads, or longer when loading failed. */
  locale: LocaleCode;
  /** The locale whose dictionary is actually applied; set atomically with
   *  `translations`. Behavior keyed on language (dir/Intl) belongs here,
   *  not on the preference. */
  loadedLocale: LocaleCode;
  /** Loaded dictionary for `loadedLocale`; seeded with the bundled en
   *  fallback and swapped asynchronously by applyLocale. */
  translations: Translations;
  /** UI theme. Initial value seeded from prefers-color-scheme; once
   *  toggled the explicit choice persists. */
  theme: ThemePreference;
  /** Per-service gates for third-party network calls. Sourced from
   *  build-time env on every load (see thirdPartyDefaults); not
   *  persisted, so env is the single source of truth. */
  thirdParty: { labelary: boolean };
  /** Whether the user has dismissed the one-time Labelary privacy notice. */
  labelaryNoticeAcknowledged: boolean;
  /** Runtime Labelary endpoint override (empty = build env / public default).
   *  Persisted; not sensitive, so it lives in the store like other prefs. */
  labelaryHost: string;
  /** Runtime Labelary API key. NOT persisted to the store's localStorage blob
   *  (that is plaintext on disk); it is held only in memory here and durably in
   *  the OS credential store, hydrated once at startup. Empty until loaded. */
  labelaryApiKey: string;
  /** Guards the startup credential read against a concurrent user save: once
   *  either the hydrate or a save has set the key, a late-resolving hydrate is
   *  a no-op so it can't clobber a freshly saved key. Transient. */
  labelaryApiKeyLoaded: boolean;
  /** Bumped on every key save so the preview cache invalidates even on desktop,
   *  where the key lives only in the keychain and never in this store. */
  labelaryKeyEpoch: number;
  previewProvider: PreviewProvider;
  canvasSettings: CanvasSettings;
  /** Curated object-palette rows ({type, variant} instances, duplicates
   *  allowed) and the palette view mode. Persisted UI preferences, not
   *  undoable; default = one row per type at its default variant. */
  paletteRows: PaletteRow[];
  paletteView: PaletteView;
  /** Curation mode for the type-list: shows remove buttons + "add type" and
   *  turns the grip into a reorder handle (canvas-spawn drag is suspended).
   *  Transient editor state, not persisted. */
  paletteEditing: boolean;
  /** Power-user opt-in: show the emitted ZPL command next to each properties
   *  field. Persisted UI preference; default off so beginners aren't burdened. */
  showZplCommands: boolean;
  /** Desktop-only opt-in for the local MCP loopback server. Off by default so
   *  no port opens unless the user asks; persisted like other prefs. */
  mcpServerEnabled: boolean;
  mcpServerPort: number;
  /** Bearer token for the loopback server, generated on first enable and reused
   *  so an MCP-client config the user already wired up keeps working. Held
   *  in the OS credential store (like the Labelary key), transient here. */
  mcpServerToken: string;
  /** Keychain hydrate happened (or a fresh token was generated/saved). */
  mcpServerTokenLoaded: boolean;
  /** Build capability from mcp_status: whether this build can spawn the MCP
   *  sidecar (false on web and sidecar-less releases). Stamped at boot;
   *  null until the first status lands. Transient. */
  mcpSidecarAvailable: boolean | null;

  /** Right-sidebar tab. Lives in the store so canvas interactions can
   *  drive the panel (e.g. double-click a text field). Transient; not
   *  in partialize so a reload resets to 'properties'. */
  sidebarTab: SidebarTab;
  /** Block resize-handle mode; see BlockDragMode. Transient. */
  blockDragMode: BlockDragMode;
  /** Reference for the "Align" section toggle; see AlignSelectionRef. Transient. */
  alignRef: AlignSelectionRef;
  printerSettingsTab: PrinterSettingsTab | null;
  /** Cross-component trigger for the "send to Zebra" dialog. `null`
   *  keeps the dialog closed. */
  zebraPrintSource: 'label' | 'setupScript' | null;
  /** Barcode object id whose GS1 content builder modal is open; null = closed. */
  gs1BuilderObjectId: string | null;
  /** Object id whose typed-content builder modal is open; null = closed.
   *  Shared by QR and DataMatrix (content is symbology-agnostic). */
  contentBuilderObjectId: string | null;
  /** Object id whose variable-builder modal is open; null = closed. The single
   *  content editor for bindable fields (variables/clock/serial tokens). */
  variableBuilderObjectId: string | null;
  /** One-shot focus request scoped to a single object. The nonce
   *  increments per call so consumers can re-fire even for the same
   *  id; TemplateContentInput's effect compares its own `objectId`
   *  prop to `id` so only the requested editor takes focus. Transient. */
  editorFocusRequest: { id: string; nonce: number } | null;

  setLocale: (locale: LocaleCode) => void;
  /** Single orchestration point for locale loading: fetch (cached) chunk,
   *  latest-wins guard, atomic translations+loadedLocale swap, failure log.
   *  Never rejects; consumed by setLocale and the main.tsx bootstrap. */
  applyLocale: (locale: LocaleCode) => Promise<void>;
  setTheme: (theme: ThemePreference) => void;
  setThirdPartyEnabled: (service: 'labelary', enabled: boolean) => void;
  setPreviewProvider: (provider: PreviewProvider) => void;
  setLabelaryHost: (host: string) => void;
  /** Persist the key to the OS credential store (empty deletes it) and mirror
   *  it in memory. Rejects with the backend's message when the store is
   *  unavailable, so the settings UI can surface the failure. */
  saveLabelaryApiKey: (key: string) => Promise<void>;
  /** Load the key from the credential store once at startup. Idempotent and
   *  race-safe: skips if a save already populated the key. */
  hydrateLabelaryApiKey: () => Promise<void>;
  /** Desktop one-time legacy-key migration; see migrateLabelaryKeyBinding. */
  migrateLabelaryKey: () => Promise<void>;
  acknowledgeLabelaryNotice: () => void;
  revokeLabelaryNotice: () => void;
  /** Reset app preferences (theme, canvas, palette, power-user, Labelary
   *  consent) to defaults. Keeps the current design and the chosen language. */
  resetSettings: () => void;
  setCanvasSettings: (settings: Partial<CanvasSettings>) => void;
  /** Pin/unpin a favorites row by entry id (the search star toggle): adds a row
   *  when absent, removes the matching row(s) when present. */
  togglePaletteRow: (entryId: string) => void;
  removePaletteRow: (index: number) => void;
  /** Move the row with `activeId` to where `overId` sits (drag-reorder). */
  reorderPaletteRows: (activeId: string, overId: string) => void;
  setPaletteView: (view: PaletteView) => void;
  togglePaletteEditing: () => void;
  setShowZplCommands: (show: boolean) => void;
  /** Persist the enable flag; generates a token on first enable so the section
   *  never starts the server tokenless. Does not start/stop the server itself
   *  (that side effect is orchestrated by the useMcpServer hook). */
  setMcpServerEnabled: (enabled: boolean) => void;
  setMcpServerPort: (port: number) => void;
  regenerateMcpToken: () => void;
  /** Load the token from the credential store (single-flight); migrates a
   *  token still sitting in the old localStorage persist on first run. */
  hydrateMcpToken: () => Promise<void>;
  /** The token every server start must use: hydrated, or freshly generated
   *  only when the store is KNOWN empty. */
  ensureMcpToken: () => Promise<string>;
  setMcpSidecarAvailable: (available: boolean) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setBlockDragMode: (mode: BlockDragMode) => void;
  setAlignRef: (ref: AlignSelectionRef) => void;
  setPrinterSettingsTab: (tab: PrinterSettingsTab | null) => void;
  openZebraPrint: (source: 'label' | 'setupScript') => void;
  closeZebraPrint: () => void;
  openGs1Builder: (objectId: string) => void;
  closeGs1Builder: () => void;
  openContentBuilder: (objectId: string) => void;
  closeContentBuilder: () => void;
  openVariableBuilder: (objectId: string) => void;
  closeVariableBuilder: () => void;
  /** Fire a focus request. Does NOT touch the sidebar tab; caller
   *  composes `setSidebarTab('properties')` when the request would
   *  otherwise land on an unmounted editor. */
  requestContentEditorFocus: (id: string) => void;
}

/** Canvas defaults; shared by initial state and `resetSettings` so the two
 *  never drift. Note `resetSettings` deliberately preserves the live
 *  `zoom`/`viewRotation` from these defaults (see there). */
export const DEFAULT_CANVAS_SETTINGS: CanvasSettings = {
  showGrid: false,
  snapEnabled: false,
  snapSizeMm: 1,
  smartSnapEnabled: true,
  zoom: 1,
  unit: 'mm',
  viewRotation: 0,
  dataRenderMode: 'preview',
};

type UiPrefs = Pick<
  UiSlice,
  | 'theme'
  | 'thirdParty'
  | 'labelaryNoticeAcknowledged'
  | 'previewProvider'
  | 'canvasSettings'
  | 'paletteRows'
  | 'paletteView'
  | 'paletteEditing'
  | 'showZplCommands'
  | 'mcpServerEnabled'
  | 'mcpServerPort'
>;

/** Default port for the MCP loopback server. High and IANA-unassigned, so it
 *  is unlikely to collide with a service already bound on the loopback. */
export const DEFAULT_MCP_PORT = 4923;

/** Defaults `resetSettings` restores. Shared with initial state so the `Pick`
 *  turns a forgotten entry into a compile error. Excludes `locale` (reset keeps
 *  the language). */
function defaultUiPrefs(): UiPrefs {
  return {
    theme: detectInitialTheme(),
    thirdParty: thirdPartyDefaults(),
    labelaryNoticeAcknowledged: false,
    previewProvider: 'labelary',
    canvasSettings: { ...DEFAULT_CANVAS_SETTINGS },
    paletteRows: defaultPaletteRows(),
    paletteView: 'flat',
    paletteEditing: false,
    showZplCommands: false,
    mcpServerEnabled: false,
    mcpServerPort: DEFAULT_MCP_PORT,
  };
}

export const createUiSlice: StateCreator<LabelState, [], [], UiSlice> = (set, get) => ({
  locale: detectLocale(),
  loadedLocale: 'en',
  translations: fallbackTranslations,
  ...defaultUiPrefs(),
  // Endpoint config is persisted but out of `defaultUiPrefs`, so a settings
  // reset leaves it untouched (resetting the host without the keychain-held
  // key would send a premium key to the public host). Key is transient here,
  // hydrated from the credential store at startup.
  labelaryHost: '',
  labelaryApiKey: '',
  labelaryApiKeyLoaded: false,
  labelaryKeyEpoch: 0,
  // Keychain-held like the Labelary key; a settings reset keeps it.
  mcpServerToken: '',
  mcpServerTokenLoaded: false,
  mcpSidecarAvailable: null,
  sidebarTab: 'properties',
  blockDragMode: 'frame',
  alignRef: 'selection',
  printerSettingsTab: null,
  zebraPrintSource: null,
  gs1BuilderObjectId: null,
  contentBuilderObjectId: null,
  variableBuilderObjectId: null,
  editorFocusRequest: null,

  setLocale: (locale) => {
    // Async swap: the previous language stays visible for the chunk's load
    // time; `locale` records the preference immediately.
    set({ locale });
    void get().applyLocale(locale);
  },
  applyLocale: async (locale) => {
    try {
      const translations = await loadLocale(locale);
      // Locale may have changed again meanwhile; only the latest wins.
      if (get().locale === locale) set({ translations, loadedLocale: locale });
    } catch (err) {
      // Failed fetch (e.g. offline switch, broken deploy): the previous
      // dictionary stays active and loadedLocale keeps showing that.
      console.warn(`locale chunk for "${locale}" failed to load`, err);
    }
  },
  setTheme: (theme) => set({ theme }),
  setThirdPartyEnabled: (service, enabled) =>
    set((state) => ({ thirdParty: { ...state.thirdParty, [service]: enabled } })),
  // Tear down a live overlay on switch so one provider's render can't linger
  // while the toggle already names the other.
  setPreviewProvider: (provider) => {
    set({ previewProvider: provider });
    get().exitPreviewMode();
  },
  // Changing the effective endpoint tears down a live LABELARY overlay, like
  // the sibling endpoint actions, so a render from the old host/key can't
  // linger. A printer render is independent of the host/key, so leave it.
  setLabelaryHost: (host) => {
    const next = host.trim();
    if (next === get().labelaryHost) return;
    set({ labelaryHost: next });
    if (selectEffectivePreviewProvider(get()) === 'labelary') get().exitPreviewMode();
  },
  saveLabelaryApiKey: async (key) => {
    const trimmed = key.trim();
    const bumpEpoch = () => set((s) => ({ labelaryKeyEpoch: s.labelaryKeyEpoch + 1 }));
    // Throws on an unavailable store; caller surfaces it.
    if (isDesktopShell) {
      // Desktop never mirrors the key into this store; the proxy reads it from
      // the keychain (see preview.rs).
      await setLabelaryKeyBound(resolveHost(get().labelaryHost), trimmed);
    } else {
      await setCredential(LABELARY_KEY_CRED, trimmed);
      set({ labelaryApiKey: trimmed, labelaryApiKeyLoaded: true });
    }
    bumpEpoch();
    if (selectEffectivePreviewProvider(get()) === 'labelary') get().exitPreviewMode();
  },
  // Desktop keeps the key out of the webview entirely (the proxy reads it from
  // the keychain), so hydrate only marks loaded there; the web build reads it.
  // Losing the key is harmless (the user re-enters it), so there is no fallback.
  hydrateLabelaryApiKey: isDesktopShell
    ? async () => set({ labelaryApiKeyLoaded: true })
    : makeCredentialHydrator({
        credName: LABELARY_KEY_CRED,
        isLoaded: () => get().labelaryApiKeyLoaded,
        onStored: (key) => set({ labelaryApiKey: key.trim(), labelaryApiKeyLoaded: true }),
        onEmpty: () => set({ labelaryApiKey: '', labelaryApiKeyLoaded: true }),
        onError: () => undefined,
      }),
  migrateLabelaryKey: async () => {
    if (isDesktopShell) await migrateLabelaryKeyBinding(resolveHost(get().labelaryHost));
  },
  acknowledgeLabelaryNotice: () => set({ labelaryNoticeAcknowledged: true }),
  // Revoke consent so the Labelary gate closes again; re-enabling re-shows the
  // disclosure, keeping consent explicit and reversible. Tear down any live
  // preview so a Labelary-rendered overlay can't linger after consent is gone.
  revokeLabelaryNotice: () => {
    set({ labelaryNoticeAcknowledged: false });
    get().exitPreviewMode();
  },
  // Scoped reset: prefs to defaults, design and language untouched. Not a
  // localStorage nuke, so it works the same in the browser and a Tauri build.
  // Keeps live view state (zoom/rotation): the fit-to-view is a one-shot at
  // mount, so resetting zoom would strand the canvas at 100% with no re-fit.
  resetSettings: () => {
    set((state) => {
      const prefs = defaultUiPrefs();
      return {
        ...prefs,
        canvasSettings: {
          ...prefs.canvasSettings,
          zoom: state.canvasSettings.zoom,
          viewRotation: state.canvasSettings.viewRotation,
        },
      };
    });
    // Reset drops Labelary consent; end any live preview so it doesn't linger.
    get().exitPreviewMode();
    // Reset also drops the MCP opt-in; a running sidecar must not outlive it.
    // stopMcpServer no-ops in the web build; catch only guards a real invoke failure.
    void stopMcpServer().catch(() => undefined);
  },
  setCanvasSettings: (settings) =>
    set((state) => ({ canvasSettings: { ...state.canvasSettings, ...settings } })),
  togglePaletteRow: (entryId) =>
    set((state) => {
      if (state.paletteRows.some((r) => r.entryId === entryId)) {
        return { paletteRows: state.paletteRows.filter((r) => r.entryId !== entryId) };
      }
      const id = `${entryId}-${newId().slice(0, 8)}`;
      return { paletteRows: [...state.paletteRows, { id, entryId }] };
    }),
  removePaletteRow: (index) =>
    set((state) => ({ paletteRows: state.paletteRows.filter((_, i) => i !== index) })),
  reorderPaletteRows: (activeId, overId) =>
    set((state) => {
      const from = state.paletteRows.findIndex((r) => r.id === activeId);
      const to = state.paletteRows.findIndex((r) => r.id === overId);
      if (from < 0 || to < 0 || from === to) return {};
      const rows = state.paletteRows.slice();
      const [moved] = rows.splice(from, 1);
      if (!moved) return {};
      rows.splice(to, 0, moved);
      return { paletteRows: rows };
    }),
  setPaletteView: (view) => set({ paletteView: view }),
  togglePaletteEditing: () => set((state) => ({ paletteEditing: !state.paletteEditing })),
  setShowZplCommands: (show) => set({ showZplCommands: show }),
  setMcpServerEnabled: (enabled) => set({ mcpServerEnabled: enabled }),
  setMcpServerPort: (port) => set({ mcpServerPort: port }),
  regenerateMcpToken: () => {
    const token = generateMcpToken();
    persistMcpToken(token);
    set({ mcpServerToken: token, mcpServerTokenLoaded: true });
  },
  ensureMcpToken: async () => {
    await get().hydrateMcpToken();
    const existing = get().mcpServerToken;
    if (existing) return existing;
    // Still unloaded = the read FAILED, not known-empty: minting now could
    // clobber the stored token wired-up client configs point at.
    if (!get().mcpServerTokenLoaded) throw new Error('credential store unavailable');
    const token = generateMcpToken();
    persistMcpToken(token);
    set({ mcpServerToken: token, mcpServerTokenLoaded: true });
    return token;
  },
  hydrateMcpToken: makeCredentialHydrator({
    credName: MCP_TOKEN_CRED,
    isLoaded: () => get().mcpServerTokenLoaded,
    onStored: (token) => {
      localStorage.removeItem(MCP_TOKEN_FALLBACK_LS);
      set({ mcpServerToken: token.trim(), mcpServerTokenLoaded: true });
    },
    onEmpty: () => {
      // Adopt the broken-store fallback or the pre-keychain persist (migration).
      const legacy = localStorage.getItem(MCP_TOKEN_FALLBACK_LS) ?? get().mcpServerToken;
      if (legacy) {
        persistMcpToken(legacy);
        set({ mcpServerToken: legacy, mcpServerTokenLoaded: true });
      } else {
        set({ mcpServerTokenLoaded: true });
      }
    },
    onError: () => {
      // The fallback slot is the truth on broken-store systems; without one
      // stay unloaded so a transient failure retries instead of minting.
      const fallback = localStorage.getItem(MCP_TOKEN_FALLBACK_LS);
      if (fallback) set({ mcpServerToken: fallback, mcpServerTokenLoaded: true });
    },
  }),
  setMcpSidecarAvailable: (available) => set({ mcpSidecarAvailable: available }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setBlockDragMode: (mode) => set({ blockDragMode: mode }),
  setAlignRef: (ref) => set({ alignRef: ref }),
  setPrinterSettingsTab: (tab) => set({ printerSettingsTab: tab }),
  openZebraPrint: (source) => set({ zebraPrintSource: source }),
  closeZebraPrint: () => set({ zebraPrintSource: null }),
  openGs1Builder: (objectId) => set({ gs1BuilderObjectId: objectId }),
  closeGs1Builder: () => set({ gs1BuilderObjectId: null }),
  openContentBuilder: (objectId) => set({ contentBuilderObjectId: objectId }),
  closeContentBuilder: () => set({ contentBuilderObjectId: null }),
  openVariableBuilder: (objectId) => set({ variableBuilderObjectId: objectId }),
  closeVariableBuilder: () => set({ variableBuilderObjectId: null }),
  requestContentEditorFocus: (id) =>
    set((state) => ({
      editorFocusRequest: {
        id,
        nonce: (state.editorFocusRequest?.nonce ?? 0) + 1,
      },
    })),
});

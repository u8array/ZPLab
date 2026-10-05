import { useEffect, useId, useRef, useState, type FocusEvent } from 'react';
import { PlusIcon, TrashIcon, InformationCircleIcon } from '@heroicons/react/16/solid';
import {
  hasFontBytes,
  loadFontBytes,
  removeFont,
  getFontFamily,
  isEmbedLarge,
  cachedFontPath,
} from '@zplab/core/lib/fontCache';
import { useCachedFonts } from '../../hooks/useCachedFonts';
import { useLabelStore, useFileDeletability, forgetHistoryUsing, type DeleteBlock } from '../../store/labelStore';
import { useT } from '../../hooks/useT';
import { useUpload } from '../../hooks/useUpload';
import { isDesktopShell } from '../../lib/platform';
import { listSystemFonts, readSystemFont, type SystemFont } from '../../lib/systemFonts';
import { storageKey, storageRefMatchesPath } from '@zplab/core/lib/storagePath';
import { listsStoredFont } from '@zplab/core/lib/storedObjects';
import {
  ZPL_DRIVE_PREFIXES,
  isBuiltinFontId,
  nextFreeAlias,
  normalizeAlias,
  prepareFontBytes,
  prepareFontUpload,
  type FontNameIssue,
  upsertCustomFontMapping,
} from '@zplab/core/lib/customFonts';
import { inputCls, labelCls } from '../Properties/styles';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Tooltip } from '../ui/Tooltip';
import type { CustomFontMapping } from '@zplab/core/types/LabelConfig';
import { applyFontDelivery, fontDelivery, type ResourceDelivery } from '@zplab/core/lib/resourceDelivery';
import { DeliverySelect } from '../Properties/DeliverySelect';
const PATHS_DATALIST_ID = 'zpl-custom-font-paths';

const addBtnCls =
  'flex items-center gap-1.5 px-2 py-1.5 rounded text-xs font-mono border border-dashed border-border text-muted hover:text-text hover:border-border-2 transition-colors';

export function FontManager() {
  const t = useT();
  const fonts = useCachedFonts();
  const customFonts = useLabelStore((s) => s.label.customFonts);
  const setLabelConfig = useLabelStore((s) => s.setLabelConfig);
  const setupFonts = useLabelStore((s) => s.printerProfile.setupFonts);
  const patchPrinterProfile = useLabelStore((s) => s.patchPrinterProfile);
  const fileDeletability = useFileDeletability();
  const deletability = (path: string) => fileDeletability('fonts', storageKey(path));

  const [adding, setAdding] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const deleteMessage = (steps: number) =>
    steps === 0 ? t.fonts.deleteConfirm : `${t.fonts.deleteConfirm} ${steps === 1 ? t.fonts.deleteHistoryOne : t.fonts.deleteHistoryManyFmt.replace('{n}', String(steps))}`;

  const uploadedPaths = fonts.map(cachedFontPath);

  // A fresh manual row carries an empty path while the user types, so only `path === undefined`
  // separates a legacy canvas-only binding from one.
  const manualMappings: { entry: CustomFontMapping; index: number }[] = [];
  (customFonts ?? []).forEach((m, index) => {
    if (m.path === undefined) return;
    // Same rule the import binds by, so a row never appears twice under two spellings of one path.
    const uploaded = uploadedPaths.some((p) => storageRefMatchesPath(m.path as string, p));
    if (!uploaded) manualMappings.push({ entry: m, index });
  });
  const entryForPath = (path: string) => (customFonts ?? []).find((m) => m.path && storageRefMatchesPath(m.path, path));

  const aliasCounts = new Map<string, number>();
  for (const m of customFonts ?? []) {
    if (m.alias) aliasCounts.set(m.alias, (aliasCounts.get(m.alias) ?? 0) + 1);
  }
  const isDuplicateAlias = (alias: string) =>
    !!alias && (aliasCounts.get(alias) ?? 0) > 1;

  const replaceList = (next: CustomFontMapping[]) => {
    setLabelConfig({ customFonts: next.length > 0 ? next : undefined });
  };

  const setAliasForPath = (path: string, rawAlias: string) => {
    const alias = normalizeAlias(rawAlias);
    replaceList(upsertCustomFontMapping(customFonts, path, alias));
  };

  const deliverPath = (path: string, next: ResourceDelivery) => {
    const result = applyFontDelivery(next, entryForPath(path), path, setupFonts);
    if (result.setupFonts !== setupFonts && !patchPrinterProfile({ setupFonts: result.setupFonts ? [...result.setupFonts] : undefined })) return;
    if (!result.patch) return;
    const list = customFonts ?? [];
    replaceList(
      list.map((m) =>
        m.path !== undefined && storageRefMatchesPath(m.path, path)
          ? { ...m, ...result.patch }
          : m,
      ),
    );
  };

  const updateManualAt = (
    index: number,
    patch: Partial<CustomFontMapping>,
  ) => {
    const list = customFonts ?? [];
    replaceList(
      list.map((m, i) =>
        i === index
          ? {
              ...m,
              alias:
                patch.alias !== undefined
                  ? normalizeAlias(patch.alias)
                  : m.alias,
              path: patch.path ?? m.path,
            }
          : m,
      ),
    );
  };

  const removeAt = (index: number) => {
    replaceList((customFonts ?? []).filter((_, i) => i !== index));
  };

  const addManual = () => {
    // Suggest the next free letter from the I-Z 1-9 range so the user
    // does not accidentally override a built-in Zebra font letter. They
    // can still type any letter manually if they want the override.
    const taken = (customFonts ?? []).map((m) => m.alias).filter(Boolean);
    replaceList([
      ...(customFonts ?? []),
      { alias: nextFreeAlias(taken), path: '' },
    ]);
  };

  return (
    <div className="p-3 flex flex-col gap-3">
      <p className="font-mono text-[10px] font-medium text-muted uppercase tracking-widest px-1 pt-1">
        {t.fonts.heading}
      </p>

      {fonts.length === 0 && !adding && (
        <p className="text-xs text-muted px-1">{t.fonts.noFonts}</p>
      )}

      <div className="flex flex-col gap-1">
        {fonts.map((font) => {
          const path = cachedFontPath(font);
          const entry = entryForPath(path);
          const alias = entry?.alias ?? '';
          return (
            <FontEntry
              key={path}
              name={path}
              alias={alias}
              duplicate={isDuplicateAlias(alias)}
              delivery={fontDelivery(entry, path, setupFonts)}
              embedLarge={isEmbedLarge(path)}
              previewMissing={!getFontFamily(path)}
              blockedBy={deletability(path).blockedBy}
              listed={listsStoredFont(path, setupFonts)}
              onAliasChange={(v) => setAliasForPath(path, v)}
              onDeliveryChange={(v) => deliverPath(path, v)}
              onRequestDelete={() => setPendingDelete(path)}
            />
          );
        })}
      </div>

      {adding ? (
        <AddFontForm
          onDone={(uploadedPath) => {
            // Auto-assign the next free alias when the upload succeeds.
            // Closes the "what now?" gap between the upload finishing
            // and the delivery select becoming usable: the user lands on
            // a row that is already wired through to ^CW + canvas, with
            // an editable alias if they want to override the default.
            if (uploadedPath) {
              const path = uploadedPath;
              const taken = (customFonts ?? [])
                .map((m) => m.alias)
                .filter(Boolean);
              const alias = nextFreeAlias(taken);
              if (alias) setAliasForPath(path, alias);
            }
            setAdding(false);
          }}
        />
      ) : (
        <button type="button" className={addBtnCls} onClick={() => setAdding(true)}>
          <span className="text-accent">+</span>
          {t.fonts.addFont}
        </button>
      )}

      <CollapsibleSection
        id="fonts-printer-resident"
        title={t.fonts.manualMappingsHeading}
        defaultOpen={manualMappings.length > 0}
      >
        <ManualMappingsSection
          rows={manualMappings}
          hint={t.fonts.manualMappingsHint}
          addLabel={t.fonts.addManualMapping}
          isDuplicateAlias={isDuplicateAlias}
          onUpdate={updateManualAt}
          onRemove={removeAt}
          onAdd={addManual}
        />
      </CollapsibleSection>

      <datalist id={PATHS_DATALIST_ID}>
        {ZPL_DRIVE_PREFIXES.map((p) => (
          <option key={p} value={p} />
        ))}
        {uploadedPaths.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      {pendingDelete !== null && (
        <ConfirmDialog
          message={deleteMessage(deletability(pendingDelete).historySteps)}
          confirmLabel={t.fonts.delete}
          cancelLabel={t.app.cancel}
          destructive
          onConfirm={() => {
            if (deletability(pendingDelete).blockedBy === undefined) {
              forgetHistoryUsing('fonts', storageKey(pendingDelete));
              removeFont(pendingDelete);
            }
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

// ── FontEntry ──────────────────────────────────────────────────────────────────

interface FontEntryProps {
  name: string;
  alias: string;
  duplicate: boolean;
  delivery: ResourceDelivery;
  /** Font is large; embedding still works but warns (bigger job, slower view). */
  embedLarge: boolean;
  /** Bytes are cached, but no browser face draws them. */
  previewMissing: boolean;
  blockedBy: DeleteBlock | undefined;
  listed: boolean;
  onAliasChange: (next: string) => void;
  onDeliveryChange: (next: ResourceDelivery) => void;
  onRequestDelete: () => void;
}

function FontEntry({
  name,
  alias,
  duplicate,
  delivery,
  embedLarge,
  previewMissing,
  blockedBy,
  listed,
  onAliasChange,
  onDeliveryChange,
  onRequestDelete,
}: FontEntryProps) {
  const t = useT();
  const openObjects = useLabelStore((s) => s.setPrinterSettingsTab);
  // ~DY without a matching ^CW would dump bytes onto the printer that no field can reference.
  const jobBlocked = alias ? undefined : t.delivery.jobNeedsAlias;
  // Heads-up when the user picks a built-in letter (0, A-H): ^CW with
  // a built-in alias overrides the factory font on the printer. That is
  // the intended way to both override and preview a built-in here, but
  // the consequence is worth flagging.
  const overridesBuiltin = isBuiltinFontId(alias);

  return (
    <div className="flex flex-col gap-0.5 px-2 py-1.5 rounded border border-transparent hover:border-border-2 hover:bg-surface-2 transition-colors">
      <div className="grid grid-cols-[1fr_3rem_auto] items-center gap-2">
        <span
          className="font-mono text-xs text-text truncate"
          title={name}
        >
          {name}
        </span>
        <Tooltip
          className="w-full"
          content={
            duplicate
              ? t.label.customFontsDuplicateAlias
              : alias
                ? t.fonts.aliasAssigned
                : t.fonts.aliasHint
          }
        >
          <input
            type="text"
            className={`${inputCls} text-center ${
              duplicate
                ? '!border-red-500'
                : overridesBuiltin
                  ? '!border-amber-500'
                  : ''
            }`}
            maxLength={1}
            placeholder="A-Z"
            aria-invalid={duplicate || undefined}
            value={alias}
            onChange={(e) => onAliasChange(e.target.value)}
          />
        </Tooltip>
        <Tooltip content={blockedBy ? ({ document: t.fonts.inUse, profile: t.fonts.inProfile, restore: t.fonts.inRestore, clipboard: t.fonts.inClipboard, frozen: t.printerSettings.frozenHint } satisfies Record<DeleteBlock, string>)[blockedBy] : t.fonts.delete}>
          <button
            type="button"
            onClick={onRequestDelete}
            disabled={blockedBy !== undefined}
            className="p-1 text-muted hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label={t.fonts.delete}
          >
            <TrashIcon className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      </div>
      <DeliverySelect
        resource="font"
        subject={name}
        value={delivery}
        onChange={onDeliveryChange}
        blocked={jobBlocked === undefined ? undefined : { job: jobBlocked }}
        manage={listed ? { label: t.delivery.manageObjects, open: () => openObjects('storedFonts') } : undefined}
      />
      {overridesBuiltin && (
        <p className="text-[10px] text-amber-500 leading-snug pl-1">
          {t.fonts.builtinAliasWarning}
        </p>
      )}
      {previewMissing && (
        <p className="text-[10px] font-mono text-warning">{t.fonts.faceRejected}</p>
      )}
      {embedLarge && delivery === 'job' && (
        <p className="text-[10px] text-amber-500 leading-snug pl-1">
          {t.fonts.embedLargeWarning}
        </p>
      )}
    </div>
  );
}

// ── ManualMappingsSection ──────────────────────────────────────────────────────

interface ManualMappingsSectionProps {
  rows: { entry: CustomFontMapping; index: number }[];
  hint: string;
  addLabel: string;
  isDuplicateAlias: (alias: string) => boolean;
  /** `index` refers to the row's position in the full `customFonts`
   *  list (not in this section's subset) so the parent updates the
   *  correct entry even when two rows transiently share an empty path. */
  onUpdate: (index: number, patch: Partial<CustomFontMapping>) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
}

function ManualMappingsSection({
  rows,
  hint,
  addLabel,
  isDuplicateAlias,
  onUpdate,
  onRemove,
  onAdd,
}: ManualMappingsSectionProps) {
  const t = useT();
  // Auto-remove rows whose alias AND path are both empty when focus
  // actually leaves the row container. requestAnimationFrame defers
  // the check until the new focus has landed, then we confirm the row
  // no longer contains it; tabbing between the row's own inputs does
  // not count as "leaving".
  const handleBlur = (
    e: FocusEvent<HTMLDivElement>,
    index: number,
    path: string,
    alias: string,
  ) => {
    const row = e.currentTarget;
    requestAnimationFrame(() => {
      if (!alias && !path && !row.contains(document.activeElement)) {
        onRemove(index);
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {rows.map(({ entry: m, index }) => {
        const dup = isDuplicateAlias(m.alias);
        const path = m.path ?? '';
        return (
          <div
            key={index}
            className="grid grid-cols-[3rem_1fr_auto] gap-2 items-center"
            onBlur={(e) => handleBlur(e, index, path, m.alias)}
          >
            <Tooltip
              className="w-full"
              content={
                dup
                  ? t.label.customFontsDuplicateAlias
                  : t.label.customFontsAliasHint
              }
            >
              <input
                type="text"
                className={`${inputCls} text-center ${dup ? '!border-red-500' : ''}`}
                maxLength={1}
                placeholder="A-Z"
                aria-invalid={dup || undefined}
                value={m.alias}
                onChange={(e) => onUpdate(index, { alias: e.target.value })}
              />
            </Tooltip>
            <input
              type="text"
              className={inputCls}
              list={PATHS_DATALIST_ID}
              placeholder={t.label.customFontsPath}
              value={path}
              onChange={(e) => onUpdate(index, { path: e.target.value })}
            />
            <button
              type="button"
              className="p-1 text-muted hover:text-text"
              onClick={() => onRemove(index)}
              aria-label={t.label.customFontsRemove}
            >
              <TrashIcon className="w-3.5 h-3.5" />
            </button>
            {m.embedInZpl && !hasFontBytes(path) && (
              <p className="col-span-3 text-[10px] text-warning">{t.printerSettings.fonts.missingBytes}</p>
            )}
          </div>
        );
      })}
      <div className="flex items-center gap-1.5">
        <button type="button" className={addBtnCls} onClick={onAdd}>
          <PlusIcon className="w-3 h-3 text-accent" />
          {addLabel}
        </button>
        <Tooltip content={hint}>
          <button type="button" aria-label={hint} className="shrink-0 text-muted/60 hover:text-text cursor-help">
            <InformationCircleIcon className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

// ── AddFontForm ────────────────────────────────────────────────────────────────

interface AddFontFormProps {
  /** `uploadedPath` is the stored printer path on success, undefined on cancel or failure. */
  onDone: (uploadedPath?: string) => void;
}

function AddFontForm({ onDone }: AddFontFormProps) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [fromComputer, setFromComputer] = useState(false);
  const listId = useId();
  // One run for both sources, so every control stays locked while a pick is still landing.
  const { busy: uploading, issue: uploadIssue, start: uploadFile } = useUpload<'error' | FontNameIssue, File | SystemFont>(async (input) => {
    // Nothing typed means the picked file's own name, which is almost always the intended one.
    const prepared =
      input instanceof File ? await prepareFontUpload(input, name) : prepareFontBytes(input.file_name, await readSystemFont(input.path), name);
    if (!prepared.ok) return prepared.reason === 'notAFont' ? 'error' : prepared.reason;
    await loadFontBytes(prepared.bytes, prepared.path);
    onDone(prepared.path);
    return null;
  }, 'error');

  return (
    <div className="flex flex-col gap-2 p-2 rounded border border-border bg-surface-2">
      <div className="flex flex-col gap-1">
        <label className={labelCls}>{t.fonts.printerFilename}</label>
        <input
          className={inputCls}
          value={name}
          placeholder={t.fonts.printerFilenamePlaceholder}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".ttf,.otf,.tte,.TTF,.OTF,.TTE"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadFile(file);
          e.target.value = '';
        }}
      />

      {uploadIssue && (
        <p className="text-[10px] font-mono text-red-400">{{ error: t.fonts.uploadError, nameTaken: t.fonts.nameTaken, nameUnusable: t.fonts.nameUnusable }[uploadIssue]}</p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          className="flex-1 px-2 py-1.5 rounded text-xs font-mono bg-accent text-bg hover:opacity-90 disabled:opacity-40 transition-opacity"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? '…' : t.fonts.upload}
        </button>
        {isDesktopShell && (
          <button
            type="button"
            className="px-2 py-1.5 rounded text-xs font-mono border border-border text-muted hover:text-text transition-colors"
            onClick={() => setFromComputer((v) => !v)}
            disabled={uploading}
            aria-expanded={fromComputer}
            aria-controls={fromComputer ? listId : undefined}
          >
            {t.fonts.fromComputer}
          </button>
        )}
        <button
          type="button"
          className="px-2 py-1.5 rounded text-xs font-mono border border-border text-muted hover:text-text transition-colors"
          onClick={() => onDone()}
          disabled={uploading}
        >
          {t.fonts.cancel}
        </button>
      </div>

      {fromComputer && <SystemFontList listId={listId} busy={uploading} onPick={uploadFile} />}
    </div>
  );
}

// ── SystemFontList ─────────────────────────────────────────────────────────────

function SystemFontList({ listId, busy, onPick }: { listId: string; busy: boolean; onPick: (font: SystemFont) => void }) {
  const t = useT();
  const [fonts, setFonts] = useState<SystemFont[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => {
    let current = true;
    listSystemFonts().then(
      (list) => current && setFonts(list),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, []);
  const shown = (fonts ?? []).filter((f) => `${f.family} ${f.style}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="flex flex-col gap-1">
      <input className={inputCls} value={query} placeholder={t.fonts.filterFonts} onChange={(e) => setQuery(e.target.value)} aria-label={t.fonts.filterFonts} />
      {fonts === null && !failed && <p className="text-[10px] text-muted">…</p>}
      {fonts !== null && fonts.length === 0 && <p className="text-[10px] text-muted">{t.fonts.noSystemFonts}</p>}
      {fonts !== null && fonts.length > 0 && shown.length === 0 && <p className="text-[10px] text-muted">{t.fonts.noFilterMatch}</p>}
      {failed && <p className="text-[10px] font-mono text-red-400">{t.fonts.systemFontsFailed}</p>}
      <ul id={listId} className="max-h-48 overflow-auto rounded border border-border text-xs" aria-label={t.fonts.fromComputer}>
        {shown.map((font) => (
          <li key={font.path}>
            {/* aria-disabled, not disabled: a greyed row must stay reachable, so its reason can be read. */}
            <button
              type="button"
              className="flex w-full items-baseline gap-2 px-2 py-1 text-left hover:bg-border/60 aria-disabled:opacity-40 aria-disabled:hover:bg-transparent"
              onClick={() => {
                if (!busy && !font.restricted) onPick(font);
              }}
              aria-disabled={busy || font.restricted}
              title={font.restricted ? t.fonts.restrictedLicense : font.variable ? t.fonts.variableFont : undefined}
            >
              <span className="text-text truncate">{font.family}</span>
              <span className="text-muted truncate">{font.style}</span>
              <span className="ml-auto font-mono text-[10px] text-muted shrink-0">{Math.ceil(font.bytes / 1024)} KB</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

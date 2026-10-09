import { useEffect, useId, useRef, useState } from 'react';
import { XMarkIcon } from '@heroicons/react/16/solid';
import { FONT_FILE_ACCEPT } from '@zplab/core/lib/fontCache';
import { prepareFontBytes, prepareFontUpload, printerFontFileName, type FontNameIssue } from '@zplab/core/lib/customFonts';
import { useT } from '../../hooks/useT';
import { useUpload } from '../../hooks/useUpload';
import { isDesktopShell } from '../../lib/platform';
import { systemFontFaceStyle } from '../../lib/fontFaceStyle';
import { fontNameIssueText } from '../../lib/fontNameIssueText';
import { listSystemFonts, readSystemFont, type SystemFont } from '../../lib/systemFonts';
import { ariaDisabledCls, inputCls, labelCls } from '../ui/formStyles';
import { DialogShell } from '../ui/DialogShell';

interface AddFontDialogProps {
  /** The picked bytes, undefined when the dialog closes without adding. The caller caches them, so it
   *  can still refuse a name this dialog has no way to know is taken. */
  onDone: (picked?: { path: string; bytes: Uint8Array }) => void;
  /** The file a stale profile entry waits for. Its name is fixed, because any other name repairs nothing. */
  repairPath?: string;
}

/** Picked but not yet cached. The gate runs on Add, so a rejected name stays editable. */
type FontCandidate = File | SystemFont;

const candidateFileName = (candidate: FontCandidate) => (candidate instanceof File ? candidate.name : candidate.file_name);

/** aria-disabled, not disabled: a locked control keeps focus, so the dialog's own key handler still sees Escape. */
const lockedBtnCls = `px-3 py-1.5 rounded text-xs font-mono transition-colors ${ariaDisabledCls}`;
const secondaryBtnCls = `${lockedBtnCls} whitespace-nowrap border`;

/** Modal because the installed-fonts list needs more room than the sidebar gives. */
export function AddFontDialog({ onDone, repairPath }: AddFontDialogProps) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  // Closing abandons a pending read, so its result must not reach the cache.
  const aborted = useRef(false);
  const [candidate, setCandidate] = useState<FontCandidate | null>(null);
  const [name, setName] = useState(repairPath ?? '');
  const titleId = useId();
  const listLabelId = useId();
  const issueId = useId();
  const { busy, issue, start: addFont } = useUpload<'error' | FontNameIssue, FontCandidate>(async (input) => {
    const prepared =
      input instanceof File ? await prepareFontUpload(input, name) : prepareFontBytes(input.file_name, await readSystemFont(input.path), name);
    if (aborted.current) return null;
    if (!prepared.ok) return prepared.reason === 'notAFont' ? 'error' : prepared.reason;
    onDone({ path: prepared.path, bytes: prepared.bytes });
    return null;
  }, 'error');

  const select = (next: FontCandidate) => {
    setCandidate(next);
    if (repairPath) return;
    const fileName = candidateFileName(next);
    setName(printerFontFileName(fileName) ?? fileName);
  };

  const close = () => {
    aborted.current = true;
    onDone();
  };

  const canAdd = !busy && candidate !== null && name.trim() !== '';
  const submit = () => {
    if (canAdd && candidate) addFont(candidate);
  };
  const nameRejected = issue !== null && issue !== 'error';

  return (
    <DialogShell
      onClose={close}
      labelledBy={titleId}
      portal
      boxClassName="bg-surface border border-border rounded-lg w-[26rem] max-w-[95vw] max-h-[90vh] flex flex-col shadow-2xl"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-3 border-b border-border">
        <h2 id={titleId} className="text-sm font-medium text-text">
          {t.fonts.addFont}
        </h2>
        <button
          type="button"
          onClick={close}
          aria-label={t.app.close}
          className="p-0.5 rounded text-muted hover:text-text hover:bg-surface-2 transition-colors"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>

      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex min-h-0 flex-col gap-3 px-4 py-4 overflow-y-auto">
          {isDesktopShell && (
            <div className="flex flex-col gap-1">
              <p id={listLabelId} className={labelCls}>
                {t.fonts.fromComputer}
              </p>
              <SystemFontList
                labelId={listLabelId}
                busy={busy}
                selectedPath={candidate instanceof File ? undefined : candidate?.path}
                onSelect={select}
              />
            </div>
          )}

          <input
            ref={fileRef}
            type="file"
            accept={FONT_FILE_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) select(file);
              e.target.value = '';
            }}
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`${secondaryBtnCls} shrink-0 ${
                candidate instanceof File ? 'border-accent bg-accent-dim text-accent' : 'border-border text-muted hover:text-text hover:bg-surface-2'
              }`}
              onClick={() => {
                if (!busy) fileRef.current?.click();
              }}
              aria-disabled={busy}
            >
              {t.fonts.upload}
            </button>
            {candidate instanceof File && (
              <span className="font-mono text-[10px] text-muted truncate" title={candidate.name}>
                {candidate.name}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className={labelCls}>{t.fonts.printerFilename}</label>
            <input
              className={inputCls}
              value={name}
              placeholder={t.fonts.printerFilenamePlaceholder}
              onChange={(e) => setName(e.target.value)}
              readOnly={busy || repairPath !== undefined}
              aria-disabled={busy || repairPath !== undefined}
              aria-invalid={nameRejected || undefined}
              aria-describedby={issue ? issueId : undefined}
              autoFocus={!isDesktopShell}
            />
            {issue && (
              <p id={issueId} role="alert" className="text-[10px] font-mono text-red-400 leading-snug">
                {{ error: t.fonts.uploadError, ...fontNameIssueText(t) }[issue]}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            type="button"
            className={`${lockedBtnCls} text-muted hover:text-text hover:bg-surface-2`}
            onClick={close}
          >
            {t.fonts.cancel}
          </button>
          <button
            type="submit"
            className={`${lockedBtnCls} bg-accent text-bg hover:opacity-90`}
            aria-disabled={!canAdd}
            aria-busy={busy || undefined}
          >
            {t.fonts.add}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

/** Uneven on purpose, so the placeholder reads as a list of names rather than a block. */
const LOADING_ROW_WIDTHS = ["70%", "58%", "66%", "44%", "62%", "50%"];

function LoadingRows() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2 px-2 py-2">
      {LOADING_ROW_WIDTHS.map((width) => (
        <span key={width} className="h-3 rounded bg-border animate-pulse" style={{ width }} />
      ))}
    </div>
  );
}

// ── SystemFontList ─────────────────────────────────────────────────────────────

function SystemFontList({
  labelId,
  busy,
  selectedPath,
  onSelect,
}: {
  labelId: string;
  busy: boolean;
  selectedPath: string | undefined;
  onSelect: (font: SystemFont) => void;
}) {
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
  const selectedIndex = shown.findIndex((f) => f.path === selectedPath);

  const moveSelection = (list: HTMLElement, step: number) => {
    const from = selectedIndex < 0 ? (step > 0 ? -1 : shown.length) : selectedIndex;
    for (let i = from + step; i >= 0 && i < shown.length; i += step) {
      const next = shown[i];
      if (!next || next.restricted) continue;
      onSelect(next);
      list.querySelectorAll<HTMLElement>('[role="option"]')[i]?.focus();
      return;
    }
  };

  return (
    <div
      className="flex flex-col gap-1"
      onKeyDown={(e) => {
        if (busy || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
        e.preventDefault();
        moveSelection(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1);
      }}
    >
      <input
        className={inputCls}
        value={query}
        placeholder={t.fonts.filterFonts}
        onChange={(e) => setQuery(e.target.value)}
        aria-label={t.fonts.filterFonts}
        readOnly={busy}
        aria-disabled={busy}
        autoFocus
      />
      {/* Fixed height, so neither the arriving list nor a filter resizes the dialog under the pointer. */}
      <div
        role="listbox"
        aria-labelledby={labelId}
        aria-busy={fonts === null && !failed}
        className="h-56 overflow-auto rounded border border-border text-xs"
      >
        {failed && <p className="px-2 py-1 font-mono text-[10px] text-red-400">{t.fonts.systemFontsFailed}</p>}
        {fonts === null && !failed && <LoadingRows />}
        {fonts !== null && fonts.length === 0 && <p className="px-2 py-1 text-[10px] text-muted">{t.fonts.noInstalledFonts}</p>}
        {fonts !== null && fonts.length > 0 && shown.length === 0 && <p className="px-2 py-1 text-[10px] text-muted">{t.fonts.noFilterMatch}</p>}
        {shown.map((font, i) => {
          const selected = font.path === selectedPath;
          return (
            // One tab stop for the whole list: Tab reaches the name field without walking every row.
            <button
              key={font.path}
              type="button"
              role="option"
              tabIndex={selected || (selectedIndex < 0 && i === 0) ? 0 : -1}
              className={`flex w-full items-baseline gap-2 px-2 py-1 text-left aria-disabled:opacity-40 ${
                selected ? 'bg-accent-dim' : 'hover:bg-border/60 aria-disabled:hover:bg-transparent'
              }`}
              onClick={() => {
                if (!busy && !font.restricted) onSelect(font);
              }}
              aria-selected={selected}
              aria-disabled={busy || font.restricted}
              title={font.restricted ? t.fonts.restrictedLicense : font.variable ? t.fonts.variableFont : undefined}
            >
              <span className="text-text truncate" style={systemFontFaceStyle(font)}>
                {font.family}
              </span>
              <span className={`truncate ${selected ? 'text-text' : 'text-muted'}`}>{font.style}</span>
              <span className={`ml-auto font-mono text-[10px] shrink-0 ${selected ? 'text-text' : 'text-muted'}`}>
                {Math.ceil(font.bytes / 1024)} KB
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

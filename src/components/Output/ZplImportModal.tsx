import { useRef, useState } from 'react';
import { XMarkIcon, ClipboardDocumentIcon, CheckIcon, FolderOpenIcon } from '@heroicons/react/16/solid';
import { importZplText, routeSetupCommands, type ZplImportResult, type SetupCommandChoice } from '@zplab/core/lib/zplImportService';
import { readFileAsZplText } from '../../lib/readFile';
import { useLabelStore } from '../../store/labelStore';
import { commitUsedImages } from '@zplab/core/lib/imageUsage';
import { formatReportAsText, type ImportResult } from '../../lib/importReport';
import { replayRiskFindings, printerCommandFindings, resolveRoutedReport, type ImportReport } from '@zplab/core/lib/importReport';
import { ImportSummaryBody } from './ImportSummary';
import { ImportSetupChoice } from './ImportSetupChoice';
import { useT } from '../../hooks/useT';
import { DialogShell } from '../ui/DialogShell';
import { copyText } from '../../lib/clipboard';
import { acceptAttr, ZPL_SAVE_FILTERS } from '../../lib/fileDialogs';

interface Props {
  onClose: () => void;
}

export function ZplImportModal({ onClose }: Props) {
  const t = useT();
  const [zpl, setZpl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  // Import held back for the setup-command routing prompt.
  const [pending, setPending] = useState<ZplImportResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [appendMode, setAppendMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const applyZplImport = useLabelStore((s) => s.applyZplImport);
  const setPrinterSettingsTab = useLabelStore((s) => s.setPrinterSettingsTab);
  const dpmm = useLabelStore((s) => s.label.dpmm);
  const pages = useLabelStore((s) => s.pages);

  // Append-mode only makes sense when there is something to append *to*.
  // On a fresh designer (one empty page) we hide the toggle entirely
  // because the resulting [empty, imported] state would just be clutter
  // the user has to clean up manually.
  const hasExistingContent =
    pages.length > 1 || (pages[0]?.objects.length ?? 0) > 0;

  // Stop on the result view only for what the changed canvas cannot show: findings, uploads parked in the profile, rows left behind.
  const finishImport = (totalObjects: number, report: ImportReport, changed: { fonts: number; graphics: number; settings: number }, droppedRows: number) => {
    const { settings, ...profileUploads } = changed;
    if (report.findings.length === 0 && profileUploads.fonts + profileUploads.graphics + settings + droppedRows === 0) {
      onClose();
    } else {
      setResult({ objectCount: totalObjects, report, profileUploads, profileSettings: settings, droppedRows });
    }
  };

  const commitImport = (imported: ZplImportResult, choice: SetupCommandChoice) => {
    const { printerProfile, pages, keptPageIndexes } = routeSetupCommands(choice, imported);
    const mode = appendMode && hasExistingContent ? 'append' : 'replace';
    const changed = applyZplImport({
      mode,
      imported: { labelConfig: imported.labelConfig, pages, variables: imported.variables, batch: imported.batch },
      profile: printerProfile,
    });
    if (changed === null) return onClose();
    const droppedRows = mode === 'append' ? (imported.batch?.dataset.rows.length ?? 0) : 0;
    commitUsedImages(pages, imported.decodedImages);
    const totalObjects = pages.reduce((s, p) => s + p.objects.length, 0);
    // The summary must not warn about findings the routing just resolved.
    const report =
      choice === 'keep' ? imported.report : resolveRoutedReport(imported.report, keptPageIndexes);
    finishImport(totalObjects, report, changed, droppedRows);
  };

  // Shared by both entry points (paste, file picker); they differ only in how
  // they obtain the text.
  const processImport = (text: string) => {
    const imported = importZplText(text, dpmm);
    const { labelConfig, printerProfile, pages } = imported;
    const totalObjects = pages.reduce((s, p) => s + p.objects.length, 0);
    if (
      totalObjects === 0 &&
      Object.keys(labelConfig).length === 0 &&
      Object.keys(printerProfile).length === 0 &&
      imported.report.findings.length === 0
    ) {
      setError(t.importModal.errNoObjects);
      return;
    }
    if (replayRiskFindings(imported.report).length > 0) {
      setPending(imported);
      return;
    }
    commitImport(imported, 'keep');
  };

  const handleImport = () => {
    setError(null);
    if (!zpl.trim()) {
      setError(t.importModal.errPasteFirst);
      return;
    }
    processImport(zpl);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError(null);
    let text: string;
    try {
      text = await readFileAsZplText(file);
    } catch {
      setError(t.importModal.errFileRead);
      return;
    }

    if (!text.trim()) {
      setError(t.importModal.errFileEmpty);
      return;
    }
    processImport(text);
  };

  const handleCopy = () => {
    if (!result) return;
    void copyText(formatReportAsText(result, t.importReport)).then((r) => {
      if (r !== 'copied') return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <DialogShell
      onClose={onClose}
      labelledBy="zpl-import-title"
      boxClassName="bg-surface border border-border rounded-lg w-130 flex flex-col shadow-2xl max-h-[80vh]"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <span id="zpl-import-title" className="font-mono text-xs text-muted uppercase tracking-widest">{t.app.importZpl}</span>
        <button
          onClick={onClose}
          aria-label={t.app.close}
          className="p-0.5 rounded text-muted hover:text-text hover:bg-surface-2 transition-colors"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>

      {pending ? (
        <ImportSetupChoice
          findings={printerCommandFindings(pending.report)}
          canKeep={!(appendMode && hasExistingContent)}
          onChoose={(choice) => {
            const imported = pending;
            setPending(null);
            commitImport(imported, choice);
          }}
        />
      ) : result ? (
        <>
          <ImportSummaryBody result={result} onOpenObjects={(tab) => { onClose(); setPrinterSettingsTab(tab); }} />
          <div className="flex justify-between items-center px-4 py-3 border-t border-border shrink-0">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 font-mono text-[10px] text-muted hover:text-text transition-colors"
            >
              {copied
                ? <><CheckIcon className="w-3.5 h-3.5" /> {t.importModal.copied}</>
                : <><ClipboardDocumentIcon className="w-3.5 h-3.5" /> {t.importModal.copyReport}</>}
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded text-xs font-mono bg-accent text-bg hover:opacity-90 transition-opacity"
            >
              {t.app.close}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-3 p-4 flex-1 min-h-0">
            <p className="font-mono text-[10px] text-muted leading-relaxed">
              {t.importModal.intro.split(/(\{recon\}|\{save\})/).map((part, i) =>
                part === '{recon}' ? (
                  <span key={i} className="text-amber-400">{t.importModal.introRecon}</span>
                ) : part === '{save}' ? (
                  <span key={i} className="text-text">{t.importModal.introSave}</span>
                ) : (
                  part
                ),
              )}
            </p>
            <textarea
              className="flex-1 min-h-60 bg-surface-2 border border-border rounded px-3 py-2 font-mono text-xs text-text focus:border-accent focus:outline-none resize-none"
              placeholder="^XA&#10;^PW800&#10;^LL480&#10;^FO50,50^A0N,30,0^FDHello World^FS&#10;^XZ"
              value={zpl}
              onChange={(e) => setZpl(e.target.value)}
              spellCheck={false}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept={acceptAttr(...ZPL_SAVE_FILTERS)}
              className="hidden"
              onChange={handleFileSelect}
            />
            {error && (
              <p className="font-mono text-[10px] text-amber-400 leading-relaxed">{error}</p>
            )}
          </div>

          <div className="flex items-center justify-between px-4 py-3 border-t border-border shrink-0">
            <div className="flex items-center gap-4">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 font-mono text-[10px] text-muted hover:text-text transition-colors"
              >
                <FolderOpenIcon className="w-3.5 h-3.5" />
                {t.app.chooseFile}
              </button>
              {hasExistingContent && (
                <label className="flex items-center gap-1.5 cursor-pointer font-mono text-[10px] text-muted hover:text-text transition-colors">
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={appendMode}
                    onChange={(e) => setAppendMode(e.target.checked)}
                  />
                  {t.app.keepExistingPages}
                </label>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded text-xs font-mono text-muted hover:text-text hover:bg-surface-2 transition-colors"
              >
                {t.app.cancel}
              </button>
              <button
                onClick={handleImport}
                disabled={!zpl.trim()}
                className="px-3 py-1.5 rounded text-xs font-mono bg-accent text-bg hover:opacity-90 disabled:opacity-25 disabled:cursor-not-allowed transition-opacity"
              >
                {t.importModal.importAction}
              </button>
            </div>
          </div>
        </>
      )}
    </DialogShell>
  );
}

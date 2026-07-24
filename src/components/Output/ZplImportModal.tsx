import { useRef, useState } from 'react';
import { XMarkIcon, ClipboardDocumentIcon, CheckIcon, FolderOpenIcon } from '@heroicons/react/16/solid';
import { importZplText, routeSetupCommands, mergeSetupFonts, type ZplImportResult, type SetupCommandChoice } from '@zplab/core/lib/zplImportService';
import { readFileAsText } from '../../lib/readFile';
import { useLabelStore } from '../../store/labelStore';
import type { Page } from '@zplab/core/types/Group';
import type { LabelConfig } from '@zplab/core/types/LabelConfig';
import type { PrinterProfile } from '@zplab/core/types/PrinterProfile';
import type { Variable } from '@zplab/core/types/Variable';
import { formatReportAsText, type ImportResult } from '../../lib/importReport';
import { replayRiskFindings, printerCommandFindings, resolveRoutedReport, type ImportReport } from '@zplab/core/lib/importReport';
import { ImportSummaryBody } from './ImportSummary';
import { ImportSetupChoice } from './ImportSetupChoice';
import { useT } from '../../hooks/useT';
import { DialogShell } from '../ui/DialogShell';

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
  const loadDesign = useLabelStore((s) => s.loadDesign);
  const appendPages = useLabelStore((s) => s.appendPages);
  const patchPrinterProfile = useLabelStore((s) => s.patchPrinterProfile);
  const label = useLabelStore((s) => s.label);
  const pages = useLabelStore((s) => s.pages);

  // Append-mode only makes sense when there is something to append *to*.
  // On a fresh designer (one empty page) we hide the toggle entirely
  // because the resulting [empty, imported] state would just be clutter
  // the user has to clean up manually.
  const hasExistingContent =
    pages.length > 1 || (pages[0]?.objects.length ?? 0) > 0;

  const applyImport = (
    labelConfig: Partial<LabelConfig>,
    printerProfile: Partial<PrinterProfile>,
    importedPages: Page[],
    importedVariables: Variable[],
  ) => {
    // No pages (setup-only import): loading would blank the document.
    if (importedPages.length > 0) {
      if (appendMode && hasExistingContent) {
        // Keep the current label config: the user opted to keep the
        // existing design's dimensions, so any imported ^PW/^LL is
        // intentionally discarded. Imported variables are dropped too:
        // append-mode preserves the current Variables tab; merging here
        // would risk name/fnNumber collisions the user can't see in the
        // dialog. Round-trip from a saved design uses Save/Load, not Append.
        appendPages(importedPages);
      } else {
        loadDesign({ ...label, ...labelConfig }, importedPages, importedVariables);
      }
    }
    // Profile fields are per-installation state, applied regardless of
    // append/replace. Setup fonts merge additively: a stream expresses no
    // deletion.
    const profileToPatch = printerProfile.setupFonts
      ? {
          ...printerProfile,
          setupFonts: mergeSetupFonts(
            useLabelStore.getState().printerProfile.setupFonts,
            printerProfile.setupFonts,
          ),
        }
      : printerProfile;
    if (Object.keys(profileToPatch).length > 0) {
      patchPrinterProfile(profileToPatch);
    }
  };

  // Feedback through state change: when the import has no findings the
  // changed canvas is confirmation enough. We only stop on the result
  // view when there is something the user could not otherwise see, i.e.
  // one or more findings to review.
  const finishImport = (totalObjects: number, report: ImportReport) => {
    if (report.findings.length === 0) {
      onClose();
    } else {
      setResult({ objectCount: totalObjects, report });
    }
  };

  const commitImport = (imported: ZplImportResult, choice: SetupCommandChoice) => {
    const { printerProfile, pages, keptPageIndexes } = routeSetupCommands(choice, imported);
    applyImport(imported.labelConfig, printerProfile, pages, imported.variables);
    const totalObjects = pages.reduce((s, p) => s + p.objects.length, 0);
    // The summary must not warn about findings the routing just resolved.
    const report =
      choice === 'keep' ? imported.report : resolveRoutedReport(imported.report, keptPageIndexes);
    finishImport(totalObjects, report);
  };

  // Shared by both entry points (paste, file picker); they differ only in how
  // they obtain the text.
  const processImport = (text: string) => {
    const imported = importZplText(text, label.dpmm);
    const { labelConfig, printerProfile, pages } = imported;
    const totalObjects = pages.reduce((s, p) => s + p.objects.length, 0);
    if (
      totalObjects === 0 &&
      Object.keys(labelConfig).length === 0 &&
      Object.keys(printerProfile).length === 0
    ) {
      setError('No supported objects found in the ZPL code.');
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
      setError('Please paste some ZPL code first.');
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
      text = await readFileAsText(file);
    } catch {
      setError('Could not read the file.');
      return;
    }

    if (!text.trim()) {
      setError('The file appears to be empty.');
      return;
    }
    processImport(text);
  };

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(formatReportAsText(result)).then(() => {
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
          <ImportSummaryBody result={result} />
          <div className="flex justify-between items-center px-4 py-3 border-t border-border shrink-0">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 font-mono text-[10px] text-muted hover:text-text transition-colors"
            >
              {copied
                ? <><CheckIcon className="w-3.5 h-3.5" /> Copied</>
                : <><ClipboardDocumentIcon className="w-3.5 h-3.5" /> Copy report</>}
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
              Import produces an{' '}
              <span className="text-amber-400">editable reconstruction</span>
              , not an exact replica. Simple labels import cleanly; complex or
              machine-generated ZPL may lose fidelity. Use{' '}
              <span className="text-text">Save design (.json)</span> as the
              lossless source format.
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
              accept=".zpl,text/plain"
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
                Import
              </button>
            </div>
          </div>
        </>
      )}
    </DialogShell>
  );
}

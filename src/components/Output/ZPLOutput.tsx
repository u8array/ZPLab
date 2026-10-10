import { useRef } from 'react';
import { CheckIcon, ClipboardDocumentIcon, ChevronDownIcon, ChevronUpIcon, EyeIcon, PrinterIcon } from '@heroicons/react/16/solid';
import { useLabelStore, selectEffectivePreviewProvider, selectPreviewLocksEditor } from '../../store/labelStore';
import { useZplOutputView } from '../../hooks/useZplOutputView';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { finishZplExport } from '../../lib/exportZpl';
import { useT } from '../../hooks/useT';
import { useLabelaryConsent } from '../../hooks/useLabelaryConsent';
import { ZplSourceEditor } from './ZplSourceEditor';
import { Tooltip } from '../ui/Tooltip';
import { isDesktopShell } from '../../lib/platform';
import { PrinterChip } from './PrinterChip';
import { sectionHeadingCls } from '../ui/formStyles';

interface Props {
  collapsed?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
  /** Height-drag handler for the resize rail. The rail renders INSIDE the
   *  panel root so panel chrome can never read as "leaving" the session. */
  onResizeMouseDown: (e: React.MouseEvent) => void;
}

/** The ZPL output panel with its always-mounted source pane. */
export function ZPLOutput({ collapsed, onCollapse, onExpand, onResizeMouseDown }: Props) {
  const t = useT();
  const effectiveProvider = useLabelStore(selectEffectivePreviewProvider);
  const previewActive = useLabelStore(selectPreviewLocksEditor);
  const enterPreviewMode = useLabelStore((s) => s.enterPreviewMode);
  const exitPreviewMode = useLabelStore((s) => s.exitPreviewMode);
  const { gate, notice: consentNotice } = useLabelaryConsent();
  // The session's focus boundary: leaving this panel applies the buffer, so
  // header actions (copy) stay inside it and don't count as leaving.
  const panelRef = useRef<HTMLDivElement>(null);

  const { session, zpl, refusal, highlightedLines, notices, shownText, crlfKey, currentPageIndex } =
    useZplOutputView(collapsed ?? false);
  // The body keeps its metadata (the apply reparses it); the button copies the export form.
  const { copy, copied } = useCopyToClipboard(() => finishZplExport(shownText));
  const openOutput = useLabelStore((s) => s.openOutput);

  const previewAvailable = effectiveProvider !== 'none';

  const togglePreview = () => {
    if (previewActive) {
      exitPreviewMode();
      return;
    }
    gate(() => void enterPreviewMode());
  };

  // Collapsing the panel mid-edit would hide an unapplied buffer.
  const onCollapseToggle = session ? undefined : collapsed ? onExpand : onCollapse;
  const collapseLabel = collapsed ? t.app.expand : t.app.collapse;

  return (
    <div className="flex flex-col h-full" ref={panelRef} role="region" aria-label={t.output.zplHeading}>
      {onResizeMouseDown && (
        <div
          className="h-1.5 shrink-0 cursor-row-resize hover:bg-accent/30 transition-colors"
          onMouseDown={onResizeMouseDown}
        />
      )}
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            {onCollapseToggle && (
              <Tooltip content={collapseLabel}>
                <button
                  className="p-0.5 rounded text-muted hover:text-text hover:bg-border transition-colors"
                  onClick={onCollapseToggle}
                  aria-label={collapseLabel}
                >
                  {collapsed ? <ChevronUpIcon className="w-3.5 h-3.5" /> : <ChevronDownIcon className="w-3.5 h-3.5" />}
                </button>
              </Tooltip>
            )}
            <span className={sectionHeadingCls}>{t.output.zplHeading}</span>
          </div>
          <div className="flex items-center gap-3">
            {isDesktopShell && <PrinterChip />}
            {previewAvailable && (
              <Tooltip content={t.output.previewHeading}>
                <button
                  onClick={togglePreview}
                  disabled={(!zpl && !previewActive) || session !== null}
                  aria-pressed={previewActive}
                  className={`flex items-center gap-1 font-mono text-[10px] disabled:opacity-25 disabled:cursor-not-allowed transition-colors ${
                    previewActive ? 'text-accent hover:text-text' : 'text-muted hover:text-accent'
                  }`}
                >
                  <EyeIcon className="w-4 h-4" />
                  {t.output.previewHeading}
                </button>
              </Tooltip>
            )}
            <Tooltip content={t.output.copy}>
              <button
                onClick={copy}
                disabled={!shownText}
                className="flex items-center gap-1 font-mono text-[10px] text-muted hover:text-accent disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
              >
                {copied
                  ? <><CheckIcon className="w-4 h-4" />{t.output.copied}</>
                  : <><ClipboardDocumentIcon className="w-4 h-4" />{t.output.copy}</>}
              </button>
            </Tooltip>
            {/* Otherwise the dialog is reachable only through the File menu. */}
            <Tooltip content={t.zebraPrint.outputHeading}>
              <button
                onClick={() => openOutput('label')}
                disabled={!shownText || session !== null}
                className="flex items-center gap-1 font-mono text-[10px] text-muted hover:text-accent disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
              >
                <PrinterIcon className="w-4 h-4" />
                {t.zebraPrint.outputHeading}
              </button>
            </Tooltip>
          </div>
        </div>

        {notices.length > 0 && (
          <div role="status" className="shrink-0 border-b border-border px-3 py-1 space-y-0.5 bg-surface">
            {notices.map((n) => (
              <p key={n} className="font-mono text-[10px] text-amber-400 leading-relaxed">{n}</p>
            ))}
          </div>
        )}
        {!collapsed && (
          <ZplSourceEditor
            session={session}
            zpl={zpl}
            value={shownText}
            crlfKey={crlfKey}
            insertPage={currentPageIndex}
            gateRefusal={session === null ? refusal : null}
            highlightedLines={highlightedLines}
            panelRef={panelRef}
          />
        )}
      </div>

      {consentNotice}
    </div>
  );
}

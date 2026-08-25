import { useRef, useState, type ReactNode } from 'react';
import { CheckIcon, ClipboardDocumentIcon, ChevronDownIcon, ChevronUpIcon, EyeIcon } from '@heroicons/react/16/solid';
import { useLabelStore, selectLabelaryNoticeRequired, selectEffectivePreviewProvider, selectPreviewLocksEditor } from '../../store/labelStore';
import { useZplOutputView } from '../../hooks/useZplOutputView';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { useT } from '../../hooks/useT';
import { LabelaryNoticeModal } from './LabelaryNoticeModal';
import { ZplSourceEditor } from './ZplSourceEditor';
import { Tooltip } from '../ui/Tooltip';

interface Props {
  collapsed?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
  /** Height-drag handler for the resize rail. The rail renders INSIDE the
   *  panel root so panel chrome can never read as "leaving" the session. */
  onResizeMouseDown: (e: React.MouseEvent) => void;
}

export function ZPLOutput({ collapsed, onCollapse, onExpand, onResizeMouseDown }: Props) {
  const t = useT();
  const labelaryEnabled = useLabelStore((s) => s.thirdParty.labelary);
  const noticeRequired = useLabelStore(selectLabelaryNoticeRequired);
  const effectiveProvider = useLabelStore(selectEffectivePreviewProvider);
  const previewActive = useLabelStore(selectPreviewLocksEditor);
  const enterPreviewMode = useLabelStore((s) => s.enterPreviewMode);
  const exitPreviewMode = useLabelStore((s) => s.exitPreviewMode);
  const [showNotice, setShowNotice] = useState(false);
  // The session's focus boundary: leaving this panel applies the buffer, so
  // header actions (copy) stay inside it and don't count as leaving.
  const panelRef = useRef<HTMLDivElement>(null);

  const { session, zpl, refusal, highlightedLines, notices, shownText, crlfKey } =
    useZplOutputView(collapsed ?? false);

  // The button shows when the effective provider can run: Labelary when the
  // gate is on, or the printer path (desktop only). The consent notice only
  // guards Labelary; the printer talks to the user's own device.
  const previewAvailable = effectiveProvider === 'printer' || labelaryEnabled;

  const togglePreview = () => {
    if (previewActive) {
      exitPreviewMode();
      return;
    }
    if (effectiveProvider === 'labelary' && noticeRequired) {
      setShowNotice(true);
      return;
    }
    void enterPreviewMode();
  };

  return (
    <div className="flex flex-col h-full" ref={panelRef} role="region" aria-label={t.output.zplHeading}>
      {onResizeMouseDown && (
        <div
          className="h-1.5 shrink-0 cursor-row-resize hover:bg-accent/30 transition-colors"
          onMouseDown={onResizeMouseDown}
        />
      )}
      <OutputSection
        heading={t.output.zplHeading}
        copyContent={shownText}
        emptyMessage={t.output.noObjects}
        notices={notices}
        collapsed={collapsed}
        // Collapsing the panel mid-edit would hide an unapplied buffer.
        onCollapseToggle={session ? undefined : collapsed ? onExpand : onCollapse}
        collapseLabel={collapsed ? t.app.expand : t.app.collapse}
        body={
          zpl !== '' || session ? (
            <ZplSourceEditor
              session={session}
              zpl={zpl}
              value={shownText}
              crlfKey={crlfKey}
              gateRefusal={session === null ? refusal : null}
              highlightedLines={highlightedLines}
              panelRef={panelRef}
            />
          ) : undefined
        }
        extraActions={
          previewAvailable && (
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
          )
        }
      />

      {showNotice && (
        <LabelaryNoticeModal
          onClose={() => setShowNotice(false)}
          onContinue={() => {
            setShowNotice(false);
            void enterPreviewMode();
          }}
        />
      )}
    </div>
  );
}

/** Single output pane: header (collapse toggle + heading + extra
 *  actions + copy button) and the caller's `body` (the source pane),
 *  or an empty-document message. */
function OutputSection({
  heading,
  copyContent,
  emptyMessage,
  notices,
  collapsed,
  onCollapseToggle,
  collapseLabel,
  extraActions,
  body,
}: {
  heading: string;
  /** Feeds only the header's copy button; the body renders itself. */
  copyContent: string;
  emptyMessage: string;
  notices?: readonly string[];
  collapsed?: boolean;
  onCollapseToggle?: () => void;
  collapseLabel?: string;
  extraActions?: ReactNode;
  body?: ReactNode;
}) {
  const t = useT();
  const { copy, copied } = useCopyToClipboard(() => copyContent);

  return (
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
          <span className="font-mono text-[10px] text-muted uppercase tracking-widest">{heading}</span>
        </div>
        <div className="flex items-center gap-3">
          {extraActions}
          <Tooltip content={t.output.copy}>
            <button
              onClick={copy}
              disabled={!copyContent}
              className="flex items-center gap-1 font-mono text-[10px] text-muted hover:text-accent disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
            >
              {copied
                ? <><CheckIcon className="w-4 h-4" />{t.output.copied}</>
                : <><ClipboardDocumentIcon className="w-4 h-4" />{t.output.copy}</>}
            </button>
          </Tooltip>
        </div>
      </div>

      {notices && notices.length > 0 && (
        <div role="status" className="shrink-0 border-b border-border px-3 py-1 space-y-0.5 bg-surface">
          {notices.map((n) => (
            <p key={n} className="font-mono text-[10px] text-amber-400 leading-relaxed">{n}</p>
          ))}
        </div>
      )}
      {!collapsed && (
        body ?? (
          <pre className="overflow-auto p-3 font-mono text-xs leading-relaxed m-0 bg-surface flex-1">
            <span className="text-muted">{emptyMessage}</span>
          </pre>
        )
      )}
    </div>
  );
}

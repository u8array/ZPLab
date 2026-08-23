import { useState, type ReactNode } from 'react';
import { CheckIcon, ClipboardDocumentIcon, ChevronDownIcon, ChevronUpIcon, EyeIcon, PencilSquareIcon } from '@heroicons/react/16/solid';
import { useLabelStore, selectLabelaryNoticeRequired, selectEffectivePreviewProvider, selectPreviewLocksEditor, selectDocumentEmits } from '../../store/labelStore';
import { generateMultiPageZPL } from '@zplab/core/lib/zplGenerator';
import { sourceEditGate } from '@zplab/core/lib/zplSourceEdit';
import { sourceRefusalText } from '../../lib/sourceEditText';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { useT } from '../../hooks/useT';
import { LabelaryNoticeModal } from './LabelaryNoticeModal';
import { ZplLine } from './ZplLine';
import { ZplSourceEditor } from './ZplSourceEditor';
import { Tooltip } from '../ui/Tooltip';

interface Props {
  collapsed?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
}

export function ZPLOutput({ collapsed, onCollapse, onExpand }: Props) {
  const t = useT();
  const label = useLabelStore((s) => s.label);
  const pages = useLabelStore((s) => s.pages);
  const variables = useLabelStore((s) => s.variables);
  const labelaryEnabled = useLabelStore((s) => s.thirdParty.labelary);
  const noticeRequired = useLabelStore(selectLabelaryNoticeRequired);
  const effectiveProvider = useLabelStore(selectEffectivePreviewProvider);
  const previewActive = useLabelStore(selectPreviewLocksEditor);
  const enterPreviewMode = useLabelStore((s) => s.enterPreviewMode);
  const exitPreviewMode = useLabelStore((s) => s.exitPreviewMode);
  const sourceEdit = useLabelStore((s) => s.sourceEdit);
  const enterSourceEdit = useLabelStore((s) => s.enterSourceEdit);
  const [showNotice, setShowNotice] = useState(false);

  const session = sourceEdit.status === 'editing' ? sourceEdit : null;
  const documentEmits = useLabelStore(selectDocumentEmits);
  const zpl = documentEmits ? generateMultiPageZPL(label, pages, variables) : '';

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

  const gate = zpl === '' ? null : sourceEditGate(zpl);
  const editBlocked = !documentEmits || previewActive || (gate !== null && !gate.ok);
  const editTooltip =
    gate !== null && !gate.ok ? sourceRefusalText(gate.reason, t) : t.output.editSource;

  return (
    <div className="flex flex-col h-full">
      <OutputSection
        heading={t.output.zplHeading}
        // The header's copy button must copy what the body shows: the live
        // buffer during an edit, the generated export otherwise.
        content={session ? session.draft : zpl}
        emptyMessage={t.output.noObjects}
        collapsed={collapsed}
        // Collapsing the panel mid-edit would hide an unapplied buffer.
        onCollapseToggle={session ? undefined : collapsed ? onExpand : onCollapse}
        collapseLabel={collapsed ? t.app.expand : t.app.collapse}
        body={
          session ? (
            <ZplSourceEditor
              draft={session.draft}
              baseline={session.baseline}
              session={session.session}
            />
          ) : undefined
        }
        extraActions={
          <>
            <Tooltip content={editTooltip}>
              <button
                onClick={() => {
                  enterSourceEdit(zpl);
                  onExpand?.();
                }}
                // Disabled during the session: the footer owns every exit
                // (including the discard confirmation), a header exit would
                // either duplicate that flow or dead-click on a dirty buffer.
                disabled={session !== null || editBlocked}
                aria-pressed={session !== null}
                className={`flex items-center gap-1 font-mono text-[10px] disabled:opacity-25 disabled:cursor-not-allowed transition-colors ${
                  session ? 'text-accent hover:text-text' : 'text-muted hover:text-accent'
                }`}
              >
                <PencilSquareIcon className="w-4 h-4" />
                {t.output.editSource}
              </button>
            </Tooltip>
            {previewAvailable && (
              <Tooltip content={t.output.previewHeading}>
                <button
                  onClick={togglePreview}
                  disabled={(!zpl && !previewActive) || session !== null}
                  aria-pressed={previewActive}
                  className={`flex items-center gap-1 font-mono text-[10px] disabled:opacity-25 disabled:cursor-not-allowed transition-colors ${
                    previewActive
                      ? 'text-accent hover:text-text'
                      : 'text-muted hover:text-accent'
                  }`}
                >
                  <EyeIcon className="w-4 h-4" />
                  {t.output.previewHeading}
                </button>
              </Tooltip>
            )}
          </>
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
 *  actions + copy button) and a `<pre>` body, or the caller's `body`
 *  replacement (the source editor). */
function OutputSection({
  heading,
  content,
  emptyMessage,
  collapsed,
  onCollapseToggle,
  collapseLabel,
  extraActions,
  body,
}: {
  heading: string;
  content: string;
  emptyMessage: string;
  collapsed?: boolean;
  onCollapseToggle?: () => void;
  collapseLabel?: string;
  extraActions?: ReactNode;
  body?: ReactNode;
}) {
  const t = useT();
  const { copy, copied } = useCopyToClipboard(() => content);

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
              disabled={!content}
              className="flex items-center gap-1 font-mono text-[10px] text-muted hover:text-accent disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
            >
              {copied
                ? <><CheckIcon className="w-4 h-4" />{t.output.copied}</>
                : <><ClipboardDocumentIcon className="w-4 h-4" />{t.output.copy}</>}
            </button>
          </Tooltip>
        </div>
      </div>

      {!collapsed && (
        body ?? (
          <pre className="overflow-auto p-3 font-mono text-xs leading-relaxed text-text m-0 bg-surface flex-1">
            {content
              ? content.split('\n').map((line, i) => (
                  <ZplLine key={i} line={line} />
                ))
              : <span className="text-muted">{emptyMessage}</span>
            }
          </pre>
        )
      )}
    </div>
  );
}

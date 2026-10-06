import { XMarkIcon } from '@heroicons/react/16/solid';
import { useLabelStore } from '../../store/labelStore';
import { useT } from '../../hooks/useT';
import { DialogShell } from '../ui/DialogShell';
import { sectionHeadingCls } from '../ui/formStyles';

interface Props {
  /** Called after the modal flipped the store flag, so callers only need
   *  to react (start the fetch / open the next modal). Acknowledgement
   *  itself is the modal's responsibility. */
  onContinue: () => void;
  onClose: () => void;
}

/** Privacy notice shown the first time the user invokes a Labelary-backed
 *  feature (Preview, Print). After acknowledgement the gate
 *  (`canCallLabelary`) opens permanently and this modal is no longer
 *  rendered. Shared between Preview and Print so the disclosure wording
 *  stays in lockstep. */
export function LabelaryNoticeModal({ onContinue, onClose }: Props) {
  const t = useT();
  const acknowledgeLabelaryNotice = useLabelStore((s) => s.acknowledgeLabelaryNotice);

  const handleContinue = () => {
    acknowledgeLabelaryNotice();
    onContinue();
  };

  return (
    <DialogShell
      onClose={onClose}
      labelledBy="labelary-notice-title"
      boxClassName="bg-surface border border-border-2 rounded shadow-lg flex flex-col overflow-hidden max-w-[90vw]"
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-2 shrink-0">
        <span id="labelary-notice-title" className={sectionHeadingCls}>
          {t.output.previewNoticeTitle}
        </span>
        <button
          onClick={onClose}
          aria-label={t.app.close}
          className="p-0.5 rounded text-muted hover:text-text hover:bg-surface-2 transition-colors ml-6"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-col gap-3 p-6 max-w-80 text-center font-mono text-[10px] text-muted leading-relaxed">
        <span>{t.output.previewNoticeBody}</span>
        <a
          href="https://labelary.com/service.html#pricing"
          target="_blank"
          rel="noreferrer"
          className="text-accent hover:underline"
        >
          {t.output.previewNoticePrivacyLink}
        </a>
        <button
          onClick={handleContinue}
          className="self-center mt-1 px-3 py-1.5 rounded text-[10px] font-mono bg-surface-2 border border-border text-text hover:border-accent transition-colors"
        >
          {t.output.previewNoticeAcknowledge}
        </button>
      </div>
    </DialogShell>
  );
}

import { XMarkIcon } from '@heroicons/react/16/solid';
import type { SourceApplyOk } from '@zplab/core/lib/zplSourceEdit';
import { DialogShell } from '../ui/DialogShell';
import { ImportSummaryBody } from './ImportSummary';
import { describeEditorLoss } from '../../lib/importReport';
import { useT } from '../../hooks/useT';

/** Pre-commit review: import findings plus the editor-only loss the apply
 *  would cause. Confirming commits the already-prepared plan. */
export function SourceApplyConfirmDialog({
  plan,
  onApply,
  onCancel,
}: {
  plan: SourceApplyOk;
  onApply: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const lossLines = describeEditorLoss(plan.loss, t.importReport);
  return (
    <DialogShell
      onClose={onCancel}
      labelledBy="source-apply-title"
      portal
      boxClassName="bg-surface border border-border rounded-lg w-130 flex flex-col shadow-2xl max-h-[80vh]"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <span id="source-apply-title" className="font-mono text-xs text-muted uppercase tracking-widest">
          {t.output.editSourceConfirmTitle}
        </span>
        <button
          onClick={onCancel}
          aria-label={t.app.close}
          className="p-0.5 rounded text-muted hover:text-text hover:bg-surface-2 transition-colors"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
        {plan.report.findings.length > 0 && (
          <ImportSummaryBody result={{ objectCount: plan.objectCount, report: plan.report }} />
        )}
        {lossLines.length > 0 && (
          <div className="flex flex-col gap-1 px-4 pb-4 pt-2">
            <span className="font-mono text-[10px] font-semibold text-amber-400">
              {t.importReport.editorLossHeading}
            </span>
            {lossLines.map((line) => (
              <span key={line} className="font-mono text-[10px] text-muted">
                {line}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded text-xs font-mono border border-border text-text hover:bg-surface-2 transition-colors"
        >
          {t.app.cancel}
        </button>
        <button
          type="button"
          onClick={onApply}
          className="px-3 py-1.5 rounded text-xs font-mono bg-accent text-bg hover:opacity-90 transition-opacity"
        >
          {t.output.editSourceConfirmApply}
        </button>
      </div>
    </DialogShell>
  );
}

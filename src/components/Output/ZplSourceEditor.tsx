import { useState } from 'react';
import { hasEditorLoss } from '@zplab/core/lib/editorStateDiff';
import { prepareSourceApply, type SourceApplyOk } from '@zplab/core/lib/zplSourceEdit';
import { sourceRefusalText } from '../../lib/sourceEditText';
import { useLabelStore } from '../../store/labelStore';
import { SourceApplyConfirmDialog } from './SourceApplyConfirmDialog';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useT } from '../../hooks/useT';
// Eager on purpose: ~10% bundle buys an instant, failure-free editor toggle.
import ZplCodeMirror from './ZplCodeMirror';

/** One edit session's buffer and apply flow. Mounted only while the session
 *  is live, so plan/error/confirm state dies with it; the session id rides on
 *  every apply, which refuses a mismatch. */
export function ZplSourceEditor({
  draft,
  baseline,
  session,
}: {
  draft: string;
  baseline: string;
  session: number;
}) {
  const t = useT();
  const setSourceDraft = useLabelStore((s) => s.setSourceDraft);
  const cancelSourceEdit = useLabelStore((s) => s.cancelSourceEdit);
  const applyZplSource = useLabelStore((s) => s.applyZplSource);
  // Modal-local like the import modal's result/pending: only the buffer lives
  // in the store, the in-flight plan does not survive its session anyway.
  const [pendingPlan, setPendingPlan] = useState<SourceApplyOk | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const dirty = draft !== baseline;
  const requestCancel = () => {
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    cancelSourceEdit();
  };

  const handleApply = () => {
    // An untouched buffer must not commit: the reparse would still rename
    // variables and replace ids, pure loss for a no-op edit.
    if (!dirty) {
      cancelSourceEdit();
      return;
    }
    const state = useLabelStore.getState();
    const plan = prepareSourceApply({
      text: draft,
      baseline,
      current: {
        label: state.label,
        pages: state.pages,
        variables: state.variables,
        printerProfile: state.printerProfile,
        columnMapping: state.columnMapping,
      },
    });
    if (!plan.ok) {
      setApplyError(sourceRefusalText(plan.reason, t));
      return;
    }
    setApplyError(null);
    // Feedback through state change, like the import modal: only stop on a
    // dialog when there is something the user could not otherwise see.
    if (plan.report.findings.length === 0 && !hasEditorLoss(plan.loss)) {
      applyZplSource(plan, session);
      return;
    }
    setPendingPlan(plan);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex flex-col flex-1 min-h-0 bg-surface-2 border-b border-border font-mono text-xs text-text">
        <ZplCodeMirror
          value={draft}
          onChange={(value) => {
            setApplyError(null);
            setSourceDraft(value);
          }}
          ariaLabel={t.output.editSource}
        />
      </div>
      <div className="flex items-center justify-between px-3 py-2 shrink-0 gap-3">
        <p className="font-mono text-[10px] text-amber-400 leading-relaxed truncate">{applyError}</p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={requestCancel}
            className="px-3 py-1.5 rounded text-xs font-mono border border-border text-text hover:bg-surface-2 transition-colors"
          >
            {t.app.cancel}
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={draft.trim() === ''}
            className="px-3 py-1.5 rounded text-xs font-mono bg-accent text-bg hover:opacity-90 disabled:opacity-25 disabled:cursor-not-allowed transition-opacity"
          >
            {t.output.editSourceApply}
          </button>
        </div>
      </div>

      {pendingPlan && (
        <SourceApplyConfirmDialog
          plan={pendingPlan}
          onApply={() => {
            applyZplSource(pendingPlan, session);
            setPendingPlan(null);
          }}
          onCancel={() => setPendingPlan(null)}
        />
      )}

      {confirmDiscard && (
        <ConfirmDialog
          message={t.output.editSourceDiscardBody}
          confirmLabel={t.output.editSourceDiscard}
          cancelLabel={t.app.cancel}
          destructive
          onConfirm={cancelSourceEdit}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </div>
  );
}

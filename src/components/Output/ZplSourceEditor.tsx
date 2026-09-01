import { useEffect, useRef, useState, type RefObject } from 'react';
import { hasEditorLoss } from '@zplab/core/lib/editorStateDiff';
import { prepareSourceApply } from '@zplab/core/lib/zplSourceEdit';
import type { SourceApplyOk } from '@zplab/core/lib/zplSourceEdit';
import { sourceRefusalText, type SourceRefusal } from '../../lib/sourceEditText';
import {
  useLabelStore,
  selectPreviewLocksEditor,
  selectShadowDraft,
  selectShadowRefusal,
  selectShadowFindings,
  selectSourceDocumentState,
} from '../../store/labelStore';
import type { SourceEditMode } from '../../store/slices/sourceEditSlice';
import { SourceApplyConfirmDialog } from './SourceApplyConfirmDialog';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useSessionExit } from '../../hooks/useSessionExit';
import { useT } from '../../hooks/useT';
import ZplCodeMirror, { type ZplCodeMirrorHandle } from './ZplCodeMirror';
import { buildSourceDiagnostics, type SourceLint } from '../../lib/sourceDiagnostics';

type SessionState = Extract<SourceEditMode, { status: 'editing' }>;

const NO_DIAGNOSTICS: readonly SourceLint[] = [];

/** The always-mounted source pane: the first modifying keystroke seeds a
 *  session from the shown export (focus is the mode: one person either types
 *  here or works the canvas). Leaving the panel applies; Escape discards. */
export function ZplSourceEditor({
  session,
  zpl,
  value,
  crlfKey,
  gateRefusal,
  highlightedLines,
  panelRef,
}: {
  session: SessionState | null;
  zpl: string;
  value: string;
  crlfKey: boolean;
  /** Gate refusal of the shown export; makes the pane read-only. */
  gateRefusal: Exclude<SourceRefusal, 'unbalanced'> | null;
  highlightedLines: ReadonlySet<number>;
  panelRef: RefObject<HTMLDivElement | null>;
}) {
  const t = useT();
  const previewActive = useLabelStore(selectPreviewLocksEditor);
  const readOnly = previewActive || gateRefusal !== null;
  const editorRef = useRef<ZplCodeMirrorHandle>(null);
  const gateMsg = gateRefusal !== null ? sourceRefusalText(gateRefusal, t) : null;

  const shadowRefusal = useLabelStore(selectShadowRefusal);
  const shadowFindings = useLabelStore(selectShadowFindings);
  const shadowDraft = useLabelStore(selectShadowDraft);
  // Offsets only describe the text they were parsed from, so a lagging shadow
  // hands null and the editor keeps mapping its previous set; outside a
  // session there is nothing left to map.
  const diagnostics: readonly SourceLint[] | null =
    session === null
      ? NO_DIAGNOSTICS
      : shadowDraft === value
        ? buildSourceDiagnostics(shadowRefusal, shadowFindings, t)
        : null;

  // The text history belongs to the session: clear it when one ENDS, or an
  // undo in the still-focused editor could resurrect the closed buffer.
  // Session start stays undoable.
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const prevSessionRef = useRef(session?.session ?? null);
  useEffect(() => {
    const prev = prevSessionRef.current;
    const cur = session?.session ?? null;
    prevSessionRef.current = cur;
    if (prev !== null && cur === null) {
      const id = setTimeout(() => setHistoryEpoch((e) => e + 1), 0);
      return () => clearTimeout(id);
    }
  }, [session]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex flex-col flex-1 min-h-0 bg-surface-2 font-mono text-xs text-text">
        <ZplCodeMirror
          key={crlfKey ? 'crlf' : 'lf'}
          ref={editorRef}
          value={value}
          onChange={(text) => {
            const s = useLabelStore.getState();
            // First modifying keystroke: the shown export becomes the baseline.
            if (s.sourceEdit.status !== 'editing') s.enterSourceEdit(zpl);
            s.setSourceDraft(text);
          }}
          ariaLabel={t.output.editSource}
          readOnly={readOnly}
          highlightLines={highlightedLines}
          historyEpoch={historyEpoch}
          placeholderText={t.output.editSourcePlaceholder}
          diagnostics={diagnostics}
        />
      </div>
      {gateMsg !== null && (
        <p
          role="status"
          title={gateMsg}
          className="px-3 py-1.5 shrink-0 border-t border-border font-mono text-[10px] text-muted truncate"
        >
          {gateMsg}
        </p>
      )}
      {session && (
        <SessionChrome
          key={session.session}
          session={session}
          panelRef={panelRef}
          focusEditor={() => editorRef.current?.focus()}
        />
      )}
    </div>
  );
}

/** One session's footer, dialogs and exit surfaces. Keyed by session id, so
 *  plan/confirm state dies structurally with the session. */
function SessionChrome({
  session,
  panelRef,
  focusEditor,
}: {
  session: SessionState;
  panelRef: RefObject<HTMLDivElement | null>;
  /** Re-focuses the editor; cancelling a dialog means "keep editing", and
   *  without it focus strands outside the panel and blur-apply never re-arms. */
  focusEditor: () => void;
}) {
  const t = useT();
  const cancelSourceEdit = useLabelStore((s) => s.cancelSourceEdit);
  const applyZplSource = useLabelStore((s) => s.applyZplSource);
  // Modal-local like the import modal's result/pending: only the buffer lives
  // in the store, the in-flight plan does not survive its session anyway.
  const [pendingPlan, setPendingPlan] = useState<SourceApplyOk | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const liveRefusal = useLabelStore(selectShadowRefusal);
  const liveDraft = useLabelStore(selectShadowDraft);
  // A located imbalance names bytes, so it may only be quoted while the parse
  // still describes the buffer; the positionless reasons hold either way.
  const liveMsg =
    liveRefusal === null
      ? null
      : liveRefusal.reason !== 'unbalanced'
        ? sourceRefusalText(liveRefusal.reason, t)
        : liveDraft === session.draft
          ? (buildSourceDiagnostics(liveRefusal, [], t)
              .find((l) => l.severity === 'error')?.message ?? null)
          : null;

  // Whitespace over an empty baseline authored nothing: exits treat it as
  // clean, or a stray Space traps the user in an unappliable held session.
  const dirty =
    session.draft !== session.baseline &&
    !(session.baseline === '' && session.draft.trim() === '');
  const requestCancel = () => {
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    cancelSourceEdit();
    // Session chrome (this trigger included) unmounts; without a successor
    // a keyboard user lands on document.body. Blur exits never come here.
    focusEditor();
  };

  /** Returns whether the session ended (a held session swallows the click). */
  const handleApply = (): boolean => {
    // An untouched buffer must not commit: the reparse would still rename
    // variables and replace ids, pure loss for a no-op edit.
    if (!dirty) {
      cancelSourceEdit();
      return true;
    }
    const state = useLabelStore.getState();
    const plan = prepareSourceApply({
      text: session.draft,
      baseline: session.baseline,
      current: selectSourceDocumentState(state),
    });
    if (!plan.ok) {
      // The debounced shadow sync would lag the click by up to 300ms.
      state.setSourceRefusal(plan, session.draft);
      // Deferred past the pointerdown's default focus, so Escape keeps working.
      setTimeout(focusEditor, 0);
      return false;
    }
    // Feedback through state change, like the import modal: only stop on a
    // dialog when there is something the user could not otherwise see.
    if (plan.report.findings.length === 0 && !hasEditorLoss(plan.loss)) {
      applyZplSource(plan, session.session);
      return true;
    }
    setPendingPlan(plan);
    return false;
  };

  useSessionExit(panelRef, {
    onExit: handleApply,
    onEscape: requestCancel,
    suspended: pendingPlan !== null || confirmDiscard,
  });

  return (
    <>
      <div className="flex items-center justify-between px-3 py-2 shrink-0 gap-3 border-t border-border">
        <p
          role="status"
          title={liveMsg ?? undefined}
          className="font-mono text-[10px] text-amber-400 leading-relaxed truncate"
        >
          {liveMsg}
        </p>
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
            // Refocus like Cancel: a clean apply unmounts this button. On the
            // dialog path the trap's initial focus wins afterwards, harmless.
            onClick={() => {
              handleApply();
              focusEditor();
            }}
            disabled={session.draft.trim() === ''}
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
            applyZplSource(pendingPlan, session.session);
            setPendingPlan(null);
            focusEditor();
          }}
          onCancel={() => {
            setPendingPlan(null);
            focusEditor();
          }}
        />
      )}

      {confirmDiscard && (
        <ConfirmDialog
          message={t.output.editSourceDiscardBody}
          confirmLabel={t.output.editSourceDiscard}
          cancelLabel={t.app.cancel}
          destructive
          onConfirm={() => {
            cancelSourceEdit();
            focusEditor();
          }}
          onCancel={() => {
            setConfirmDiscard(false);
            focusEditor();
          }}
        />
      )}
    </>
  );
}

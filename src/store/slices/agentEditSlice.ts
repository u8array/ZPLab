import type { StateCreator } from 'zustand';
import { applyDesignOps, captureLoss, nodesById, type DesignOp } from '@zplab/core/lib/designOps';
import { designSizeIssue } from '@zplab/core/lib/designLimits';
import { probeBarcodeFootprint } from '../anchorRepin';
import { selectEditorFrozen } from '../labelStore.selectors';
import type { LabelState } from '../labelStore';

export type AgentEditResult =
  | { ok: true; assignedIds: Record<number, string>; capturesLost: number[]; capturesAtRisk: number[] }
  | { ok: false; reason: 'frozen' }
  | { ok: false; reason: 'invalid'; errors: string[]; opIndex?: number };

export interface AgentEditSlice {
  /** One op list, one undo step, nothing written when any op fails. */
  applyAgentOps: (ops: readonly DesignOp[]) => AgentEditResult;
}

export const createAgentEditSlice: StateCreator<LabelState, [], [], AgentEditSlice> = (_set, get, api) => ({
  applyAgentOps: (ops) => {
    const state = get();
    // Every editor mutator returns silently under the freeze. An agent needs the refusal spelled out.
    if (selectEditorFrozen(state)) return { ok: false, reason: 'frozen' };
    const result = applyDesignOps(
      { label: state.label, pages: state.pages, variables: state.variables, columnMapping: state.columnMapping },
      ops,
      probeBarcodeFootprint,
    );
    if (!result.ok) return { ok: false, reason: 'invalid', errors: result.errors, opIndex: result.opIndex };
    // The same cap the tool boundary applies to every design, or the report would fail after the edit landed.
    const oversize = designSizeIssue(result.doc.pages);
    if (oversize !== null) return { ok: false, reason: 'invalid', errors: [oversize] };
    const touched = ops.flatMap((op, i) => (op.op === 'update' ? [op.id] : op.op === 'add' ? (result.assignedIds.get(i) ?? []) : []));
    // The selection belongs to the current page, so the view follows the first object the ops touched.
    const first = touched[0];
    const page = first === undefined ? undefined : result.doc.pages.find((p) => nodesById(p.objects).has(first));
    const onPage = page === undefined ? undefined : nodesById(page.objects);
    const pageIndex = page === undefined ? -1 : result.doc.pages.indexOf(page);
    // Otherwise the selection stays, minus what a remove took, like the editor's own remove.
    const live = new Set(result.doc.pages.flatMap((p) => [...nodesById(p.objects).keys()]));
    const kept = state.selectedIds.filter((id) => live.has(id));
    // Raw setState like applyZplSource: the reducer's dirty flags are authoritative. The dirty-tracking
    // diff would also stamp fields a rename rewrote, and export would then drop a capture the receipt calls intact.
    api.setState({
      pages: result.doc.pages,
      variables: result.doc.variables,
      columnMapping: result.doc.columnMapping,
      ...(onPage
        ? { currentPageIndex: pageIndex, selectedIds: touched.filter((id) => onPage.has(id)) }
        : kept.length !== state.selectedIds.length
          ? { selectedIds: kept }
          : {}),
    });
    const loss = captureLoss(state.pages, result.touched, result.edited);
    return { ok: true, assignedIds: Object.fromEntries(result.assignedIds), capturesLost: loss.lost, capturesAtRisk: loss.atRisk };
  },
});

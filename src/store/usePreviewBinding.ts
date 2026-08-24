import { useLabelStore, selectRenderVariables, selectRenderDesignLabel, selectRenderColumnMapping } from "./labelStore";
import {
  buildActiveRow,
  clockCtxFromLabel,
  resolveContentPreview,
  type ActiveRow,
  type ClockResolveCtx,
} from "@zplab/core/lib/variableBinding";
import type { Variable } from "@zplab/core/types/Variable";

export interface PreviewBinding {
  variables: readonly Variable[];
  /** Active dataset row, or null without a dataset/mapping. */
  active: ActiveRow | null;
  /** Label-level ^SO2/^SO3 clock offsets. */
  clock: ClockResolveCtx;
  /** Content string -> its builder-preview substitution: variable DEFAULTS +
   *  label clock, explicitly NO dataset row (the builders' validation semantics).
   *  Named to keep it from being mistaken for an `active`-aware resolver. */
  resolveDefaults: (content: string, opts?: { resolveCtrl?: boolean }) => string;
}

/** The one seam for "what would this print": every preview consumer (builders,
 *  canvas, preflight) derives the same binding context from the store here
 *  instead of assembling variables/dataset/clock ad hoc per call site. */
export function usePreviewBinding(): PreviewBinding {
  const variables = useLabelStore(selectRenderVariables);
  const dataset = useLabelStore((s) => s.dataset);
  const columnMapping = useLabelStore(selectRenderColumnMapping);
  const label = useLabelStore(selectRenderDesignLabel);
  const active = buildActiveRow(dataset, columnMapping);
  const clock = clockCtxFromLabel(label);
  return {
    variables,
    active,
    clock,
    resolveDefaults: (content, opts) => resolveContentPreview(content, variables, clock, opts),
  };
}

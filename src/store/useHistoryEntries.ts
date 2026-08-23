import { useLabelStore, temporalPartialize, useHistory } from "./labelStore";
import { selectEditorFrozen } from "./labelStore.selectors";
import {
  describeHistoryStep,
  buildHistoryTimeline,
  historyJumpSteps,
  type HistorySnapshot,
  type HistoryStepDescriptor,
} from "../lib/historyStep";

export interface HistoryEntry {
  descriptor: HistoryStepDescriptor;
  isCurrent: boolean;
}

export interface HistoryEntries {
  entries: HistoryEntry[];
  currentIndex: number;
  jumpTo: (index: number) => void;
  clear: () => void;
  canClear: boolean;
  /** Editor frozen (preview or source edit): undo/redo are no-ops, so the UI
   *  should render the list as inert rather than offering dead controls. */
  locked: boolean;
}

// Descriptors are pure functions of (prev, next) snapshot identity. zundo mutates
// the past/future arrays in place via splice (same array ref), so we cache on the
// snapshot OBJECTS, not the arrays. The freshly-built `current` literal misses
// each render (cheap, one diff); the past/future-internal pairs stay warm.
const cache = new WeakMap<object, WeakMap<object, HistoryStepDescriptor>>();
const initialCache = new WeakMap<object, HistoryStepDescriptor>();

function describeCached(
  prev: HistorySnapshot | null,
  next: HistorySnapshot,
): HistoryStepDescriptor {
  if (!prev) {
    let d = initialCache.get(next);
    if (!d) {
      d = describeHistoryStep(null, next);
      initialCache.set(next, d);
    }
    return d;
  }
  let inner = cache.get(prev);
  if (!inner) {
    inner = new WeakMap();
    cache.set(prev, inner);
  }
  let d = inner.get(next);
  if (!d) {
    d = describeHistoryStep(prev, next);
    inner.set(next, d);
  }
  return d;
}

/** Store adapter: projects the zundo timeline into a flat, ordered list of
 *  history entries (oldest first, including the implicit current state) and a
 *  `jumpTo` that translates a target index into the right undo/redo step count.
 *  Composes `useHistory()`, so it inherits the editor-frozen no-op on undo/redo. */
export function useHistoryEntries(): HistoryEntries {
  const history = useHistory();
  const locked = useLabelStore(selectEditorFrozen);
  const { pastStates, futureStates, undo, redo, clear } = history;

  const current = temporalPartialize(useLabelStore.getState()) as HistorySnapshot;
  const { timeline, currentIndex } = buildHistoryTimeline(
    pastStates as unknown as HistorySnapshot[],
    current,
    futureStates as unknown as HistorySnapshot[],
  );

  const entries: HistoryEntry[] = timeline.map((next, i) => ({
    descriptor: describeCached(timeline[i - 1] ?? null, next),
    isCurrent: i === currentIndex,
  }));

  const jumpTo = (index: number) => {
    const steps = historyJumpSteps(index, currentIndex);
    if (steps < 0) undo(-steps);
    else if (steps > 0) redo(steps);
  };

  return {
    entries,
    currentIndex,
    jumpTo,
    clear,
    canClear: !locked && (pastStates.length > 0 || futureStates.length > 0),
    locked,
  };
}

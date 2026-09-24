import { useState } from "react";
import type { usePreviewBinding } from "../../store/usePreviewBinding";
import { newId } from "@zplab/core/lib/ids";
import { validateGs1SegmentResolved, validateGs1Segments, type Gs1Segment, type Gs1SetError } from "@zplab/core/lib/gs1";

type ResolveDefaults = ReturnType<typeof usePreviewBinding>["resolveDefaults"];

/** Draft-list entry: a stable key stops React from recycling a row instance onto a different segment when one above is removed. */
interface DraftSegment extends Gs1Segment {
  key: string;
}

const draftSegment = (s: Gs1Segment): DraftSegment => ({ ...s, key: newId() });

export interface Gs1SegmentDraft {
  segments: DraftSegment[];
  enforceReq: boolean;
  /** Each value substituted with variable defaults and the label clock. */
  resolvedValues: string[];
  errors: (string | null)[];
  fieldErrorCount: number;
  setError: Gs1SetError | null;
  presentAis: string[];
  focusKey: string | null;
  addSegment: (ai: string) => void;
  setValue: (i: number, value: string) => void;
  removeAt: (i: number) => void;
  applyPreset: (ais: readonly string[]) => void;
}

/** Reads `seed` once on mount. */
export function useGs1SegmentDraft(seed: readonly Gs1Segment[], enforceReq: boolean, resolveDefaults: ResolveDefaults): Gs1SegmentDraft {
  const [segments, setSegments] = useState(() => seed.map(draftSegment));
  // Stored instead of focused directly: the control that triggered the add may already be unmounted, which would drop focus to body and mute the dialog's key trap.
  const [focusKey, setFocusKey] = useState<string | null>(null);

  // resolveCtrl: false for emitter parity, GS1 keeps a stray chip literal.
  const resolvedValues = segments.map((s) => resolveDefaults(s.value, { resolveCtrl: false }));
  const errors = segments.map((s, i) => validateGs1SegmentResolved(s.ai, s.value, resolvedValues[i] ?? ""));

  return {
    segments,
    enforceReq,
    resolvedValues,
    errors,
    fieldErrorCount: errors.filter((e) => e !== null).length,
    setError: validateGs1Segments(segments, enforceReq),
    presentAis: segments.map((s) => s.ai),
    focusKey,
    addSegment: (ai) => {
      const draft = draftSegment({ ai, value: "" });
      setSegments((prev) => [...prev, draft]);
      setFocusKey(draft.key);
    },
    setValue: (i, value) => setSegments((prev) => prev.map((s, j) => (j === i ? { ...s, value } : s))),
    removeAt: (i) => setSegments((prev) => prev.filter((_, j) => j !== i)),
    applyPreset: (ais) => {
      const drafts = ais.map((ai) => draftSegment({ ai, value: "" }));
      setSegments(drafts);
      setFocusKey(drafts[0]?.key ?? null);
    },
  };
}

import { useEffect, type ReactNode } from "react";
import { useT } from "../../hooks/useT";
import { usePreviewBinding } from "../../store/usePreviewBinding";
import { aiSpec } from "@zplab/core/lib/gs1";
import { LINK_GTIN_LENGTHS, digitalLinkAddIssue, linkAis, linkAisSegments, linkGtin, linkSegmentIssue } from "@zplab/core/lib/gs1DigitalLink";
import { addBlockText, linkIssueText } from "./gs1Text";
import { useGs1SegmentDraft } from "./useGs1SegmentDraft";
import { Gs1AiPalette, type AddBlock } from "./Gs1AiPalette";
import { Gs1SegmentList, type RowHint } from "./Gs1SegmentList";

// A link GTIN of 8, 12 or 13 digits is complete, so the hint shows its printed form instead of promising a check digit.
const rowHint: RowHint = (seg, resolved, err) =>
  aiSpec(seg.ai)?.kind === "gtin" && !err && resolved.length !== 14 && LINK_GTIN_LENGTHS.includes(resolved.length) ? `= ${linkGtin(resolved)}` : undefined;

/** The AI editor of a Digital Link, kept in sync with the form's `ais` element string. */
export function DigitalLinkAis({ ais, onChange, feedback }: { ais: string; onChange: (ais: string) => void; feedback: ReactNode }) {
  const t = useT();
  const { variables, resolveDefaults } = usePreviewBinding();
  const draft = useGs1SegmentDraft(linkAisSegments(ais), false, resolveDefaults, linkSegmentIssue);
  const addBlock: AddBlock = (ai, present) => {
    const issue = digitalLinkAddIssue(ai, present);
    return addBlockText(t.gs1builder, ai, present) ?? (issue && linkIssueText(t.contentBuilder, issue));
  };
  const next = linkAis(draft.segments);
  // The draft owns the rows. The form owns the field the encoder reads.
  useEffect(() => {
    if (next !== ais) onChange(next);
  }, [next, ais, onChange]);

  return (
    <div className="flex flex-col gap-2">
      <Gs1SegmentList draft={draft} variables={variables} showFnc1={false} rowHint={rowHint} />
      {feedback}
      <Gs1AiPalette draft={draft} addBlock={addBlock} className="max-h-56 border border-border rounded" />
    </div>
  );
}

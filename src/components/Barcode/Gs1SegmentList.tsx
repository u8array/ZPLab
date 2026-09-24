import { TrashIcon } from "@heroicons/react/24/outline";
import { useT } from "../../hooks/useT";
import { Tooltip } from "../ui/Tooltip";
import { MarkerTextField } from "../Properties/MarkerTextField";
import { extractTemplateRefs, hasTemplateMarkers } from "@zplab/core/lib/fnTemplate";
import { aiSpec, isVariableKind, decimalValuePreview, type Gs1AiSpec, type Gs1Segment } from "@zplab/core/lib/gs1";
import { aiName, fieldErrMsg, type Gs1BuilderStrings } from "./gs1Text";
import type { usePreviewBinding } from "../../store/usePreviewBinding";
import type { Gs1SegmentDraft } from "./useGs1SegmentDraft";

type Variables = ReturnType<typeof usePreviewBinding>["variables"];

/** Compact GS1 format token for a field, GS1 notation and not localized. */
function formatHint(spec: Gs1AiSpec): string {
  switch (spec.kind) {
    case "gtin": return "n14";
    case "date": return spec.len === 8 ? "YYYYMMDD" : "YYMMDD";
    case "fixedNum": return `n${spec.len}`;
    // Implied point lives in the AI, so show the integer+fraction split.
    case "decimal": return spec.decimalPlaces ? `n${spec.len - spec.decimalPlaces}+${spec.decimalPlaces}` : `n${spec.len}`;
    case "fixedAlnum": return `an${spec.len}`;
    case "varNum": return `n..${spec.len}`;
    case "varAlnum": return `an..${spec.len}`;
  }
}

/** State chip combining the format requirement, the resolved width and a
 *  met/unmet glyph into one element (e.g. `✓ n14`, `6/20`, `✗ 7/6`). */
function segmentBadge(spec: Gs1AiSpec | undefined, resolved: string, err: string | null): { label: string; tone: string } | null {
  if (!spec) return null;
  if (err) {
    if (err === "exactLength" && !hasTemplateMarkers(resolved)) return { label: `✗ ${resolved.length}/${spec.len}`, tone: "text-error" };
    return { label: `✗ ${formatHint(spec)}`, tone: "text-error" };
  }
  if (isVariableKind(spec.kind)) return { label: `${resolved.length}/${spec.len}`, tone: "text-muted" };
  return { label: `✓ ${formatHint(spec)}`, tone: "text-muted" };
}

export function Gs1SegmentList({ draft, variables }: { draft: Gs1SegmentDraft; variables: Variables }) {
  const tg = useT().gs1builder;
  // FNC1 follows a variable AI that is not the last segment.
  const fnc1After = (i: number): boolean => {
    const seg = draft.segments[i];
    const spec = seg ? aiSpec(seg.ai) : undefined;
    return !!spec && isVariableKind(spec.kind) && i < draft.segments.length - 1;
  };
  return (
    <ul className="flex flex-col gap-2">
      {draft.segments.map((seg, i) => (
        <SegmentRow
          key={seg.key}
          tg={tg}
          seg={seg}
          err={draft.errors[i] ?? null}
          resolved={draft.resolvedValues[i] ?? ""}
          variables={variables}
          fnc1After={fnc1After(i)}
          autoFocusValue={seg.key === draft.focusKey}
          onChange={(v) => draft.setValue(i, v)}
          onRemove={() => draft.removeAt(i)}
        />
      ))}
    </ul>
  );
}

function SegmentRow({
  tg,
  seg,
  err,
  resolved,
  variables,
  fnc1After,
  autoFocusValue,
  onChange,
  onRemove,
}: {
  tg: Gs1BuilderStrings;
  seg: Gs1Segment;
  err: string | null;
  resolved: string;
  variables: Variables;
  fnc1After: boolean;
  autoFocusValue: boolean;
  onChange: (value: string) => void;
  onRemove: () => void;
}) {
  const spec = aiSpec(seg.ai);
  const isMarker = hasTemplateMarkers(seg.value);
  const badge = segmentBadge(spec, resolved, err);
  const decPreview = spec?.kind === "decimal" ? decimalValuePreview(seg.ai, resolved) : null;
  // A marker width mismatch names the variable's default as the fix. A clock token's width cannot change, so it keeps the generic message.
  const actionable =
    err === "exactLength" && isMarker && spec && extractTemplateRefs(seg.value).some((n) => variables.some((v) => v.name === n));
  const hint = err
    ? actionable && spec
      ? tg.errMarkerLengthFmt.replace("{have}", String(resolved.length)).replace("{need}", String(spec.len))
      : fieldErrMsg(tg, err)
    : spec?.kind === "gtin" && !isMarker && resolved.length > 0 && resolved.length < 14
      ? tg.gtinAutocomplete
      : decPreview
        ? `= ${decPreview}`
        : isMarker && resolved !== "" && !hasTemplateMarkers(resolved)
          ? `= ${resolved}`
          : null;

  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] bg-accent-dim text-accent rounded px-1 py-0.5 shrink-0">({seg.ai})</span>
        <span className="text-xs text-text shrink-0 w-28 truncate">{aiName(tg, seg.ai)}</span>
        <MarkerTextField value={seg.value} onChange={onChange} ariaLabel={aiName(tg, seg.ai)} hasError={err !== null} autoFocus={autoFocusValue} />
        {badge && <span className={`font-mono text-[10px] shrink-0 ${badge.tone}`}>{badge.label}</span>}
        <button type="button" aria-label={tg.remove} onClick={onRemove} className="text-muted hover:text-error shrink-0">
          <TrashIcon className="w-4 h-4" />
        </button>
      </div>
      {hint && (
        <span className={`text-[10px] pl-1 ${err ? "text-error" : "text-muted"} ${!err ? "font-mono" : ""}`}>{hint}</span>
      )}
      {fnc1After && (
        <Tooltip content={tg.fnc1} className="self-start">
          <span className="flex items-center gap-1 text-[9px] font-mono text-muted/70 pl-1">
            <span className="w-4 border-t border-dashed border-border" />
            FNC1
          </span>
        </Tooltip>
      )}
    </li>
  );
}

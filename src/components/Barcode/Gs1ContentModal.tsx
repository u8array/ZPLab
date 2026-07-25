import { useId, useState } from "react";
import { TrashIcon, PlusIcon } from "@heroicons/react/24/outline";
import { DialogShell } from "../ui/DialogShell";
import { DialogHeader } from "../ui/DialogHeader";
import { DialogActions } from "../ui/DialogActions";
import { useT } from "../../hooks/useT";
import type { Translations } from "../../locales";
import { inputCls } from "../ui/formStyles";
import { Tooltip } from "../ui/Tooltip";
import { useLabelStore, getCurrentObjects } from "../../store/labelStore";
import { usePreviewBinding } from "../../store/usePreviewBinding";
import { getObjectStringContent } from "@zplab/core/lib/variableBinding";
import { extractTemplateRefs, hasTemplateMarkers, markersToEmbeds } from "@zplab/core/lib/fnTemplate";
import { DEFAULT_CLOCK_CHARS, markersToTokens } from "@zplab/core/lib/fcTemplate";
import { MarkerTextField } from "../Properties/MarkerTextField";
import { findObjectById } from "@zplab/core/types/Group";
import { newId } from "@zplab/core/lib/ids";
import {
  aiSpec,
  gs1AddBlockReason,
  isVariableKind,
  validateGs1SegmentResolved,
  validateGs1Segments,
  segmentsToElementString,
  segmentsToContent,
  parseGs1ToSegments,
  decimalValuePreview,
  type Gs1AiSpec,
  type Gs1Segment,
  type Gs1SetError,
} from "@zplab/core/lib/gs1";
import {
  AI_BY_GROUP,
  GS1_GROUP_ORDER,
  GS1_COMMON_AIS,
  GS1_BUILDER_PRESETS,
  GS1_REQ_ENFORCED_TYPES,
  reqSatisfiableInBuilder,
} from "../../lib/gs1BuilderPalette";

type Gs1BuilderStrings = Translations["gs1builder"];

/** Draft-list entry: a stable key keeps React from recycling a row instance
 *  onto a DIFFERENT segment when one above is removed (index keys would move
 *  focus and caret into the wrong field mid-edit). */
interface DraftSegment extends Gs1Segment {
  key: string;
}

const draftSegment = (s: Gs1Segment): DraftSegment => ({ ...s, key: newId() });

/** Long-tail count for the palette hint: offerable catalog minus the curated
 *  set (all common AIs are satisfiable, guarded by test). */
function hiddenAiCount(enforceReq: boolean): number {
  const total = Object.values(AI_BY_GROUP)
    .flat()
    .filter((s) => !enforceReq || reqSatisfiableInBuilder(s)).length;
  return total - GS1_COMMON_AIS.size;
}

/** Localized AI display name: per-AI key, else the decimal family's shared
 *  key, else the catalog EN title, else the AI number. */
function aiName(tg: Gs1BuilderStrings, ai: string): string {
  const loc = tg as Record<string, string>;
  const spec = aiSpec(ai);
  const family = spec?.kind === "decimal" ? loc[`aiNameFamily${ai.slice(0, 3)}`] : undefined;
  // `||` on the title so an empty catalog title (8110/8112) still falls to the AI number.
  return loc[`aiName${ai}`] ?? family ?? (spec?.title || ai);
}

function fieldErrMsg(tg: Gs1BuilderStrings, code: string): string {
  return (tg as Record<string, string>)[`err${code.charAt(0).toUpperCase()}${code.slice(1)}`] ?? code;
}

function setErrMsg(tg: Gs1BuilderStrings, e: Gs1SetError): string {
  if (e.key === "exclusiveAis")
    return tg.errExclusiveFmt.replace("{a}", e.ai).replace("{b}", e.other);
  if (e.key === "missingRequired")
    return tg.errRequiresFmt
      .replace("{ai}", e.ai)
      .replace("{list}", e.alternatives.map((alt) => alt.map((m) => `(${m})`).join("+")).join(" / "));
  return fieldErrMsg(tg, e.key);
}

/** Compact GS1 format token for a field (not localized; GS1 notation). */
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

export function Gs1ContentModal() {
  const objectId = useLabelStore((s) => s.gs1BuilderObjectId);
  if (!objectId) return null;
  // Keyed remount per target so the segment draft re-seeds from that object.
  return <Gs1Builder key={objectId} objectId={objectId} />;
}

function Gs1Builder({ objectId }: { objectId: string }) {
  const t = useT();
  const tg = t.gs1builder;
  const titleId = useId();
  const subtitleId = useId();
  const closeGs1Builder = useLabelStore((s) => s.closeGs1Builder);
  const updateObject = useLabelStore((s) => s.updateObject);

  const obj = findObjectById(getCurrentObjects(), objectId);
  const { variables, resolveDefaults } = usePreviewBinding();
  // Seed once (lazy): existing content the parser can't load (free text, a
  // lone single-bind marker, or a marker whose default no longer fills its
  // fixed AI) starts the editor empty WITH a warning instead of blocking the
  // builder; only an explicit Apply replaces it, Cancel keeps it.
  const [seed] = useState(() => {
    const content = (obj && getObjectStringContent(obj)) || "";
    const parsed = parseGs1ToSegments(content, variables);
    return { segments: (parsed ?? []).map(draftSegment), lost: content !== "" && parsed === null };
  });
  const [segments, setSegments] = useState<DraftSegment[]>(seed.segments);
  const enforceReq = GS1_REQ_ENFORCED_TYPES.has(obj?.type ?? "");
  const [query, setQuery] = useState("");

  // Validate each segment as its preview substitution (variable defaults,
  // current clock), so a marker is checked as the text it prints.
  // resolveCtrl: false = emitter parity (GS1 keeps a stray chip literal).
  const resolvedValues = segments.map((s) => resolveDefaults(s.value, { resolveCtrl: false }));
  const errors = segments.map((s, i) => validateGs1SegmentResolved(s.ai, s.value, resolvedValues[i] ?? ""));
  const fieldErrorCount = errors.filter((e) => e !== null).length;
  const fieldsOk = segments.length > 0 && fieldErrorCount === 0;
  const setError = validateGs1Segments(segments, enforceReq);
  // Round-trip gate: only allow Apply for content the builder can re-open, so
  // a marker that validates but can't be re-parsed (e.g. a fixed field whose
  // markers don't resolve to its exact width) can't produce un-editable state.
  const roundTrips = parseGs1ToSegments(segmentsToContent(segments), variables) !== null;
  const valid = fieldsOk && setError === null && roundTrips;

  // Set-rule violations other than "empty" ("empty" is the gateEmpty case).
  const setRuleError = setError && setError.key !== "empty" ? setError : null;
  // Never leave Apply silently disabled: the footer names the first blocker.
  const blocker =
    segments.length === 0 ? tg.gateEmpty
    : fieldErrorCount > 0 ? tg.gateFieldErrorsFmt.replace("{n}", String(fieldErrorCount))
    : setRuleError ? setErrMsg(tg, setRuleError)
    : !roundTrips ? tg.gateRoundTrip
    : null;

  // Focus the new row's value field after add: the source button remounts
  // (palette row turns blocked, presets unmount entirely), which would drop
  // focus to body and mute the dialog's container-attached key trap.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const addSegment = (ai: string) => {
    const draft = draftSegment({ ai, value: "" });
    setSegments((prev) => [...prev, draft]);
    setFocusKey(draft.key);
  };
  const presentAis = segments.map((s) => s.ai);
  const setValue = (i: number, value: string) =>
    setSegments((prev) => prev.map((s, j) => (j === i ? { ...s, value } : s)));
  const removeAt = (i: number) => setSegments((prev) => prev.filter((_, j) => j !== i));
  const applyPreset = (ais: readonly string[]) => {
    const drafts = ais.map((ai) => draftSegment({ ai, value: "" }));
    setSegments(drafts);
    setFocusKey(drafts[0]?.key ?? null);
  };

  const apply = () => {
    updateObject(objectId, { props: { content: segmentsToContent(segments) } });
    closeGs1Builder();
  };

  // FNC1 follows a variable AI that is not the last segment.
  const fnc1After = (i: number): boolean => {
    const seg = segments[i];
    const spec = seg ? aiSpec(seg.ai) : undefined;
    return !!spec && isVariableKind(spec.kind) && i < segments.length - 1;
  };

  const q = query.trim().toLowerCase();

  return (
    <DialogShell
      portal
      labelledBy={titleId}
      describedBy={subtitleId}
      onClose={closeGs1Builder}
      // Fixed height so the palette's query-driven row count (curated set vs full
      // catalog) scrolls inside the aside instead of resizing the whole box.
      boxClassName="bg-surface border border-border rounded-lg shadow-2xl w-[900px] max-w-[95vw] h-[85vh] flex flex-col overflow-hidden"
    >
      <DialogHeader
        titleId={titleId}
        subtitleId={subtitleId}
        title={tg.title}
        subtitle={tg.subtitle}
        onClose={closeGs1Builder}
        closeLabel={tg.close}
      />

      <div className="flex-1 min-h-0 flex">
        {/* Palette (tool/source): own scroll so it stays visible past ~10 segments. */}
        <aside className="w-[280px] shrink-0 border-r border-border flex flex-col min-h-0">
          <div className="px-4 py-3 border-b border-border flex flex-col gap-2">
            <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted">{tg.paletteHeading}</h3>
            <input
              className={`${inputCls} py-0.5 text-xs`}
              placeholder={tg.searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={tg.searchPlaceholder}
            />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3">
            {GS1_GROUP_ORDER.map((group) => {
              // No query shows only the curated set; search spans the catalog.
              // Req-enforced carriers hide AIs whose requisites aren't modeled.
              const matches = AI_BY_GROUP[group].filter(
                (spec) =>
                  (!enforceReq || reqSatisfiableInBuilder(spec)) &&
                  (q
                    ? spec.ai.includes(q) || aiName(tg, spec.ai).toLowerCase().includes(q) || spec.title.toLowerCase().includes(q)
                    : GS1_COMMON_AIS.has(spec.ai)),
              );
              if (matches.length === 0) return null;
              return (
                <div key={group} className="flex flex-col gap-1">
                  <span className="text-[10px] text-muted/70">
                    {(tg as Record<string, string>)[`group${group.charAt(0).toUpperCase()}${group.slice(1)}`]}
                  </span>
                  <div className="flex flex-col gap-1">
                    {matches.map((spec) => {
                      // Preventive gate over the same rules the validator
                      // enforces: an AI already in the set or excluded by one
                      // is not addable, the tooltip names why.
                      const block = gs1AddBlockReason(spec.ai, presentAis);
                      return (
                        <Tooltip
                          key={spec.ai}
                          content={
                            block
                              ? block.kind === "duplicate"
                                ? tg.aiAlreadyAdded
                                : tg.aiExcludedByFmt.replace("{ai}", block.other)
                              : undefined
                          }
                        >
                          <button
                            type="button"
                            onClick={() => addSegment(spec.ai)}
                            disabled={!!block}
                            className="group w-full flex items-center gap-2 px-2 py-1 rounded border border-transparent enabled:hover:border-border enabled:hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed text-xs text-left transition-colors"
                          >
                            <PlusIcon className={`w-3 h-3 text-muted shrink-0 opacity-0 ${block ? "" : "group-hover:opacity-100 group-focus-visible:opacity-100"}`} />
                            <span className="font-mono text-[10px] text-accent shrink-0">({spec.ai})</span>
                            <span className="text-text truncate min-w-0">{aiName(tg, spec.ai)}</span>
                          </button>
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {q === "" && (
              <span className="text-[10px] text-muted/70">{tg.moreViaSearchFmt.replace("{n}", String(hiddenAiCount(enforceReq)))}</span>
            )}
          </div>
        </aside>

        {/* Document + feedback: the segment list being built, then the preview. */}
        <div className="flex-1 min-w-0 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {seed.lost && <p className="text-[11px] text-warning">{tg.seedNotParsedHint}</p>}

          {segments.length === 0 ? (
            <PresetEmptyState tg={tg} onPick={applyPreset} />
          ) : (
            <ul className="flex flex-col gap-2">
              {segments.map((seg, i) => (
                <SegmentRow
                  key={seg.key}
                  tg={tg}
                  seg={seg}
                  err={errors[i] ?? null}
                  resolved={resolvedValues[i] ?? ""}
                  variables={variables}
                  fnc1After={fnc1After(i)}
                  autoFocusValue={seg.key === focusKey}
                  onChange={(v) => setValue(i, v)}
                  onRemove={() => removeAt(i)}
                />
              ))}
            </ul>
          )}

          {/* Set-level rule (exclusive/missing-required): rendered in full so
              a long alternatives list is never truncated. */}
          {fieldsOk && setRuleError && (
            <p className="text-[11px] text-error">{setErrMsg(tg, setRuleError)}</p>
          )}

          {valid && (
            <section className="flex flex-col gap-2 border-t border-border pt-3">
              <div className="flex flex-col gap-1">
                <span className="flex items-baseline gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-text">{tg.elementLabel}</span>
                  <span className="text-[10px] text-muted">{tg.elementSublabel}</span>
                </span>
                <code className="text-xs font-mono text-text break-all bg-surface-2 rounded px-2 py-1.5">
                  {resolveDefaults(segmentsToElementString(segments), { resolveCtrl: false })}
                </code>
              </div>
              <div className="flex flex-col gap-1">
                <span className="flex items-baseline gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted">{tg.rawLabel}</span>
                  <span className="text-[10px] text-muted/70">{tg.rawSublabel}</span>
                </span>
                {/* ZPL field data as the generator emits it: markers become
                    ^FE embeds (#n#) and ^FC clock tokens, shown with the
                    DEFAULT delimiter chars; export picks alternates only on a
                    payload collision, where the output panel is authoritative. */}
                <code className="text-[11px] font-mono text-muted break-all bg-surface-2/60 rounded px-2 py-1">
                  {markersToTokens(
                    markersToEmbeds(segmentsToElementString(segments), variables, "#").payload,
                    DEFAULT_CLOCK_CHARS,
                  )}
                </code>
              </div>
            </section>
          )}
        </div>
      </div>

      <footer className="px-5 py-3 border-t border-border flex items-center gap-3">
        <span
          role="status"
          aria-live="polite"
          className={`flex-1 min-w-0 text-[11px] truncate ${blocker ? "text-warning" : "text-transparent"}`}
        >
          {blocker ?? ""}
        </span>
        <DialogActions
          onCancel={closeGs1Builder}
          onApply={apply}
          applyDisabled={!valid}
          applyLabel={tg.apply}
          cancelLabel={tg.cancel}
        />
      </footer>
    </DialogShell>
  );
}

/** Empty-state onboarding: use-case presets that only prefill the list. */
function PresetEmptyState({ tg, onPick }: { tg: Gs1BuilderStrings; onPick: (ais: readonly string[]) => void }) {
  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-text">{tg.presetsHeading}</span>
        <span className="text-[11px] text-muted">{tg.presetsHint}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {GS1_BUILDER_PRESETS.map((p) => (
          <button
            key={p.nameKey}
            type="button"
            onClick={() => onPick(p.ais)}
            className="flex items-center justify-between gap-2 px-3 py-2 rounded border border-border bg-surface-2 hover:border-accent hover:bg-surface transition-colors text-left"
          >
            <span className="text-xs text-text">{tg[p.nameKey]}</span>
            <span className="font-mono text-[10px] text-muted">{p.ais.map((a) => `(${a})`).join(" ")}</span>
          </button>
        ))}
      </div>
    </div>
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
  variables: ReturnType<typeof usePreviewBinding>["variables"];
  fnc1After: boolean;
  autoFocusValue: boolean;
  onChange: (value: string) => void;
  onRemove: () => void;
}) {
  const spec = aiSpec(seg.ai);
  const isMarker = hasTemplateMarkers(seg.value);
  const badge = segmentBadge(spec, resolved, err);
  const decPreview = spec?.kind === "decimal" ? decimalValuePreview(seg.ai, resolved) : null;
  // Actionable message: marker width mismatch names the variable's default as
  // the fix; a clock-only mismatch keeps the generic message (clock widths are
  // fixed, the fix is a different token, not a default value).
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

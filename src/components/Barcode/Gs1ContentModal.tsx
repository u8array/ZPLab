import { useId, useState } from "react";
import { DialogShell } from "../ui/DialogShell";
import { DialogHeader } from "../ui/DialogHeader";
import { DialogActions } from "../ui/DialogActions";
import { useT } from "../../hooks/useT";
import { useLabelStore, getCurrentObjects } from "../../store/labelStore";
import { usePreviewBinding } from "../../store/usePreviewBinding";
import { getObjectStringContent } from "@zplab/core/lib/variableBinding";
import { markersToEmbeds } from "@zplab/core/lib/fnTemplate";
import { DEFAULT_CLOCK_CHARS, markersToTokens } from "@zplab/core/lib/fcTemplate";
import { findObjectById } from "@zplab/core/types/Group";
import { segmentsToElementString, segmentsToContent, parseGs1ToSegments } from "@zplab/core/lib/gs1";
import { GS1_BUILDER_PRESETS, GS1_REQ_ENFORCED_TYPES } from "../../lib/gs1BuilderPalette";
import { setErrMsg, type Gs1BuilderStrings } from "./gs1Text";
import { useGs1SegmentDraft } from "./useGs1SegmentDraft";
import { Gs1AiPalette } from "./Gs1AiPalette";
import { Gs1SegmentList } from "./Gs1SegmentList";

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

  const { variables, resolveDefaults } = usePreviewBinding();
  // Seed once (lazy): existing content the parser can't load (free text, a
  // lone single-bind marker, or a marker whose default no longer fills its
  // fixed AI) starts the editor empty WITH a warning instead of blocking the
  // builder; only an explicit Apply replaces it, Cancel keeps it.
  const [seed] = useState(() => {
    const obj = findObjectById(getCurrentObjects(), objectId);
    const content = (obj && getObjectStringContent(obj)) || "";
    const parsed = parseGs1ToSegments(content, variables);
    return { segments: parsed ?? [], lost: content !== "" && parsed === null, enforceReq: GS1_REQ_ENFORCED_TYPES.has(obj?.type ?? "") };
  });
  // The rule set is frozen with the seed, so a target removed under the modal cannot relax the gates.
  const draft = useGs1SegmentDraft(seed.segments, seed.enforceReq, resolveDefaults);
  const { segments, fieldErrorCount, setError } = draft;

  const fieldsOk = segments.length > 0 && fieldErrorCount === 0;
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

  const apply = () => {
    updateObject(objectId, { props: { content: segmentsToContent(segments) } });
    closeGs1Builder();
  };

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
        <Gs1AiPalette draft={draft} className="w-[280px] shrink-0 border-r border-border" />

        {/* Document + feedback: the segment list being built, then the preview. */}
        <div className="flex-1 min-w-0 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {seed.lost && <p className="text-[11px] text-warning">{tg.seedNotParsedHint}</p>}

          {segments.length === 0 ? (
            <PresetEmptyState tg={tg} onPick={draft.applyPreset} />
          ) : (
            <Gs1SegmentList draft={draft} variables={variables} />
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

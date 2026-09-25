import { useState } from "react";
import { PlusIcon } from "@heroicons/react/24/outline";
import { useT } from "../../hooks/useT";
import { inputCls } from "../ui/formStyles";
import { Tooltip } from "../ui/Tooltip";
import { AI_BY_GROUP, GS1_GROUP_ORDER, GS1_COMMON_AIS, reqSatisfiableInBuilder } from "../../lib/gs1BuilderPalette";
import { addBlockText, aiName } from "./gs1Text";
import type { Gs1SegmentDraft } from "./useGs1SegmentDraft";

/** Long-tail count for the palette hint: offerable catalog minus the curated set, disjoint by test. */
function hiddenAiCount(enforceReq: boolean): number {
  const total = Object.values(AI_BY_GROUP)
    .flat()
    .filter((s) => !enforceReq || reqSatisfiableInBuilder(s)).length;
  return total - GS1_COMMON_AIS.size;
}

/** The localized reason an identifier cannot be added, null when it can. */
export type AddBlock = (ai: string, presentAis: readonly string[]) => string | null;

export function Gs1AiPalette({ draft, addBlock, className }: { draft: Gs1SegmentDraft; addBlock?: AddBlock; className?: string }) {
  const tg = useT().gs1builder;
  const { enforceReq } = draft;
  const block = addBlock ?? ((ai: string, present: readonly string[]) => addBlockText(tg, ai, present));
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  return (
    <aside className={`flex flex-col min-h-0 ${className ?? ""}`}>
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
      {/* Own scroll so the palette stays visible past ~10 segments. */}
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
                  // Preventive gate: the validator refuses the same AI if this is bypassed.
                  const reason = block(spec.ai, draft.presentAis);
                  return (
                    <Tooltip key={spec.ai} content={reason ?? undefined}>
                      <button
                        type="button"
                        onClick={() => draft.addSegment(spec.ai)}
                        disabled={reason !== null}
                        className="group w-full flex items-center gap-2 px-2 py-1 rounded border border-transparent enabled:hover:border-border enabled:hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed text-xs text-left transition-colors"
                      >
                        <PlusIcon className={`w-3 h-3 text-muted shrink-0 opacity-0 ${reason !== null ? "" : "group-hover:opacity-100 group-focus-visible:opacity-100"}`} />
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
  );
}

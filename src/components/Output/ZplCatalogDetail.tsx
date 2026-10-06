import { useId } from "react";
import { commandId, commandLabel, type CommandSupport } from "@zplab/core/catalog";
import { useT } from "../../hooks/useT";
import { useCatalogSummaries } from "../../hooks/useCatalogSummaries";
import type { CatalogSelection } from "../../hooks/useCatalogSelection";
import { catalogEmptyText, syntaxSegments } from "../../lib/catalogText";
import { useCollapsibleState } from "../ui/useCollapsibleState";
import { PaneToggle } from "../ui/PaneToggle";
import { sectionHeadingCls } from "../ui/formStyles";
import { CAPTION_CLS, focusKeeper, type OutputKey, PANE_ATTRS, paneClass, slotClass, SUPPORT_LEVEL } from "./catalogPanes";

/** Rendering order of the support axes. */
const CAPABILITIES: readonly { cap: keyof CommandSupport; key: OutputKey }[] = [
  { cap: "web", key: "catalogWeb" },
  { cap: "desktop", key: "catalogDesktop" },
  { cap: "docker", key: "catalogDocker" },
];

export function ZplCatalogDetail({ selection, editorHasFocus }: { selection: CatalogSelection; editorHasFocus?: () => boolean }) {
  const t = useT();
  const summaries = useCatalogSummaries();
  const bodyId = useId();
  const [open, setOpen] = useCollapsibleState("catalog-detail", true);
  const { entry, emptyReason, stepBack } = selection;
  const emptyLine = emptyReason && <p className="text-muted leading-relaxed">{catalogEmptyText(emptyReason, t)}</p>;
  // The no-cursor line would be read on every step through plain text.
  const announced = emptyReason?.kind !== "noCursor";

  return (
    <aside
      {...PANE_ATTRS}
      aria-label={t.output.catalogHeading}
      onKeyDown={(e) => {
        if (e.key === "Escape") stepBack();
      }}
      className={paneClass(open, "w-72 min-w-[12rem] border-l border-border")}
    >
      <div className={open ? "flex border-b border-border shrink-0" : "flex flex-col flex-1"}>
        {open && <h2 className={`flex-1 px-3 py-1.5 ${sectionHeadingCls}`}>{t.output.catalogHeading}</h2>}
        <PaneToggle
          side="right"
          open={open}
          title={t.output.catalogHeading}
          onToggle={() => setOpen((o) => !o)}
          onMouseDown={focusKeeper(editorHasFocus)}
          controls={bodyId}
        />
      </div>
      {open && (
        <div id={bodyId} className="px-3 py-2.5 flex-1 min-h-0 overflow-auto" data-testid="catalog-detail">
          <div className="min-w-0">
            <div aria-live="polite" className="min-w-0">
              {entry && (
                <>
                  <div className="flex flex-wrap items-baseline gap-x-2 min-w-0">
                    <span className="font-mono text-accent font-semibold shrink-0">{commandLabel(entry)}</span>
                    <span className="text-text font-medium">{entry.title}</span>
                  </div>
                  <p className="mt-1.5 text-text leading-relaxed">{summaries[commandId(entry)]?.summary ?? entry.summary}</p>
                </>
              )}
              {announced && emptyLine}
            </div>
            {/* Outside the live region: every caret step would read the whole parameter list aloud. */}
            {entry?.reference && (
              <>
                <section className="mt-4">
                  <h3 className={CAPTION_CLS}>{t.output.catalogSyntax}</h3>
                  <code className="mt-1 block font-mono text-[11px] text-text font-semibold break-all">
                    {syntaxSegments(entry.reference.syntax, entry.reference.params.map((p) => p.name)).map((seg, i) => (
                      <span key={i} className={seg.slot === null ? undefined : slotClass(seg.slot)}>{seg.text}</span>
                    ))}
                  </code>
                  {entry.reference.params.length > 0 && (
                    <ul className="mt-2.5 space-y-2">
                      {entry.reference.params.map((p, i) => (
                        <li key={p.name} className="grid grid-cols-[0.875rem_1fr] gap-x-2 items-baseline">
                          <span className={`font-mono font-semibold ${slotClass(i)}`}>{p.name}</span>
                          <span className="text-text leading-snug">{p.meaning}</span>
                          <span className="col-start-2 mt-0.5 text-[11px] text-muted leading-snug">
                            {p.values}
                            {/* Without nowrap the separator can end a line and orphan the default. */}
                            {p.default && <span className="whitespace-nowrap">{` \u00b7 ${t.output.catalogDefault} ${p.default}`}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section className="mt-4">
                  <h3 className={CAPTION_CLS}>{t.output.catalogExample}</h3>
                  <code className="mt-1 block rounded bg-surface-2 px-1.5 py-1 font-mono text-[11px] text-text leading-relaxed break-all">
                    {entry.reference.example}
                  </code>
                </section>
              </>
            )}
            {entry && (
              <dl className="mt-4 pt-2 border-t border-border flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px]">
                {CAPABILITIES.map(({ cap, key }) => (
                  <div key={cap} className="flex gap-1">
                    <dt className="text-muted">{t.output[key]}</dt>
                    <dd className={SUPPORT_LEVEL[entry.support[cap]].cls}>{t.output[SUPPORT_LEVEL[entry.support[cap]].key]}</dd>
                  </div>
                ))}
              </dl>
            )}
            {!announced && emptyLine}
          </div>
        </div>
      )}
    </aside>
  );
}

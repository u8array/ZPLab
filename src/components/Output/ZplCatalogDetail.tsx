import { useId } from "react";
import { commandId, commandLabel, type CommandSupport } from "@zplab/core/catalog";
import { useT } from "../../hooks/useT";
import { useCatalogSummaries } from "../../hooks/useCatalogSummaries";
import type { CatalogSelection } from "../../hooks/useCatalogSelection";
import { catalogEmptyText } from "../../lib/catalogText";
import { useCollapsibleState } from "../ui/useCollapsibleState";
import { PaneToggle } from "../ui/PaneToggle";
import { focusKeeper, type OutputKey, PANE_ATTRS, paneClass, SUPPORT_LEVEL } from "./catalogPanes";

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
  // Only the caret-driven lines are announced. The no-cursor line would be read on every step through plain text.
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
        {open && <h2 className="flex-1 px-3 py-1.5 font-mono text-[10px] text-muted uppercase tracking-widest">{t.output.catalogHeading}</h2>}
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
        <div id={bodyId} className="px-3 py-2 flex-1 min-h-0 overflow-auto" data-testid="catalog-detail">
          <div className="space-y-1 min-w-0">
            <div aria-live="polite" className="space-y-1 min-w-0">
              {entry && (
                <>
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="font-mono text-accent font-semibold shrink-0">{commandLabel(entry)}</span>
                    <span className="text-text font-medium truncate">{entry.title}</span>
                  </div>
                  <p className="text-text leading-relaxed">{summaries[commandId(entry)]?.summary ?? entry.summary}</p>
                  <dl className="flex flex-wrap gap-x-3 font-mono text-[10px]">
                    {CAPABILITIES.map(({ cap, key }) => (
                      <div key={cap} className="flex gap-1">
                        <dt className="text-muted">{t.output[key]}</dt>
                        <dd className={SUPPORT_LEVEL[entry.support[cap]].cls}>{t.output[SUPPORT_LEVEL[entry.support[cap]].key]}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
              {announced && emptyLine}
            </div>
            {!announced && emptyLine}
          </div>
        </div>
      )}
    </aside>
  );
}

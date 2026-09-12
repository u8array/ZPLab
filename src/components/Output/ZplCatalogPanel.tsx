import { useEffect, useId, useRef } from "react";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { CATALOG_SECTIONS, commandId, commandLabel, type CommandSupport, type SupportLevel } from "@zplab/core/catalog";
import { useT } from "../../hooks/useT";
import { useCatalogSummaries } from "../../hooks/useCatalogSummaries";
import type { CatalogSelection } from "../../hooks/useCatalogSelection";
import type { Translations } from "../../locales";
import { inputCls } from "../Properties/styles";

type OutputKey = keyof Translations["output"];

/** Rendering order of the three support axes, each with its locale key. */
const CAPABILITY: readonly { cap: keyof CommandSupport; key: OutputKey }[] = [
  { cap: "web", key: "catalogWeb" },
  { cap: "desktop", key: "catalogDesktop" },
  { cap: "lint", key: "catalogLint" },
];

const LEVEL: Record<SupportLevel, { cls: string; key: OutputKey }> = {
  yes: { cls: "text-accent", key: "catalogYes" },
  planned: { cls: "text-info", key: "catalogPlanned" },
  no: { cls: "text-muted", key: "catalogNo" },
};

// Neither useId output nor a command id is a bare identifier; the prefix must survive, since
// ^PH and ~PH are separate rows.
const domId = (listId: string, key: string): string =>
  `${listId}-${key.replace(/^\^/, "c").replace(/^~/, "t").replace(/[^A-Za-z0-9]/g, "_")}`;

/** Command reference beside the source pane; no `onInsert` means inserting is unavailable. */
export function ZplCatalogPanel({ selection, onInsert }: { selection: CatalogSelection; onInsert?: (text: string) => void }) {
  const t = useT();
  const summaries = useCatalogSummaries();
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const { query, setQuery, results, ids, entry, shownId, activeIndex, caretVisible, choose, toggle, stepBack, insertTextFor } = selection;
  // Headings only: the catalog is stored in section order, so the arrow walk reads `ids` as is.
  const groups = CATALOG_SECTIONS.map((section) => ({ section, rows: results.filter((e) => e.section === section.name) })).filter(
    (g) => g.rows.length > 0,
  );
  const empty = ids.length === 0;
  const requestInsert = onInsert && shownId ? () => onInsert(insertTextFor(shownId)) : undefined;

  useEffect(() => {
    if (!shownId) return;
    const row = listRef.current?.querySelector(`#${CSS.escape(domId(listId, shownId))}`);
    row?.scrollIntoView?.({ block: "nearest" });
    // `query` re-runs this when a cleared filter re-mounts the active row.
  }, [shownId, listId, query]);

  const onListKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      // Out of the empty state the walk resumes at the caret's command, not at row one.
      if (activeIndex < 0 && caretVisible) {
        choose(caretVisible);
        return;
      }
      const step = e.key === "ArrowDown" ? 1 : -1;
      const enterFrom = step > 0 ? 0 : ids.length - 1;
      const next = ids[Math.min(ids.length - 1, Math.max(0, activeIndex < 0 ? enterFrom : activeIndex + step))];
      if (next) choose(next);
    } else if (e.key === "Enter") {
      // Enter inserts only the highlighted row. Anything else goes through the detail's button.
      const activeId = ids[activeIndex];
      if (activeId) onInsert?.(insertTextFor(activeId));
      else if (caretVisible) choose(caretVisible);
    }
  };
  const onPanelKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") stepBack();
  };

  return (
    // tabIndex -1 keeps a description click's focus inside the pane, else the session exit's focusout fires.
    // The data attributes keep the canvas shortcuts and the session's Escape away from the panel's own keys.
    <aside
      tabIndex={-1}
      onKeyDown={onPanelKeyDown}
      data-text-surface
      data-session-exit-ignore
      className="flex flex-col basis-2/5 min-w-[14rem] max-w-[52rem] shrink border-l border-border bg-surface text-xs @container outline-none"
    >
      <h2 className="px-3 py-1.5 border-b border-border shrink-0 font-mono text-[10px] text-muted uppercase tracking-widest">
        {t.output.catalogHeading}
      </h2>
      <div className="flex flex-col flex-1 min-h-0 @xl:flex-row-reverse">
        <div
          className="px-3 py-2 border-b border-border shrink-0 max-h-40 overflow-auto @xl:max-h-none @xl:w-72 @xl:border-b-0 @xl:border-l"
          data-testid="catalog-detail"
        >
          <div className="space-y-1 min-w-0">
            {/* The prompt stays outside the live region: it would be read out after every Escape. */}
            <div aria-live="polite" className="space-y-1 min-w-0">
              {entry && (
                <>
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="font-mono text-accent font-semibold shrink-0">{commandLabel(entry)}</span>
                    <span className="text-text font-medium truncate">{entry.title}</span>
                  </div>
                  <p className="text-text leading-relaxed">{summaries[commandId(entry)]?.summary ?? entry.summary}</p>
                  <dl className="flex flex-wrap gap-x-3 font-mono text-[10px]">
                    {CAPABILITY.map(({ cap, key }) => (
                      <div key={cap} className="flex gap-1">
                        <dt className="text-muted">{t.output[key]}</dt>
                        <dd className={LEVEL[entry.support[cap]].cls}>{t.output[LEVEL[entry.support[cap]].key]}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
            </div>
            {!entry && <p className="text-muted leading-relaxed">{t.output.catalogNoCursor}</p>}
            <div className="flex justify-end">
              <button
                type="button"
                // Stays mounted and focusable: a focused button that unmounts or turns disabled
                // drops focus to body, and the session's focusout fallback would then apply a dirty edit.
                aria-disabled={!requestInsert}
                onClick={requestInsert}
                className="font-mono text-[10px] text-muted hover:text-accent aria-disabled:opacity-25 aria-disabled:cursor-not-allowed transition-colors"
              >
                {t.output.catalogInsert}
              </button>
            </div>
          </div>
        </div>
        <div className="flex flex-col flex-1 min-h-0 min-w-0">
          <div className="px-3 py-2 border-b border-border shrink-0">
            <label className="relative block">
              <MagnifyingGlassIcon className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                // Cleared here on purpose: only some browsers clear a search field natively,
                // and the panel's own Escape must not take the detail with it. An empty
                // field has nothing to clear, so Escape falls through to the step-back.
                onKeyDown={(e) => {
                  if (e.key !== "Escape" || query === "") return;
                  e.stopPropagation();
                  setQuery("");
                }}
                placeholder={t.output.catalogSearch}
                aria-label={t.output.catalogSearch}
                className={`${inputCls} pl-7`}
              />
            </label>
          </div>
          {empty && <p className="flex-1 px-3 py-2 text-muted">{t.output.catalogNoMatch}</p>}
          <ul
            ref={listRef}
            role="listbox"
            hidden={empty}
            tabIndex={0}
            aria-label={t.output.catalogHeading}
            aria-activedescendant={shownId && activeIndex >= 0 ? domId(listId, shownId) : undefined}
            onKeyDown={onListKeyDown}
            className="flex-1 min-h-0 overflow-auto py-1 outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            {groups.map(({ section, rows }) => {
              const headingId = domId(listId, `section ${section.name}`);
              return (
                <li key={section.name} role="group" aria-labelledby={headingId}>
                  <div id={headingId} className="px-3 pt-2 pb-0.5 font-mono text-[10px] text-muted uppercase tracking-widest">
                    {section.name}
                  </div>
                  <ul role="presentation">
                    {rows.map((row) => {
                      const id = commandId(row);
                      const active = id === shownId;
                      return (
                        <li
                          key={id}
                          id={domId(listId, id)}
                          role="option"
                          aria-selected={active}
                          // The clicks of a double-click must not toggle the pin twice.
                          onClick={(e) => {
                            if (e.detail <= 1) toggle(id);
                          }}
                          onDoubleClick={() => onInsert?.(insertTextFor(id))}
                          className={`flex items-baseline gap-2 px-3 py-0.5 cursor-default select-none hover:bg-border/60 ${active ? "bg-border/60" : ""}`}
                        >
                          {/* Coloured by web support: the answer most users need at a glance. */}
                          <span className={`font-mono shrink-0 ${LEVEL[row.support.web].cls}`}>{id}</span>
                          <span className="text-muted truncate">{row.title}</span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </aside>
  );
}

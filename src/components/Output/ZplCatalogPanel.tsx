import { useEffect, useId, useRef, useState } from "react";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import {
  CATALOG_SECTIONS,
  catalogEntry,
  commandId,
  commandLabel,
  filterCatalog,
  type CommandSupport,
  type SupportLevel,
} from "@zplab/core/catalog";
import { useT } from "../../hooks/useT";
import { useCatalogSummaries } from "../../hooks/useCatalogSummaries";
import type { Translations } from "../../locales";
import type { CursorCommand } from "../../lib/zplLanguage";
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
export function ZplCatalogPanel({
  cursor,
  onInsert,
  sessionId,
}: {
  cursor: CursorCommand | null;
  onInsert?: (text: string) => void;
  /** A choice made during a source-edit session dies with that session. */
  sessionId?: number;
}) {
  const t = useT();
  const summaries = useCatalogSummaries();
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState("");
  // The panel's own choice over the caret: a pinned row, or the empty state on purpose.
  const [pinned, setPinned] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // State derived from props, React's prev-vs-current guard at render time as in
  // useCollapsibleState. A new cursor object is a real move: the editor dedupes on
  // id and offset before it reports one.
  const [prev, setPrev] = useState({ cursor, sessionId });
  if (prev.cursor !== cursor || prev.sessionId !== sessionId) {
    setPrev({ cursor, sessionId });
    setPinned(null);
    setDismissed(false);
  }
  const results = filterCatalog(query);
  // Headings only: the catalog is stored in section order, so the arrow walk reads `results` as is.
  const groups = CATALOG_SECTIONS.map((section) => ({ section, rows: results.filter((e) => e.section === section.name) })).filter(
    (g) => g.rows.length > 0,
  );
  const ids = results.map(commandId);
  // A pin the search hides is inert and returns when the filter clears.
  const visiblePin = pinned !== null && ids.includes(pinned) ? pinned : null;
  const requestedId = visiblePin ?? (dismissed ? undefined : cursor?.id);
  const entry = requestedId ? catalogEntry(requestedId) : undefined;
  // A twin row is one entry whichever prefix the caret sits on; the row id is the entry's.
  const shownId = entry ? commandId(entry) : null;
  const activeIndex = shownId ? ids.indexOf(shownId) : -1;
  const caretEntry = cursor ? catalogEntry(cursor.id) : undefined;
  const caretRow = caretEntry ? commandId(caretEntry) : null;
  const caretIndex = caretRow ? ids.indexOf(caretRow) : -1;
  const empty = ids.length === 0;
  // The spelling under the caret or on the row: ~HL and ^HL share a row but differ on the printer.
  const insertRequested = onInsert && entry && requestedId ? () => onInsert(requestedId) : undefined;

  useEffect(() => {
    if (!shownId) return;
    const row = listRef.current?.querySelector(`#${CSS.escape(domId(listId, shownId))}`);
    row?.scrollIntoView?.({ block: "nearest" });
    // `query` re-runs this when a cleared filter re-mounts the active row.
  }, [shownId, listId, query]);

  // Choosing a row is a wish to see it, so it also ends a dismissal.
  const showRow = (id: string): void => {
    setDismissed(false);
    setPinned(id);
  };
  const togglePin = (id: string): void => {
    setDismissed(false);
    setPinned((p) => (p === id ? null : id));
  };
  const onListKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      // Out of the empty state the walk resumes at the caret's command, not at row one.
      if (activeIndex < 0 && caretRow && caretIndex >= 0) {
        showRow(caretRow);
        return;
      }
      const step = e.key === "ArrowDown" ? 1 : -1;
      const enterFrom = step > 0 ? 0 : ids.length - 1;
      const next = ids[Math.min(ids.length - 1, Math.max(0, activeIndex < 0 ? enterFrom : activeIndex + step))];
      if (next) showRow(next);
    } else if (e.key === "Enter") {
      // The listbox activates its highlighted row; the detail's button is the way to insert anything else.
      const activeId = ids[activeIndex];
      if (activeId) onInsert?.(activeId);
      else if (caretRow && caretIndex >= 0) showRow(caretRow);
    }
  };
  // Escape steps back by what shows, not by the raw pin: a pin the search hides
  // already shows the caret, so that press goes straight to the empty state.
  const onPanelKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    setPinned(null);
    if (requestedId === undefined || requestedId === cursor?.id) setDismissed(true);
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
            <div aria-live="polite" className="space-y-1 min-w-0">
              {entry ? (
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
              ) : (
                <p className="text-muted leading-relaxed">{t.output.catalogNoCursor}</p>
              )}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                // Stays mounted and focusable: a focused button that unmounts or turns disabled
                // drops focus to body, and the session's focusout fallback would then apply a dirty edit.
                aria-disabled={!insertRequested}
                onClick={insertRequested}
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
                // and the panel's own Escape must not take the detail with it.
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
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
                            if (e.detail <= 1) togglePin(id);
                          }}
                          onDoubleClick={() => onInsert?.(id)}
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

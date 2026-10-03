import { useEffect, useId, useRef, useState } from "react";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { ChevronDownIcon } from "@heroicons/react/16/solid";
import { CATALOG_SECTIONS, commandId, commandLabel, type CommandSupport, type SupportLevel } from "@zplab/core/catalog";
import { useT } from "../../hooks/useT";
import { useCatalogSummaries } from "../../hooks/useCatalogSummaries";
import type { CatalogSelection } from "../../hooks/useCatalogSelection";
import { catalogEmptyText } from "../../lib/catalogText";
import type { Translations } from "../../locales";
import { inputCls } from "../Properties/styles";
import { ContextMenu, type MenuSection } from "../ui/ContextMenu";
import { useContextMenu } from "../../hooks/useContextMenu";
import { useCollapsibleState } from "../ui/useCollapsibleState";
import { Tooltip } from "../ui/Tooltip";

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

/** One entry: the insert a double-click and Enter also run. */
function buildCatalogRowMenu(label: string, run: (() => void) | undefined): MenuSection[] {
  return [{ id: "row", items: [{ id: "insert", label, run, disabled: run === undefined }] }];
}

/** Command reference beside the source pane; no `onInsert` means inserting is unavailable. */
export function ZplCatalogPanel({
  selection,
  onInsert,
  editorHasFocus,
}: {
  selection: CatalogSelection;
  onInsert?: (text: string) => void;
  /** Absent, the panel takes pointer focus like any other. */
  editorHasFocus?: () => boolean;
}) {
  const t = useT();
  const summaries = useCatalogSummaries();
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [listOpen, setListOpen] = useCollapsibleState("catalog-list", true);
  // State, not a ref: the menu's container is read during render.
  const [panelEl, setPanelEl] = useState<HTMLElement | null>(null);
  // A row chosen under the pointer is in view already, and scrolling would close the menu that opens with it.
  const chosenByPointer = useRef<string | null>(null);
  const { query, setQuery, results, ids, entry, emptyReason, shownId, activeIndex, caretVisible, choose, toggle, stepBack, insertTextFor } = selection;
  const { menu, openAtPointer, close } = useContextMenu<MenuSection[]>();
  // Headings only: the catalog is stored in section order, so the arrow walk reads `ids` as is.
  const groups = CATALOG_SECTIONS.map((section) => ({ section, rows: results.filter((e) => e.section === section.name) })).filter(
    (g) => g.rows.length > 0,
  );
  const empty = ids.length === 0;
  const emptyLine = emptyReason && <p className="text-muted leading-relaxed">{catalogEmptyText(emptyReason, t)}</p>;
  // Only the caret-driven lines are announced. The no-cursor line would be read on every step through plain text.
  const announced = emptyReason?.kind !== "noCursor";
  // A caret is only worth keeping while there is one: from elsewhere the catalog takes focus as any panel.
  const keepEditorFocus = (e: React.MouseEvent): void => {
    if (editorHasFocus?.()) e.preventDefault();
  };
  // A right-click selects the row like a click does, then offers the insert that double-click hides.
  const openRowMenu = (e: React.MouseEvent, id: string): void => {
    e.preventDefault();
    chosenByPointer.current = id;
    choose(id);
    openAtPointer(e, buildCatalogRowMenu(t.output.catalogInsert, onInsert ? () => onInsert(insertTextFor(id)) : undefined));
  };

  useEffect(() => {
    const justChosen = chosenByPointer.current;
    chosenByPointer.current = null;
    if (!shownId || shownId === justChosen) return;
    const row = listRef.current?.querySelector(`#${CSS.escape(domId(listId, shownId))}`);
    row?.scrollIntoView?.({ block: "nearest" });
    // `query` and `listOpen` re-run this when a cleared filter or an unfold re-mounts the active row.
  }, [shownId, listId, query, listOpen]);

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
      // Enter inserts only the highlighted row. Without one, it only selects the caret.
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
      ref={setPanelEl}
      tabIndex={-1}
      onKeyDown={onPanelKeyDown}
      data-text-surface
      data-session-exit-ignore
      className="flex flex-col basis-2/5 min-w-[14rem] max-w-[52rem] shrink border-l border-border bg-surface text-xs @container outline-none"
    >
      <div className="flex items-center px-3 py-1.5 border-b border-border shrink-0">
        <h2 className="font-mono text-[10px] text-muted uppercase tracking-widest">{t.output.catalogHeading}</h2>
        <Tooltip content={t.output.catalogList}>
          <button
            type="button"
            aria-label={t.output.catalogList}
            aria-expanded={listOpen}
            aria-controls={`${listId}-list`}
            onMouseDown={keepEditorFocus}
            onClick={() => setListOpen((o) => !o)}
            className="ml-auto p-0.5 text-muted hover:text-text transition-colors"
          >
            <ChevronDownIcon className={`w-3 h-3 transition-transform ${listOpen ? "" : "-rotate-90"}`} />
          </button>
        </Tooltip>
      </div>
      <div className={`flex flex-col flex-1 min-h-0 ${listOpen ? "@xl:flex-row-reverse" : ""}`}>
        <div
          className={
            listOpen
              ? "px-3 py-2 border-b border-border shrink-0 max-h-40 overflow-auto @xl:max-h-none @xl:w-72 @xl:border-b-0 @xl:border-l"
              : "px-3 py-2 flex-1 min-h-0 overflow-auto"
          }
          data-testid="catalog-detail"
        >
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
                    {CAPABILITY.map(({ cap, key }) => (
                      <div key={cap} className="flex gap-1">
                        <dt className="text-muted">{t.output[key]}</dt>
                        <dd className={LEVEL[entry.support[cap]].cls}>{t.output[LEVEL[entry.support[cap]].key]}</dd>
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
        {listOpen && (
          <div id={`${listId}-list`} className="flex flex-col flex-1 min-h-0 min-w-0">
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
                            onMouseDown={keepEditorFocus}
                            // The clicks of a double-click must not toggle the pin twice.
                            onClick={(e) => {
                              if (e.detail > 1) return;
                              chosenByPointer.current = id;
                              toggle(id);
                            }}
                            onDoubleClick={() => onInsert?.(insertTextFor(id))}
                            onContextMenu={(e) => openRowMenu(e, id)}
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
        )}
      </div>
      {/* Mounted inside the panel: the session exit reads a pointerdown outside it as leaving the edit. */}
      {menu && <ContextMenu sections={menu.data} x={menu.x} y={menu.y} onClose={close} container={panelEl} />}
    </aside>
  );
}

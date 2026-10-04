import { useEffect, useId, useRef, useState } from "react";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { CATALOG_SECTIONS, commandId } from "@zplab/core/catalog";
import { useT } from "../../hooks/useT";
import type { CatalogSelection } from "../../hooks/useCatalogSelection";
import { inputCls } from "../ui/formStyles";
import { ContextMenu, type MenuSection } from "../ui/ContextMenu";
import { useContextMenu } from "../../hooks/useContextMenu";
import { useCollapsibleState } from "../ui/useCollapsibleState";
import { PaneToggle } from "../ui/PaneToggle";
import { focusKeeper, PANE_ATTRS, paneClass, SUPPORT_LEVEL } from "./catalogPanes";

// Neither useId output nor a command id is a bare identifier. The prefix must survive, since ^PH and ~PH are separate rows.
const domId = (listId: string, key: string): string =>
  `${listId}-${key.replace(/^\^/, "c").replace(/^~/, "t").replace(/[^A-Za-z0-9]/g, "_")}`;

function buildCatalogRowMenu(label: string, run: (() => void) | undefined): MenuSection[] {
  return [{ id: "row", items: [{ id: "insert", label, run, disabled: run === undefined }] }];
}

export function ZplCatalogList({
  selection,
  onInsert,
  editorHasFocus,
}: {
  selection: CatalogSelection;
  onInsert?: (text: string) => void;
  editorHasFocus?: () => boolean;
}) {
  const t = useT();
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [listOpen, setListOpen] = useCollapsibleState("catalog-list", true);
  // State, not a ref: the menu's container is read during render.
  const [panelEl, setPanelEl] = useState<HTMLElement | null>(null);
  // A row chosen under the pointer is in view already, and scrolling would close the menu that opens with it.
  const chosenByPointer = useRef<string | null>(null);
  const { query, setQuery, results, ids, shownId, activeIndex, caretVisible, choose, toggle, stepBack, insertTextFor } = selection;
  const { menu, openAtPointer, close } = useContextMenu<MenuSection[]>();
  // Headings only: the catalog is stored in section order, so the arrow walk reads `ids` as is.
  const groups = CATALOG_SECTIONS.map((section) => ({ section, rows: results.filter((e) => e.section === section.name) })).filter(
    (g) => g.rows.length > 0,
  );
  const empty = ids.length === 0;
  const keepEditorFocus = focusKeeper(editorHasFocus);
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
    // `query` and `listOpen` re-run this when a cleared filter or an unfold remounts the active row.
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
      const activeId = ids[activeIndex];
      if (activeId) onInsert?.(insertTextFor(activeId));
      else if (caretVisible) choose(caretVisible);
    }
  };
  const onPanelKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") stepBack();
  };

  return (
    <aside
      {...PANE_ATTRS}
      ref={setPanelEl}
      aria-label={t.output.catalogList}
      onKeyDown={onPanelKeyDown}
      className={paneClass(listOpen, "w-64 min-w-[11rem] border-r border-border")}
    >
      <div className={listOpen ? "flex border-b border-border shrink-0" : "flex flex-col flex-1"}>
        <PaneToggle
          side="left"
          open={listOpen}
          title={t.output.catalogList}
          onToggle={() => setListOpen((o) => !o)}
          onMouseDown={keepEditorFocus}
          controls={`${listId}-list`}
        />
        {listOpen && <h2 className="flex-1 px-3 py-1.5 text-right font-mono text-[10px] text-muted uppercase tracking-widest">{t.output.catalogList}</h2>}
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
                // Not every browser clears a search field natively, and the pane's Escape must not take the detail with it.
                // An empty field has nothing to clear, so Escape falls through to the step-back.
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
            aria-label={t.output.catalogList}
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
                          <span className={`font-mono shrink-0 ${SUPPORT_LEVEL[row.support.web].cls}`}>{id}</span>
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
      {/* Mounted inside the pane: the session exit reads a pointerdown outside it as leaving the edit. */}
      {menu && <ContextMenu sections={menu.data} x={menu.x} y={menu.y} onClose={close} container={panelEl} />}
    </aside>
  );
}

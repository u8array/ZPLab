import { useState } from "react";
import { catalogEntry, catalogRow, commandId, filterCatalog, type ZplCommandEntry } from "@zplab/core/catalog";
import type { CursorCommand } from "../lib/zplLanguage";

export interface CatalogSelection {
  query: string;
  setQuery: (query: string) => void;
  results: ZplCommandEntry[];
  ids: string[];
  entry: ZplCommandEntry | undefined;
  shownId: string | null;
  activeIndex: number;
  pinVisible: string | null;
  caretVisible: string | null;
  choose: (id: string | null) => void;
  toggle: (id: string) => void;
  /** Escape: the caret's own row goes to the empty state, any other pin to the caret. */
  stepBack: () => void;
  /** The caret's own row inserts the spelling under the caret: ~HL and ^HL share a
   *  row but differ on the printer. Any other row inserts its id. */
  insertTextFor: (rowId: string) => string;
}

export function useCatalogSelection(cursor: CursorCommand | null): CatalogSelection {
  const [query, setQuery] = useState("");
  const [pinned, setPinned] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // Render-time reset as in useCollapsibleState. A new cursor object is the user asking
  // again: a pointer gesture, or the command under the caret changed. A null report only
  // says the caret is gone, as after a regenerated export or a page switch.
  const [prevCursor, setPrevCursor] = useState(cursor);
  if (prevCursor !== cursor) {
    setPrevCursor(cursor);
    if (cursor !== null) {
      setPinned(null);
      setDismissed(false);
    }
  }
  const results = filterCatalog(query);
  const ids = results.map(commandId);
  const pinVisible = pinned !== null && ids.includes(pinned) ? pinned : null;
  const asked = pinVisible ?? (dismissed ? undefined : cursor?.id);
  const entry = asked ? catalogEntry(asked) : undefined;
  const shownId = entry ? commandId(entry) : null;
  const caretRow = cursor ? (catalogRow(cursor.id) ?? null) : null;

  const choose = (id: string | null): void => {
    setDismissed(false);
    setPinned(id);
  };
  return {
    query,
    setQuery,
    results,
    ids,
    entry,
    shownId,
    activeIndex: shownId ? ids.indexOf(shownId) : -1,
    pinVisible,
    caretVisible: caretRow && ids.includes(caretRow) ? caretRow : null,
    choose,
    toggle: (id) => choose(pinned === id ? null : id),
    stepBack: () => {
      if (shownId === null) return;
      setPinned(null);
      if (shownId === caretRow) setDismissed(true);
    },
    insertTextFor: (rowId) => (cursor && rowId === caretRow ? cursor.id : rowId),
  };
}

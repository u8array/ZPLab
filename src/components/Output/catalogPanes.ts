import type { SupportLevel } from "@zplab/core/catalog";
import type { Translations } from "../../locales";

export type OutputKey = keyof Translations["output"];

export const SUPPORT_LEVEL: Record<SupportLevel, { cls: string; key: OutputKey }> = {
  yes: { cls: "text-accent", key: "catalogYes" },
  planned: { cls: "text-info", key: "catalogPlanned" },
  no: { cls: "text-muted", key: "catalogNo" },
};

// tabIndex -1 keeps a click inside the pane from moving focus out, else the session exit's focusout fires.
// The data attributes keep the canvas shortcuts and the session's Escape away from the pane's own keys.
export const PANE_ATTRS = { tabIndex: -1, "data-text-surface": true, "data-session-exit-ignore": true } as const;

/** Keeps the editor's caret: a click in the pane must not take focus from it. */
export const focusKeeper = (editorHasFocus?: () => boolean) => (e: React.MouseEvent): void => {
  if (editorHasFocus?.()) e.preventDefault();
};

/** Width, border and minimum apply only while open, since the rail brings its own. */
export const paneClass = (open: boolean, openClass: string): string =>
  `flex flex-col bg-surface text-xs outline-none ${open ? `shrink ${openClass}` : "shrink-0"}`;

// 24x24 Lucide glyph paths for the floating selection buttons. Kept out of
// the renderer so FloatingCanvasButton stays icon-agnostic.

/** Lucide "rotate-cw"; the universally-recognised rotate-90 glyph. */
export const ROTATE_ICON =
  "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8 M21 3v5h-5";

/** Lucide "trash-2": lid line, can body, two slats. */
export const TRASH_ICON =
  "M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M10 11v6 M14 11v6";

/** Lucide "lock": closed shackle over a body. */
export const LOCK_ICON =
  "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z M7 11V7a5 5 0 0 1 10 0v4";

/** Lucide "lock-open": open shackle over a body. */
export const UNLOCK_ICON =
  "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z M7 11V7a5 5 0 0 1 9.9-1";

/** Lucide "group": corner brackets framing two overlapping tiles. */
export const GROUP_ICON =
  "M3 7V5a2 2 0 0 1 2-2h2 M17 3h2a2 2 0 0 1 2 2v2 M21 17v2a2 2 0 0 1-2 2h-2 M7 21H5a2 2 0 0 1-2-2v-2 M8 8h6v4H8z M11 12h6v4h-6z";

/** Lucide "ungroup": two separated tiles (no frame). */
export const UNGROUP_ICON =
  "M5 4h8v6H5z M11 14h8v6h-8z";

/** Lucide "minus": a single horizontal stroke; switch-to-line mode. */
export const LINE_ICON = "M5 12h14";

/** Lucide "square": switch-to-box mode. */
export const BOX_ICON =
  "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z";

/** Lucide "columns-3": one frame split in three, the liner's row an object repeats on. */
export const REPEAT_ICON =
  "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M9 3v18 M15 3v18";

/** Lucide "unlink-2": a chain link with its bar gone. */
export const DECOUPLE_ICON =
  "M15 7h2a5 5 0 0 1 0 10h-2 M9 17H7A5 5 0 0 1 7 7h2";

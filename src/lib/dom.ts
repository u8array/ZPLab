/** Returns `true` when `el` is a text-input surface that should
 *  intercept keyboard events the global shortcuts and canvas
 *  handlers would otherwise act on (Backspace → delete object,
 *  Ctrl+A → select all objects, etc.). `data-text-surface` marks editor
 *  HOSTS whose focus target is not contenteditable itself (the read-only
 *  CodeMirror pane focuses .cm-scroller; gutters sit beside .cm-content). */
export function isEditableTarget(el: HTMLElement | null): boolean {
  // Listeners on window/document pass whatever `e.target` is; only elements
  // can be editable (and only they have `closest`).
  if (!el || !(el instanceof Element)) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
    el.isContentEditable || el.closest("[data-text-surface]") !== null
  );
}

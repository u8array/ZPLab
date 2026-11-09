import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/** A surface the panel owns but renders elsewhere, like a portaled menu. Moving into it is no exit. */
export const SESSION_SURFACE_ATTRS = { 'data-session-surface': true } as const;

/** The source-edit session's exit surface on a panel root. Not useDismiss:
 *  capture phase, a focusout fallback, and a held exit that swallows the
 *  click so nothing fires under it. */
export function useSessionExit(
  panelRef: RefObject<HTMLElement | null>,
  handlers: { onExit: () => boolean; onEscape: () => void },
): void {
  // Latest closures for the raw DOM listeners (mounted once per session).
  // Layout effect: synced before paint, so no user event sees a stale closure.
  const handlersRef = useRef(handlers);
  useLayoutEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const root = panelRef.current;
    if (!root) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Under a modal's backdrop a held session would swallow every click, so a modal is no exit.
    const modalOpen = () => document.querySelector('[aria-modal="true"]') !== null;
    const inside = (el: Element) => root.contains(el) || el.closest('[data-session-surface]') !== null;
    // Capture-phase, so the exit lands BEFORE the target's own handlers and
    // chrome/stage clicks act on the unfrozen store in the same click. (A
    // click on a canvas OBJECT still needs a second one: the apply re-ids
    // the Konva node under the pointer mid-gesture.)
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target || inside(target) || modalOpen()) return;
      if (!handlersRef.current.onExit()) {
        e.preventDefault();
        e.stopPropagation();
        // Cancelling pointerdown does not suppress the gesture's click, which fires
        // after pointerup, so onClick targets like the pager would still fire under the held session.
        const swallowClick = (ce: Event) => {
          ce.preventDefault();
          ce.stopPropagation();
        };
        document.addEventListener('click', swallowClick, true);
        const disarm = () =>
          // After the click dispatch, which runs synchronously on pointerup.
          setTimeout(() => document.removeEventListener('click', swallowClick, true), 0);
        window.addEventListener('pointerup', disarm, { once: true, capture: true });
        window.addEventListener('pointercancel', disarm, { once: true, capture: true });
      }
    };
    // Fallback for non-pointer focus moves (Tab out, programmatic focus).
    const onFocusOut = () => {
      clearTimeout(timer);
      // Deferred: focusout fires before the new activeElement settles. A
      // window blur (alt-tab) keeps the session; only focus moving elsewhere
      // in the app is "the one person now works the canvas".
      timer = setTimeout(() => {
        if (!document.hasFocus()) return;
        const active = document.activeElement;
        if (active && inside(active)) return;
        if (modalOpen()) return;
        handlersRef.current.onExit();
      }, 0);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      // Each layer takes a press: a visible catalog pin and a non-empty selection are
      // consumed by the editor's keymap before the session sees Escape. The catalog
      // panes run after this native listener, so they opt out by attribute.
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target?.closest('[data-session-exit-ignore]')) handlersRef.current.onEscape();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    root.addEventListener('focusout', onFocusOut);
    root.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', onPointerDown, true);
      root.removeEventListener('focusout', onFocusOut);
      root.removeEventListener('keydown', onKeyDown);
    };
  }, [panelRef]);
}

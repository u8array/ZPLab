import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/** The source-edit session's exit surface on a panel root. Not useDismiss:
 *  capture phase, focusout fallback, and a held exit (onExit false: refusal
 *  or confirm dialog) swallows the click so nothing fires under it. */
export function useSessionExit(
  panelRef: RefObject<HTMLElement | null>,
  handlers: { onExit: () => boolean; onEscape: () => void; suspended: boolean },
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
    // Capture-phase, so the exit lands BEFORE the target's own handlers and
    // chrome/stage clicks act on the unfrozen store in the same click. (A
    // click on a canvas OBJECT still needs a second one: the apply re-ids
    // the Konva node under the pointer mid-gesture.)
    const onPointerDown = (e: PointerEvent) => {
      if (handlersRef.current.suspended) return;
      const target = e.target as Element | null;
      if (!target || root.contains(target)) return;
      if (!handlersRef.current.onExit()) {
        e.preventDefault();
        e.stopPropagation();
        // Cancelling pointerdown does NOT suppress the gesture's click (it is
        // its own event after pointerup), so onClick targets like menu
        // triggers or the pager would still fire under the held session.
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
        if (handlersRef.current.suspended) return;
        if (!document.hasFocus()) return;
        const active = document.activeElement;
        if (active && root.contains(active)) return;
        handlersRef.current.onExit();
      }, 0);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      // CM's simplifySelection consumes Escape for ANY non-empty selection,
      // so discarding then takes a second press (standard editor behavior).
      if (e.key === 'Escape' && !e.defaultPrevented) handlersRef.current.onEscape();
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

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/** Dismiss a popover/menu on outside-click (a pointerdown beyond `ref`) or
 *  Escape. Listeners attach only while `active`, so a closed menu costs nothing.
 *  `defer` waits a tick before attaching so the opening interaction's own
 *  pointer event (e.g. the right-click that spawns a context menu) doesn't
 *  immediately self-close it. The latest `onDismiss` is read through a ref, so a
 *  fresh inline callback each render doesn't re-bind the listeners. */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  options: { active?: boolean; defer?: boolean } = {},
): void {
  const { active = true, defer = false } = options;
  // Keep the latest callback in a ref so a fresh inline `onDismiss` each render
  // doesn't re-bind the listeners. Synced in a layout effect (before paint, so
  // before any user event can fire) rather than during render.
  const onDismissRef = useRef(onDismiss);
  useLayoutEffect(() => {
    onDismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (!active) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onDismissRef.current();
    };
    // Capture phase and consumed: the open popover is the top layer, so its Escape reaches nothing beneath.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onDismissRef.current();
    };
    const attach = () => {
      window.addEventListener("pointerdown", onPointer);
      window.addEventListener("keydown", onKey, true);
    };
    let timer: number | undefined;
    if (defer) timer = window.setTimeout(attach, 0);
    else attach();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [ref, active, defer]);
}

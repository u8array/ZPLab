import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** Tab-able elements per the WAI-ARIA dialog pattern. The selector
 *  matches the standard set; `[tabindex="-1"]` is intentionally excluded
 *  because such elements are programmatically focusable but not in the
 *  Tab cycle. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((el) => !el.hasAttribute('inert') && el.offsetParent !== null);
}

/** Modal focus management: trap Tab inside the container, close on
 *  Escape, focus the first focusable on mount, and restore the
 *  previously-focused element when the trap is torn down.
 *
 *  Use it in each modal by attaching a ref to the dialog container and
 *  passing the close callback. The hook does nothing if the ref is not
 *  yet attached when it runs. */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
): void {
  // Read the latest onEscape via ref so callers don't need to memoize.
  // Without this the trap would re-mount on every parent render, stealing
  // focus from inputs as the user types.
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus into the dialog. Falling back to the container itself
    // ensures Esc/Tab handlers receive keys even when the dialog has
    // no focusable controls (e.g. a notice with only a button still
    // works; an unusual dialog with none would still capture Esc).
    const initial = focusableElements(container)[0] ?? container;
    if (!container.contains(document.activeElement)) {
      initial.focus();
    }

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onEscapeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;

      const focusable = focusableElements(container);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    // Listener on the container, not document: keydown bubbles from
    // the focused element up through the container, so we still see
    // every key while focus is inside. Listening on document would
    // mean stacked modals (e.g. confirm-on-top-of-import) all react to
    // a single Escape press and the entire stack would collapse.
    container.addEventListener('keydown', handleKey);
    return () => {
      container.removeEventListener('keydown', handleKey);
      // A close handler that already moved focus elsewhere must win, or the
      // restore re-blurs its target and can re-trigger blur handlers.
      // Contract: such handlers redirect SYNCHRONOUSLY, or they lose to this.
      const active = document.activeElement;
      if (active === null || active === document.body || container.contains(active)) {
        previouslyFocused?.focus?.();
      }
    };
  }, [containerRef]);
}

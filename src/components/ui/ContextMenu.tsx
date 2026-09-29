import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRightIcon } from "@heroicons/react/16/solid";
import { useDismiss } from "../../hooks/useDismiss";

/** One context-menu entry. `labelKey` resolves against the caller's `labels`
 *  map; a raw `label` overrides it (dynamic entries). A `submenu` makes it a
 *  parent row. */
export interface MenuAction {
  id: string;
  labelKey?: string;
  label?: string;
  run?: () => void;
  disabled?: boolean;
  /** Why the entry is disabled, shown as a native title on hover. */
  tooltip?: string;
  danger?: boolean;
  submenu?: MenuAction[];
}

/** Actions are grouped into divider-separated sections. */
export interface MenuSection {
  id: string;
  items: MenuAction[];
}

type IconType = React.ComponentType<{ className?: string }>;

interface Props {
  sections: MenuSection[];
  /** Viewport coords to open at (right-click point or an anchor corner). */
  x: number;
  y: number;
  /** Resolved labels for `labelKey` entries; `label` entries need none. */
  labels?: Record<string, string>;
  /** Icon per action; consumer-owned so the menu model stays pure data. */
  iconFor?: (item: MenuAction) => IconType | undefined;
  onClose: () => void;
  /** Where the menu mounts. A panel that watches for pointer events leaving it passes itself. */
  container?: Element | null;
}

// Close-grace for submenu hover: long enough to survive a diagonal pointer
// path across the rows below, short enough not to feel sticky.
const SUBMENU_CLOSE_GRACE_MS = 220;

const MENU_BOX =
  "z-[60] min-w-44 bg-surface border border-border rounded-lg shadow-2xl p-1";

function labelOf(item: MenuAction, labels?: Record<string, string>): string {
  return item.label ?? (item.labelKey ? labels?.[item.labelKey] ?? item.labelKey : item.id);
}

function RowIcon({ icon: Icon }: { icon?: IconType }) {
  return Icon ? <Icon className="w-4 h-4 shrink-0" /> : null;
}

function Row({
  item,
  labels,
  iconFor,
  onClose,
  openId,
  setOpenId,
}: {
  item: MenuAction;
  labels?: Record<string, string>;
  iconFor?: (item: MenuAction) => IconType | undefined;
  onClose: () => void;
  /** Which sibling's submenu is open; owned by the level above so at most one
   *  submenu per level exists (opening a sibling closes the lingering one and
   *  an overshoot onto a closing box can't revive it over the new one). */
  openId: string | null;
  setOpenId: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const subOpen = openId === item.id;
  const wrapRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  // Grace timer: an immediate close on mouseleave kills the submenu while the
  // pointer travels diagonally across the rows below toward it; a short delay
  // lets it arrive, and re-entering cancels the close.
  const closeTimer = useRef<number | null>(null);
  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const openSub = () => {
    cancelClose();
    if (!item.disabled) setOpenId(item.id);
  };
  const scheduleClose = () => {
    cancelClose();
    // Functional guard: if a sibling opened during the grace, leave it alone.
    closeTimer.current = window.setTimeout(
      () => setOpenId((cur) => (cur === item.id ? null : cur)),
      SUBMENU_CLOSE_GRACE_MS,
    );
  };
  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);
  // Children coordinate their own level.
  const [childOpenId, setChildOpenId] = useState<string | null>(null);
  // Submenus open to the right by default; flip left and/or shift up once the
  // real size is known so a nested level can't run off the viewport.
  const [flip, setFlip] = useState<{ left: boolean; up: number }>({ left: false, up: 0 });
  const cls = `w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs font-mono rounded transition-colors ${
    item.disabled
      ? "text-muted/40 cursor-not-allowed"
      : item.danger
        ? "text-text hover:bg-error/15 hover:text-error"
        : "text-text hover:bg-surface-2"
  }`;

  useLayoutEffect(() => {
    if (!subOpen) return;
    const wrap = wrapRef.current;
    const sub = subRef.current;
    if (!wrap || !sub) return;
    const wr = wrap.getBoundingClientRect();
    const sr = sub.getBoundingClientRect();
    const overBottom = sr.bottom + 4 - window.innerHeight;
    setFlip({
      left: wr.right + sr.width + 4 > window.innerWidth,
      up: overBottom > 0 ? overBottom : 0,
    });
  }, [subOpen]);

  const submenu = item.submenu;
  if (submenu?.length) {
    return (
      <div
        ref={wrapRef}
        className="relative"
        onMouseEnter={openSub}
        onMouseLeave={scheduleClose}
      >
        <button disabled={item.disabled} title={item.tooltip} className={cls}>
          <RowIcon icon={iconFor?.(item)} />
          <span className="flex-1">{labelOf(item, labels)}</span>
          <ChevronRightIcon className="w-3.5 h-3.5 text-muted shrink-0" />
        </button>
        {subOpen && (
          // Padding (not margin) forms the visual gap, so the bridge between
          // row and submenu stays hoverable and crossing it can't mouseleave.
          <div
            className={`absolute top-0 ${flip.left ? "right-full pr-0.5" : "left-full pl-0.5"}`}
            style={flip.up ? { transform: `translateY(-${flip.up}px)` } : undefined}
          >
            <div ref={subRef} className={MENU_BOX}>
              {submenu.map((s) => (
                <Row
                  key={s.id}
                  item={s}
                  labels={labels}
                  iconFor={iconFor}
                  onClose={onClose}
                  openId={childOpenId}
                  setOpenId={setChildOpenId}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      disabled={item.disabled}
      title={item.tooltip}
      className={cls}
      onClick={() => {
        if (item.disabled) return;
        item.run?.();
        onClose();
      }}
    >
      <RowIcon icon={iconFor?.(item)} />
      <span className="flex-1">{labelOf(item, labels)}</span>
    </button>
  );
}

/** Pure view over `MenuSection[]`; builders stay data-only. */
export function ContextMenu({ sections, x, y, labels, iconFor, onClose, container }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  // One open submenu across the whole root level (sections included).
  const [openId, setOpenId] = useState<string | null>(null);

  // Clamp into the viewport once the real size is known.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - r.width - 4),
      y: Math.min(y, window.innerHeight - r.height - 4),
    });
  }, [x, y]);

  // Defer so the opening right-click's own pointer events don't self-close.
  useDismiss(ref, onClose, { defer: true });

  // Also dismiss on scroll (the fixed menu would detach from its anchor) and on
  // a context menu elsewhere (keyboard Menu key fires no pointerdown, so two
  // could otherwise stack). Mounted after the opening event, so it isn't caught.
  // onClose via ref so an inline callback doesn't re-bind the listeners.
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onCloseRef.current();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("contextmenu", close, true);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("contextmenu", close, true);
    };
  }, []);

  return createPortal(
    <div ref={ref} className={`fixed ${MENU_BOX}`} style={{ left: pos.x, top: pos.y }} role="menu">
      {sections.map((section, i) => (
        <div key={section.id}>
          {i > 0 && <div className="my-1 border-t border-border" />}
          {section.items.map((item) => (
            <Row
              key={item.id}
              item={item}
              labels={labels}
              iconFor={iconFor}
              onClose={onClose}
              openId={openId}
              setOpenId={setOpenId}
            />
          ))}
        </div>
      ))}
    </div>,
    container ?? document.body,
  );
}

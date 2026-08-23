import { useRef, useState } from "react";

const OUTPUT_MIN_H = 80;
const OUTPUT_MAX_H = 600;
export const OUTPUT_DEFAULT_H = 208;
const LS_KEY = "zpl-output-panel";

function loadPanelState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { collapsed: boolean; height: number };
  } catch {
    return null;
  }
}

function savePanelState(collapsed: boolean, height: number) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ collapsed, height }));
  } catch {
    // localStorage not available (e.g. private browsing with storage blocked)
  }
}

/** `lockCollapse`: an open source-edit buffer must stay visible, so the drag
 *  rail clamps at the minimum height instead of collapsing (which would
 *  unmount the editor with no expand affordance left). */
export function useOutputPanel(defaultH = OUTPUT_DEFAULT_H, lockCollapse = false) {
  const saved = loadPanelState();
  const [height, setHeight] = useState(saved?.height ?? defaultH);
  const [collapsed, setCollapsed] = useState(saved?.collapsed ?? true);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = {
      startY: e.clientY,
      startH: collapsed ? OUTPUT_MIN_H : height,
    };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - ev.clientY;
      const next = Math.min(
        OUTPUT_MAX_H,
        Math.max(OUTPUT_MIN_H, dragRef.current.startH + delta),
      );
      if (next <= OUTPUT_MIN_H) {
        if (lockCollapse) {
          setCollapsed(false);
          setHeight(OUTPUT_MIN_H);
          savePanelState(false, OUTPUT_MIN_H);
          return;
        }
        setCollapsed(true);
        savePanelState(true, height);
        dragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        return;
      }
      setCollapsed(false);
      setHeight(next);
      savePanelState(false, next);
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const collapse = () => {
    if (lockCollapse) return;
    setCollapsed(true);
    savePanelState(true, height);
  };
  const expand = () => {
    const h = height < OUTPUT_MIN_H ? OUTPUT_DEFAULT_H : height;
    setHeight(h);
    setCollapsed(false);
    savePanelState(false, h);
  };

  return { height, collapsed, onMouseDown, collapse, expand };
}

import { useState } from "react";

const OUTPUT_MIN_H = 80;
const OUTPUT_MAX_H = 600;
export const OUTPUT_DEFAULT_H = 208;
const LS_KEY = "zpl-output-panel";

interface PanelState {
  collapsed: boolean;
  height: number;
}

function loadPanelState(): PanelState | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PanelState;
  } catch {
    return null;
  }
}

function savePanelState(state: PanelState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    // localStorage not available (e.g. private browsing with storage blocked)
  }
}

/** `lockCollapse`: an open source-edit buffer must stay visible, so the drag
 *  rail clamps at the minimum height instead of collapsing (which would
 *  unmount the editor with no expand affordance left). */
export function useOutputPanel(defaultH = OUTPUT_DEFAULT_H, lockCollapse = false) {
  const [saved] = useState(loadPanelState);
  const [height, setHeight] = useState(saved?.height ?? defaultH);
  const [collapsed, setCollapsed] = useState(saved?.collapsed ?? true);

  // Absolute tracking (the panel is the window's bottom row): a delta from a
  // seeded start height would jump on expand across the collapse boundary.
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    let isCollapsed = collapsed;
    // The grab lands a few px into the rail; uncorrected, the first move snaps by that.
    const grabOffset = e.clientY - e.currentTarget.getBoundingClientRect().top;
    // Gesture-local: one gesture can resize AND collapse; the height must reach storage.
    let liveHeight = height;
    const onMove = (ev: MouseEvent) => {
      const desired = window.innerHeight - ev.clientY + grabOffset;
      if (desired <= OUTPUT_MIN_H) {
        if (lockCollapse) {
          setCollapsed(false);
          setHeight(OUTPUT_MIN_H);
          savePanelState({ collapsed: false, height: OUTPUT_MIN_H });
          return;
        }
        if (!isCollapsed) {
          isCollapsed = true;
          setCollapsed(true);
          savePanelState({ collapsed: true, height: liveHeight });
        }
        return;
      }
      const next = Math.min(OUTPUT_MAX_H, desired);
      isCollapsed = false;
      liveHeight = next;
      setCollapsed(false);
      setHeight(next);
      savePanelState({ collapsed: false, height: next });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const collapse = () => {
    if (lockCollapse) return;
    setCollapsed(true);
    savePanelState({ collapsed: true, height });
  };
  const expand = () => {
    const h = height < OUTPUT_MIN_H ? OUTPUT_DEFAULT_H : height;
    setHeight(h);
    setCollapsed(false);
    savePanelState({ collapsed: false, height: h });
  };

  return { height, collapsed, onMouseDown, collapse, expand };
}

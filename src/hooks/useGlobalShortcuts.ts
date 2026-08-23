import { useEffect } from "react";
import { useLabelStore, useHistory, getCurrentObjects, selectEditorFrozen } from "../store/labelStore";
import { nextRotation } from "../components/Canvas/rotationGeometry";
import { isEditableTarget } from "../lib/dom";

export function useGlobalShortcuts() {
  const duplicateSelectedObjects = useLabelStore((s) => s.duplicateSelectedObjects);
  const copySelectedObjects = useLabelStore((s) => s.copySelectedObjects);
  const pasteObjects = useLabelStore((s) => s.pasteObjects);
  const selectObjects = useLabelStore((s) => s.selectObjects);
  const setCanvasSettings = useLabelStore((s) => s.setCanvasSettings);
  const setCurrentPage = useLabelStore((s) => s.setCurrentPage);
  const setSelectionLocked = useLabelStore((s) => s.setSelectionLocked);
  const groupSelection = useLabelStore((s) => s.groupSelection);
  const ungroup = useLabelStore((s) => s.ungroup);
  const { undo, redo } = useHistory();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Preview overlay or an open source buffer freezes the design; every
      // shortcut here either edits the model or changes the selection
      // /page, both of which would visibly drift away from the frozen
      // snapshot. Block them wholesale.
      if (selectEditorFrozen(useLabelStore.getState())) return;
      const mod = e.metaKey || e.ctrlKey;

      // Editable targets keep their native undo/redo, copy/paste and
      // select-all; every document shortcut below (incl. Ctrl+Z) applies only
      // outside text fields, so typing in an input isn't hijacked by the model.
      if (isEditableTarget(e.target as HTMLElement)) return;

      if (mod && e.code === "KeyZ") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.code === "KeyA") {
        e.preventDefault();
        selectObjects(getCurrentObjects().map((o) => o.id));
        return;
      }
      if (mod && e.code === "KeyD") {
        e.preventDefault();
        duplicateSelectedObjects();
        return;
      }
      if (mod && e.code === "KeyC") {
        if (window.getSelection()?.toString()) return;
        e.preventDefault();
        copySelectedObjects();
        return;
      }
      if (mod && e.code === "KeyV") {
        e.preventDefault();
        pasteObjects();
        return;
      }
      if (mod && e.code === "KeyL") {
        // Ctrl+L locks the current selection, Ctrl+Shift+L unlocks. No-op
        // for an empty selection so the browser's default address-bar
        // focus binding stays intact when nothing is selected.
        const ids = useLabelStore.getState().selectedIds;
        if (ids.length === 0) return;
        e.preventDefault();
        setSelectionLocked(!e.shiftKey);
        return;
      }
      if (mod && e.code === "KeyG") {
        // Ctrl+G groups the current selection, Ctrl+Shift+G ungroups.
        // Listed before the bare-G grid toggle so the modifier wins.
        e.preventDefault();
        if (e.shiftKey) ungroup();
        else groupSelection();
        return;
      }
      if (e.code === "KeyG" && !mod) {
        e.preventDefault();
        setCanvasSettings({ showGrid: !useLabelStore.getState().canvasSettings.showGrid });
      }
      if (e.code === "KeyS" && !mod) {
        e.preventDefault();
        setCanvasSettings({ snapEnabled: !useLabelStore.getState().canvasSettings.snapEnabled });
      }
      if (e.code === "KeyR" && !mod) {
        e.preventDefault();
        const current = useLabelStore.getState().canvasSettings.viewRotation;
        setCanvasSettings({ viewRotation: nextRotation(current) });
      }
      if (e.code === "PageUp") {
        e.preventDefault();
        const { currentPageIndex } = useLabelStore.getState();
        if (currentPageIndex > 0) setCurrentPage(currentPageIndex - 1);
      }
      if (e.code === "PageDown") {
        e.preventDefault();
        const { currentPageIndex, pages } = useLabelStore.getState();
        if (currentPageIndex < pages.length - 1) setCurrentPage(currentPageIndex + 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, duplicateSelectedObjects, copySelectedObjects, pasteObjects, selectObjects, setCanvasSettings, setCurrentPage, setSelectionLocked, groupSelection, ungroup]);
}

import { useEffect } from "react";
import { useLabelStore, useHistory, getCurrentObjects, selectEditorFrozen, selectRenderPages, selectRenderPageIndex } from "../store/labelStore";
import { nextRotation } from "../components/Canvas/rotationGeometry";
import { isEditableTarget } from "../lib/dom";
import { findObjectById, hasLockedAncestor, isGroup } from "@zplab/core/types/Group";
import { objectResolvesCtrl, specForObject } from "@zplab/core/registry";
import { contentSanitiser } from "@zplab/core/registry/contentSpec";
import { serialSeed } from "@zplab/core/registry/serialField";
import { getObjectStringContent } from "@zplab/core/lib/variableBinding";
import { resolvedContentLength } from "@zplab/core/lib/fnTemplate";
import { findAtomicMarker } from "../lib/markerTokens";

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
    const onType = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableTarget(e.target as HTMLElement)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const backspace = e.key === "Backspace";
      if (!backspace && [...e.key].length !== 1) return;
      // Space still activates a focused control through its native keyboard behavior.
      if (e.key === " " && e.target instanceof Element && e.target.closest('button, a, [role="button"], [role="checkbox"]')) return;
      const state = useLabelStore.getState();
      if (selectEditorFrozen(state) || state.selectedIds.length !== 1) return;
      const objects = getCurrentObjects();
      const obj = findObjectById(objects, state.selectedIds[0] ?? "");
      if (!obj || isGroup(obj) || obj.locked || hasLockedAncestor(objects, obj.id)) return;
      const content = getObjectStringContent(obj);
      if (content === undefined) return;
      // Capture before canvas shortcuts: G/S/R and Space become content, and
      // Backspace edits the content instead of deleting the selected object.
      e.preventDefault();
      e.stopImmediatePropagation();
      // ponytail: append-only canvas typing; use the content editor for caret/IME editing.
      const last = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(content)].at(-1);
      const end = findAtomicMarker(content, content.length, "backspace")?.start ?? last?.index ?? 0;
      let next = backspace ? content.slice(0, end) : content + e.key;
      const spec = specForObject(obj);
      next = "serial" in obj.props && obj.props.serial ? serialSeed(next, spec) : spec ? contentSanitiser(spec)(next) : next;
      if (spec?.maxLength !== undefined &&
        resolvedContentLength(next, state.variables, objectResolvesCtrl(obj)) > Math.max(spec.maxLength, resolvedContentLength(content, state.variables, objectResolvesCtrl(obj)))) return;
      if (next !== content) state.updateObject(obj.id, { props: { content: next } });
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Editable targets keep their native undo/redo, copy/paste and
      // select-all; every document shortcut below (incl. Ctrl+Z) applies only
      // outside text fields, so typing in an input isn't hijacked by the model.
      if (isEditableTarget(e.target as HTMLElement)) return;

      // Paging is view-only, so it mirrors the pager buttons: the store's own
      // setCurrentPage guard decides (blocked by a preview, open in a session).
      if (e.code === "PageUp") {
        e.preventDefault();
        const index = selectRenderPageIndex(useLabelStore.getState());
        if (index > 0) setCurrentPage(index - 1);
        return;
      }
      if (e.code === "PageDown") {
        e.preventDefault();
        const state = useLabelStore.getState();
        const index = selectRenderPageIndex(state);
        if (index < selectRenderPages(state).length - 1) setCurrentPage(index + 1);
        return;
      }

      // Preview overlay or an open source buffer freezes the design; every
      // shortcut below either edits the model or changes the selection,
      // which would visibly drift away from the frozen snapshot.
      if (selectEditorFrozen(useLabelStore.getState())) return;

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
    };
    window.addEventListener("keydown", onType, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onType, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [undo, redo, duplicateSelectedObjects, copySelectedObjects, pasteObjects, selectObjects, setCanvasSettings, setCurrentPage, setSelectionLocked, groupSelection, ungroup]);
}

import { useState } from "react";
import { TrashIcon } from "@heroicons/react/16/solid";
import { useLabelStore, selectEditorFrozen, selectPreviewLocksEditor, selectRenderPages, selectRenderPageIndex, selectSourceEditing } from "../../store/labelStore";
import { useT } from "../../hooks/useT";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Tooltip } from "../ui/Tooltip";

// A locked button keeps focus and a press on it still reaches the group, so the buttons use aria-disabled.
const btnCls = "w-6 h-4.5 flex items-center justify-center text-muted transition-colors aria-disabled:opacity-25 aria-disabled:cursor-not-allowed aria-disabled:hover:text-muted";
const stepCls = `${btnCls} hover:text-text font-mono text-sm`;

export function PaginationControl() {
  const t = useT();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pageCount = useLabelStore((s) => selectRenderPages(s).length);
  const currentPageIndex = useLabelStore(selectRenderPageIndex);
  const setCurrentPage = useLabelStore((s) => s.setCurrentPage);
  const removePage = useLabelStore((s) => s.removePage);
  const editorFrozen = useLabelStore(selectEditorFrozen);
  const previewLocked = useLabelStore(selectPreviewLocksEditor);
  const sourceEditing = useLabelStore(selectSourceEditing);

  // Hide entirely on single-page documents; adding pages lives in the File menu.
  if (pageCount <= 1) return null;

  // Paging is view-only (see setCurrentPage); deleting mutates the model
  // and stays frozen.
  const canPrev = !previewLocked && currentPageIndex > 0;
  const canNext = !previewLocked && currentPageIndex < pageCount - 1;

  const indicator = t.app.pageIndicatorFmt
    .replace("{current}", String(currentPageIndex + 1))
    .replace("{total}", String(pageCount));

  return (
    <div
      role="group"
      aria-label={indicator}
      // A press must not take focus from the editor, or the session exit's focusout handler runs.
      onMouseDown={(e) => {
        if (sourceEditing) e.preventDefault();
      }}
      className="flex items-center gap-1"
    >
      <Tooltip content={t.app.prevPage}>
        <button
          onClick={() => setCurrentPage(currentPageIndex - 1)}
          aria-disabled={!canPrev}
          aria-label={t.app.prevPage}
          className={stepCls}
        >
          ‹
        </button>
      </Tooltip>
      <span className="font-mono text-[10px] text-text px-2 select-none whitespace-nowrap">
        {currentPageIndex + 1} / {pageCount}
      </span>
      <Tooltip content={t.app.nextPage}>
        <button
          onClick={() => setCurrentPage(currentPageIndex + 1)}
          aria-disabled={!canNext}
          aria-label={t.app.nextPage}
          className={stepCls}
        >
          ›
        </button>
      </Tooltip>
      <div className="w-px h-3.5 bg-border mx-0.5" />
      <Tooltip content={t.app.deletePage}>
        <button
          onClick={() => !editorFrozen && setConfirmOpen(true)}
          aria-disabled={editorFrozen}
          aria-label={t.app.deletePage}
          className={`${btnCls} hover:text-red-400`}
        >
          <TrashIcon className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
      {confirmOpen && (
        <ConfirmDialog
          message={t.app.deletePageConfirm}
          confirmLabel={t.app.deletePage}
          cancelLabel={t.app.cancel}
          destructive
          onConfirm={() => {
            removePage(currentPageIndex);
            setConfirmOpen(false);
          }}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}

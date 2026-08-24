import { useState } from "react";
import { TrashIcon } from "@heroicons/react/16/solid";
import { useLabelStore, selectEditorFrozen, selectPreviewLocksEditor, selectRenderPages, selectRenderPageIndex } from "../../store/labelStore";
import { useT } from "../../hooks/useT";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Tooltip } from "../ui/Tooltip";

export function PaginationControl() {
  const t = useT();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pageCount = useLabelStore((s) => selectRenderPages(s).length);
  const currentPageIndex = useLabelStore(selectRenderPageIndex);
  const setCurrentPage = useLabelStore((s) => s.setCurrentPage);
  const removePage = useLabelStore((s) => s.removePage);
  const editorFrozen = useLabelStore(selectEditorFrozen);
  const previewLocked = useLabelStore(selectPreviewLocksEditor);

  // Hide entirely on single-page documents; adding pages lives in the File menu.
  if (pageCount <= 1) return null;

  // Paging is view-only (see setCurrentPage); deleting mutates the model
  // and stays frozen.
  const canPrev = !previewLocked && currentPageIndex > 0;
  const canNext = !previewLocked && currentPageIndex < pageCount - 1;

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 bg-surface border border-border rounded px-1 py-0.5">
      <Tooltip content={t.app.prevPage}>
        <button
          onClick={() => canPrev && setCurrentPage(currentPageIndex - 1)}
          disabled={!canPrev}
          aria-label={t.app.prevPage}
          className="w-6 h-6 flex items-center justify-center text-muted hover:text-text disabled:opacity-25 disabled:cursor-not-allowed font-mono text-sm transition-colors"
        >
          ‹
        </button>
      </Tooltip>
      <span
        aria-label={t.app.pageIndicatorFmt
          .replace("{current}", String(currentPageIndex + 1))
          .replace("{total}", String(pageCount))}
        className="font-mono text-[10px] text-text px-2 select-none whitespace-nowrap"
      >
        {currentPageIndex + 1} / {pageCount}
      </span>
      <Tooltip content={t.app.nextPage}>
        <button
          onClick={() => canNext && setCurrentPage(currentPageIndex + 1)}
          disabled={!canNext}
          aria-label={t.app.nextPage}
          className="w-6 h-6 flex items-center justify-center text-muted hover:text-text disabled:opacity-25 disabled:cursor-not-allowed font-mono text-sm transition-colors"
        >
          ›
        </button>
      </Tooltip>
      <div className="w-px h-3.5 bg-border mx-0.5" />
      <Tooltip content={t.app.deletePage}>
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={editorFrozen}
          aria-label={t.app.deletePage}
          className="w-6 h-6 flex items-center justify-center text-muted hover:text-red-400 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
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

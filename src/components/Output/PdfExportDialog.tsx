import { useId } from "react";
import { DialogShell } from "../ui/DialogShell";
import { useT } from "../../hooks/useT";
import { formatTemplate } from "../../lib/formatTemplate";
import type { PdfExportProgress } from "../../hooks/usePdfExport";

/** Progress of a running PDF export. Once the file is being written there is nothing left to cancel. */
export function PdfExportDialog({ progress, onCancel }: { progress: NonNullable<PdfExportProgress>; onCancel: () => void }) {
  const t = useT();
  const titleId = useId();
  return (
    <DialogShell onClose={onCancel} labelledBy={titleId} boxClassName="bg-surface border border-border rounded shadow-lg flex flex-col w-[360px] max-w-[95vw]">
      <h2 id={titleId} className="px-5 pt-4 text-sm font-medium text-text">
        {t.pdfExport.title}
      </h2>
      <p className="px-5 py-3 text-xs text-muted">
        {progress.saving ? t.pdfExport.saving : formatTemplate(t.pdfExport.progressFmt, { i: String(Math.min(progress.done + 1, progress.total)), n: String(progress.total) })}
      </p>
      <progress className="mx-5 h-1.5 w-auto accent-accent" value={progress.done} max={progress.total} />
      <div className="flex justify-end px-4 py-3 border-t border-border">
        {!progress.saving && (
          <button type="button" onClick={onCancel} className="px-4 py-1.5 rounded text-xs font-mono border border-border text-text hover:bg-surface-2 transition-colors">
            {t.pdfExport.cancel}
          </button>
        )}
      </div>
    </DialogShell>
  );
}

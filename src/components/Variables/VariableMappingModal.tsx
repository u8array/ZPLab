import { TableCellsIcon, XMarkIcon } from '@heroicons/react/16/solid';
import { useT } from '../../hooks/useT';
import { DialogShell } from '../ui/DialogShell';
import { MappingEditor } from './MappingEditor';
import { useMappingDraft } from './useMappingDraft';

interface Props {
  onClose: () => void;
  /** Opens the CSV file picker (the same one as the File menu's import). */
  onImportCsv: () => void;
}

/** Dialog chrome around the shared MappingEditor. Falls back to a close-only
 *  shell when there is no editable dataset (e.g. the raw-text cache was lost on
 *  a mid-session reload). */
export function VariableMappingModal({ onClose, onImportCsv }: Props) {
  const t = useT();
  const tv = t.variables;
  const draft = useMappingDraft();

  if (!draft.hasEditableDataset) {
    return (
      <DialogShell
        onClose={onClose}
        labelledBy="variable-mapping-title"
        boxClassName="bg-surface border border-border rounded-lg w-80 shadow-2xl"
      >
        <div className="p-4 font-mono text-xs text-muted">
          <p className="mb-3">{tv.csvNoCsvLoaded}</p>
          <div className="flex items-center gap-2">
            <button
              onClick={onImportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono bg-accent text-bg hover:opacity-90 transition-opacity"
            >
              <TableCellsIcon className="w-3.5 h-3.5" />
              {t.app.importCsvData}
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded text-xs font-mono text-text border border-border hover:bg-surface-2 transition-colors"
            >
              {tv.csvClose}
            </button>
          </div>
        </div>
      </DialogShell>
    );
  }

  const confirm = () => {
    draft.apply();
    onClose();
  };

  return (
    <DialogShell
      onClose={onClose}
      labelledBy="variable-mapping-title"
      boxClassName="bg-surface border border-border rounded-lg w-128 flex flex-col shadow-2xl max-h-[85vh]"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <span
          id="variable-mapping-title"
          className="font-mono text-xs text-muted uppercase tracking-widest"
        >
          {tv.csvMappingTitle}
        </span>
        <button
          onClick={onClose}
          aria-label={tv.csvClose}
          className="p-0.5 rounded text-muted hover:text-text hover:bg-surface-2 transition-colors"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="px-4 py-4 overflow-y-auto">
        <MappingEditor draft={draft} />
      </div>

      <div className="flex justify-end items-center gap-2 px-4 py-3 border-t border-border shrink-0">
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded text-xs font-mono text-muted hover:text-text hover:bg-surface-2 transition-colors"
        >
          {tv.cancel}
        </button>
        <button
          onClick={confirm}
          disabled={!draft.canApply}
          className="px-3 py-1.5 rounded text-xs font-mono bg-accent text-bg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {tv.csvApply}
        </button>
      </div>
    </DialogShell>
  );
}

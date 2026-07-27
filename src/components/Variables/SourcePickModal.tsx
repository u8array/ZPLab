import { useState } from 'react';
import { ArrowUpTrayIcon, XMarkIcon } from '@heroicons/react/16/solid';
import { useT } from '../../hooks/useT';
import { DialogShell } from '../ui/DialogShell';
import { Select } from '../ui/Select';

interface Props {
  /** Header text (filename / profile name) and its full-value tooltip. */
  titleText: string;
  titleAttr: string;
  /** Field label for the single choice (worksheet / table). */
  label: string;
  options: string[];
  onLoad: (value: string) => Promise<boolean>;
  onCancel: () => void;
}

/** Pick one entry from a source (excel worksheet, sqlite table) then Load.
 *  Always shown so a dataset replace takes a deliberate Load click. */
export function SourcePickModal({ titleText, titleAttr, label, options, onLoad, onCancel }: Props) {
  const tv = useT().variables;
  const [value, setValue] = useState(() => options[0] ?? '');
  const [loading, setLoading] = useState(false);

  const handleLoad = () => {
    if (value === '') return;
    setLoading(true);
    void onLoad(value).then((ok) => {
      if (!ok) setLoading(false);
    });
  };

  return (
    <DialogShell
      onClose={onCancel}
      labelledBy="source-pick-title"
      boxClassName="bg-surface border border-border rounded-lg w-80 flex flex-col shadow-2xl"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span
          id="source-pick-title"
          className="font-mono text-xs text-muted uppercase tracking-widest truncate"
          title={titleAttr}
        >
          {titleText}
        </span>
        <button
          onClick={onCancel}
          aria-label={tv.csvClose}
          className="p-0.5 rounded text-muted hover:text-text hover:bg-surface-2 transition-colors"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-col gap-1 px-4 py-4 font-mono text-xs">
        <label className="text-[10px] text-muted uppercase tracking-wider">{label}</label>
        <Select<string>
          value={value}
          onChange={setValue}
          groups={[{ options: options.map((o) => ({ value: o, label: o })) }]}
        />
      </div>

      <div className="flex justify-end items-center gap-2 px-4 py-3 border-t border-border">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded text-xs font-mono text-muted hover:text-text hover:bg-surface-2 transition-colors"
        >
          {tv.cancel}
        </button>
        <button
          onClick={handleLoad}
          disabled={value === '' || loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono bg-accent text-bg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          <ArrowUpTrayIcon className="w-3.5 h-3.5" />
          {tv.dbLoad}
        </button>
      </div>
    </DialogShell>
  );
}

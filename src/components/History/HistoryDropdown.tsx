import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useDismiss } from '../../hooks/useDismiss';
import {
  ChevronDownIcon,
  PlusIcon,
  TrashIcon,
  PencilIcon,
  VariableIcon,
  TableCellsIcon,
  Cog6ToothIcon,
  RectangleGroupIcon,
  DocumentIcon,
  ArrowsPointingOutIcon,
  ArrowsRightLeftIcon,
  ArrowsUpDownIcon,
  EllipsisHorizontalIcon,
  FlagIcon,
  FolderOpenIcon,
} from '@heroicons/react/16/solid';
import { useT } from '../../hooks/useT';
import type { Translations } from '../../locales';
import { useHistoryEntries } from '../../store/useHistoryEntries';
import type { HistoryStepKind } from '../../lib/historyStep';
import { formatStep } from '../../lib/historyFormat';
import { Tooltip } from '../ui/Tooltip';

const KIND_ICON: Record<HistoryStepKind, ComponentType<{ className?: string }>> = {
  initial: FlagIcon,
  load: FolderOpenIcon,
  add: PlusIcon,
  remove: TrashIcon,
  move: ArrowsRightLeftIcon,
  resize: ArrowsPointingOutIcon,
  edit: PencilIcon,
  group: RectangleGroupIcon,
  reorder: ArrowsUpDownIcon,
  variable: VariableIcon,
  dataset: TableCellsIcon,
  label: Cog6ToothIcon,
  page: DocumentIcon,
  mixed: EllipsisHorizontalIcon,
};

/** The timeline list. Split into its own component so the (per-render) timeline
 *  build + descriptor diffs only run while the popover is open, not on every
 *  store commit behind a closed trigger. */
function HistoryList({ t }: { t: Translations }) {
  const { entries, currentIndex, jumpTo, clear, canClear, locked } = useHistoryEntries();
  const currentRef = useRef<HTMLButtonElement>(null);

  // The current step sits after the past entries, so in a long history it opens
  // below the fold; keep it in view on open and as scrubbing moves the cursor.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentIndex]);

  return (
    <>
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0">
        <span className="text-xs font-medium text-text">{t.history.title}</span>
        <Tooltip content={t.history.clear}>
          <button
            type="button"
            onClick={clear}
            disabled={!canClear}
            aria-label={t.history.clear}
            className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-text hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted"
          >
            <TrashIcon className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      </div>
      {entries.length <= 1 ? (
        <div className="p-4 text-center text-muted text-xs">{t.history.empty}</div>
      ) : (
        <div className="flex flex-col max-h-80 overflow-y-auto">
          {entries.map((entry, i) => {
            const Icon = KIND_ICON[entry.descriptor.kind];
            // Steps after the current one are redoable future; mute them so the
            // user reads the timeline position at a glance.
            const isFuture = i > currentIndex;
            return (
              <button
                key={i}
                ref={entry.isCurrent ? currentRef : undefined}
                type="button"
                onClick={() => jumpTo(i)}
                disabled={locked}
                aria-current={entry.isCurrent}
                className={`flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors disabled:cursor-default ${
                  entry.isCurrent
                    ? 'bg-accent/10 text-accent'
                    : isFuture
                      ? 'text-muted/60 enabled:hover:bg-surface-2'
                      : 'text-text enabled:hover:bg-surface-2'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{formatStep(t, entry.descriptor)}</span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

/** History timeline as a popover anchored to the undo controls in the header.
 *  The list stays open while jumping so the user can scrub back and forth;
 *  an outside click and Escape close it. */
export function HistoryDropdown() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useDismiss(rootRef, () => setOpen(false), { active: open });

  return (
    <div ref={rootRef} className="relative">
      <Tooltip content={t.history.title}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={t.history.title}
          aria-haspopup="menu"
          aria-expanded={open}
          className={`p-1.5 rounded transition-colors ${
            open ? 'text-accent bg-border' : 'text-muted hover:text-text hover:bg-border'
          }`}
        >
          <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </Tooltip>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-60 bg-surface border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden">
          <HistoryList t={t} />
        </div>
      )}
    </div>
  );
}

import { useId, type ReactNode } from 'react';
import { ChevronDownIcon } from '@heroicons/react/16/solid';
import { useCollapsibleState } from '../ui/useCollapsibleState';
import { ZplCmd } from './ZplCmd';

const titleCls =
  'font-mono text-[10px] font-semibold uppercase tracking-widest text-text';

/** Status dot: accent when the section is open/active, muted otherwise. */
function Dot({ active }: { active: boolean }) {
  return (
    <span
      className={`w-1.5 h-1.5 rounded-sm shrink-0 ${active ? 'bg-accent' : 'bg-border-2'}`}
    />
  );
}

function CardLabel({ active, title }: { active: boolean; title: ReactNode }) {
  return (
    <>
      <Dot active={active} />
      <span className={titleCls}>{title}</span>
    </>
  );
}

// bg-surface on a same-coloured panel: the border carries the edge in dark,
// the shadow lifts the card in light (panel stays bg-surface, not bg-bg, so it
// keeps a clear border against the canvas).
const cardCls = 'rounded-lg border border-border bg-surface shadow-sm overflow-hidden';
const bodyCls = 'px-2.5 pb-3 pt-0.5 flex flex-col gap-3';

interface SectionCardProps {
  /** Stable id; persists open-state under the shared `zpl:section:` keys. */
  id: string;
  title: ReactNode;
  defaultOpen?: boolean;
  /** ZPL command this single-command section maps to (e.g. ^FN); shown when
   *  showZplCommands is on. Omit for multi-command sections. */
  cmd?: string;
  /** Compact control rendered right-aligned in the header, outside the collapse
   *  toggle so its own clicks don't fold the section (e.g. the Line|Box mode). */
  headerAction?: ReactNode;
  children: ReactNode;
}

/**
 * Collapsible properties section as a self-contained card. Renders its own
 * card chrome (dot + title + chevron) for the Properties panel and reuses
 * CollapsibleSection's persistence via `useCollapsibleState`, so the open
 * state survives regardless of which renderer drew the section.
 */
export function SectionCard({
  id,
  title,
  defaultOpen = true,
  cmd,
  headerAction,
  children,
}: SectionCardProps) {
  const [open, setOpen] = useCollapsibleState(id, defaultOpen);
  const contentId = useId();
  const toggle = () => setOpen((o) => !o);
  return (
    <div className={cardCls}>
      <div className="flex items-center gap-2 px-2.5 py-2.5">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={contentId}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <CardLabel active={open} title={title} />
        </button>
        {headerAction}
        <ZplCmd cmd={cmd} />
        {/* Redundant pointer affordance; the label button is the AT disclosure. */}
        <button
          type="button"
          onClick={toggle}
          tabIndex={-1}
          aria-hidden="true"
          className="shrink-0"
        >
          <ChevronDownIcon
            className={`w-3 h-3 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
          />
        </button>
      </div>
      {open && (
        <div id={contentId} className={bodyCls}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Always-open card (no collapse control), for the lead "Content" section
 * that should never be hidden. Shares the card chrome with SectionCard.
 */
export function StaticSectionCard({
  title,
  cmd,
  headerAction,
  children,
}: {
  title: ReactNode;
  /** ZPL command this single-field section emits (e.g. ^FD); shown as a tag
   *  when showZplCommands is on. Only for sections that map to one command. */
  cmd?: string;
  /** Compact control rendered right-aligned in the header (e.g. a shortcut
   *  into the printer-settings modal). */
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cardCls}>
      <div className="flex items-center gap-2 px-2.5 py-2.5">
        <CardLabel active title={title} />
        <div className="ml-auto flex items-center gap-2">
          {headerAction}
          <ZplCmd cmd={cmd} />
        </div>
      </div>
      <div className={bodyCls}>{children}</div>
    </div>
  );
}

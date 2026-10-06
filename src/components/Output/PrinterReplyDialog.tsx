import { useId, type ReactNode } from "react";
import { XMarkIcon } from "@heroicons/react/16/solid";
import { useT } from "../../hooks/useT";
import type { PrinterOutcome } from "../../lib/printerQuery";
import { failureText, readingText } from "../../lib/printerStatusText";
import { useLabelStore } from "../../store/labelStore";
import { DialogShell } from "../ui/DialogShell";

interface Props<T> {
  title: string;
  titleClassName?: string;
  /** Off by default, so a click inside the panel's dialog does not count as leaving the source session. */
  portal?: boolean;
  read: PrinterOutcome<T> | "reading";
  onClose: () => void;
  children: (value: T) => ReactNode;
  after?: ReactNode;
}

/** One printer reply, with the reading step and the failure wording every reply shares. */
export function PrinterReplyDialog<T>({ title, titleClassName = "", portal, read, onClose, children, after }: Props<T>) {
  const t = useT();
  const loc = t.printerSettings.printerStatus;
  const titleId = useId();
  const step = useLabelStore((s) => s.printerReading);
  return (
    <DialogShell onClose={onClose} labelledBy={titleId} portal={portal} boxClassName="bg-surface border border-border rounded-lg w-[36rem] max-w-[95vw] max-h-[90vh] flex flex-col shadow-2xl">
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-3 border-b border-border">
        <h2 id={titleId} className={`text-sm font-medium text-text ${titleClassName}`}>
          {title}
        </h2>
        <button type="button" onClick={onClose} aria-label={t.app.close} className="p-0.5 rounded text-muted hover:text-text hover:bg-surface-2 transition-colors">
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-col gap-3 px-4 py-4 overflow-auto" aria-live="polite" aria-busy={read === "reading" || undefined}>
        {read === "reading" ? (
          step !== undefined && <span className="text-[10px] font-mono text-muted">{readingText(loc, step)}</span>
        ) : read.kind === "ok" ? (
          children(read.value)
        ) : (
          <span role="alert" className="text-[10px] font-mono text-error">
            {failureText(loc, read)}
          </span>
        )}
        {after}
      </div>
    </DialogShell>
  );
}

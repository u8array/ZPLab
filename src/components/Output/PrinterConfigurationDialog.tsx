import { useId } from "react";
import { XMarkIcon } from "@heroicons/react/16/solid";
import { useT } from "../../hooks/useT";
import type { PrinterOutcome } from "../../lib/printerQuery";
import { failureText, readingText } from "../../lib/printerStatusText";
import { selectPrinterState, useLabelStore } from "../../store/labelStore";
import { DialogShell } from "../ui/DialogShell";
import { labelCls } from "../ui/formStyles";

interface Props {
  read: PrinterOutcome<string> | "reading";
  onClose: () => void;
}

const preCls = "max-h-[50vh] overflow-auto rounded border border-border p-2 font-mono text-[10px] leading-relaxed text-text whitespace-pre m-0";

/** ^HH as the printer echoes it, beside the raw replies. */
export function PrinterConfigurationDialog({ read, onClose }: Props) {
  const t = useT();
  const loc = t.printerSettings.printerStatus;
  const titleId = useId();
  const step = useLabelStore((s) => s.printerReading);
  const raw = useLabelStore((s) => {
    const state = selectPrinterState(s);
    return state.phase === "done" ? state.report.raw : "";
  });
  // Not portaled, so a click inside it does not count as leaving the source session.
  return (
    <DialogShell onClose={onClose} labelledBy={titleId} boxClassName="bg-surface border border-border rounded-lg w-[36rem] max-w-[95vw] max-h-[90vh] flex flex-col shadow-2xl">
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-3 border-b border-border">
        <h2 id={titleId} className="text-sm font-medium text-text">
          {loc.configuration}
        </h2>
        <button type="button" onClick={onClose} aria-label={t.app.close} className="p-0.5 rounded text-muted hover:text-text hover:bg-surface-2 transition-colors">
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-col gap-3 px-4 py-4 overflow-y-auto" aria-live="polite" aria-busy={read === "reading" || undefined}>
        {read === "reading" ? (
          step !== undefined && <span className="text-[10px] font-mono text-muted">{readingText(loc, step)}</span>
        ) : read.kind === "ok" ? (
          <pre className={preCls}>{read.value}</pre>
        ) : (
          <span role="alert" className="text-[10px] font-mono text-error">
            {failureText(loc, read)}
          </span>
        )}
        {raw && (
          <div className="flex flex-col gap-1">
            <span className={labelCls}>{loc.rawReply}</span>
            <pre className={preCls}>{raw}</pre>
          </div>
        )}
      </div>
    </DialogShell>
  );
}

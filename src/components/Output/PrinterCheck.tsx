import { useT } from "../../hooks/useT";
import type { PrinterQueryFailure } from "../../lib/printerQuery";
import { failureText, readingText, reportView, warningsText, type ReadinessTone } from "../../lib/printerStatusText";
import type { PrintTransport } from "../../lib/printTarget";
import { selectPrinterState, useLabelStore } from "../../store/labelStore";

const TONE_CLS: Record<ReadinessTone, string> = { ready: "text-green-400", warning: "text-amber-400", blocked: "text-red-400", unknown: "text-muted" };

interface Props {
  transport: PrintTransport;
  /** A send holds the channel, so the check waits for it. */
  sendBusy: boolean;
  onFailure?: (failure: PrinterQueryFailure) => void;
}

/** Asks the printer before a job goes out, over the channel the job takes. */
export function PrinterCheck({ transport, sendBusy, onFailure }: Props) {
  const t = useT();
  const loc = t.printerSettings.printerStatus;
  const state = useLabelStore((s) => selectPrinterState(s, transport));
  const step = useLabelStore((s) => s.printerReading);
  const reading = step !== undefined;
  const checkPrinter = useLabelStore((s) => s.checkPrinter);
  const check = async () => {
    const result = await checkPrinter(transport);
    if (result && result.kind !== "ok") onFailure?.(result);
  };
  const view = reportView(loc, state.phase === "done" ? state.report : undefined);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void check()}
        disabled={reading || sendBusy}
        className="self-start px-3 py-1.5 text-xs font-mono rounded border border-border text-muted hover:text-text hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {step !== undefined ? readingText(loc, step) : t.zebraPrint.checkPrinter}
      </button>
      <div aria-live="polite" aria-busy={reading || undefined}>
        {state.phase === "failed" && (
          <p role="alert" className="font-mono text-[10px] text-error">
            {failureText(loc, state.failure)}
          </p>
        )}
        {view && (
          <details className="font-mono text-[10px]">
            <summary data-tone={view.line.tone} className={`cursor-pointer ${TONE_CLS[view.line.tone]}`}>
              {view.line.text}
            </summary>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted">
              {view.report.identity && (
                <>
                  <dt>{loc.model}</dt>
                  <dd className="m-0 text-text">{`${view.report.identity.model} ${view.report.identity.firmware}`}</dd>
                </>
              )}
              {view.report.flags && (
                <>
                  <dt>{loc.warnings}</dt>
                  <dd className="m-0 text-text">{warningsText(loc, view.readiness)}</dd>
                </>
              )}
            </dl>
            {view.report.withheld && <p className="mt-1 text-muted">{loc.withheldHint}</p>}
          </details>
        )}
      </div>
    </div>
  );
}

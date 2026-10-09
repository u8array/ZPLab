import { useT } from "../../hooks/useT";
import { primaryButtonCls } from "../ui/formStyles";
import { Tooltip } from "../ui/Tooltip";

/** The system way's body, with no device to pick and nothing to address. */
export function SystemPrintBody({ onPrint, rendering, locked }: { onPrint: () => void; rendering: boolean; locked: boolean }) {
  const t = useT();
  const loc = t.zebraPrint;
  return (
    <div className="flex flex-col gap-3 p-4" aria-busy={rendering || undefined}>
      <p aria-live="polite" className="font-mono text-[10px] text-muted min-h-4">
        {rendering ? loc.systemRendering : ""}
      </p>
      <div className="flex justify-end">
        <Tooltip content={locked ? t.printerSettings.printerStatus.failBusy : undefined}>
          <button onClick={onPrint} disabled={rendering || locked} className={primaryButtonCls}>
            {loc.kindPrint}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

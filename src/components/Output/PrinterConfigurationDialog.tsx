import { useT } from "../../hooks/useT";
import type { PrinterOutcome } from "../../lib/printerQuery";
import { selectPrinterState, useLabelStore } from "../../store/labelStore";
import { labelCls } from "../ui/formStyles";
import { PrinterReplyDialog } from "./PrinterReplyDialog";

interface Props {
  read: PrinterOutcome<string> | "reading";
  onClose: () => void;
}

const preCls = "max-h-[50vh] overflow-auto rounded border border-border p-2 font-mono text-[10px] leading-relaxed text-text whitespace-pre m-0";

/** ^HH as the printer echoes it, beside the raw replies. */
export function PrinterConfigurationDialog({ read, onClose }: Props) {
  const loc = useT().printerSettings.printerStatus;
  const raw = useLabelStore((s) => {
    const state = selectPrinterState(s);
    return state.phase === "done" ? state.report.raw : "";
  });
  return (
    <PrinterReplyDialog
      title={loc.configuration}
      read={read}
      onClose={onClose}
      after={
        raw && (
          <div className="flex flex-col gap-1">
            <span className={labelCls}>{loc.rawReply}</span>
            <pre className={preCls}>{raw}</pre>
          </div>
        )
      }
    >
      {(text) => <pre className={preCls}>{text}</pre>}
    </PrinterReplyDialog>
  );
}

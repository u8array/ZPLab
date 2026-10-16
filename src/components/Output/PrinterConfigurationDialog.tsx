import { useT } from "../../hooks/useT";
import type { ReplyShown } from "../../hooks/useReplyRead";
import { selectPrinterState, useLabelStore } from "../../store/labelStore";
import { PrinterReplyDialog, RawReplyBlock, replyPreCls } from "./PrinterReplyDialog";

interface Props {
  read: ReplyShown<string>;
  onClose: () => void;
}

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
      after={raw && <RawReplyBlock label={loc.rawReply} text={raw} />}
    >
      {(text) => <pre className={replyPreCls}>{text}</pre>}
    </PrinterReplyDialog>
  );
}

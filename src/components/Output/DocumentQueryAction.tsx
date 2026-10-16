import { useReplyRead } from "../../hooks/useReplyRead";
import { useT } from "../../hooks/useT";
import type { DocumentReply } from "../../lib/printerDocumentQuery";
import type { PrinterQueryFailure } from "../../lib/printerQuery";
import type { PrintTransport } from "../../lib/printTarget";
import { useLabelStore } from "../../store/labelStore";
import { primaryButtonCls } from "../ui/formStyles";
import { DocumentReplyDialog } from "./DocumentReplyDialog";

interface Props {
  zpl: () => string;
  commands: readonly string[];
  transport: PrintTransport;
  disabled: boolean;
  onFailure: (failure: PrinterQueryFailure) => void;
}

export function DocumentQueryAction({ zpl, commands, transport, disabled, onFailure }: Props) {
  const t = useT();
  const query = useLabelStore((s) => s.queryDocument);
  const reply = useReplyRead<DocumentReply>();
  const run = () =>
    reply.start(async () => {
      const result = await query(zpl(), commands, transport);
      if (result.kind !== "ok") onFailure(result);
      return result;
    });
  return (
    <>
      <button type="button" onClick={run} disabled={disabled} className={primaryButtonCls}>
        {t.zebraPrint.queryButton}
      </button>
      {reply.read !== undefined && <DocumentReplyDialog read={reply.read} onClose={reply.close} />}
    </>
  );
}

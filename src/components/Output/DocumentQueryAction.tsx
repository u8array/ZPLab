import { useEffect, useRef } from "react";
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
  const waiting = useRef<AbortController>(null);
  const run = () => {
    const controller = new AbortController();
    waiting.current = controller;
    reply.start(async () => {
      const result = await query(zpl(), commands, transport, controller.signal);
      if (result.kind !== "ok") onFailure(result);
      return result;
    });
  };
  const stop = () => waiting.current?.abort();
  useEffect(() => () => waiting.current?.abort(), []);
  // A closed dialog frees the printer channel instead of holding it until the deadline.
  const close = () => {
    stop();
    reply.close();
  };
  return (
    <>
      <button type="button" onClick={run} disabled={disabled} className={primaryButtonCls}>
        {t.zebraPrint.queryButton}
      </button>
      {reply.read !== undefined && <DocumentReplyDialog read={reply.read} onClose={close} onStop={stop} />}
    </>
  );
}

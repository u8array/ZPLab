import { useT } from "../../hooks/useT";
import type { DocumentReply } from "../../lib/printerDocumentQuery";
import type { ReplyShown } from "../../hooks/useReplyRead";
import { documentReplyLines } from "../../lib/printerStatusText";
import { PrinterReplyDialog, RawReplyBlock } from "./PrinterReplyDialog";

interface Props {
  read: ReplyShown<DocumentReply>;
  onClose: () => void;
}

/** The printer's answer to the document: what a parser could read, above the bytes as they arrived. */
export function DocumentReplyDialog({ read, onClose }: Props) {
  const t = useT();
  const loc = t.printerSettings.printerStatus;
  return (
    <PrinterReplyDialog portal title={t.zebraPrint.replyTitle} read={read} onClose={onClose}>
      {(reply) => {
        const lines = documentReplyLines(loc, t.printerSettings.objects, reply);
        return (
          <>
            {lines.length > 0 && (
              <div className="flex flex-col gap-0.5">
                {/* Two readings can word the same line, so the position is the only stable key. */}
                {lines.map((line, index) => (
                  <p key={index} className="m-0 font-mono text-[10px] text-text">
                    {line}
                  </p>
                ))}
              </div>
            )}
            <RawReplyBlock label={reply.configuration ? loc.configuration : loc.rawReply} text={reply.raw} />
          </>
        );
      }}
    </PrinterReplyDialog>
  );
}

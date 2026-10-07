import type { PrinterOutcome } from "../../lib/printerQuery";
import { PrinterReplyDialog } from "../Output/PrinterReplyDialog";

interface Props {
  path: string;
  read: PrinterOutcome<string | null> | "reading";
  /** What to say for null, since a blank sample and an unreadable graphic differ. */
  blankText: string;
  onClose: () => void;
}

/** A stored graphic or a font sample as the printer draws it. */
export function PrinterImageDialog({ path, read, blankText, onClose }: Props) {
  return (
    <PrinterReplyDialog title={path} titleClassName="font-mono" portal read={read} onClose={onClose}>
      {(url) =>
        url ? (
          <img src={url} alt={path} className="max-w-full self-start border border-border bg-white" />
        ) : (
          <span role="alert" className="text-[10px] font-mono text-error">
            {blankText}
          </span>
        )
      }
    </PrinterReplyDialog>
  );
}

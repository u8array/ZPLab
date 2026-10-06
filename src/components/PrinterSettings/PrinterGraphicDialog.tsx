import type { HostGraphic } from "@zplab/core/lib/hostDirectory";
import { useT } from "../../hooks/useT";
import { graphicDataUrl } from "../../lib/printerObjects";
import type { PrinterOutcome } from "../../lib/printerQuery";
import { PrinterReplyDialog } from "../Output/PrinterReplyDialog";

interface Props {
  path: string;
  read: PrinterOutcome<HostGraphic> | "reading";
  onClose: () => void;
}

/** A stored graphic as the printer holds it, decoded like a ^GF field. */
export function PrinterGraphicDialog({ path, read, onClose }: Props) {
  const loc = useT().printerSettings.objects;
  const url = read !== "reading" && read.kind === "ok" ? graphicDataUrl(read.value) : null;
  return (
    <PrinterReplyDialog title={path} titleClassName="font-mono" portal read={read} onClose={onClose}>
      {() =>
        url ? (
          <img src={url} alt={path} className="max-w-full self-start border border-border bg-white" />
        ) : (
          <span role="alert" className="text-[10px] font-mono text-error">
            {loc.graphicUnreadable}
          </span>
        )
      }
    </PrinterReplyDialog>
  );
}

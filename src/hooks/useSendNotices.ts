import { deliveryNotices, exportPrinterImpact, printerImpactNotices } from "../lib/exportImpact";
import { sendZpl } from "../lib/sendZpl";
import { selectCanBatchExport, useLabelStore } from "../store/labelStore";
import { useT } from "./useT";

/** What the bytes about to go out do to the printer, synchronously, because the banner must exist the
 *  moment the send button goes live. */
export function useSendNotices(): readonly string[] {
  const t = useT();
  const pages = useLabelStore((s) => s.pages);
  const currentPageIndex = useLabelStore((s) => s.currentPageIndex);
  const batch = useLabelStore(selectCanBatchExport);
  const zpl = useLabelStore((s) => sendZpl(s, 1));

  // A batch recalls one page, so only that page's delivery is at stake.
  const printed = batch ? pages.slice(currentPageIndex, currentPageIndex + 1) : pages;
  return [...printerImpactNotices(exportPrinterImpact(zpl), t), ...deliveryNotices(printed, t)];
}

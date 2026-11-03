import { usePrintWays } from "../../hooks/usePrintWays";
import type { DocumentQueryFacts, OutputFacts } from "../../lib/outputChoice";
import { queryFacts } from "../../lib/outputChoice.testkit";
import type { PrintTransport } from "../../lib/printTarget";
import { ZebraWayPanel } from "./ZebraWayPanel";

const FACTS: OutputFacts = {
  hasObjects: true,
  documentEmits: true,
  sourceEditing: false,
  canBatchExport: false,
  canBatchPdf: true,
  pdfCurrentPageOnly: false,
  batchRowCount: 0,
};

/** The dialog owns the device lists, so the panel under test gets them from the same hook. */
export function WayPanel({ way, zpl, query = queryFacts() }: { way: PrintTransport; zpl: () => string; query?: DocumentQueryFacts }) {
  const ways = usePrintWays("label", FACTS);
  return <ZebraWayPanel way={way} zpl={zpl} devices={ways.devices} query={query} />;
}

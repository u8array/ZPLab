import { usePrintWays } from "../../hooks/usePrintWays";
import type { DocumentQueryFacts, OutputFacts } from "../../lib/outputChoice";
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

const PRINTS_ONLY: DocumentQueryFacts = { commands: [], prints: true };

/** The dialog owns the device lists, so the panel under test gets them from the same hook. */
export function WayPanel({ way, zpl, query = PRINTS_ONLY }: { way: PrintTransport; zpl: () => string; query?: DocumentQueryFacts }) {
  const ways = usePrintWays("label", FACTS);
  return <ZebraWayPanel way={way} zpl={zpl} devices={ways.devices} query={query} />;
}

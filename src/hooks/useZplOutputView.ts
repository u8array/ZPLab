import { expandSelection } from "@zplab/core/types/Group";
import { generateMultiPageZplWithMap } from "@zplab/core/lib/zplGenerator";
import { sourceEditGate } from "@zplab/core/lib/zplSourceEdit";
import { useLabelStore, useCurrentObjects, selectDocumentEmits } from "../store/labelStore";
import { spanCoveredLines } from "../lib/emitSpanHighlight";
import { printerImpactNotices } from "../lib/exportImpact";
import { usePrinterImpact } from "./usePrinterImpact";
import { useT } from "./useT";

const NO_LINES: ReadonlySet<number> = new Set();
const NO_NOTICES: readonly string[] = [];

/** Everything the output pane derives from the document: the export text always (header
 *  copy works collapsed), highlight and notices only while the pane is visible. */
export function useZplOutputView(collapsed: boolean) {
  const t = useT();
  const label = useLabelStore((s) => s.label);
  const pages = useLabelStore((s) => s.pages);
  const variables = useLabelStore((s) => s.variables);
  const documentEmits = useLabelStore(selectDocumentEmits);
  const sourceEdit = useLabelStore((s) => s.sourceEdit);
  const selectedIds = useLabelStore((s) => s.selectedIds);
  const currentPageIndex = useLabelStore((s) => s.currentPageIndex);
  const objects = useCurrentObjects();

  const session = sourceEdit.status === "editing" ? sourceEdit : null;
  const emitted = documentEmits
    ? generateMultiPageZplWithMap(label, pages, variables)
    : { text: "", spans: [] };
  const zpl = emitted.text;
  const gate = zpl === "" ? null : sourceEditGate(zpl);

  const viewVisible = !collapsed && session === null;
  const highlightedLines = viewVisible
    ? spanCoveredLines(
        zpl,
        // The selection lives on the current page; its ids resolve there only.
        emitted.spans.filter((s) => s.pageIndex === currentPageIndex),
        new Set(expandSelection(objects, selectedIds)),
      )
    : NO_LINES;

  const impact = usePrinterImpact(zpl, viewVisible);
  const notices = impact ? printerImpactNotices(impact, t) : NO_NOTICES;

  return { session, zpl, gate, highlightedLines, notices };
}

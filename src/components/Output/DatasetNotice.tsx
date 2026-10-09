import type { ReactNode } from "react";
import { useT } from "../../hooks/useT";
import { formatTemplate } from "../../lib/formatTemplate";
import { useLabelStore, selectBatchInputs, selectBatchPrintCount } from "../../store/labelStore";

const NoticeLine = ({ children }: { children: ReactNode }) => (
  <p className="px-3 py-1.5 border-b border-border font-mono text-[10px] text-amber-400">{children}</p>
);

export function DatasetNotice() {
  const t = useT();
  const rows = useLabelStore((s) => selectBatchInputs(s)?.dataset.rows.length ?? null);
  // A per-label ^PQ multiplies every recall, so the honest count is rows times quantity.
  const printQuantity = useLabelStore((s) => s.label.printQuantity ?? 1);
  const batchCount = useLabelStore(selectBatchPrintCount);
  if (rows === null) return null;
  return (
    <NoticeLine>
      {printQuantity > 1
        ? formatTemplate(t.zebraPrint.batchNoticeQtyFmt, { n: String(batchCount), rows: String(rows), q: String(printQuantity) })
        : formatTemplate(t.zebraPrint.batchNoticeFmt, { n: String(rows) })}
    </NoticeLine>
  );
}

/** A mapped dataset reaches the system way as the active row alone. */
export function ActiveRowNotice() {
  const t = useT();
  const rows = useLabelStore((s) => selectBatchInputs(s)?.dataset.rows.length ?? null);
  const activeRowIndex = useLabelStore((s) => s.dataset?.activeRowIndex ?? 0);
  if (rows === null) return null;
  return (
    <NoticeLine>
      {formatTemplate(t.zebraPrint.systemActiveRowOnlyFmt, { n: String(activeRowIndex + 1), rows: String(rows) })}
    </NoticeLine>
  );
}

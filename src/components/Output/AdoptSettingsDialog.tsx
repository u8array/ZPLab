import { useState } from "react";
import { adoptionDiff, isAdoptable, preselectedRows, type AdoptionRow } from "@zplab/core/lib/printerSettingsAdoption";
import type { SgdSetting } from "@zplab/core/lib/sgd";
import { useT } from "../../hooks/useT";
import type { PrinterOutcome } from "../../lib/printerQuery";
import { selectEditorFrozen, useLabelStore } from "../../store/labelStore";
import { labelCls, primaryButtonCls, zplCommandTagCls } from "../ui/formStyles";
import { Tooltip } from "../ui/Tooltip";
import { PrinterReplyDialog } from "./PrinterReplyDialog";

interface Props {
  read: PrinterOutcome<SgdSetting[]> | "reading";
  portal?: boolean;
  onClose: () => void;
}

/** Differing rows first, settled ones next, and what the app cannot hold last. */
const rank = (row: AdoptionRow): number => (!isAdoptable(row) ? 2 : row.differs ? 0 : 1);

const cellCls = "px-2 py-1 align-top";

/** What the printer reports beside what the app holds, with nothing adopted unasked. */
export function AdoptSettingsDialog({ read, portal, onClose }: Props) {
  const t = useT();
  const loc = t.printerSettings.printerStatus;
  const label = useLabelStore((s) => s.label);
  const profile = useLabelStore((s) => s.printerProfile);
  const frozen = useLabelStore(selectEditorFrozen);
  const adoptPrinterSettings = useLabelStore((s) => s.adoptPrinterSettings);
  const [picked, setPicked] = useState<ReadonlySet<string>>();
  const [refused, setRefused] = useState(false);

  const settings = read !== "reading" && read.kind === "ok" ? read.value : [];
  const rows = [...adoptionDiff(settings, label, profile)].sort((a, b) => rank(a) - rank(b));
  const preselected = preselectedRows(rows);
  const unadoptable = rows.some((row) => !isAdoptable(row));
  const chosen = picked ?? new Set(preselected.map((row) => row.field));
  const toggle = (field: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(field);
    else next.delete(field);
    setPicked(next);
  };
  const apply = () => {
    if (adoptPrinterSettings(rows.filter((row) => chosen.has(row.field)))) onClose();
    else setRefused(true);
  };

  return (
    <PrinterReplyDialog title={loc.adoptTitle} read={read} portal={portal} onClose={onClose}>
      {() => (
        <>
          {preselected.length === 0 && !unadoptable && <span className="text-[10px] font-mono text-muted">{loc.adoptNothing}</span>}
          {unadoptable && <span className="text-[10px] font-mono text-muted">{loc.adoptDiffersUnadoptable}</span>}
          {rows.length > 0 && (
            <table className="w-full text-[10px] font-mono border-collapse">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className={`${cellCls} ${labelCls}`}>{loc.adoptSetting}</th>
                  <th className={`${cellCls} ${labelCls}`}>{loc.adoptPrinterValue}</th>
                  <th className={`${cellCls} ${labelCls}`}>{loc.adoptCurrentValue}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.field} className={row.differs ? "text-text" : "text-muted"}>
                    <td className={cellCls}>
                      {isAdoptable(row) ? (
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input type="checkbox" className="accent-accent" checked={chosen.has(row.field)} onChange={(e) => toggle(row.field, e.target.checked)} />
                          {row.key}
                          {row.command && <span className={zplCommandTagCls}>{row.command}</span>}
                        </label>
                      ) : (
                        <span className="flex items-center gap-1.5">
                          {row.key}
                          {row.command && <span className={zplCommandTagCls}>{row.command}</span>}
                          <span className="text-muted/60 shrink-0">{loc.adoptNotConvertible}</span>
                        </span>
                      )}
                    </td>
                    <td className={cellCls}>
                      {row.adoptedValue || row.printerValue}
                      {row.adoptedValue && row.adoptedValue !== row.printerValue && <span className="text-muted/60"> {row.printerValue}</span>}
                    </td>
                    <td className={cellCls}>{row.currentValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {refused && (
            <span role="alert" className="text-[10px] font-mono text-error">
              {loc.adoptRefused}
            </span>
          )}
          <Tooltip content={frozen ? t.printerSettings.frozenHint : undefined}>
            <button type="button" className={`${primaryButtonCls} self-start`} disabled={frozen || chosen.size === 0} onClick={apply}>
              {loc.adoptApply}
            </button>
          </Tooltip>
        </>
      )}
    </PrinterReplyDialog>
  );
}

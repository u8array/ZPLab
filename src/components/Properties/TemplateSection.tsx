import { useLabelStore, useCurrentObjects, currentPageLabel } from "../../store/labelStore";
import { useT } from "../../hooks/useT";
import { formatTemplate } from "../../lib/formatTemplate";
import { SectionCard } from "./SectionCard";
import { FieldLabel } from "./ZplCmd";
import { StoredFormatField } from "./StoredFormatField";
import { DeliverySelect } from "./DeliverySelect";
import { storedFormatSlots } from "@zplab/core/lib/zplGenerator";
import { formatDelivery, recallWayIssue } from "@zplab/core/lib/storedFormat";
import { datasetDisplayName } from "@zplab/core/types/DataSource";

/** Everything that makes the page a template in one place: the stored name, how jobs deliver it, its slots and the rows they take. */
export function TemplateSection({ locked }: { locked: boolean }) {
  const t = useT();
  const pageLabel = useLabelStore(currentPageLabel);
  const pageIndex = useLabelStore((s) => s.currentPageIndex);
  const path = pageLabel.storedFormatPath;
  const chosen = pageLabel.storedFormatDelivery;
  const way = formatDelivery(pageLabel);
  const issue = useLabelStore((s) => recallWayIssue(currentPageLabel(s), s.pages));
  const setPath = useLabelStore((s) => s.setPageStoredFormatPath);
  const setDelivery = useLabelStore((s) => s.setPageStoredFormatDelivery);
  const setSidebarTab = useLabelStore((s) => s.setSidebarTab);
  const setPrinterSettingsTab = useLabelStore((s) => s.setPrinterSettingsTab);
  const objects = useCurrentObjects();
  const variables = useLabelStore((s) => s.variables);
  const dataset = useLabelStore((s) => s.dataset);
  const declared = path === undefined ? new Set<number>() : storedFormatSlots(pageLabel, objects, variables);
  const slots = variables.filter((v) => declared.has(v.fnNumber)).sort((a, b) => a.fnNumber - b.fnNumber);
  const blocked = issue === undefined ? undefined : issue === "longName" ? t.delivery.formatNeedsShortName : t.delivery.formatNameContested;
  return (
    <SectionCard id="page-template" title={t.template.section}>
      <StoredFormatField key={pageIndex} path={path} locked={locked} onChange={setPath} />
      {path !== undefined && (
        <>
          <div inert={locked}>
            <DeliverySelect
              resource="format"
              subject={path}
              value={way}
              onChange={(next) => setDelivery(next === "job" ? undefined : next)}
              blocked={blocked === undefined ? undefined : { setup: blocked, printer: blocked }}
              issue={issue === "contested" && chosen !== undefined ? blocked : undefined}
              manage={way === "setup" ? { label: t.template.openSetupScript, open: () => setPrinterSettingsTab("clockTime") } : undefined}
            />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel cmd="^FN">{t.template.slots}</FieldLabel>
            <span className="text-[10px] text-muted font-mono">
              {slots.length === 0 ? t.template.noSlots : slots.map((v) => `${v.fnNumber} ${v.name}`).join(", ")}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>{t.template.dataset}</FieldLabel>
            <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-muted">
              <span className="truncate">
                {dataset
                  ? `${datasetDisplayName(dataset.source)} · ${formatTemplate(t.template.rowsFmt, { n: String(dataset.rows.length) })}`
                  : t.template.noDataset}
              </span>
              <button type="button" onClick={() => setSidebarTab("variables")} className="shrink-0 text-accent hover:underline">
                {t.template.openVariables}
              </button>
            </div>
          </div>
        </>
      )}
    </SectionCard>
  );
}

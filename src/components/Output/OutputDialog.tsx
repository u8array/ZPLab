import { XMarkIcon } from "@heroicons/react/16/solid";
import { useState } from "react";
import { useT } from "../../hooks/useT";
import { DialogShell } from "../ui/DialogShell";
import { RadioOption } from "../ui/RadioOption";
import { SegmentedStrip, type Segment } from "../ui/SegmentedStrip";
import { primaryButtonCls, sectionHeadingCls } from "../ui/formStyles";
import { useLabelStore, selectPrinterReading, selectEffectivePreviewProvider } from "../../store/labelStore";
import { formatTemplate } from "../../lib/formatTemplate";
import { isDesktopShell } from "../../lib/platform";
import { needsRawChannel, type PrintWay } from "../../lib/printTarget";
import { wayHint, wayLabel } from "../../lib/printWayText";
import {
  effectiveKind,
  effectiveScope,
  offeredKinds,
  offeredScopes,
  type FileFormat,
  type OutputFacts,
  type OutputKind,
  type OutputSource,
  type PdfScope,
} from "../../lib/outputChoice";
import { useLabelaryConsent } from "../../hooks/useLabelaryConsent";
import { usePrintWays } from "../../hooks/usePrintWays";
import { useSendNotices } from "../../hooks/useSendNotices";
import { ActiveRowNotice, DatasetNotice } from "./DatasetNotice";
import { SystemPrintBody } from "./SystemPrintBody";
import { ZebraWayPanel } from "./ZebraWayPanel";

interface Props {
  /** Read at the click, because a mapped dataset regenerates the code for every data row. */
  zpl: () => string;
  source: OutputSource;
  facts: OutputFacts;
  onClose: () => void;
  onPrintImage: () => Promise<void>;
  onExportPdf: (scope: PdfScope) => void;
  onExportPng: () => void;
}

function ImpactNotices() {
  const notices = useSendNotices();
  if (notices.length === 0) return null;
  return (
    <div role="status">
      {notices.map((n) => (
        <p key={n} className="px-3 py-1.5 border-b border-border font-mono text-[10px] text-amber-400">
          {n}
        </p>
      ))}
    </div>
  );
}

/** The one place the label leaves the app. The first level is where it goes, the second how, and
 *  the dialog proposes both again next time. */
export function OutputDialog({ zpl, source, facts, onClose, onPrintImage, onExportPdf, onExportPng }: Props) {
  const t = useT();
  const loc = t.zebraPrint;
  const choice = useLabelStore((s) => s.outputChoice);
  const setOutputChoice = useLabelStore((s) => s.setOutputChoice);

  const kinds = offeredKinds(source, facts);
  const kind = effectiveKind(choice.kind, kinds);
  // A setup script leaves one kind, and a first level with one entry is no choice to show.
  const choosable = kinds.length > 1;
  const scopes = offeredScopes(facts);
  const scope = effectiveScope(choice.pdfScope, scopes);
  const scopeChoosable = scopes.length > 1;
  const kindText: Record<OutputKind, Segment<OutputKind>> = {
    print: { key: "print", label: loc.kindPrint, hint: loc.kindPrintHint },
    file: { key: "file", label: loc.kindFile, hint: loc.kindFileHint },
  };
  const formatSegments: Segment<FileFormat>[] = [
    { key: "pdf", label: loc.formatPdf, hint: loc.formatPdfHint },
    { key: "png", label: loc.formatPng, hint: loc.formatPngHint },
  ];
  const scopeLabels: Record<PdfScope, string> = {
    design: loc.scopeDesign,
    batch: formatTemplate(loc.scopeCountFmt, { label: loc.scopeBatch, n: String(facts.batchRowCount) }),
  };

  const ways = usePrintWays(source, facts);
  const waySegments: Segment<PrintWay>[] = ways.offered.map((key) => ({
    key,
    label: wayLabel(loc, key),
    hint: wayHint(loc, key, isDesktopShell),
  }));

  // The render takes seconds over the network, and the dialog stays to show that it is working.
  const [rendering, setRendering] = useState(false);
  const checking = useLabelStore(selectPrinterReading);
  const renderer = useLabelStore(selectEffectivePreviewProvider);
  const { gate, notice } = useLabelaryConsent();

  const printImage = () =>
    gate(() => {
      setRendering(true);
      void onPrintImage().then(onClose, onClose);
    });
  // The PDF progress dialog takes over from here, and this modal would sit over it.
  const exportPdf = () =>
    gate(() => {
      onClose();
      onExportPdf(scope);
    });
  // The save dialog takes over, and the canvas draws the PNG without asking a renderer.
  const exportPng = () => {
    onClose();
    onExportPng();
  };

  return (
    <>
      <DialogShell
        portal
        onClose={onClose}
        labelledBy="output-title"
        // A floor on the height keeps the tabs still when a body of another height takes over.
        boxClassName="bg-surface border border-border rounded shadow-lg flex flex-col w-[420px] max-w-[95vw] min-h-[18rem] max-h-[80vh]"
      >
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0">
          <span id="output-title" className={sectionHeadingCls}>
            {source === "setupScript" ? loc.heading : loc.outputHeading}
          </span>
          <button
            onClick={onClose}
            aria-label={t.app.close}
            className="p-1 rounded text-muted hover:text-text hover:bg-surface-2 transition-colors"
          >
            <XMarkIcon className="w-3.5 h-3.5" />
          </button>
        </div>

        {choosable && (
          <div className="px-3 py-2.5 border-b border-border shrink-0">
            <SegmentedStrip
              label={loc.outputHeading}
              segments={kinds.map((key) => kindText[key])}
              current={kind}
              onPick={(next) => setOutputChoice({ kind: next })}
            />
          </div>
        )}

        {kind === "print" && (
          <div className="flex flex-col flex-1 min-h-0">
            {/* The ways strip stays out of the scroll, so only the body of the chosen way moves. */}
            <div className="shrink-0">
              {source === "label" && (
                <>
                  {ways.way === "system" ? <ActiveRowNotice /> : <DatasetNotice />}
                  {/* These are the exact bytes sent, which the dialog may never have shown. */}
                  {ways.way !== "system" && <ImpactNotices />}
                </>
              )}
              <div className="flex flex-col gap-1 px-3 py-2.5 border-b border-border">
                <span className={sectionHeadingCls}>{loc.wayHeading}</span>
                <div>
                  <SegmentedStrip label={loc.wayHeading} segments={waySegments} current={ways.way} onPick={ways.choose} />
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              {ways.way === "system" ? (
                <SystemPrintBody onPrint={printImage} rendering={rendering} locked={checking && needsRawChannel(ways.way, renderer)} />
              ) : (
                <ZebraWayPanel zpl={zpl} way={ways.tab} devices={ways.devices} />
              )}
            </div>
          </div>
        )}

        {kind === "file" && (
          <div className="flex flex-col gap-3 p-4 flex-1 min-h-0 overflow-y-auto">
            <div className="flex flex-col gap-1">
              <span className={sectionHeadingCls}>{loc.formatHeading}</span>
              <div>
                <SegmentedStrip
                  label={loc.formatHeading}
                  segments={formatSegments}
                  current={choice.fileFormat}
                  onPick={(next) => setOutputChoice({ fileFormat: next })}
                />
              </div>
            </div>

            {choice.fileFormat === "pdf" ? (
              <>
                {scopeChoosable && (
                  // Flex on an inner box, because a legend inside a flex fieldset lays out per browser.
                  <fieldset className="min-w-0">
                    <legend className={sectionHeadingCls}>{loc.scopeHeading}</legend>
                    <div className="flex flex-col gap-1 pt-1">
                      {scopes.map((value) => (
                        <RadioOption
                          key={value}
                          name="pdf-scope"
                          value={value}
                          current={scope}
                          onSelect={(next) => setOutputChoice({ pdfScope: next })}
                          label={scopeLabels[value]}
                        />
                      ))}
                    </div>
                  </fieldset>
                )}
                <div className="flex justify-end">
                  <button onClick={exportPdf} className={primaryButtonCls}>
                    {scope === "design" && facts.pdfCurrentPageOnly ? t.app.exportPdfCurrentPage : t.app.exportPdf}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex justify-end">
                <button onClick={exportPng} className={primaryButtonCls}>
                  {t.app.exportPng}
                </button>
              </div>
            )}
          </div>
        )}
      </DialogShell>

      {notice}
    </>
  );
}

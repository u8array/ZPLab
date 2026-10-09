import { XMarkIcon } from "@heroicons/react/16/solid";
import { useState } from "react";
import { useT } from "../../hooks/useT";
import { DialogShell } from "../ui/DialogShell";
import { Tooltip } from "../ui/Tooltip";
import { RadioOption } from "../ui/RadioOption";
import { primaryButtonCls, sectionHeadingCls } from "../ui/formStyles";
import { useLabelStore } from "../../store/labelStore";
import { formatTemplate } from "../../lib/formatTemplate";
import {
  effectiveKind,
  effectiveScope,
  offeredKinds,
  offeredScopes,
  type OutputFacts,
  type OutputKind,
  type OutputSource,
  type PdfScope,
} from "../../lib/outputChoice";
import { ZplSendPanel } from "./ZplSendPanel";

interface Props {
  /** Read only where it is shown, because a batch regenerates megabytes on every click elsewhere. */
  zpl: () => string;
  source: OutputSource;
  facts: OutputFacts;
  onClose: () => void;
  /** The running print, or nothing when a notice has to be answered before the work starts. */
  onPrintImage: () => Promise<void> | undefined;
  onExportPdf: (scope: PdfScope) => void;
}

/** The one place the label leaves the app. The first level is what it becomes, the second how, and
 *  the dialog proposes both again next time. */
export function OutputDialog({ zpl, source, facts, onClose, onPrintImage, onExportPdf }: Props) {
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
  // One scope is no choice, and then the action's own name says what it covers.
  const scopeChoosable = scopes.length > 1;
  const kindLabels: Record<OutputKind, string> = { zpl: loc.kindZpl, image: loc.kindImage, pdf: loc.kindPdf };
  const kindHints: Record<OutputKind, string> = { zpl: loc.kindZplHint, image: loc.kindImageHint, pdf: loc.kindPdfHint };
  const scopeLabels: Record<PdfScope, string> = { design: loc.scopeDesign, batch: loc.scopeBatch };

  // The modal would sit over the print dialog and the renderer's progress, so it steps aside first.
  const leaveAnd = (action: () => void) => () => {
    onClose();
    action();
  };

  // The render takes seconds over the network, and the dialog stays to show that it is working.
  const [rendering, setRendering] = useState(false);
  const printImage = () => {
    const started = onPrintImage();
    if (!started) return onClose();
    setRendering(true);
    void started.then(onClose, onClose);
  };

  return (
    <DialogShell
      onClose={onClose}
      labelledBy="output-title"
      // Each kind's body has its own height, and a centred box would move the tabs by half the
      // difference on every switch. Hung from the top, it only ever grows downwards.
      boxClassName="bg-surface border border-border rounded shadow-lg flex flex-col w-[420px] max-w-[95vw] self-start mt-[12vh] max-h-[80vh]"
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0">
        <span id="output-title" className={sectionHeadingCls}>
          {choosable ? loc.outputHeading : loc.heading}
        </span>
        <button
          onClick={onClose}
          aria-label={t.app.close}
          className="p-1 rounded text-muted hover:text-text hover:bg-surface-2 transition-colors"
        >
          <XMarkIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Pills, not the underlined tabs below them, so the two levels do not read as one strip. */}
      {choosable && (
        <div className="flex gap-1 px-2 py-2 border-b border-border shrink-0">
          {kinds.map((key) => (
            <Tooltip key={key} content={kindHints[key]}>
              <button
                aria-pressed={kind === key}
                onClick={() => setOutputChoice({ kind: key })}
                className={`px-3 py-1 text-[10px] font-mono uppercase tracking-widest rounded transition-colors ${
                  kind === key ? "bg-accent text-bg" : "text-muted hover:text-text hover:bg-surface-2"
                }`}
              >
                {kindLabels[key]}
              </button>
            </Tooltip>
          ))}
        </div>
      )}

      {/* The head stays put, the ways and their bodies scroll, like every other modal here. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {kind === "zpl" && <ZplSendPanel zpl={zpl()} />}

        {kind === "image" && (
          <div className="flex flex-col gap-3 p-4" aria-busy={rendering}>
            <p className="font-mono text-[10px] text-muted">{loc.kindImageHint}</p>
            {/* Stands where the rendered label will be, like the placeholder in the font dialog. */}
            {rendering && <span aria-hidden="true" className="h-24 rounded bg-border animate-pulse" />}
            <div className="flex justify-end">
              <button onClick={printImage} disabled={rendering} className={primaryButtonCls}>
                {loc.imagePrint}
              </button>
            </div>
          </div>
        )}

        {kind === "pdf" && (
          <div className="flex flex-col gap-3 p-4">
            <p className="font-mono text-[10px] text-muted">{loc.kindPdfHint}</p>
            {scopeChoosable && (
              <div className="flex flex-col gap-0.5">
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
            )}
            <div className="flex justify-end">
              <button onClick={leaveAnd(() => onExportPdf(scope))} className={primaryButtonCls}>
                {scope === "batch"
                  ? formatTemplate(t.app.exportBatchPdfFmt, { n: String(facts.batchRowCount) })
                  : facts.pdfCurrentPageOnly
                    ? t.app.exportPdfCurrentPage
                    : t.app.exportPdf}
              </button>
            </div>
          </div>
        )}
      </div>
    </DialogShell>
  );
}

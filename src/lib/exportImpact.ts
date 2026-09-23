import { parseZPL } from "@zplab/core/lib/zplParser";
import { dedupCommandsByKind } from "@zplab/core/lib/importReport";
import { formatTemplate } from "./formatTemplate";
import type { Translations } from "../locales";

export interface PrinterImpact {
  setup: string[];
  actions: string[];
  /** The ^DF paths the blocks store under, distinct. */
  stores: string[];
  /** Every block stores, so the job prints nothing. */
  printsNothing: boolean;
}

/** Printer-impact commands a stream carries: `setup` reconfigures (^JU, ^ST), `actions`
 *  fire (~JA, ~JC). Full parse costs ~20x the emit, so callers keep it off render paths. */
export function exportPrinterImpact(zpl: string): PrinterImpact {
  const parsed = parseZPL(zpl);
  const findings = parsed.pages.flatMap((p) => p.findings);
  return {
    setup: dedupCommandsByKind(findings, "replayRisk"),
    actions: dedupCommandsByKind(findings, "deviceAction"),
    stores: [...new Set(parsed.pages.flatMap((p) => p.storedFormatPath ?? []))],
    // A batch job stores its template and then recalls it, so it prints after all.
    printsNothing: parsed.pages.length > 0 && parsed.pages.every((p) => p.storedFormatPath !== undefined),
  };
}

/** The impact as display lines, so panel and send dialog name the same commands. */
export function printerImpactNotices(impact: PrinterImpact, t: Translations): readonly string[] {
  return [
    ...(impact.stores.length > 0
      ? [formatTemplate(impact.printsNothing ? t.output.storesFormatFmt : t.output.storesSomeFormatFmt, { path: impact.stores.join(", ") })]
      : []),
    ...(impact.setup.length > 0
      ? [formatTemplate(t.output.replayRiskSetupFmt, { commands: impact.setup.join(", ") })]
      : []),
    ...(impact.actions.length > 0
      ? [formatTemplate(t.output.replayRiskActionsFmt, { commands: impact.actions.join(", ") })]
      : []),
  ];
}

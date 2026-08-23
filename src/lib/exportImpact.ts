import { parseZPL } from "@zplab/core/lib/zplParser";
import { dedupCommandsByKind } from "@zplab/core/lib/importReport";
import { formatTemplate } from "./formatTemplate";
import type { Translations } from "../locales";

export interface PrinterImpact {
  setup: string[];
  actions: string[];
}

/** Printer-impact commands a stream carries: `setup` reconfigures (^JU, ^ST), `actions`
 *  fire (~JA, ~JC). Full parse costs ~20x the emit, so callers keep it off render paths. */
export function exportPrinterImpact(zpl: string): PrinterImpact {
  const findings = parseZPL(zpl).pages.flatMap((p) => p.findings);
  return {
    setup: dedupCommandsByKind(findings, "replayRisk"),
    actions: dedupCommandsByKind(findings, "deviceAction"),
  };
}

/** The impact as display lines, so panel and send dialog name the same commands. */
export function printerImpactNotices(impact: PrinterImpact, t: Translations): readonly string[] {
  return [
    ...(impact.setup.length > 0
      ? [formatTemplate(t.output.replayRiskSetupFmt, { commands: impact.setup.join(", ") })]
      : []),
    ...(impact.actions.length > 0
      ? [formatTemplate(t.output.replayRiskActionsFmt, { commands: impact.actions.join(", ") })]
      : []),
  ];
}

import type { ImportFinding, ImportFindingKind, ImportReport } from './zplParser';

// Re-export the parser-side domain types so UI code talks to the report
// surface through this module exclusively instead of reaching into the
// parser for type imports.
export type { ImportFinding, ImportFindingKind, ImportReport };

/** Distinct command codes of one finding kind; backs the report's bucket views. */
export function dedupCommandsByKind(
  findings: readonly ImportFinding[],
  kind: ImportFindingKind,
): string[] {
  // Keyed past the prefix glyph: a ^CC/^CT remap spells one command two ways.
  const byBytes = new Map<string, string>();
  for (const f of findings) {
    if (f.kind !== kind) continue;
    const key = f.command.slice(1);
    if (!byBytes.has(key)) byBytes.set(key, f.command);
  }
  return [...byBytes.values()];
}

/** Routable setup-script findings; drives the import routing prompt. */
export function replayRiskFindings(report: ImportReport): ImportFinding[] {
  return report.findings.filter((f) => f.kind === 'replayRisk');
}

/** Routable setup commands plus non-routable device actions, for the prompt list. */
export function printerCommandFindings(report: ImportReport): ImportFinding[] {
  return report.findings.filter((f) => f.kind === 'replayRisk' || f.kind === 'deviceAction');
}

/** Report after routing setup commands out of the label: replayRisk resolved,
 *  overlay-dependent findings on routed pages moot, findings on dropped pages
 *  removed and survivors remapped to `keptPageIndexes` order. */
export function resolveRoutedReport(
  report: ImportReport,
  keptPageIndexes: readonly number[],
): ImportReport {
  const riskPages = new Set(replayRiskFindings(report).map((f) => f.pageIndex));
  const newIndexOf = new Map(keptPageIndexes.map((orig, i) => [orig, i]));
  const findings = report.findings.flatMap((f) => {
    if (f.kind === 'replayRisk') return [];
    if ((f.kind === 'lossyEdit' || f.kind === 'deviceAction') && riskPages.has(f.pageIndex)) {
      return [];
    }
    const newIndex = newIndexOf.get(f.pageIndex);
    return newIndex === undefined ? [] : [{ ...f, pageIndex: newIndex }];
  });
  return {
    findings,
    partial: dedupCommandsByKind(findings, 'partial'),
    browserLimit: dedupCommandsByKind(findings, 'browserLimit'),
    unknown: dedupCommandsByKind(findings, 'unknown'),
    replayRisk: dedupCommandsByKind(findings, 'replayRisk'),
    deviceAction: dedupCommandsByKind(findings, 'deviceAction'),
  };
}

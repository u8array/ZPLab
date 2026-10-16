import type { ImportFinding, ImportFindingKind, ImportReport } from './zplParser';

// Re-export the parser-side domain types so UI code talks to the report
// surface through this module exclusively instead of reaching into the
// parser for type imports.
export type { ImportFinding, ImportFindingKind, ImportReport };

/** Distinct command codes of one finding kind; backs the report's bucket views. */
export function dedupCommandsByKind(
  findings: readonly ImportFinding[],
  kind: ImportFindingKind,
  keyFrom = 1,
): string[] {
  // Keyed past the prefix glyph: a ^CC/^CT remap spells one command two ways. An escape has none.
  const byBytes = new Map<string, string>();
  for (const f of findings) {
    if (f.kind !== kind) continue;
    const key = f.command.slice(keyFrom);
    if (!byBytes.has(key)) byBytes.set(key, f.command);
  }
  return [...byBytes.values()];
}

/** Routable setup-script findings; drives the import routing prompt. */
export function replayRiskFindings(report: ImportReport): ImportFinding[] {
  return report.findings.filter((f) => f.kind === 'replayRisk');
}

/** The pages whose overlay routing strips. */
export const riskPageIndexes = (report: ImportReport): ReadonlySet<number> => new Set(replayRiskFindings(report).map((f) => f.pageIndex));

/** Routable setup commands plus non-routable device actions, for the prompt list. */
export function printerCommandFindings(report: ImportReport): ImportFinding[] {
  return report.findings.filter((f) => f.kind === 'replayRisk' || f.kind === 'deviceAction');
}

/** Findings about bytes only an overlay replays, so they leave with the overlay. */
const OVERLAY_BOUND_KINDS: ReadonlySet<ImportFindingKind> = new Set(['lossyEdit', 'deviceAction']);
export const overlayBound = (f: ImportFinding): boolean => OVERLAY_BOUND_KINDS.has(f.kind);

/** The commands a routed page loses with its overlay, so the choice is made knowing them. */
export function commandsLostByRouting(report: ImportReport): string[] {
  const riskPages = riskPageIndexes(report);
  return [...new Set(report.findings.filter((f) => f.kind === 'deviceAction' && riskPages.has(f.pageIndex)).map((f) => f.command))];
}

/** `pageIndex` of a finding about the stream as a whole, which no page routing may drop. */
export const DOCUMENT_FINDING = -1;

/** Report after routing setup commands out of the label: replayRisk resolved,
 *  overlay-dependent findings on routed pages moot, findings on dropped pages
 *  removed and survivors remapped to `keptPageIndexes` order. */
export function resolveRoutedReport(
  report: ImportReport,
  keptPageIndexes: readonly number[],
): ImportReport {
  const riskPages = riskPageIndexes(report);
  const newIndexOf = new Map(keptPageIndexes.map((orig, i) => [orig, i]));
  const findings = report.findings.flatMap((f) => {
    if (f.kind === 'replayRisk') return [];
    if (overlayBound(f) && riskPages.has(f.pageIndex)) return [];
    if (f.pageIndex === DOCUMENT_FINDING) return [f];
    const newIndex = newIndexOf.get(f.pageIndex);
    // A setup-only page leaves with its block, but what the profile could not take is still lost.
    if (newIndex === undefined) return f.kind === 'partial' ? [{ ...f, pageIndex: DOCUMENT_FINDING }] : [];
    return [{ ...f, pageIndex: newIndex }];
  });
  return reportOf(findings);
}

/** The report over its findings: the bucket views deduplicate by command code. */
export function reportOf(findings: ImportFinding[]): ImportReport {
  return {
    findings,
    partial: dedupCommandsByKind(findings, 'partial'),
    browserLimit: dedupCommandsByKind(findings, 'browserLimit'),
    unknown: dedupCommandsByKind(findings, 'unknown'),
    replayRisk: dedupCommandsByKind(findings, 'replayRisk'),
    deviceAction: dedupCommandsByKind(findings, 'deviceAction'),
    hostQuery: dedupCommandsByKind(findings, 'hostQuery'),
    unterminatedField: dedupCommandsByKind(findings, 'unterminatedField'),
    hexControl: dedupCommandsByKind(findings, 'hexControl', 0),
  };
}

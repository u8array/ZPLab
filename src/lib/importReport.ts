import type { ImportFinding, ImportReport } from '@zplab/core/lib/importReport';
import type { Translations } from '../locales';
import { ZPL_COMMAND_MAP } from './zplCommandSupport';

export interface ImportResult {
  objectCount: number;
  report: ImportReport;
}

type ReportStrings = Translations['importReport'];

/** ZPL tokens stay out of the locale strings (translator safety); the one
 *  loss text that names formats gets them interpolated here. */
const LOSS_SUBSTITUTIONS: readonly [string, string][] = [
  ['{rawFmts}', '^GFB/^GFC'],
  ['{hexFmt}', '^GFA'],
  ['{wrapFmts}', ':B64:/:Z64:'],
];

/** Returns the loss description for a partial command code, e.g. "^A@" → font face note. */
function partialLoss(cmd: string, tr: ReportStrings): string {
  const key = cmd.slice(1);
  const entry = ZPL_COMMAND_MAP.get(key) ?? (key[0] === 'A' ? ZPL_COMMAND_MAP.get('A@') : undefined);
  if (!entry?.loss) return tr.partialFallback;
  return LOSS_SUBSTITUTIONS.reduce((s, [m, v]) => s.replace(m, v), tr[entry.loss]);
}

/**
 * Single source of truth for finding wording. Both the UI list and the
 * copy-as-text formatter feed off this so the user sees the same
 * description in both surfaces; without it, the two pathways drift
 * whenever someone tweaks a string in one place.
 *
 * `title` is the headline (kind + command code where useful);
 * `detail` is the secondary line (loss description for partial, raw
 * token for the others).
 */
export function describeFinding(
  f: ImportFinding,
  tr: ReportStrings,
): { title: string; detail: string } {
  if (f.kind === 'partial') {
    return {
      title: tr.partialTitleFmt.replace('{cmd}', f.command),
      detail: partialLoss(f.command, tr),
    };
  }
  if (f.kind === 'browserLimit') {
    return { title: tr.browserLimitTitle, detail: f.command };
  }
  if (f.kind === 'replayRisk') {
    return { title: tr.replayRiskTitle, detail: f.command };
  }
  if (f.kind === 'deviceAction') {
    return { title: tr.deviceActionTitle, detail: f.command };
  }
  if (f.kind === 'lossyEdit') {
    return { title: tr.lossyEditTitle, detail: f.command };
  }
  if (f.kind === 'fnRenumbered') {
    return { title: tr.fnRenumberedTitleFmt.replace('{fn}', '^FN'), detail: f.command };
  }
  if (f.kind === 'fnDefaultDropped') {
    return { title: tr.fnDefaultDroppedTitleFmt.replace('{fn}', '^FN'), detail: f.command };
  }
  if (f.kind === 'mixedPageGeometry') {
    // ^JM divergence is a mode conflict, not a size one, so it gets its own
    // headline; the command token alone is the detail (title carries meaning).
    if (f.cause === 'jm') {
      return { title: tr.mixedJmTitle, detail: f.command };
    }
    return {
      title: tr.mixedGeoTitle,
      detail: tr.mixedGeoDetailFmt.replace('{cmds}', '^PW/^LL').replace('{detail}', f.command),
    };
  }
  return { title: tr.unknownTitle, detail: f.command };
}

/** Compact "Page N: " prefix when a finding originates from a multi-page
 *  import. Single-page reports omit it to stay terse. */
function pagePrefix(f: ImportFinding, multiPage: boolean, pageFmt: string): string {
  return multiPage ? `${pageFmt.replace('{n}', String(f.pageIndex + 1))}: ` : '';
}

export function formatReportAsText(result: ImportResult, tr: ReportStrings): string {
  const { objectCount, report } = result;
  const findings = report.findings;
  const multiPage = findings.some((f) => f.pageIndex > 0);

  const lines: string[] = [
    tr.reportHeader,
    tr.reportObjectsFmt.replace('{n}', String(objectCount)),
    '',
  ];

  if (findings.length === 0) {
    lines.push(tr.reportClean);
    return lines.join('\n');
  }

  // One row per finding (per page-occurrence). Matches the UI list so the
  // copied text mirrors what the user sees in the modal.
  for (const f of findings) {
    const { title, detail } = describeFinding(f, tr);
    lines.push(`${pagePrefix(f, multiPage, tr.pageFmt)}${title}: ${detail}`);
  }
  return lines.join('\n');
}

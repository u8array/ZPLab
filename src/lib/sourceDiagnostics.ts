import type { UnbalancedFormat } from '@zplab/core/lib/zplParser';
import type { ImportFinding } from '@zplab/core/lib/importReport';
import type { SourceRefusalInfo } from '@zplab/core/lib/zplSourceEdit';
import { describeFinding } from './importReport';
import { formatTemplate } from './formatTemplate';
import type { Translations } from '../locales';

/** One-click repair: the command the editor inserts at the first command boundary at
 *  or after the lint, spelled with the prefix in force there; the label stays canonical,
 *  as in the catalog. The imbalance kinds get none, as no single byte is the right spot. */
export interface SourceFix {
  command: string;
  label: string;
}

/** Editor-framework-neutral lint in STRING offsets of its build's text. */
export interface SourceLint {
  from: number;
  to: number;
  /** `related` marks context, not a second defect: the editor renders it
   *  weaker so one problem still reads as one problem. */
  severity: 'error' | 'related' | 'warning';
  message: string;
  fix?: SourceFix;
}

/** A pasted garbage stream can raise a finding per token; past this the
 *  squiggles stop adding information. */
const MAX_FINDING_LINTS = 500;

const KIND_MSG = {
  strayXz: 'lintStrayXzFmt',
  unclosedXa: 'lintUnclosedXaFmt',
} as const;

/** The one diagnostics derivation: the imbalance a refused apply reports,
 *  pointed at the command that caused it, then the spanned import findings
 *  as warnings in the report's own wording. Span-less findings stay in the
 *  report surfaces; a guessed position would mislead. */
export function buildSourceDiagnostics(
  refusal: SourceRefusalInfo | null,
  findings: readonly ImportFinding[],
  t: Translations,
): SourceLint[] {
  const lints: SourceLint[] = [];
  if (refusal?.reason === 'unbalanced') {
    const ub: UnbalancedFormat = refusal.unbalanced;
    lints.push({
      from: ub.at,
      to: ub.at + ub.cmd.length,
      severity: 'error',
      message: formatTemplate(t.output[KIND_MSG[ub.kind]], { cmd: ub.cmd }),
    });
    // The defect is the unterminated format, but the repair goes here, which in
    // a multi-label document is a whole label away from the opener.
    if (ub.related) {
      lints.push({
        from: ub.related.at,
        to: ub.related.at + ub.related.cmd.length,
        severity: 'related',
        message: formatTemplate(t.output.lintStillOpenHereFmt, { cmd: ub.cmd }),
      });
    }
  }
  const warnings: SourceLint[] = [];
  for (const f of findings) {
    if (!f.span) continue;
    const { title, detail } = describeFinding(f, t.importReport);
    const lint: SourceLint = {
      from: f.span.start,
      to: f.span.end,
      severity: 'warning',
      message: `${title}: ${detail}`,
    };
    // The field ends where the next command begins, which is where ^FS belongs.
    if (f.kind === 'unterminatedField') {
      lint.fix = { command: '^FS', label: formatTemplate(t.output.lintInsertCmdFmt, { cmd: '^FS' }) };
    }
    warnings.push(lint);
  }
  // Document order, then cap: kind-grouped input never matches what the
  // editor holds (it iterates by position), and capping in arrival order
  // starves whole kinds. Warnings only, so a flood cannot push out the error.
  warnings.sort((a, b) => a.from - b.from);
  lints.push(...warnings.slice(0, MAX_FINDING_LINTS));
  lints.sort((a, b) => a.from - b.from);
  return lints;
}

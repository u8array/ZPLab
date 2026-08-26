import type { UnbalancedFormat } from '@zplab/core/lib/zplParser';
import type { SourceRefusalInfo } from '@zplab/core/lib/zplSourceEdit';
import { formatTemplate } from './formatTemplate';
import type { Translations } from '../locales';

/** Editor-framework-neutral lint in STRING offsets of its build's text.
 *  Diagnosis only: a repair would need state the parse does not model
 *  (command channels, prefix scope, control-character boundaries). */
export interface SourceLint {
  from: number;
  to: number;
  /** `related` marks context, not a second defect: the editor renders it
   *  weaker so one problem still reads as one problem. */
  severity: 'error' | 'related';
  message: string;
}

const KIND_MSG = {
  strayXz: 'lintStrayXzFmt',
  unclosedXa: 'lintUnclosedXaFmt',
} as const;

/** The one diagnostics derivation: the imbalance a refused apply reports,
 *  pointed at the command that caused it. */
export function buildSourceDiagnostics(
  refusal: SourceRefusalInfo | null,
  t: Translations,
): SourceLint[] {
  if (refusal?.reason !== 'unbalanced') return [];
  const ub: UnbalancedFormat = refusal.unbalanced;
  const lints: SourceLint[] = [
    {
      from: ub.at,
      to: ub.at + ub.cmd.length,
      severity: 'error',
      message: formatTemplate(t.output[KIND_MSG[ub.kind]], { cmd: ub.cmd }),
    },
  ];
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
  return lints;
}

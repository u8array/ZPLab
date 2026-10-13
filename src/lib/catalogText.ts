import type { Translations } from '../locales';
import type { CommandParam } from '@zplab/core/catalog';
import type { CatalogTranslation } from '../locales/catalogSummaries';
import { formatTemplate } from './formatTemplate';

/** Why the reference's detail shows no entry. */
export type CatalogEmptyReason = { kind: 'noCursor' } | { kind: 'dismissed' } | { kind: 'noEntry'; cmd: string };

/** Line for a detail column without an entry. The command's spelling interpolates here. */
export function catalogEmptyText(reason: CatalogEmptyReason, t: Translations): string {
  switch (reason.kind) {
    case 'noCursor':
      return t.output.catalogNoCursor;
    case 'dismissed':
      return t.output.catalogDismissed;
    case 'noEntry':
      return formatTemplate(t.output.catalogNoEntryFmt, { cmd: reason.cmd });
  }
}

/** `slot` is the parameter's index, or null for literal text. */
export interface SyntaxSegment {
  text: string;
  slot: number | null;
}

export function syntaxSegments(syntax: string, names: readonly string[]): SyntaxSegment[] {
  const out: SyntaxSegment[] = [];
  for (const ch of syntax) {
    const slot = names.indexOf(ch);
    const last = out[out.length - 1];
    // ^Afo: adjacent slot letters must not coalesce, each carries its own index.
    if (slot >= 0) out.push({ text: ch, slot });
    else if (last && last.slot === null) last.text += ch;
    else out.push({ text: ch, slot: null });
  }
  return out;
}

export interface ReferenceRow {
  name: string;
  meaning: string;
  values: string;
  default?: string;
}

/** The parameter rows to show, each in the loaded language where the translation has it and in English otherwise. */
export function referenceRows(params: readonly CommandParam[], translation: CatalogTranslation | undefined): ReferenceRow[] {
  return params.map((p, i) => ({ name: p.name, ...(translation?.reference?.params[i] ?? p) }));
}

import type { Translations } from '../locales';
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

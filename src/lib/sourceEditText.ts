import { MAX_SOURCE_PAGES, type SourceApplyPlan } from '@zplab/core/lib/zplSourceEdit';
import type { Translations } from '../locales';

export type SourceRefusal = Extract<SourceApplyPlan, { ok: false }>['reason'];

/** The one reason→message mapping for every refusal surface. ZPL command
 *  names stay out of the locale strings (translator safety) and
 *  interpolate here. */
export function sourceRefusalText(reason: SourceRefusal, t: Translations): string {
  switch (reason) {
    case 'empty':
      return t.importModal.errPasteFirst;
    case 'noContent':
      return t.importModal.errNoObjects;
    case 'blobLine':
      return t.output.editSourceGateBlob;
    case 'tooLarge':
      return t.output.editSourceGateSize;
    case 'unbalanced':
      return t.output.editSourceUnbalancedFmt.replace('{open}', '^XA').replace('{close}', '^XZ');
    case 'tooManyPages':
      return t.output.editSourceTooManyPagesFmt.replace('{max}', String(MAX_SOURCE_PAGES));
  }
}

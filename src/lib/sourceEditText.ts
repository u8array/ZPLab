import { MAX_SOURCE_PAGES, type SourceRefusal } from '@zplab/core/lib/zplSourceEdit';
import type { Translations } from '../locales';

export type { SourceRefusal };

/** Reason→message for the refusals with no position. A located imbalance is
 *  named per kind by buildSourceDiagnostics, which is why 'unbalanced' is
 *  excluded here rather than answered twice. ZPL command names stay out of
 *  the locale strings (translator safety) and interpolate here. */
export function sourceRefusalText(
  reason: Exclude<SourceRefusal, 'unbalanced'>,
  t: Translations,
): string {
  switch (reason) {
    case 'empty':
      return t.importModal.errPasteFirst;
    case 'noContent':
      return t.importModal.errNoObjects;
    case 'blobLine':
      return t.output.editSourceGateBlob;
    case 'tooLarge':
      return t.output.editSourceGateSize;
    case 'tooManyPages':
      return t.output.editSourceTooManyPagesFmt.replace('{max}', String(MAX_SOURCE_PAGES));
  }
}

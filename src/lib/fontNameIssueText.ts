import type { FontNameIssue } from '@zplab/core/lib/customFonts';
import type { Translations } from '../locales';

/** Both font pickers answer a name issue with the same wording. */
export function fontNameIssueText(t: Translations): Record<FontNameIssue, string> {
  return { nameTaken: t.fonts.nameTaken, nameUnusable: t.fonts.nameUnusable };
}

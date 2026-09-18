import { DocumentIcon } from '@heroicons/react/16/solid';
import {
  getAvailableFontIds,
  type FontIdOption,
} from '@zplab/core/lib/customFonts';
import type { LabelConfig } from '@zplab/core/types/LabelConfig';
import type { Translations } from '../../locales';
import type { SelectGroup } from '../ui/Select';

/**
 * Display name for a built-in ZPL font. Per the spec's Font Matrices only a
 * few are named typefaces: 0 = default scalable, E = OCR-B, H = OCR-A. A–G are
 * unnamed sized bitmap fonts, so they fall back to a generic label and lean on
 * the letter badge to tell them apart.
 */
function builtinFontName(id: string, t: Translations): string {
  switch (id) {
    case '0':
      return t.registry.text.fontDefault;
    case 'E':
      return 'OCR-B';
    case 'H':
      return 'OCR-A';
    default:
      return t.registry.text.fontBitmap;
  }
}

const uploadName = (o: FontIdOption): string | undefined => o.path || o.previewFontName;

/**
 * Build the grouped option list for the font Select, shared by the field-font
 * and label-default-font pickers. Built-ins and uploads each form a section;
 * every row carries the font id as its badge (the value that goes into `^A`).
 */
export function fontSelectGroups(
  label: Pick<LabelConfig, 'customFonts'>,
  t: Translations,
  defaultLabel: string,
): SelectGroup<string>[] {
  const opts = getAvailableFontIds(label);
  const builtins = opts
    .filter((o) => o.builtin)
    .map((o) => ({ value: o.id, label: uploadName(o) ?? builtinFontName(o.id, t), badge: o.id }));
  const customs = opts
    .filter((o) => !o.builtin)
    .map((o) => ({
      value: o.id,
      label: uploadName(o) ?? o.id,
      badge: o.id,
      icon: <DocumentIcon className="w-3 h-3 shrink-0 text-muted" />,
    }));
  return [
    { options: [{ value: '', label: defaultLabel }] },
    { label: t.registry.text.fontGroupBuiltin, options: builtins },
    ...(customs.length ? [{ label: t.registry.text.fontGroupUploaded, options: customs }] : []),
  ];
}

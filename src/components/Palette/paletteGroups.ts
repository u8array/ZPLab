import type { ObjectGroup } from '@zplab/core/types/LabelObject';
import { addablesInGroup, typeLabelFor, type AddableEntry } from '../../registry/palettePresets';
import type { LeafType } from '@zplab/core/registry';
import type { SymbologyTarget } from '../../lib/symbologySwitch';
import type { Translations } from '../../locales';

export const PALETTE_GROUPS = [
  { key: 'text' as ObjectGroup, labelKey: 'groupText' },
  { key: 'code-1d' as ObjectGroup, labelKey: 'groupCode1d' },
  { key: 'code-2d' as ObjectGroup, labelKey: 'groupCode2d' },
  { key: 'shape' as ObjectGroup, labelKey: 'groupShapes' },
  { key: 'legacy' as ObjectGroup, labelKey: 'groupLegacy' },
] as const;

/** Single source for the palette groups; each consumer maps entries onto its
 *  own shape (flat browse, canvas add-here, favorites add). */
export function addableGroupsFor(
  t: Translations,
): { key: ObjectGroup; label: string; entries: AddableEntry[] }[] {
  return PALETTE_GROUPS.map((g) => ({
    key: g.key,
    label: t.palette[g.labelKey],
    entries: addablesInGroup(g.key, t),
  }));
}

/** Symbology-switch targets grouped + labelled in palette order. Single source
 *  for both switch UIs (panel select, context menu), so type labels, disabled
 *  state and reason tooltips cannot drift between them. */
export function symbologyGroupsFor(
  targets: readonly SymbologyTarget[],
  t: Translations,
): { key: ObjectGroup; label: string; types: { type: LeafType; label: string; disabled: boolean; tooltip?: string }[] }[] {
  return PALETTE_GROUPS.map((g) => ({
    key: g.key,
    label: t.palette[g.labelKey],
    types: targets
      .filter((s) => s.group === g.key)
      .map((s) => ({
        type: s.type,
        label: typeLabelFor(s.type, t),
        disabled: s.disabled,
        tooltip: s.reason ? t.registry.symbologySwitch[s.reason] : undefined,
      })),
  })).filter((g) => g.types.length > 0);
}

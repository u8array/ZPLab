import { useT } from "../../hooks/useT";
import { useLabelStore } from "../../store/labelStore";
import { FONT_CACHE_KB_RANGE, FONT_CACHE_TYPE_VALUES } from "@zplab/core/types/PrinterProfile";
import { ZplBoundedIntInput, ZplEnumSegmented } from "./zplFieldPrimitives";
import { FontLinksField } from "./FontLinksField";

/** Setup-Script rail entry: the printer's font settings. */
export function FontsTab() {
  const t = useT();
  const fontCacheOn = useLabelStore((s) => s.printerProfile.fontCacheOn);
  const fontCacheAddKb = useLabelStore((s) => s.printerProfile.fontCacheAddKb);
  const fontCacheType = useLabelStore((s) => s.printerProfile.fontCacheType);
  const patchPrinterProfile = useLabelStore((s) => s.patchPrinterProfile);
  const loc = t.printerSettings.fonts;

  return (
    <div className="flex flex-col gap-4">
      <FontLinksField />

      <section className="flex flex-col gap-3">
        <ZplEnumSegmented
          label={loc.fontCache}
          command="^CO"
          values={['Y', 'N'] as const}
          value={fontCacheOn}
          onChange={(v) => patchPrinterProfile({ fontCacheOn: v })}
          defaultLabel={t.printerSettings.defaultOption}
          optionLabel={(v) => v === 'Y' ? loc.fontCacheEnabled : loc.fontCacheDisabled}
        />
        <ZplBoundedIntInput
          label={loc.fontCacheAddKb}
          command="^CO"
          min={FONT_CACHE_KB_RANGE.min}
          max={FONT_CACHE_KB_RANGE.max}
          value={fontCacheAddKb}
          onChange={(v) => patchPrinterProfile({ fontCacheAddKb: v })}
          unit={loc.fontCacheKbUnit}
          hint={loc.fontCacheHint}
        />
        <ZplEnumSegmented
          label={loc.fontCacheType}
          command="^CO"
          values={FONT_CACHE_TYPE_VALUES}
          value={fontCacheType}
          onChange={(v) => patchPrinterProfile({ fontCacheType: v })}
          defaultLabel={t.printerSettings.defaultOption}
          optionLabel={(v) => v === '0' ? loc.fontCacheTypeNormal : loc.fontCacheTypeInternal}
        />
      </section>
    </div>
  );
}

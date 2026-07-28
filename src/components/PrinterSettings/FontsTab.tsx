import { useT } from "../../hooks/useT";
import { getAllFonts } from "@zplab/core/lib/fontCache";
import { useFontCacheVersion } from "../../hooks/useFontCacheVersion";
import { uploadedFontPath } from "@zplab/core/lib/customFonts";
import { useLabelStore } from "../../store/labelStore";
import { zplCommandTagCls } from "../ui/formStyles";
import { FONT_CACHE_KB_RANGE, FONT_CACHE_TYPE_VALUES } from "@zplab/core/types/PrinterProfile";
import { ZplBoundedIntInput, ZplEnumSegmented } from "./zplFieldPrimitives";
import { FontLinksField } from "./FontLinksField";

/** Setup-Script rail entry: per-printer font choices.
 *  Per-design (alias, embedInZpl) stays in the right-sidebar FontManager. */
export function FontsTab() {
  const t = useT();
  useFontCacheVersion();
  const setupFonts = useLabelStore((s) => s.printerProfile.setupFonts);
  const fontCacheOn = useLabelStore((s) => s.printerProfile.fontCacheOn);
  const fontCacheAddKb = useLabelStore((s) => s.printerProfile.fontCacheAddKb);
  const fontCacheType = useLabelStore((s) => s.printerProfile.fontCacheType);
  const patchPrinterProfile = useLabelStore((s) => s.patchPrinterProfile);
  const loc = t.printerSettings.fonts;

  const fonts = getAllFonts();
  const uploadedPaths = new Set(fonts.map((f) => uploadedFontPath(f.name)));
  // setupFonts entries whose bytes never made it into fontCache (re-imported profile).
  const orphanPaths = [...new Set((setupFonts ?? [])
    .map((f) => f.path)
    .filter((p) => !uploadedPaths.has(p)))];
  const setupPaths = new Set((setupFonts ?? []).map((f) => f.path));

  const toggle = (path: string, on: boolean) => {
    const list = setupFonts ?? [];
    const next = on
      ? list.some((f) => f.path === path) ? list : [...list, { path }]
      : list.filter((f) => f.path !== path);
    patchPrinterProfile({ setupFonts: next.length > 0 ? next : undefined });
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted">
            {loc.uploadHeading}
          </h3>
          <span className={zplCommandTagCls}>~DY</span>
        </div>
        <p className="text-[11px] text-muted">{loc.uploadHint}</p>
        {fonts.length === 0 && orphanPaths.length === 0 ? (
          <p className="text-xs text-muted/70">{loc.noFonts}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {fonts.map((font) => {
              const path = uploadedFontPath(font.name);
              return (
                <li
                  key={font.name}
                  className="flex items-center justify-between gap-3 px-2 py-1.5 rounded border border-transparent hover:border-border-2 hover:bg-surface-2/40 transition-colors"
                >
                  <span className="font-mono text-xs text-text truncate" title={path}>
                    {path}
                  </span>
                  <label className="flex items-center gap-1.5 text-[10px] font-mono text-muted hover:text-text cursor-pointer">
                    <input
                      type="checkbox"
                      className="accent-accent"
                      checked={setupPaths.has(path)}
                      onChange={(e) => toggle(path, e.target.checked)}
                    />
                    {loc.uploadToggle}
                  </label>
                </li>
              );
            })}
            {orphanPaths.map((path) => (
              <li
                key={path}
                className="flex items-center justify-between gap-3 px-2 py-1.5 rounded border border-warning/30 bg-warning/5"
              >
                <span className="flex flex-col gap-0.5 min-w-0">
                  <span className="font-mono text-xs text-text/60 truncate" title={path}>
                    {path}
                  </span>
                  <span className="text-[10px] text-warning">{loc.missingBytes}</span>
                </span>
                <button
                  type="button"
                  onClick={() => toggle(path, false)}
                  className="font-mono text-[10px] text-muted hover:text-red-400 px-1"
                  aria-label={loc.removeOrphan}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

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

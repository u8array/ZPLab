import { useRef, useState } from "react";
import { useT } from "../../hooks/useT";
import { Tooltip } from "../ui/Tooltip";
import { cachedFontPath, loadFontBytes } from "@zplab/core/lib/fontCache";
import { findSetupEntry, withSetupEntry, withoutSetupEntry } from "@zplab/core/lib/setupEntries";
import { isTrueTypeFileName, prepareFontUpload, printerFontFileName, type FontUploadIssue } from "@zplab/core/lib/customFonts";
import { storageKey, storageRefMatchesPath } from "@zplab/core/lib/storagePath";
import { useCachedFonts } from "../../hooks/useCachedFonts";
import { useUpload } from "../../hooks/useUpload";
import { useLabelStore, selectEditorFrozen } from "../../store/labelStore";
import { buttonCls, disabledCls, zplCommandTagCls } from "../ui/formStyles";

/** Why a profile row cannot be provisioned. */
function rowIssue(path: string, cachedKeys: ReadonlySet<string>): "unshippable" | "missingBytes" | undefined {
  if (!isTrueTypeFileName(path)) return "unshippable";
  return cachedKeys.has(storageKey(path)) ? undefined : "missingBytes";
}

/** A picked file can supply the bytes only when the upload naming rule keeps this exact path. */
function repairable(path: string): boolean {
  const own = printerFontFileName(path);
  return own !== undefined && storageRefMatchesPath(own, path);
}

/** Provisioning only. Deleting cached fonts stays in the FontManager. */
export function StoredFontsTab() {
  const t = useT();
  const fonts = useCachedFonts();
  const setupFonts = useLabelStore((s) => s.printerProfile.setupFonts);
  const patchPrinterProfileWith = useLabelStore((s) => s.patchPrinterProfileWith);
  const loc = t.printerSettings.fonts;
  const frozen = useLabelStore(selectEditorFrozen);

  // A cache row is named by its printer path, so profile and cache rows share one identity rule.
  const cachedPaths = fonts.map(cachedFontPath);
  const cachedKeys = new Set(cachedPaths.map(storageKey));
  const rows = [
    ...(setupFonts ?? []).map((f) => ({ path: f.path, inProfile: true, issue: rowIssue(f.path, cachedKeys) })),
    ...cachedPaths
      .filter((path) => isTrueTypeFileName(path) && !findSetupEntry(setupFonts, path))
      .map((path) => ({ path, inProfile: false, issue: undefined })),
  ];

  const toggle = (path: string, on: boolean) =>
    patchPrinterProfileWith((p) => ({ setupFonts: on ? withSetupEntry(p.setupFonts, { path }) : withoutSetupEntry(p.setupFonts, path) }));

  const fileRef = useRef<HTMLInputElement>(null);
  const [repairTarget, setRepairTarget] = useState<string>();
  const pick = (target?: string) => {
    setRepairTarget(target);
    fileRef.current?.click();
  };
  const { busy: uploading, issue: uploadIssue, start: uploadFile } = useUpload<"error" | "refused" | FontUploadIssue, [target?: string]>(async (file, target) => {
    const prepared = await prepareFontUpload(file, target);
    if (!prepared.ok) return prepared.reason;
    await loadFontBytes(prepared.bytes, prepared.path);
    if (!toggle(prepared.path, true)) return "refused";
    return null;
  }, "error");

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
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".ttf,.otf,.tte,.TTF,.OTF,.TTE"
            className="hidden"
            aria-label={loc.uploadFont}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) uploadFile(file, repairTarget);
            }}
          />
          <Tooltip content={frozen ? t.printerSettings.frozenHint : undefined}>
            <button type="button" className={`${buttonCls} ${disabledCls}`} disabled={uploading || frozen} onClick={() => pick()}>
              {loc.uploadFont}
            </button>
          </Tooltip>
          {uploadIssue && <span className="text-[10px] text-warning">{{ error: loc.uploadError, notAFont: loc.uploadError, nameTaken: t.fonts.nameTaken, nameUnusable: t.fonts.nameUnusable, refused: t.printerSettings.frozenHint }[uploadIssue]}</span>}
        </div>
        {rows.length === 0 ? (
          <p className="text-xs text-muted/70">{loc.noFonts}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.map(({ path, inProfile, issue }) =>
              !issue ? (
                <li
                  key={path}
                  className="flex items-center justify-between gap-3 px-2 py-1.5 rounded border border-transparent hover:border-border-2 hover:bg-surface-2/40 transition-colors"
                >
                  <span className="font-mono text-xs text-text truncate" title={path}>
                    {path}
                  </span>
                  <Tooltip content={frozen ? t.printerSettings.frozenHint : undefined}>
                    <label className="flex items-center gap-1.5 text-[10px] font-mono text-muted hover:text-text cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-accent"
                        checked={inProfile}
                        disabled={frozen}
                        onChange={(e) => toggle(path, e.target.checked)}
                      />
                      {loc.uploadToggle}
                    </label>
                  </Tooltip>
                </li>
              ) : (
                <li
                  key={path}
                  className="flex items-center justify-between gap-3 px-2 py-1.5 rounded border border-warning/30 bg-warning/5"
                >
                  <span className="flex flex-col gap-0.5 min-w-0">
                    <span className="font-mono text-xs text-text/60 truncate" title={path}>
                      {path}
                    </span>
                    <span className="text-[10px] text-warning">
                      {issue === "unshippable" ? loc.unshippableEntry : loc.missingBytes}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    {issue === "missingBytes" && repairable(path) && (
                      <button type="button" className={`${buttonCls} ${disabledCls}`} disabled={uploading || frozen} onClick={() => pick(path)}>
                        {loc.repairEntry}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={frozen}
                      onClick={() => toggle(path, false)}
                      className="font-mono text-[10px] text-muted hover:text-red-400 px-1"
                      aria-label={loc.removeOrphan}
                    >
                      ✕
                    </button>
                  </span>
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    </div>
  );
}

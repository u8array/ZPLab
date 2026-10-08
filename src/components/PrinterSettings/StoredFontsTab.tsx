import { useState } from "react";
import { usePrinterListing } from "../../hooks/usePrinterListing";
import { useT } from "../../hooks/useT";
import { Tooltip } from "../ui/Tooltip";
import { cachedFontPath, loadFontBytes } from "@zplab/core/lib/fontCache";
import { withSetupEntry, withoutSetupEntry } from "@zplab/core/lib/setupEntries";
import { isTrueTypeFileName, printerFontFileName } from "@zplab/core/lib/customFonts";
import { listsStoredFont } from "@zplab/core/lib/storedObjects";
import { storedObjectOrigins } from "@zplab/core/lib/storedObjectOrigins";
import { storageKey, storageRefMatchesPath } from "@zplab/core/lib/storagePath";
import { useCachedFonts } from "../../hooks/useCachedFonts";
import { useLabelStore, selectEditorFrozen } from "../../store/labelStore";
import { isDesktopShell } from "../../lib/platform";
import { PrinterObjectActions, PrinterOriginMark, PrinterStorageBar, StoredObjectsHeading } from "./PrinterStorage";
import { buttonCls, disabledCls } from "../ui/formStyles";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { AddFontDialog } from "../Fonts/AddFontDialog";
import { useStoredObjectHover } from "../../hooks/useStoredObjectHover";

/** Why a profile row cannot be provisioned. */
function rowIssue(key: string, cachedKeys: ReadonlySet<string>): "unshippable" | "missingBytes" | undefined {
  if (!isTrueTypeFileName(key)) return "unshippable";
  return cachedKeys.has(key) ? undefined : "missingBytes";
}

/** A picked file can supply the bytes only when the upload naming rule keeps this exact path. */
function repairable(path: string): boolean {
  const own = printerFontFileName(path);
  return own !== undefined && storageRefMatchesPath(own, path);
}

/** Deleting cached fonts stays in the FontManager. */
export function StoredFontsTab() {
  const t = useT();
  const fonts = useCachedFonts();
  const setupFonts = useLabelStore((s) => s.printerProfile.setupFonts);
  const customFonts = useLabelStore((s) => s.label.customFonts);
  const shipsToo = (path: string) => customFonts?.some((m) => m.embedInZpl && m.path !== undefined && storageRefMatchesPath(m.path, path)) ?? false;
  const patchPrinterProfileWith = useLabelStore((s) => s.patchPrinterProfileWith);
  const loc = t.printerSettings.fonts;
  const { setHoveredKey } = useStoredObjectHover();
  const frozen = useLabelStore(selectEditorFrozen);

  // A cache row is named by its printer path, so profile and cache rows share one identity rule.
  const cachedPaths = fonts.map(cachedFontPath).filter((path) => listsStoredFont(path, setupFonts));
  const cachedKeys = new Set(cachedPaths.map(storageKey));
  // A replayed upload carries its own bytes in the profile, so it needs no cache row behind it.
  const replayedPaths = (setupFonts ?? []).flatMap((f) => (f.download === undefined ? [] : [f.path]));
  const replayedKeys = new Set(replayedPaths.map(storageKey));
  const rows = storedObjectOrigins({
    kind: "font",
    setupPaths: (setupFonts ?? []).map((f) => f.path),
    local: [...cachedPaths, ...replayedPaths].map((path) => ({ path, hasBytes: true })),
    listing: usePrinterListing(),
  }).map((origin) => {
    const replayed = replayedKeys.has(origin.key);
    const issue = origin.inSetup && !replayed ? rowIssue(origin.key, cachedKeys) : undefined;
    // A printer-only row offers nothing: without bytes here, provisioning has nothing to send.
    const control = issue ? "removeEntry" : replayed ? "removeReplayed" : cachedKeys.has(origin.key) ? "provision" : "none";
    return { origin, replayed, issue, control };
  });

  const toggle = (path: string, on: boolean) =>
    patchPrinterProfileWith((p) => ({ setupFonts: on ? withSetupEntry(p.setupFonts, { path }) : withoutSetupEntry(p.setupFonts, path) }));

  // One upload path for the app, so the tab opens the font panel's dialog instead of keeping its own.
  const [adding, setAdding] = useState<{ repairPath?: string }>();
  const [uploadIssue, setUploadIssue] = useState<"replayedNameTaken" | "refused">();

  /** A replayed entry carries the only copy of its bytes, and a profile write replaces an entry
   *  whole. Nothing may be written before the refusal. */
  const provision = async ({ path, bytes }: { path: string; bytes: Uint8Array }) => {
    if (replayedKeys.has(storageKey(path))) return setUploadIssue("replayedNameTaken");
    // The entry has to meet a cache that already holds the file, or its row reads as missing bytes.
    await loadFontBytes(bytes, path);
    setUploadIssue(toggle(path, true) ? undefined : "refused");
  };
  // A replayed upload lives in the profile only, so removing it is a delete, not a toggle.
  const [pendingRemove, setPendingRemove] = useState<string>();

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <StoredObjectsHeading />
        <div className="flex items-center gap-2">
          <Tooltip content={frozen ? t.printerSettings.frozenHint : loc.uploadHint}>
            <button type="button" className={`${buttonCls} ${disabledCls}`} disabled={frozen} onClick={() => { setUploadIssue(undefined); setAdding({}); }}>
              {loc.uploadFont}
            </button>
          </Tooltip>
          {uploadIssue && (
            <span role="alert" className="text-[10px] text-warning">
              {uploadIssue === "refused" ? t.printerSettings.frozenHint : loc.replayedNameTaken}
            </span>
          )}
        </div>
        {isDesktopShell && <PrinterStorageBar />}
        {rows.length === 0 ? (
          <p className="text-xs text-muted/70">{loc.noFonts}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.map(({ origin, replayed, issue, control }) => {
              const { path, key, inSetup, hostObject } = origin;
              return (
                <li
                  key={key}
                  onMouseEnter={() => setHoveredKey(key)}
                  onMouseLeave={() => setHoveredKey(undefined)}
                  className={`flex items-center justify-between gap-3 px-2 py-1.5 rounded border ${issue ? "border-warning/30 bg-warning/5" : "border-transparent hover:border-border-2 hover:bg-surface-2/40 transition-colors"}`}
                >
                  <span className="flex flex-col gap-0.5 min-w-0">
                    <span className={`font-mono text-xs truncate ${issue ? "text-text/60" : "text-text"}`} title={path}>
                      {path}
                    </span>
                    {issue && <span className="text-[10px] text-warning">{issue === "unshippable" ? loc.unshippableEntry : loc.missingBytes}</span>}
                    {inSetup && shipsToo(path) && <span className="text-[10px] text-muted">{t.delivery.job}</span>}
                    {replayed && (
                      <Tooltip content={loc.printerFormatHint}>
                        <span className="text-[10px] text-muted">{loc.printerFormat}</span>
                      </Tooltip>
                    )}
                    <PrinterOriginMark origin={origin} />
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    {hostObject && <PrinterObjectActions origin={{ ...origin, hostObject }} kind="font" />}
                    {issue === "missingBytes" && repairable(path) && (
                      <button type="button" className={`${buttonCls} ${disabledCls}`} disabled={frozen} onClick={() => { setUploadIssue(undefined); setAdding({ repairPath: path }); }}>
                        {loc.repairEntry}
                      </button>
                    )}
                    {control === "removeEntry" && (
                      <button
                        type="button"
                        disabled={frozen}
                        onClick={() => toggle(path, false)}
                        className="font-mono text-[10px] text-muted hover:text-red-400 px-1"
                        aria-label={loc.removeOrphan}
                      >
                        ✕
                      </button>
                    )}
                    {control === "removeReplayed" && (
                      <button
                        type="button"
                        disabled={frozen}
                        onClick={() => setPendingRemove(path)}
                        className="font-mono text-[10px] text-muted hover:text-red-400 px-1 disabled:opacity-30"
                        aria-label={loc.removeReplayed}
                      >
                        ✕
                      </button>
                    )}
                    {control === "provision" && (
                      <Tooltip content={frozen ? t.printerSettings.frozenHint : undefined}>
                        <label className="flex items-center gap-1.5 text-[10px] font-mono text-muted hover:text-text cursor-pointer">
                          <input
                            type="checkbox"
                            className="accent-accent"
                            checked={inSetup}
                            disabled={frozen}
                            onChange={(e) => toggle(path, e.target.checked)}
                          />
                          {loc.uploadToggle}
                        </label>
                      </Tooltip>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {adding && (
        <AddFontDialog
          repairPath={adding.repairPath}
          onDone={(picked) => {
            if (picked) void provision(picked);
            setAdding(undefined);
          }}
        />
      )}
      {pendingRemove !== undefined && (
        <ConfirmDialog
          message={loc.removeReplayedConfirm}
          confirmLabel={loc.removeReplayed}
          cancelLabel={t.variables.cancel}
          destructive
          onConfirm={() => {
            toggle(pendingRemove, false);
            setPendingRemove(undefined);
          }}
          onCancel={() => setPendingRemove(undefined)}
        />
      )}
    </div>
  );
}

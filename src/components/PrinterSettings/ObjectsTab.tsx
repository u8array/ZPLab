import { useRef, useState } from "react";
import { InformationCircleIcon } from "@heroicons/react/16/solid";
import { Tooltip } from "../ui/Tooltip";
import { useT } from "../../hooks/useT";
import { useLabelStore } from "../../store/labelStore";
import { buttonCls } from "../Properties/styles";
import { encodeGraphicFile } from "@zplab/core/lib/imageToZpl";
import { sanitizeStorageName, storageRefMatchesPath, uploadedGraphicPath } from "@zplab/core/lib/storagePath";
import { zplCommandTagCls } from "../ui/formStyles";
import { exportableLeaves } from "@zplab/core/types/Group";
import { canSendSetupGraphic, setupGraphicFits, setupGraphicOf, setupGraphicState, uploadKey, type ImageProps } from "@zplab/core/registry/image";
import { mergeSetupEntries } from "@zplab/core/lib/zplImportService";
import type { SetupGraphic } from "@zplab/core/types/PrinterProfile";

/** Provisions only. Whether a job still ships its own bytes stays with the object, as for the fonts tab. */
export function ObjectsTab() {
  const t = useT();
  const pages = useLabelStore((s) => s.pages);
  const setupGraphics = useLabelStore((s) => s.printerProfile.setupGraphics);
  const patchPrinterProfile = useLabelStore((s) => s.patchPrinterProfile);
  const loc = t.printerSettings.objects;

  const rows = new Map<string, ImageProps>();
  for (const page of pages) {
    for (const leaf of exportableLeaves(page.objects)) {
      const props = leaf.props as ImageProps;
      const key = leaf.type === "image" ? uploadKey(props) : undefined;
      if (key && !rows.has(key)) rows.set(key, props);
    }
  }
  const rowKeys = [...rows.keys()];
  const profileOnly = (setupGraphics ?? []).filter((g) => !rowKeys.some((key) => storageRefMatchesPath(g.path, key)));

  // Read at write time: an upload resolves after the render that created it.
  const put = (entry: SetupGraphic) =>
    patchPrinterProfile({ setupGraphics: mergeSetupEntries(useLabelStore.getState().printerProfile.setupGraphics, [entry]) });
  const drop = (path: string) => {
    const next = (setupGraphics ?? []).filter((g) => !storageRefMatchesPath(g.path, path));
    patchPrinterProfile({ setupGraphics: next.length > 0 ? next : undefined });
  };
  const [sendIssue, setSendIssue] = useState<{ path: string; cache: string | undefined; fit: "tooLarge" | "unshippable" } | null>(null);
  const send = (path: string, props: ImageProps) => {
    const verdict = setupGraphicOf(props);
    if (!verdict) return;
    if (verdict.fit !== "ok") return setSendIssue({ path, cache: props._gfaCache, fit: verdict.fit });
    setSendIssue(null);
    put(verdict.entry);
  };

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadIssue, setUploadIssue] = useState<"error" | "invalidName" | "tooLarge" | "tooWide" | null>(null);
  const uploadFile = async (file: File) => {
    setUploadIssue(null);
    setUploading(true);
    try {
      const { zpl } = await encodeGraphicFile(file);
      const fit = setupGraphicFits(zpl);
      if (fit !== "ok") return setUploadIssue(fit === "tooLarge" ? "tooLarge" : "tooWide");
      const name = sanitizeStorageName(file.name.replace(/\.[^.]*$/, ""));
      if (!name) return setUploadIssue("invalidName");
      put({ path: uploadedGraphicPath({ device: "R", name }), gfa: zpl });
    } catch {
      setUploadIssue("error");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted">
              {loc.uploadHeading}
            </h3>
            <Tooltip content={loc.uploadHint}>
              <InformationCircleIcon className="w-3 h-3 text-muted/60 cursor-help shrink-0" />
            </Tooltip>
          </div>
          <span className={zplCommandTagCls}>~DY</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            aria-label={loc.uploadGraphic}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void uploadFile(file);
            }}
          />
          <button type="button" className={buttonCls} disabled={uploading} onClick={() => fileRef.current?.click()}>
            {loc.uploadGraphic}
          </button>
          {uploadIssue && (
            <span className="text-[10px] text-warning">
              {{ error: loc.uploadError, invalidName: loc.invalidName, tooLarge: loc.tooLarge, tooWide: loc.tooWide }[uploadIssue]}
            </span>
          )}
        </div>
        {rows.size === 0 && profileOnly.length === 0 ? (
          <p className="text-xs text-muted/70">{loc.noGraphics}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {[...rows.entries()].map(([path, props]) => {
              const state = setupGraphicState(props, setupGraphics);
              const hasEntry = (setupGraphics ?? []).some((g) => storageRefMatchesPath(g.path, path));
              const orphan = state === "none" && props.storedAs?.embedInZpl === false;
              const resend = state === "stale" ? loc.staleEntry : state === "unknown" ? loc.unverifiedEntry : null;
              const refused = sendIssue?.path === path && sendIssue.cache === props._gfaCache ? sendIssue.fit : null;
              return (
                <li
                  key={path}
                  className="flex items-center justify-between gap-3 px-2 py-1.5 rounded border border-transparent hover:border-border-2 hover:bg-surface-2/40 transition-colors"
                >
                  <span className="flex flex-col gap-0.5 min-w-0">
                    <span className="font-mono text-xs text-text truncate" title={path}>
                      {path}
                    </span>
                    {refused ? (
                      <span className="text-[10px] text-warning">{refused === "tooLarge" ? loc.tooLarge : loc.tooWide}</span>
                    ) : resend && canSendSetupGraphic(props) ? (
                      <button type="button" className="text-left text-[10px] text-warning hover:underline" onClick={() => send(path, props)}>
                        {resend}
                      </button>
                    ) : resend ? (
                      <span className="text-[10px] text-warning">{resend}</span>
                    ) : state === "tooLarge" ? (
                      <span className="text-[10px] text-warning">{loc.tooLarge}</span>
                    ) : orphan ? (
                      <span className="text-[10px] text-warning">{loc.orphanRecall}</span>
                    ) : null}
                  </span>
                  <label className="flex items-center gap-1.5 text-[10px] font-mono text-muted hover:text-text cursor-pointer">
                    <input
                      type="checkbox"
                      className="accent-accent"
                      checked={hasEntry}
                      disabled={!hasEntry && !canSendSetupGraphic(props)}
                      onChange={(e) => (e.target.checked ? send(path, props) : drop(path))}
                    />
                    {loc.uploadToggle}
                  </label>
                </li>
              );
            })}
            {profileOnly.map((entry) => (
              <li
                key={entry.path}
                className="flex items-center justify-between gap-3 px-2 py-1.5 rounded border border-border-2/60 bg-surface-2/20"
              >
                <span className="flex flex-col gap-0.5 min-w-0">
                  <span className="font-mono text-xs text-text/80 truncate" title={entry.path}>
                    {entry.path}
                  </span>
                  <span className="text-[10px] text-muted">{loc.fromProfile}</span>
                </span>
                <button
                  type="button"
                  onClick={() => drop(entry.path)}
                  className="font-mono text-[10px] text-muted hover:text-red-400 px-1"
                  aria-label={loc.removeEntry}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

import { useRef, useState } from "react";
import { InformationCircleIcon } from "@heroicons/react/16/solid";
import { Tooltip } from "../ui/Tooltip";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useT } from "../../hooks/useT";
import { useUpload } from "../../hooks/useUpload";
import { useLabelStore, useLiveUsage, selectEditorFrozen } from "../../store/labelStore";
import { encodeGraphicFile } from "@zplab/core/lib/imageToZpl";
import { sanitizeStorageName, setupEntryKey, uploadedGraphicPath } from "@zplab/core/lib/storagePath";
import { findSetupEntry, setupEntryHoldsOther, withSetupEntry, withoutSetupEntry } from "@zplab/core/lib/setupEntries";
import { buttonCls, disabledCls, zplCommandTagCls } from "../ui/formStyles";
import { useCachedImages } from "../../hooks/useCachedImages";
import { exportableLeaves } from "@zplab/core/types/Group";
import { canSendSetupGraphic, setupGraphicFits, setupGraphicOf, setupGraphicState, uploadKey, type ImageProps } from "@zplab/core/registry/image";
import { removeImage } from "@zplab/core/lib/imageCache";
import { imageUsage } from "@zplab/core/lib/imageUsage";
import type { LiveReason } from "@zplab/core/lib/liveUsage";
import type { SetupGraphic } from "@zplab/core/types/PrinterProfile";

/** Provisioning plus the local image cache. Whether a job ships its own bytes stays with the object. */
export function StoredGraphicsTab() {
  const t = useT();
  const pages = useLabelStore((s) => s.pages);
  const setupGraphics = useLabelStore((s) => s.printerProfile.setupGraphics);
  const patchPrinterProfileWith = useLabelStore((s) => s.patchPrinterProfileWith);
  const loc = t.printerSettings.objects;

  const rows = new Map<string, ImageProps>();
  for (const page of pages) {
    for (const leaf of exportableLeaves(page.objects)) {
      const props = leaf.props as ImageProps;
      const key = leaf.type === "image" ? uploadKey(props) : undefined;
      if (key && !rows.has(key)) rows.set(key, props);
    }
  }
  const profileOnly = (setupGraphics ?? []).filter((g) => !rows.has(setupEntryKey(g)));

  const put = (entry: SetupGraphic) => patchPrinterProfileWith((p) => ({ setupGraphics: withSetupEntry(p.setupGraphics, entry) }));
  const drop = (path: string) => patchPrinterProfileWith((p) => ({ setupGraphics: withoutSetupEntry(p.setupGraphics, path) }));
  const [sendIssue, setSendIssue] = useState<{ path: string; cache: string | undefined; fit: "tooLarge" | "unshippable" } | null>(null);
  const send = (path: string, props: ImageProps) => {
    const verdict = setupGraphicOf(props);
    if (!verdict) return;
    if (verdict.fit !== "ok") return setSendIssue({ path, cache: props._gfaCache, fit: verdict.fit });
    setSendIssue(null);
    put(verdict.entry);
  };

  // Frozen, the open pages are not what a source session will apply, so no control may act on them.
  const frozen = useLabelStore(selectEditorFrozen);
  const usage = imageUsage(pages);
  const held = useLiveUsage().images;
  const cached = useCachedImages();
  const unused = cached.filter((img) => !held.has(img.id));
  const [pendingDrop, setPendingDrop] = useState<string[] | null>(null);
  const dropCached = (ids: string[]) => {
    for (const id of ids) removeImage(id);
  };

  const fileRef = useRef<HTMLInputElement>(null);
  const { busy: uploading, issue: uploadIssue, start: uploadFile } = useUpload(async (file: File) => {
    const { zpl } = await encodeGraphicFile(file);
    const fit = setupGraphicFits(zpl);
    if (fit !== "ok") return fit === "tooLarge" ? "tooLarge" : "tooWide";
    const name = sanitizeStorageName(file.name.replace(/\.[^.]*$/, ""));
    if (!name) return "invalidName";
    const entry = { path: uploadedGraphicPath({ device: "R", name }), gfa: zpl };
    // Read after the encode: an upload resolves after the render that started it.
    if (setupEntryHoldsOther(useLabelStore.getState().printerProfile.setupGraphics, entry)) return "nameTaken";
    // The hint is the fixed text: by the time it renders, the freeze that refused the patch may be over.
    if (!put(entry)) return "refused";
    return null;
  }, "error" as const);

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
              if (file) uploadFile(file);
            }}
          />
          <Tooltip content={frozen ? t.printerSettings.frozenHint : undefined}>
            <button type="button" className={`${buttonCls} ${disabledCls}`} disabled={uploading || frozen} onClick={() => fileRef.current?.click()}>
              {loc.uploadGraphic}
            </button>
          </Tooltip>
          {uploadIssue && (
            <span className="text-[10px] text-warning">
              {{ error: loc.uploadError, invalidName: loc.invalidName, tooLarge: loc.tooLarge, tooWide: loc.tooWide, nameTaken: loc.nameTaken, refused: t.printerSettings.frozenHint }[uploadIssue]}
            </span>
          )}
        </div>
        {rows.size === 0 && profileOnly.length === 0 ? (
          <p className="text-xs text-muted/70">{loc.noGraphics}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {[...rows.entries()].map(([path, props]) => {
              const state = setupGraphicState(props, setupGraphics);
              const hasEntry = findSetupEntry(setupGraphics, path) !== undefined;
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
                      <button type="button" className="text-left text-[10px] text-warning hover:underline disabled:opacity-40" disabled={frozen} onClick={() => send(path, props)}>
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
                  <Tooltip content={frozen ? t.printerSettings.frozenHint : undefined}>
                    <label className="flex items-center gap-1.5 text-[10px] font-mono text-muted hover:text-text cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-accent"
                        checked={hasEntry}
                        disabled={frozen || (!hasEntry && !canSendSetupGraphic(props))}
                        onChange={(e) => (e.target.checked ? send(path, props) : drop(path))}
                      />
                      {loc.uploadToggle}
                    </label>
                  </Tooltip>
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
                  disabled={frozen}
                  onClick={() => drop(entry.path)}
                  className="font-mono text-[10px] text-muted hover:text-red-400 disabled:opacity-30 px-1"
                  aria-label={loc.removeEntry}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted">
              {loc.cacheHeading}
            </h3>
            <Tooltip content={loc.cacheHint}>
              <InformationCircleIcon className="w-3 h-3 text-muted/60 cursor-help shrink-0" />
            </Tooltip>
          </div>
          <button
            type="button"
            className={`${buttonCls} ${disabledCls}`}
            disabled={unused.length === 0 || frozen}
            title={frozen ? loc.cacheFrozen : undefined}
            onClick={() => setPendingDrop(unused.map((img) => img.id))}
          >
            {loc.removeUnused}
          </button>
        </div>
        {cached.length === 0 ? (
          <p className="text-xs text-muted/70">{loc.noCached}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {cached.map((img) => {
              const count = usage.get(img.id) ?? 0;
              const reason = held.get(img.id);
              return (
                <li
                  key={img.id}
                  className="flex items-center justify-between gap-3 px-2 py-1.5 rounded border border-transparent hover:border-border-2 hover:bg-surface-2/40 transition-colors"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <img src={img.dataUrl} alt="" className="w-6 h-6 object-contain bg-white rounded-sm shrink-0" />
                    <span className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-mono text-xs text-text truncate" title={img.name}>
                        {img.name}
                      </span>
                      <span className="text-[10px] text-muted">
                        {count > 0 ? loc.cacheUsageFmt.replace("{n}", String(count)) : loc.cacheUnused}
                      </span>
                    </span>
                  </span>
                  <Tooltip content={reason ? (({ document: loc.cacheInUse, history: loc.cacheInHistory, restore: loc.cacheInRestore, clipboard: loc.cacheInClipboard }) as Partial<Record<LiveReason, string>>)[reason] ?? loc.cacheInUse : frozen ? loc.cacheFrozen : loc.removeCached}>
                    <button
                      type="button"
                      disabled={held.has(img.id) || frozen}
                      onClick={() => setPendingDrop([img.id])}
                      className="font-mono text-[10px] text-muted hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed px-1"
                      aria-label={`${loc.removeCached}: ${img.name}`}
                    >
                      ✕
                    </button>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {pendingDrop !== null && (
        <ConfirmDialog
          message={pendingDrop.length === 1 ? loc.cacheDeleteConfirm : loc.cacheDeleteUnusedConfirmFmt.replace("{n}", String(pendingDrop.length))}
          confirmLabel={loc.removeCached}
          cancelLabel={t.app.cancel}
          destructive
          onConfirm={() => {
            dropCached(pendingDrop);
            setPendingDrop(null);
          }}
          onCancel={() => setPendingDrop(null)}
        />
      )}
    </div>
  );
}

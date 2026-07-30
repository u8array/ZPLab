import { useState, useRef, useCallback } from 'react';
import { InformationCircleIcon, TrashIcon } from '@heroicons/react/16/solid';
import type { ObjectTypeUi } from './panelTypes';
import { useT } from '../hooks/useT';
import { buttonCls, inputCls, labelCls } from '../components/Properties/styles';
import { loadImageFile, getImage, getAllImages, removeImage } from '@zplab/core/lib/imageCache';
import { imageToGFA } from '@zplab/core/lib/imageToZpl';
import {
  defaultStorageName,
  formatStoragePath,
  MAX_STORAGE_NAME_LEN,
  STORAGE_DEVICES,
  STORAGE_NAME_FILTER_RE,
} from '@zplab/core/lib/storagePath';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Tooltip } from '../components/ui/Tooltip';
import { SectionCard, StaticSectionCard } from '../components/Properties/SectionCard';
import { UnitNumberInput } from '../components/Properties/UnitNumberInput';
import { RotationSelect } from '../components/Properties/RotationSelect';
import { FieldLabel, ZplCmd } from '../components/Properties/ZplCmd';
import { Select } from '../components/ui/Select';
import { isImageRotatable, type ImageProps } from '@zplab/core/registry/image';

export const imagePanel: ObjectTypeUi<ImageProps> = {
  PropertiesPanel: ({ obj, onChange }) => {
    const t = useT();
    const p = obj.props;
    const fileRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [uploadFailed, setUploadFailed] = useState(false);
    const [pendingCacheDelete, setPendingCacheDelete] = useState(false);

    const cached = getImage(p.imageId);
    const allImages = getAllImages();

    const handleUpload = useCallback(async (file: File) => {
      setUploading(true);
      setUploadFailed(false);
      try {
        const entry = await loadImageFile(file);
        // Pre-generate GFA cache
        const result = await imageToGFA(entry.dataUrl, p.widthDots, p.threshold);
        onChange({ imageId: entry.id, _gfaCache: result.zpl });
      } catch {
        // Surface the failure inline (non-image MIME, oversized, decode error).
        setUploadFailed(true);
      } finally {
        setUploading(false);
      }
    }, [onChange, p.widthDots, p.threshold]);

    const handleImageSelect = useCallback(async (imageId: string) => {
      // Empty selection = "no image bytes". Legitimate when the user is
      // setting up a recall-only reference (storedAs without a local
      // preview image). Clear the cache pointer + ^GFA cache so the
      // ZPL emitter doesn't carry stale bytes from the previous source.
      if (!imageId) {
        onChange({ imageId: '', _gfaCache: undefined });
        return;
      }
      const img = getImage(imageId);
      if (!img) return;
      // A width-0 image (dimensionless SVG) rejects; still select it, just with
      // no cache, so the emit stays blank instead of leaving stale bytes.
      const result = await imageToGFA(img.dataUrl, p.widthDots, p.threshold).catch(() => null);
      onChange({ imageId, _gfaCache: result?.zpl });
    }, [onChange, p.widthDots, p.threshold]);

    const handleWidthChange = useCallback(async (widthDots: number) => {
      const img = getImage(p.imageId);
      if (!img) { onChange({ widthDots }); return; }
      const result = await imageToGFA(img.dataUrl, widthDots, p.threshold).catch(() => null);
      onChange(result ? { widthDots, _gfaCache: result.zpl } : { widthDots });
    }, [onChange, p.imageId, p.threshold]);

    const handleThresholdChange = useCallback(async (threshold: number) => {
      const img = getImage(p.imageId);
      if (!img) { onChange({ threshold }); return; }
      const result = await imageToGFA(img.dataUrl, p.widthDots, threshold).catch(() => null);
      onChange(result ? { threshold, _gfaCache: result.zpl } : { threshold });
    }, [onChange, p.imageId, p.widthDots]);

    // Lifted local const so the storage-section closures get a narrowed
    // reference that survives into onChange callbacks. Without it TS
    // re-widens `p.storedAs` to `... | undefined` inside the handlers
    // and we'd need `?.`-fallbacks for every field access.
    const storedAs = p.storedAs;

    return (
      <>
        <StaticSectionCard title={t.properties.contentSection} cmd={p.storedAs ? "^XG" : "^GF"}>
          {/* Image select / upload */}
          <div className="flex flex-col gap-1">
            <label className={labelCls}>{t.registry.image.source}</label>
            {allImages.length > 0 && (
              <div className="flex items-center gap-1">
                <div className="flex-1 min-w-0">
                  <Select<string>
                    value={p.imageId}
                    onChange={handleImageSelect}
                    aria-label={t.registry.image.source}
                    groups={[{ options: [
                      { value: '', label: t.registry.image.selectImage },
                      ...allImages.map((img) => ({ value: img.id, label: img.name })),
                    ] }]}
                  />
                </div>
                {/* Delete the *cached* file (data-URL) from imageCache +
                    localStorage. Different from removing the image-object
                    via Del: this clears the bytes shared across all
                    objects referencing the same imageId. Skip when the
                    current image-object has no source selected. */}
                {p.imageId && (
                  <Tooltip content={t.registry.image.removeFromCache}>
                    <button
                      type="button"
                      className="p-1.5 rounded text-muted hover:text-text hover:bg-surface-2 transition-colors shrink-0"
                      aria-label={t.registry.image.removeFromCache}
                      onClick={() => setPendingCacheDelete(true)}
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  </Tooltip>
                )}
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className={buttonCls}
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? t.registry.image.uploading : t.registry.image.upload}
            </button>
            {uploadFailed && (
              <p className="text-[10px] font-mono text-error">{t.registry.image.uploadError}</p>
            )}
          </div>

          {/* The colored source, shown nowhere else; the canvas already gives
              live mono feedback for the threshold slider. */}
          {cached && (
            <div className="flex flex-col gap-1">
              <label className={labelCls}>{t.registry.image.original}</label>
              <img
                src={cached.dataUrl}
                alt={cached.name}
                className="max-w-full max-h-20 object-contain rounded border border-border bg-white"
              />
              <span className="text-[10px] text-muted font-mono">
                {cached.width} × {cached.height} px
              </span>
            </div>
          )}
        </StaticSectionCard>

        <SectionCard id={`${obj.type}-settings`} title={t.properties.settingsSection}>
          {/* Width */}
          <UnitNumberInput
            label={t.registry.image.widthDots}
            scope="page"
            valueDots={p.widthDots}
            minDots={8}
            onChangeDots={(w) => w !== undefined && handleWidthChange(w)}
            zplCmd={p.storedAs ? "~DY" : "^GF"}
          />

          {/* Mono threshold */}
          <div className="flex flex-col gap-1">
            <FieldLabel cmd={p.storedAs ? "~DY" : "^GF"}>{t.registry.image.threshold}</FieldLabel>
            <input
              type="range"
              min={1}
              max={255}
              value={p.threshold}
              onChange={(e) => handleThresholdChange(Number(e.target.value))}
              className="accent-accent"
            />
            <span className="text-[10px] text-muted font-mono text-right">{p.threshold}</span>
          </div>

          {/* Rotation control only for a rotatable inline bitmap; storedAs/rawGf
              emit upright (isImageRotatable is the single gate). */}
          {isImageRotatable(p) && (
            <RotationSelect
              value={p.rotation ?? 'N'}
              onChange={(rotation) => onChange({ rotation })}
              zplCmd="^GF"
            />
          )}

          {/* Printer storage (~DY + ^XG). Section label + info icon are
              always visible so the feature is discoverable in both states;
              the body switches between an Activate-button (off) and the
              device/name editor (on). Border-top separates it visually
              from the rendering properties above. */}
          <div className="flex flex-col gap-1 mt-1 pt-3 border-t border-border">
            <div className="flex items-center gap-2">
              <label className={labelCls}>{t.registry.image.storage}</label>
              <Tooltip content={t.registry.image.storeOnPrinterHint}>
                <InformationCircleIcon className="w-3 h-3 text-muted/60 cursor-help shrink-0" />
              </Tooltip>
              <div className="ml-auto">
                <ZplCmd cmd="~DY" />
              </div>
            </div>
            {storedAs ? (
              <>
                <div className="grid grid-cols-[auto_1fr] gap-2">
                  <Select<string>
                    value={storedAs.device}
                    aria-label={t.registry.image.storage}
                    onChange={(device) =>
                      onChange({ storedAs: { ...storedAs, device } })
                    }
                    groups={[{ options: STORAGE_DEVICES.map((d) => ({ value: d, label: `${d}:` })) }]}
                  />
                  <input
                    className={inputCls}
                    value={storedAs.name}
                    maxLength={MAX_STORAGE_NAME_LEN}
                    onChange={(e) => {
                      const next = e.target.value
                        .toUpperCase()
                        .replace(STORAGE_NAME_FILTER_RE, '')
                        .slice(0, MAX_STORAGE_NAME_LEN);
                      // Silently ignore keystrokes that would empty the name:
                      // an empty stem produces broken ZPL (`~DYR:,A,G,...`),
                      // and a controlled-component "refuses-to-delete-last-char"
                      // is a clearer constraint signal than a tooltip.
                      if (!next) return;
                      onChange({
                        storedAs: { ...storedAs, name: next },
                      });
                    }}
                  />
                </div>
                <span className="text-[10px] text-muted font-mono">
                  {formatStoragePath(storedAs, true)}
                </span>
                <label className="flex items-center gap-2 cursor-pointer mt-1">
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={storedAs.embedInZpl !== false}
                    onChange={(e) =>
                      onChange({
                        storedAs: { ...storedAs, embedInZpl: e.target.checked },
                      })
                    }
                  />
                  <span className={labelCls}>{t.registry.image.embedInZpl}</span>
                  <Tooltip content={t.registry.image.embedInZplHint}>
                    <InformationCircleIcon className="w-3.5 h-3.5 text-muted/60 cursor-help shrink-0" />
                  </Tooltip>
                </label>
                <button
                  type="button"
                  className={buttonCls}
                  onClick={() => onChange({ storedAs: undefined })}
                >
                  {t.registry.image.storeInline}
                </button>
              </>
            ) : (
              <button
                type="button"
                className={buttonCls}
                onClick={() =>
                  onChange({ storedAs: { device: 'R', name: defaultStorageName() } })
                }
              >
                {t.registry.image.storeOnPrinter}
              </button>
            )}
          </div>
        </SectionCard>

        {pendingCacheDelete && (
          <ConfirmDialog
            message={t.registry.image.removeFromCacheConfirm}
            confirmLabel={t.registry.image.removeFromCache}
            cancelLabel={t.app.cancel}
            destructive
            onConfirm={() => {
              removeImage(p.imageId);
              onChange({ imageId: '', _gfaCache: undefined });
              setPendingCacheDelete(false);
            }}
            onCancel={() => setPendingCacheDelete(false)}
          />
        )}
      </>
    );
  },
};

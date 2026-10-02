import { useState, useRef, useCallback } from 'react';
import { InformationCircleIcon } from '@heroicons/react/16/solid';
import type { ObjectTypeUi } from './panelTypes';
import { useT } from '../hooks/useT';
import { buttonCls, inputCls, labelCls } from '../components/Properties/styles';
import { disabledCls } from '../components/ui/formStyles';
import { loadImageFile, getImage } from '@zplab/core/lib/imageCache';
import { imageToGFA } from '@zplab/core/lib/imageToZpl';
import { formatStoragePath, MAX_STORAGE_NAME_LEN, sanitizeStorageName, STORAGE_DEVICES } from '@zplab/core/lib/storagePath';
import { Tooltip } from '../components/ui/Tooltip';
import { SectionCard, StaticSectionCard } from '../components/Properties/SectionCard';
import { UnitNumberInput } from '../components/Properties/UnitNumberInput';
import { RotationSelect } from '../components/Properties/RotationSelect';
import { FieldLabel, ZplCmd } from '../components/Properties/ZplCmd';
import { Select } from '../components/ui/Select';
import { IMAGE_PROP_SPECS, isImageRotatable, recallCommand, recallStoragePath, setupGraphicState, type ImageProps } from '@zplab/core/registry/image';
import { applyGraphicDelivery, draftGraphicIdentity, graphicDelivery, graphicWayBlocks, providedGraphic, type GraphicWayBlock, type ResourceDelivery } from '@zplab/core/lib/resourceDelivery';
import { findSetupEntry } from '@zplab/core/lib/setupEntries';
import { uploadedGraphicPath } from '@zplab/core/lib/storagePath';
import { DeliverySelect } from '../components/Properties/DeliverySelect';
import { useCachedImages } from '../hooks/useCachedImages';
import { useLabelStore } from '../store/labelStore';

export const imagePanel: ObjectTypeUi<ImageProps> = {
  PropertiesPanel: ({ obj, onChange, locked }) => {
    const t = useT();
    const p = obj.props;
    const fileRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [uploadFailed, setUploadFailed] = useState(false);

    const cached = getImage(p.imageId);
    const allImages = useCachedImages();

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

    const storedAs = p.storedAs;
    const setupGraphics = useLabelStore((s) => s.printerProfile.setupGraphics);
    const patchPrinterProfile = useLabelStore((s) => s.patchPrinterProfile);
    const openObjects = useLabelStore((s) => s.setPrinterSettingsTab);
    // Held in state so the drafted name does not churn across renders.
    const [draft, setDraft] = useState(() => draftGraphicIdentity(setupGraphics));
    // A draft the profile already holds would adopt that entry's bytes, so redraft before the checks read it.
    if (!storedAs && findSetupEntry(setupGraphics, uploadedGraphicPath(draft))) setDraft(draftGraphicIdentity(setupGraphics));
    const identity = storedAs ?? draft;
    const identified = providedGraphic({ ...p, storedAs: identity });
    const setupState = setupGraphicState(identified, setupGraphics);
    // Remembered here, not in the object: caching a refused encode would dirty the design for nothing.
    const [setupRefusal, setSetupRefusal] = useState<{ imageId: string; cache: string | undefined; fit: 'tooLarge' | 'unshippable' } | null>(null);
    const refusal = setupRefusal?.imageId === p.imageId && setupRefusal.cache === p._gfaCache ? setupRefusal.fit : null;
    const delivery = graphicDelivery(p, setupGraphics);
    const blockText: Record<GraphicWayBlock, string> = {
      opaque: t.delivery.opaqueBytes,
      tooLarge: t.printerSettings.objects.tooLarge,
      tooWide: t.printerSettings.objects.tooWide,
      noUploadBytes: t.delivery.setupNeedsBytes,
      noJobBytes: t.delivery.jobNeedsBytes,
    };
    const blocks = graphicWayBlocks(p, draft, setupGraphics, refusal);
    const blocked = (way: ResourceDelivery) => (blocks[way] === undefined ? undefined : blockText[blocks[way]]);
    const issue = delivery === 'job'
      ? blocked('job')
      : delivery === 'setup' && setupState === 'stale'
        ? t.printerSettings.objects.staleEntry
        : delivery === 'setup' && setupState === 'unknown'
          ? t.printerSettings.objects.unverifiedEntry
          : undefined;
    const deliver = (next: ResourceDelivery) => {
      const result = applyGraphicDelivery(next, p, setupGraphics, draft);
      if (!result) return;
      if ('refused' in result) return setSetupRefusal({ imageId: p.imageId, cache: p._gfaCache, fit: result.refused });
      if (result.setupGraphics !== setupGraphics && !patchPrinterProfile({ setupGraphics: result.setupGraphics ? [...result.setupGraphics] : undefined })) return;
      if (result.patch) onChange(result.patch);
    };

    return (
      <>
        <StaticSectionCard title={t.properties.contentSection} cmd={recallCommand(p) ?? "^GF"}>
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
              className={`${buttonCls} ${disabledCls}`}
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
              min={IMAGE_PROP_SPECS.threshold.min}
              max={IMAGE_PROP_SPECS.threshold.max}
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
                    value={storedAs.device ?? 'R'}
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
                      const next = sanitizeStorageName(e.target.value);
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
                  {formatStoragePath(recallStoragePath(p) ?? storedAs, true)}
                </span>
              </>
            ) : null}
            <DeliverySelect
              resource="graphic"
              subject={storedAs ? formatStoragePath(storedAs, true) : cached?.name ?? t.registry.image.source}
              value={delivery}
              onChange={deliver}
              blocked={{ job: blocked('job'), setup: blocked('setup'), printer: blocked('printer') }}
              disabled={locked}
              issue={issue}
              onOpenSetup={{ label: t.registry.image.openObjects, open: () => openObjects('storedGraphics') }}
            />
            {(refusal || (storedAs && setupState === 'tooLarge')) && (
              <span className="text-[10px] text-warning">{refusal === 'unshippable' ? t.printerSettings.objects.tooWide : t.printerSettings.objects.tooLarge}</span>
            )}
            {storedAs && (
              <button
                type="button"
                className={buttonCls}
                onClick={() => onChange({ storedAs: undefined })}
              >
                {t.registry.image.storeInline}
              </button>
            )}
          </div>
        </SectionCard>

      </>
    );
  },
};

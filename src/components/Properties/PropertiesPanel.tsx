import { useId, useState, type RefObject } from "react";
import { Cog6ToothIcon, InformationCircleIcon, FolderPlusIcon } from "@heroicons/react/16/solid";
import { useLabelStore, useCurrentObjects, currentPageLabel, selectEditorFrozen } from "../../store/labelStore";
import type { LabelCanvasHandle } from "../Canvas/LabelCanvas";
import type { AlignOp, DistributeAxis, AlignRef } from "../../lib/align";
import type { AlignSelectionRef } from "../../store/slices/uiSlice";
import { getEntry, BARCODE_1D_TYPES } from "@zplab/core/registry";
import { getPanel } from "../../registry/panels";
import { canGroupSelection, findObjectById, hasLockedAncestor, isGroup } from "@zplab/core/types/Group";
import { symbologyTargets } from "../../lib/symbologySwitch";
import { typeLabelFor } from "../../registry/palettePresets";
import { SymbologySelect } from "./SymbologySelect";
import { JUSTIFY_ICONS } from "./justifyIcons";
import { BWIP_APPROX_SEVERITY } from "@zplab/core/lib/bwipConstants";
import { stripZplCommandChars } from "@zplab/core/registry/zplHelpers";
import { dotsToMm, mmToDots } from "@zplab/core/lib/coordinates";
import {
  mmToUnit,
  unitToMm,
  unitLabel,
  unitStep,
  SNAP_DEFAULT_MM,
} from "@zplab/core/lib/units";
import type { Unit } from "@zplab/core/lib/units";
import { useT } from "../../hooks/useT";
import { SectionCard, StaticSectionCard } from "./SectionCard";
import { UnitNumberInput } from "./UnitNumberInput";
import { FieldLabel } from "./ZplCmd";
import { Tooltip } from "../ui/Tooltip";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Select } from "../ui/Select";
import { positionTypeOf, supportsPositionToggle } from "../../lib/positionConvert";
import { rescaleWouldChange } from "../../lib/densityRescale";
import { fontSelectGroups } from "./fontSelectGroups";
import { AlignToolbar } from "./AlignToolbar";
import { DensityRescaleModal } from "./DensityRescaleModal";
import { inputCls, labelCls } from "./styles";
import { fieldGridCols, fieldGridCell } from "../ui/formStyles";
import type { JmDensity, LabelConfig } from "@zplab/core/types/LabelConfig";
import { effectiveDpmm } from "@zplab/core/types/LabelConfig";
import type { LabelObjectBase } from "@zplab/core/types/LabelObject";

/** Tooltip-icon flagging that the canvas render is approximate for
 *  the given object type. Two severities collapse into one icon
 *  with a per-severity hint string. Returns null when the type's
 *  render is fully trusted (no entry in BWIP_APPROX_SEVERITY). */
function BwipApproxIcon({ type }: { type: string }) {
  const t = useT();
  const severity = BWIP_APPROX_SEVERITY.get(type);
  if (!severity) return null;
  const title =
    severity === "approx"
      ? t.properties.visualApproxHint
      : t.properties.visualApproxUnverifiedHint;
  return (
    <Tooltip content={title}>
      <InformationCircleIcon className="w-3.5 h-3.5 text-muted/60 cursor-help" />
    </Tooltip>
  );
}

/** POSITION section with align + distribute tools and the Align-To
 *  selector; same Figma/Sketch/Affinity convention used across leaf,
 *  group and multi-select panels. `unitSuffix` shows only when X/Y
 *  inputs sit below (leaf case). `useId` ties the section label to the
 *  toolbar group so screen readers announce a labelled button group. */
function PositionSectionHeader({
  unitSuffix,
  hideHeading,
  onAlign,
  onDistribute,
  onTidy,
  alignRef,
  onAlignRefChange,
  selectionCount,
}: {
  unitSuffix?: string;
  /** Hide the visible heading (kept for screen readers) when a card title
   *  already names the section, avoiding a duplicate label. */
  hideHeading?: boolean;
  onAlign: (op: AlignOp, ref: AlignRef) => void;
  onDistribute: (axis: DistributeAxis) => void;
  onTidy: () => void;
  alignRef: AlignSelectionRef;
  onAlignRefChange: (ref: AlignSelectionRef) => void;
  selectionCount: number;
}) {
  const t = useT();
  const labelId = useId();
  return (
    <div className="flex flex-col gap-2">
      <p id={labelId} className={hideHeading ? "sr-only" : labelCls}>
        {t.properties.positionSection}
        {unitSuffix ? ` (${unitSuffix})` : ""}
      </p>
      <AlignToolbar
        onAlign={onAlign}
        onDistribute={onDistribute}
        onTidy={onTidy}
        alignRef={alignRef}
        onAlignRefChange={onAlignRefChange}
        selectionCount={selectionCount}
        ariaLabelledBy={labelId}
      />
    </div>
  );
}

interface PropertiesPanelProps {
  /** Imperative handle on the canvas; required for actions that need
   *  live render bboxes (alignment). The inner null-check on `.current`
   *  covers the brief window before LabelCanvas mounts. */
  canvasRef: RefObject<LabelCanvasHandle | null>;
}

export function PropertiesPanel({ canvasRef }: PropertiesPanelProps) {
  const t = useT();
  const {
    selectedIds,
    updateObject,
    groupSelection,
    setLabelConfig,
    canvasSettings,
    setCanvasSettings,
    alignRef,
    setAlignRef,
    showZplCommands,
  } = useLabelStore();
  // X/Y are this page's dots; the config panel below edits the design instead.
  const label = useLabelStore(currentPageLabel);
  const designLabel = useLabelStore((s) => s.label);
  const objects = useCurrentObjects();
  const unit = canvasSettings.unit;
  // Walk the tree: when the layers panel drills into a nested child, the
  // selection holds a leaf id that's not at top level. A plain
  // top-level .find would miss it and the panel would silently fall
  // through to LabelConfigPanel.
  const firstId = selectedIds[0];
  const obj = firstId !== undefined ? findObjectById(objects, firstId) : undefined;
  const handleAlign = (op: AlignOp, ref: AlignRef) =>
    canvasRef.current?.alignSelection(op, ref);
  const handleDistribute = (axis: DistributeAxis) =>
    canvasRef.current?.distributeSelection(axis);
  const handleTidy = () => canvasRef.current?.tidySelection();

  if (selectedIds.length > 1) {
    const canGroup = canGroupSelection(objects, selectedIds);
    return (
      <div className="flex flex-col">
        <div className="px-3 py-2.5 border-b border-border flex items-center gap-2">
          <span className="font-mono text-xs text-accent">▣</span>
          <span className="text-xs font-medium text-text">
            {t.properties.multipleSelectedFmt.replace('{n}', String(selectedIds.length))}
          </span>
        </div>
        <div className="px-3 py-3 flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <PositionSectionHeader
              onAlign={handleAlign}
              onDistribute={handleDistribute}
              onTidy={handleTidy}
              alignRef={alignRef}
              onAlignRefChange={setAlignRef}
              selectionCount={selectedIds.length}
            />
            <p className="text-xs text-muted">
              {t.properties.x} / {t.properties.y}: {t.properties.multipleSelectedHint}
            </p>
          </div>
          {canGroup && (
            <button
              type="button"
              onClick={groupSelection}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono bg-surface-2 text-text hover:bg-surface border border-border transition-colors"
            >
              <FolderPlusIcon className="w-3.5 h-3.5" />
              {t.properties.groupSelection}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!obj) {
    return (
      <LabelConfigPanel
        label={designLabel}
        onUpdate={setLabelConfig}
        unit={unit}
        onUnitChange={(u) =>
          setCanvasSettings({ unit: u, snapSizeMm: SNAP_DEFAULT_MM[u] })
        }
      />
    );
  }

  const definition = getEntry(obj.type);
  const TypePanel = getPanel(obj.type)?.PropertiesPanel;
  const groupRow = isGroup(obj);
  // Groups intentionally have no registry entry; surface a folder-shape
  // glyph here so the header reads as something rather than blank.
  const icon = groupRow ? '⊞' : definition?.icon;
  // Power-user mode swaps the mnemonic chip for the type's ZPL command, matching
  // the palette icon slot. zplCmdFor resolves a props-dependent command (line
  // ^GB vs ^GD); groups have no command, so they keep the glyph.
  const headerBadge =
    showZplCommands && !groupRow
      ? definition?.zplCmdFor?.(obj as LabelObjectBase & { props: object }) ?? definition?.zplCmd ?? icon
      : icon;
  const typeLabel = groupRow ? t.types.group : typeLabelFor(obj.type, t);
  const switchTargets = groupRow ? [] : symbologyTargets(obj);
  // An ancestor lock blocks convertObjectType too, so the select must reflect it.
  const switchLocked = !!obj.locked || hasLockedAncestor(objects, obj.id);

  return (
    <div className="flex flex-col">
      {/* Type header: icon in an accent-tinted chip. */}
      <div className="px-3 py-2.5 border-b border-border flex items-center gap-2.5">
        <span className="flex items-center justify-center min-w-[22px] h-[22px] px-1 rounded-md bg-accent-dim text-accent font-mono text-xs font-semibold shrink-0">
          {headerBadge}
        </span>
        {switchTargets.length > 0 ? (
          <SymbologySelect obj={obj} targets={switchTargets} locked={switchLocked} />
        ) : (
          <span className="text-[13px] font-semibold text-text">
            {typeLabel}
          </span>
        )}
        <BwipApproxIcon type={obj.type} />
      </div>

      {/* Panel stays bg-surface (bg-bg would merge with the canvas); each
          SectionCard lifts off it via border + shadow. */}
      <div className="p-2 flex flex-col gap-2">
        {/* Name field: groups only (leaf rows fall back to their registry
            label in the layers panel). */}
        {groupRow && (
          <StaticSectionCard title={t.properties.name}>
            <input
              type="text"
              className={inputCls}
              aria-label={t.properties.name}
              value={obj.name ?? ''}
              placeholder={t.types.group}
              onChange={(e) =>
                updateObject(obj.id, { name: e.target.value || undefined })
              }
            />
          </StaticSectionCard>
        )}

        {/* Per-type panel first; each panel renders its own SectionCards
            (Content and/or Settings). Content editing (including variable
            binding) lives in the Variable-Builder modal opened from the
            panel, so the panel sees the raw obj and plain prop writes. */}
        {TypePanel && !groupRow && (
          // Key by id so switching objects remounts the panel and resets its
          // transient reveal state (e.g. the Typography "Advanced" toggle).
          <TypePanel
            key={obj.id}
            obj={obj}
            onChange={(props: object) => updateObject(obj.id, { props })}
          />
        )}

        {/* Position & alignment. Groups have no per-leaf x/y (children store
            world coordinates), so the inputs are hidden; align still applies
            and expands to the group's leaves at the canvas layer. The card
            title names the section, so the inner heading is sr-only. */}
        <SectionCard
          id="properties-position"
          title={
            groupRow
              ? t.properties.positionSection
              : `${t.properties.positionSection} (${unitLabel(unit)})`
          }
        >
          {!groupRow && (
            <div className={`grid grid-cols-2 ${fieldGridCols}`}>
              <div className={fieldGridCell}>
                <FieldLabel cmd={obj.positionType === "FT" ? "^FT" : "^FO"}>
                  {t.properties.x}
                </FieldLabel>
                <input
                  type="number"
                  className={inputCls}
                  value={mmToUnit(dotsToMm(obj.x, effectiveDpmm(label)), unit)}
                  step={unitStep(unit)}
                  onChange={(e) =>
                    updateObject(obj.id, {
                      x: mmToDots(
                        unitToMm(Number(e.target.value), unit),
                        effectiveDpmm(label),
                      ),
                    })
                  }
                />
              </div>
              <div className={fieldGridCell}>
                <FieldLabel cmd={obj.positionType === "FT" ? "^FT" : "^FO"}>
                  {t.properties.y}
                </FieldLabel>
                <input
                  type="number"
                  className={inputCls}
                  value={mmToUnit(dotsToMm(obj.y, effectiveDpmm(label)), unit)}
                  step={unitStep(unit)}
                  onChange={(e) =>
                    updateObject(obj.id, {
                      y: mmToDots(
                        unitToMm(Number(e.target.value), unit),
                        effectiveDpmm(label),
                      ),
                    })
                  }
                />
              </div>
            </div>
          )}
          {/* Anchor style (^FO top-left vs ^FT baseline): power-user emit-style
              choice, so it only appears with the ZPL-command preference. The
              flip keeps the visual position constant. Hidden objects are
              excluded: unmounted, so no measured footprint to convert against. */}
          {!groupRow && showZplCommands && supportsPositionToggle(obj.type) && obj.visible !== false && (
            <div className="flex items-center justify-between gap-2">
              <span className={labelCls}>{t.properties.anchorMode}</span>
              <SegmentedControl
                value={positionTypeOf(obj)}
                onChange={(target) => {
                  if (target) canvasRef.current?.convertObjectPositionType(obj.id, target);
                }}
                options={[
                  { value: "FO", label: "^FO", tooltip: t.properties.anchorTopLeftHint },
                  { value: "FT", label: "^FT", tooltip: t.properties.anchorBaselineHint },
                ]}
                aria-label={t.properties.anchorMode}
              />
            </div>
          )}
          {/* Origin semantics (which edge x pins), hence the position box. */}
          {!groupRow && BARCODE_1D_TYPES.has(obj.type) && (
            <div className="flex items-center justify-between gap-2">
              <Tooltip content={t.properties.valueAnchorHint}>
                <span className={labelCls}>{t.properties.valueAnchor}</span>
              </Tooltip>
              <SegmentedControl
                value={obj.fieldJustify ?? "L"}
                onChange={(v) => {
                  // L maps back to the implicit default; skip no-op clicks so
                  // they don't mint phantom undo steps / document diffs.
                  const fieldJustify = v === "L" ? undefined : v;
                  if (fieldJustify === obj.fieldJustify) return;
                  updateObject(obj.id, { fieldJustify });
                }}
                options={[
                  { value: "L", label: t.registry.text.justifyL, icon: JUSTIFY_ICONS.L, tooltip: t.registry.text.justifyL },
                  { value: "C", label: t.registry.text.justifyC, icon: JUSTIFY_ICONS.C, tooltip: t.registry.text.justifyC },
                  { value: "R", label: t.registry.text.justifyR, icon: JUSTIFY_ICONS.R, tooltip: t.registry.text.justifyR },
                ]}
                aria-label={t.properties.valueAnchor}
              />
            </div>
          )}
          <PositionSectionHeader
            hideHeading
            unitSuffix={!groupRow ? unitLabel(unit) : undefined}
            onAlign={handleAlign}
            onDistribute={handleDistribute}
            onTidy={handleTidy}
            alignRef={alignRef}
            onAlignRefChange={setAlignRef}
            selectionCount={selectedIds.length}
          />
        </SectionCard>

        {/* Options: comment (^FX, leaves only), lock, include-in-export.
            Collapsed by default since these are set rarely. */}
        <SectionCard
          id="properties-options"
          title={t.properties.optionsSection}
          defaultOpen={false}
        >
          {!groupRow && (
            <div className="flex flex-col gap-1">
              <FieldLabel cmd="^FX">{t.properties.comment}</FieldLabel>
              <textarea
                className={`${inputCls} resize-none`}
                rows={2}
                value={obj.comment ?? ""}
                onChange={(e) =>
                  updateObject(obj.id, { comment: stripZplCommandChars(e.target.value) || undefined })
                }
              />
            </div>
          )}

          {/* Lock mirrors the LayersPanel lock icon; meta-field bypass keeps
              the checkbox interactive even when the object is locked. */}
          <label className="flex items-center gap-2 text-xs text-text cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!obj.locked}
              onChange={(e) =>
                updateObject(obj.id, { locked: e.target.checked || undefined })
              }
            />
            <span>{t.properties.lock}</span>
            <Tooltip content={t.properties.lockHint}>
              <InformationCircleIcon className="w-3.5 h-3.5 text-muted/60 cursor-help shrink-0" />
            </Tooltip>
          </label>

          {/* includeInExport controls ZPL emission (vs the eye toggle's
              editor visibility); stored undefined when on. */}
          <label className="flex items-center gap-2 text-xs text-text cursor-pointer select-none">
            <input
              type="checkbox"
              checked={obj.includeInExport !== false}
              onChange={(e) =>
                updateObject(obj.id, { includeInExport: e.target.checked ? undefined : false })
              }
            />
            <span>{t.properties.includeInExport}</span>
            <Tooltip content={t.properties.includeInExportHint}>
              <InformationCircleIcon className="w-3.5 h-3.5 text-muted/60 cursor-help shrink-0" />
            </Tooltip>
          </label>
        </SectionCard>
      </div>
    </div>
  );
}

// ── Label presets ──────────────────────────────────────────────────────────────

interface Preset {
  label: string;
  widthMm: number;
  heightMm: number;
  dpmm: number;
}

const PRESETS: Preset[] = [
  {
    label: '4" × 6" (101 × 152 mm)',
    widthMm: 101.6,
    heightMm: 152.4,
    dpmm: 8,
  },
  {
    label: '4" × 4" (101 × 101 mm)',
    widthMm: 101.6,
    heightMm: 101.6,
    dpmm: 8,
  },
  { label: '4" × 3" (101 × 76 mm)', widthMm: 101.6, heightMm: 76.2, dpmm: 8 },
  { label: '4" × 2" (101 × 51 mm)', widthMm: 101.6, heightMm: 50.8, dpmm: 8 },
  { label: '3" × 2" (76 × 51 mm)', widthMm: 76.2, heightMm: 50.8, dpmm: 8 },
  { label: '2" × 1" (51 × 25 mm)', widthMm: 50.8, heightMm: 25.4, dpmm: 8 },
  { label: "100 × 150 mm", widthMm: 100, heightMm: 150, dpmm: 8 },
  { label: "100 × 100 mm", widthMm: 100, heightMm: 100, dpmm: 8 },
  { label: "100 × 50 mm", widthMm: 100, heightMm: 50, dpmm: 8 },
  { label: "62 × 29 mm  (Brother)", widthMm: 62, heightMm: 29, dpmm: 12 },
  { label: "57 × 32 mm  (Brother)", widthMm: 57, heightMm: 32, dpmm: 12 },
  { label: "DIN A7 (74 × 105 mm)", widthMm: 74, heightMm: 105, dpmm: 8 },
  { label: "DIN A6 (105 × 148 mm)", widthMm: 105, heightMm: 148, dpmm: 8 },
  { label: "DIN A5 (148 × 210 mm)", widthMm: 148, heightMm: 210, dpmm: 8 },
  { label: "DIN A4 (210 × 297 mm)", widthMm: 210, heightMm: 297, dpmm: 8 },
];

// ── LabelConfigPanel ───────────────────────────────────────────────────────────

interface LabelConfigPanelProps {
  label: LabelConfig;
  onUpdate: (config: Partial<LabelConfig>) => void;
  unit: Unit;
  onUnitChange: (unit: Unit) => void;
}

function LabelConfigPanel({
  label,
  onUpdate,
  unit,
  onUnitChange,
}: LabelConfigPanelProps) {
  const t = useT();
  const [pendingDpmm, setPendingDpmm] = useState<{ toDpmm: number; configPatch?: Partial<LabelConfig> } | null>(null);
  const [pendingJm, setPendingJm] = useState<{ to: JmDensity | undefined } | null>(null);
  // Skip a dead rescale prompt: open only when rescaleDesign would actually
  // change a field for the pending target. Read on demand rather than
  // subscribed, so an unrelated pages-identity change can't re-render the panel.
  const wouldRescale = (patch: Partial<LabelConfig>, includeCalibrationFields: boolean) => {
    const s = useLabelStore.getState();
    return rescaleWouldChange(s.pages, s.label, includeCalibrationFields, patch);
  };
  const locked = useLabelStore(selectEditorFrozen);
  const setPrinterSettingsTab = useLabelStore((s) => s.setPrinterSettingsTab);
  // The select edits the design-wide mode; surface a page's persisted ^JM
  // override so a diverging page is not an invisible no-op target.
  const pageJm = useLabelStore((s) => currentPageLabel(s).jmDensity);
  const matchedPreset = PRESETS.find(
    (p) =>
      p.widthMm === label.widthMm &&
      p.heightMm === label.heightMm &&
      p.dpmm === label.dpmm,
  );
  const presetValue = matchedPreset
    ? PRESETS.indexOf(matchedPreset).toString()
    : "custom";

  const handlePreset = (value: string) => {
    if (value === "custom") return;
    const p = PRESETS[Number(value)];
    if (!p) return;
    // A preset that changes dpmm reinterprets stored dots, same as the dpmm
    // selector, so route it through the rescale prompt; the new size rides along
    // as a configPatch (cancel then reverts size too, keep/scale stamp it).
    const configPatch = { widthMm: p.widthMm, heightMm: p.heightMm };
    if (p.dpmm !== label.dpmm && wouldRescale({ dpmm: p.dpmm }, false)) {
      setPendingDpmm({ toDpmm: p.dpmm, configPatch });
    } else {
      onUpdate({ ...configPatch, dpmm: p.dpmm });
    }
  };

  // ^CF / ^A suggestions: the shared resolver returns the same union
  // (built-ins + every ^CW alias + every built-in preview binding) the
  // per-text font dropdown uses, so the global default selector and
  // the per-field selector show identical labels. A preview TTF wins
  // over the printer path in the suffix because it is what the canvas
  // is actually rendering with.
  const fontGroups = fontSelectGroups(label, t, t.label.defaultFontIdNone);

  return (
    <div className="flex flex-col">
      <div className="px-3 py-2.5 border-b border-border">
        <span className="text-xs font-medium text-text">{t.label.heading}</span>
      </div>

      <div className="p-2 flex flex-col gap-2">
        <StaticSectionCard
          title={t.label.formatSection}
          headerAction={
            <Tooltip content={t.printerSettings.title}>
              <button
                type="button"
                onClick={() => setPrinterSettingsTab("output")}
                aria-label={t.printerSettings.title}
                className="text-muted hover:text-text transition-colors"
              >
                <Cog6ToothIcon className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          }
        >
        <div className="flex flex-col gap-1">
          <label className={labelCls}>{t.label.preset}</label>
          <Select<string>
            value={presetValue}
            disabled={locked}
            onChange={handlePreset}
            groups={[
              {
                options: [
                  { value: "custom", label: t.label.presetCustom },
                  ...PRESETS.map((p, i) => ({ value: String(i), label: p.label })),
                ],
              },
            ]}
          />
        </div>

        <div className="flex items-center justify-between">
          <span className={labelCls}>
            {t.label.width} / {t.label.height}
          </span>
          <div className="flex rounded overflow-hidden border border-border text-[10px] font-mono">
            {(["mm", "cm", "in"] as const).map((u) => (
              <button
                key={u}
                onClick={() => onUnitChange(u)}
                className={`px-1.5 py-0.5 transition-colors ${u === unit ? "bg-accent text-bg" : "text-muted hover:text-text"}`}
              >
                {u}
              </button>
            ))}
          </div>
        </div>

        {/* ^PW/^LL are physical head dots (never ^JM-scaled); bridge via raw dpmm.
            No allowUnset: a transient clear keeps the last valid value, not 0. */}
        <div className={`grid grid-cols-2 ${fieldGridCols}`}>
          <UnitNumberInput
            label={t.label.width}
            valueDots={mmToDots(label.widthMm, label.dpmm)}
            minDots={mmToDots(1, label.dpmm)}
            onChangeDots={(dots) => {
              if (dots !== undefined) onUpdate({ widthMm: dotsToMm(dots, label.dpmm) });
            }}
            scope="physical"
            zplCmd="^PW"
            className={fieldGridCell}
          />
          <UnitNumberInput
            label={t.label.height}
            valueDots={mmToDots(label.heightMm, label.dpmm)}
            minDots={mmToDots(1, label.dpmm)}
            onChangeDots={(dots) => {
              if (dots !== undefined) onUpdate({ heightMm: dotsToMm(dots, label.dpmm) });
            }}
            scope="physical"
            zplCmd="^LL"
            className={fieldGridCell}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className={labelCls}>{t.label.dpmm}</label>
          <Select<number>
            value={label.dpmm}
            // Every commit path is a no-op under the preview lock, so the
            // control has to read as unavailable instead of silently dropping.
            disabled={locked}
            onChange={(value) => {
              if (value !== label.dpmm && wouldRescale({ dpmm: value }, false)) setPendingDpmm({ toDpmm: value });
              else onUpdate({ dpmm: value });
            }}
            groups={[
              {
                options: [
                  { value: 6, label: t.label.dpmm6 },
                  { value: 8, label: t.label.dpmm8 },
                  { value: 12, label: t.label.dpmm12 },
                  { value: 24, label: t.label.dpmm24 },
                ],
              },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel cmd="^JM">{t.label.jmDensity}</FieldLabel>
          <Select<string>
            value={label.jmDensity ?? ''}
            disabled={locked}
            onChange={(v) => {
              const next = v === '' ? undefined : (v as JmDensity);
              if (wouldRescale({ jmDensity: next }, true)) setPendingJm({ to: next });
              else onUpdate({ jmDensity: next });
            }}
            groups={[
              {
                options: [
                  { value: '', label: t.label.jmDensityDefault },
                  { value: 'A', label: t.label.jmDensityA },
                  { value: 'B', label: t.label.jmDensityB },
                ],
              },
            ]}
          />
          {pageJm !== label.jmDensity && (
            <p className="text-[10px] text-muted leading-snug">
              {t.label.jmPageOverrideHintFmt.split('{mode}').join(pageJm ?? 'A')}
            </p>
          )}
        </div>
        {pendingDpmm !== null && (
          <DensityRescaleModal
            pending={{ kind: 'dpmm', toDpmm: pendingDpmm.toDpmm, configPatch: pendingDpmm.configPatch }}
            onClose={() => setPendingDpmm(null)}
          />
        )}
        {pendingJm !== null && (
          <DensityRescaleModal pending={{ kind: 'jm', toJm: pendingJm.to }} onClose={() => setPendingJm(null)} />
        )}

        <div className="flex flex-col gap-1">
          <label className={labelCls}>
            {t.label.safeArea}
            <Tooltip content={t.label.safeAreaHint}>
              <InformationCircleIcon className="w-3.5 h-3.5 ml-1 inline-block align-text-bottom text-muted cursor-help" />
            </Tooltip>
          </label>
          <input
            type="number"
            className={inputCls}
            value={
              label.safeAreaMm === undefined ? "" : mmToUnit(label.safeAreaMm, unit)
            }
            min={0}
            step={unitStep(unit)}
            onChange={(e) => {
              const raw = e.target.value.trim();
              const mm = raw === "" ? undefined : unitToMm(Number(raw), unit);
              onUpdate({ safeAreaMm: mm !== undefined && mm > 0 ? mm : undefined });
            }}
          />
        </div>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 accent-accent"
            checked={label.emit1dZJustify ?? false}
            onChange={(e) => onUpdate({ emit1dZJustify: e.target.checked || undefined })}
          />
          <span className={labelCls}>
            {t.label.emitZJustify}
            <Tooltip content={t.label.emitZJustifyHint}>
              <InformationCircleIcon className="w-3.5 h-3.5 ml-1 inline-block align-text-bottom text-muted cursor-help" />
            </Tooltip>
          </span>
        </label>
        </StaticSectionCard>

        <SectionCard
          id="label-fonts"
          title={t.label.defaultFont}
          defaultOpen={false}
        >
        <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <FieldLabel cmd="^CF">{t.label.defaultFontId}</FieldLabel>
          <Select
            aria-label={t.label.defaultFontId}
            value={label.defaultFontId ?? ""}
            groups={fontGroups}
            onChange={(v) => onUpdate({ defaultFontId: v || undefined })}
          />
        </div>
        <div className={`grid grid-cols-2 ${fieldGridCols}`}>
          <UnitNumberInput
            label={t.label.defaultFontHeight}
            valueDots={label.defaultFontHeight}
            minDots={1}
            allowUnset
            onChangeDots={(defaultFontHeight) => onUpdate({ defaultFontHeight })}
            scope="design"
            zplCmd="^CF"
            className={fieldGridCell}
          />
          <UnitNumberInput
            label={t.label.defaultFontWidth}
            valueDots={label.defaultFontWidth}
            minDots={0}
            allowUnset
            onChangeDots={(defaultFontWidth) => onUpdate({ defaultFontWidth })}
            scope="design"
            zplCmd="^CF"
            className={fieldGridCell}
          />
        </div>
        </div>
        </SectionCard>
      </div>
    </div>
  );
}


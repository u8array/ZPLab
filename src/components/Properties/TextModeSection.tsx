import { MinusIcon, Bars3BottomLeftIcon, WindowIcon } from "@heroicons/react/16/solid";
import { useT } from "../../hooks/useT";
import { UnitNumberInput } from "./UnitNumberInput";
import { BlockTextSettings } from "./BlockTextSettings";
import { BlockDragModeToggle } from "./BlockDragModeToggle";
import { SectionCard } from "./SectionCard";
import { ZplCmd } from "./ZplCmd";
import { Tooltip } from "../ui/Tooltip";
import { fieldGridCols, fieldGridCell } from "../ui/formStyles";
import { FB_DEFAULTS } from "@zplab/core/lib/textBlock";
import { resolveTextMode, type TextMode, type TextProps } from "@zplab/core/registry/text";
import { resolveDeviceFontId } from "@zplab/core/lib/customFonts";
import { blockLinesForHeightDots, blockStackHeightDots } from "@zplab/core/lib/zebraTextLayout";
import { useLabelStore } from "../../store/labelStore";

type IconType = typeof MinusIcon;

/** Icon passed as a prop (not a render-created component) to satisfy the
 *  static-components lint rule. */
function ModeIcon({ icon: Icon }: { icon: IconType }) {
  return <Icon className="w-4 h-4 shrink-0" />;
}

/** Three-way text layout selector (plain / ^FB field block / ^TB text block)
 *  plus the active mode's settings. Switching preserves the shared block width
 *  and converts between the ^FB max-lines and the ^TB clip height so the block
 *  keeps its size. */
export function TextModeSection({
  props: p,
  onChange,
}: {
  props: TextProps;
  onChange: (patch: Partial<TextProps>) => void;
}) {
  const t = useT();
  const label = useLabelStore((s) => s.label);
  const mode = resolveTextMode(p);
  const deviceFontId = resolveDeviceFontId(p.fontId, p.printerFontName, label);

  const setMode = (next: TextMode) => {
    if (next === mode) return;
    if (next === "normal") {
      onChange({
        textMode: undefined,
        blockWidth: undefined,
        blockLines: undefined,
        blockLineSpacing: undefined,
        blockJustify: undefined,
        blockHangingIndent: undefined,
        blockHeight: undefined,
      });
    } else if (next === "fb") {
      const spacing = p.blockLineSpacing ?? FB_DEFAULTS.blockLineSpacing;
      // Same pitch the runtime stacks with, so switching preserves the size.
      const lines = p.blockHeight
        ? blockLinesForHeightDots(p.blockHeight, p.fontHeight, spacing, deviceFontId)
        : p.blockLines ?? 3;
      onChange({
        textMode: undefined,
        blockWidth: p.blockWidth ?? FB_DEFAULTS.blockWidth,
        blockLines: lines,
        blockLineSpacing: p.blockLineSpacing ?? FB_DEFAULTS.blockLineSpacing,
        blockJustify: p.blockJustify ?? FB_DEFAULTS.blockJustify,
        blockHangingIndent: p.blockHangingIndent,
        blockHeight: undefined,
      });
    } else {
      const height =
        p.blockHeight ??
        blockStackHeightDots(
          p.blockLines ?? 3,
          p.fontHeight,
          p.blockLineSpacing ?? FB_DEFAULTS.blockLineSpacing,
          deviceFontId,
        );
      onChange({
        textMode: "tb",
        blockWidth: p.blockWidth ?? FB_DEFAULTS.blockWidth,
        blockHeight: height,
        blockLines: undefined,
        blockLineSpacing: undefined,
        blockJustify: undefined,
        blockHangingIndent: undefined,
      });
    }
  };

  const modes: { key: TextMode; label: string; hint: string; cmd: string; icon: IconType }[] = [
    { key: "normal", label: t.registry.text.modeNormal, hint: t.registry.text.modeNormalHint, cmd: "^A", icon: MinusIcon },
    { key: "fb", label: t.registry.text.modeFieldBlock, hint: t.registry.text.modeFieldBlockHint, cmd: "^FB", icon: Bars3BottomLeftIcon },
    { key: "tb", label: t.registry.text.modeTextBlock, hint: t.registry.text.modeTextBlockHint, cmd: "^TB", icon: WindowIcon },
  ];

  return (
    <SectionCard id="text-mode" title={t.registry.text.textMode}>
      <div className="grid grid-cols-3 gap-1">
        {modes.map((m) => (
          <Tooltip key={m.key} content={m.hint} className="w-full">
            <button
              type="button"
              aria-pressed={mode === m.key}
              className={`w-full flex flex-col items-center gap-0.5 rounded border px-1 py-1.5 text-[11px] transition-colors ${
                mode === m.key
                  ? "border-accent ring-1 ring-accent text-text"
                  : "border-border text-muted hover:text-text"
              }`}
              onClick={() => setMode(m.key)}
            >
              <ModeIcon icon={m.icon} />
              <span>{m.label}</span>
              <ZplCmd cmd={m.cmd} />
            </button>
          </Tooltip>
        ))}
      </div>

      {mode === "fb" && <BlockTextSettings props={p} onChange={onChange} />}

      {mode === "tb" && (
        <div className="flex flex-col gap-3">
          <BlockDragModeToggle />
          <div className={`grid grid-cols-2 ${fieldGridCols}`}>
            <UnitNumberInput
              label={t.registry.text.blockWidth}
              scope="page"
              valueDots={p.blockWidth ?? 0}
              minDots={1}
              onChangeDots={(blockWidth) => onChange({ blockWidth })}
              zplCmd="^TB"
              className={fieldGridCell}
            />
            <UnitNumberInput
              label={t.registry.text.blockHeight}
              scope="page"
              valueDots={p.blockHeight ?? 0}
              minDots={1}
              onChangeDots={(blockHeight) => onChange({ blockHeight })}
              zplCmd="^TB"
              className={fieldGridCell}
            />
          </div>
          <p className="text-[10px] text-muted">{t.registry.text.textBlockFirmwareHint}</p>
        </div>
      )}
    </SectionCard>
  );
}

import { useT } from "../../hooks/useT";
import { labelCls } from "./styles";
import { fieldGridCols, fieldGridCell } from "../ui/formStyles";
import { NumberInput } from "./NumberInput";
import { UnitNumberInput } from "./UnitNumberInput";
import { JustifyButtons } from "./JustifyButtons";
import { BlockDragModeToggle } from "./BlockDragModeToggle";
import type { TextProps } from "@zplab/core/registry/text";
import {
  isBlockTooNarrow,
  zebraGlyphAdvanceDots,
  zebraLineWidthDots,
  wrapBlockLines,
} from "@zplab/core/lib/zebraTextLayout";

interface Props {
  props: TextProps;
  onChange: (patch: Partial<TextProps>) => void;
}

/** Block-text (`^FB`) sub-panel: width / max-lines / justify /
 *  line-spacing plus inline validation hints. Hints are purely
 *  informational; never auto-correct user-set blockLines, since
 *  content can legitimately have fewer lines than max (CSV-bound
 *  rows vary) or more (intentional truncation). The editor surfaces
 *  the mismatch but leaves the choice to the user. */
export function BlockTextSettings({ props: p, onChange }: Props) {
  const t = useT();
  // Count wrapped lines, not just hard breaks, so soft-wrap overflow (a long
  // line spilling past blockLines) also trips the warning. Uses the printer
  // estimate (same basis as the blockLines cap); the canvas wrap may differ by
  // a line on scaled fonts, but this is an informational hint.
  const contentLines = wrapBlockLines(
    p.content,
    p.blockWidth ?? 0,
    (line) => zebraLineWidthDots(line, p.fontHeight, p.fontWidth),
  ).length;
  const maxLines = p.blockLines ?? 1;
  const truncates = contentLines > maxLines;
  const advance = Math.ceil(zebraGlyphAdvanceDots(p.fontHeight, p.fontWidth));
  const tooNarrow = isBlockTooNarrow(p.blockWidth ?? 0, p.fontHeight, p.fontWidth);
  return (
    <div className="flex flex-col gap-3">
      <BlockDragModeToggle />
      <div className="flex items-center justify-between gap-2">
        <label className={labelCls}>{t.registry.text.blockJustify}</label>
        <JustifyButtons
          value={p.blockJustify ?? "L"}
          onChange={(blockJustify) => onChange({ blockJustify })}
        />
      </div>
      <div className={`grid grid-cols-2 ${fieldGridCols}`}>
        <UnitNumberInput
          label={t.registry.text.blockWidth}
          scope="page"
          valueDots={p.blockWidth}
          minDots={1}
          allowUnset
          onChangeDots={(blockWidth) => onChange({ blockWidth })}
          className={fieldGridCell}
        />
        <NumberInput
          label={t.registry.text.blockLines}
          value={p.blockLines ?? 1}
          min={1}
          onChange={(blockLines) => onChange({ blockLines })}
          className={fieldGridCell}
        />
      </div>
      <div className={`grid grid-cols-2 ${fieldGridCols}`}>
        <UnitNumberInput
          label={t.registry.text.blockLineSpacing}
          scope="page"
          valueDots={p.blockLineSpacing}
          allowUnset
          onChangeDots={(blockLineSpacing) => onChange({ blockLineSpacing })}
          className={fieldGridCell}
        />
        <UnitNumberInput
          label={t.registry.text.blockHangingIndent}
          scope="page"
          valueDots={p.blockHangingIndent}
          minDots={0}
          allowUnset
          onChangeDots={(blockHangingIndent) => onChange({ blockHangingIndent })}
          className={fieldGridCell}
        />
      </div>
      {tooNarrow && (
        <p className="font-mono text-[10px] text-warning">
          {t.registry.text.blockTooNarrowFmt
            .replaceAll("{w}", String(p.blockWidth))
            .replaceAll("{advance}", String(advance))}
        </p>
      )}
      {truncates && (
        <p className="font-mono text-[10px] text-warning">
          {t.registry.text.blockLinesExceededFmt
            .replaceAll("{n}", String(contentLines))
            .replaceAll("{max}", String(maxLines))}
        </p>
      )}
      {!truncates && contentLines < maxLines && (
        <p className="font-mono text-[10px] text-muted">
          {t.registry.text.blockLinesUsageFmt
            .replaceAll("{n}", String(contentLines))
            .replaceAll("{max}", String(maxLines))}
        </p>
      )}
    </div>
  );
}

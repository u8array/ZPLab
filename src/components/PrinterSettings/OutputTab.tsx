import { InformationCircleIcon } from "@heroicons/react/24/outline";
import { useT } from "../../hooks/useT";
import { useLabelStore } from "../../store/labelStore";
import { UnitNumberInput } from "../Properties/UnitNumberInput";
import { Tooltip } from "../ui/Tooltip";
import { labelCls, fieldGridCols, fieldGridCell } from "../ui/formStyles";
import { RegionFocus } from "./printerIllustration";
import { ZplBoundedIntInput, ZplCheckbox } from "./zplFieldPrimitives";

/** Print-time output settings (offsets, shift, quantities). These are
 *  per-label ZPL (^LH/^LT/^LS/^PQ) and stay in labelConfig; they live here
 *  rather than in the label panel because they position the print on the
 *  DEVICE, which the printer illustration visualizes per focused field. */
export function OutputTab() {
  const t = useT();
  const label = useLabelStore((s) => s.label);
  const setLabelConfig = useLabelStore((s) => s.setLabelConfig);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className={labelCls}>
          {t.label.offsetsHeading}
          <Tooltip content={t.label.offsetsHint}>
            <InformationCircleIcon className="w-3.5 h-3.5 ml-1 inline-block align-text-bottom text-muted cursor-help" />
          </Tooltip>
        </span>
        <div className={`grid grid-cols-3 ${fieldGridCols}`}>
          <RegionFocus region="originX" className={fieldGridCell}>
            <UnitNumberInput
              label={t.label.labelHomeX}
              valueDots={label.labelHomeX}
              minDots={0}
              allowUnset
              onChangeDots={(labelHomeX) => setLabelConfig({ labelHomeX })}
              scope="design"
              zplCmd="^LH"
              className="contents"
            />
          </RegionFocus>
          <RegionFocus region="originY" className={fieldGridCell}>
            <UnitNumberInput
              label={t.label.labelHomeY}
              valueDots={label.labelHomeY}
              minDots={0}
              allowUnset
              onChangeDots={(labelHomeY) => setLabelConfig({ labelHomeY })}
              scope="design"
              zplCmd="^LH"
              className="contents"
            />
          </RegionFocus>
          <RegionFocus region="top" className={fieldGridCell}>
            <UnitNumberInput
              label={t.label.labelTop}
              valueDots={label.labelTop}
              minDots={-120}
              maxDots={120}
              allowUnset
              onChangeDots={(labelTop) => setLabelConfig({ labelTop })}
              scope="design"
              zplCmd="^LT"
              className="contents"
            />
          </RegionFocus>
        </div>
      </div>

      <RegionFocus region="shift">
        <UnitNumberInput
          label={t.label.labelShift}
          valueDots={label.labelShift}
          // ^LS shifts content left; the canvas viewport frames a non-negative
          // shift. Negatives round-trip from import but aren't authored here
          // (spec: "if print position is less than 0, set ^LS to 0").
          minDots={0}
          allowUnset
          onChangeDots={(labelShift) => setLabelConfig({ labelShift })}
          scope="design"
          zplCmd="^LS"
        />
      </RegionFocus>

      <RegionFocus region="stack" className="flex flex-col gap-4">
        <ZplBoundedIntInput
          label={t.label.printQuantity}
          command="^PQ"
          min={1}
          max={99999999}
          value={label.printQuantity ?? 1}
          onChange={(v) =>
            setLabelConfig({ printQuantity: v !== undefined && v > 1 ? v : undefined })
          }
        />
        <ZplBoundedIntInput
          label={t.label.pauseCount}
          command="^PQ"
          min={0}
          max={99999999}
          value={label.pauseCount}
          onChange={(pauseCount) => setLabelConfig({ pauseCount })}
        />
        <ZplCheckbox
          text={t.label.programmablePause}
          command="^PP"
          checked={label.programmablePause === true}
          onChange={(v) => setLabelConfig({ programmablePause: v || undefined })}
        />
        <ZplBoundedIntInput
          label={t.label.replicates}
          command="^PQ"
          min={0}
          max={99999999}
          value={label.replicates}
          onChange={(replicates) => setLabelConfig({ replicates })}
        />
        <ZplCheckbox
          text={t.label.overridePauseCount}
          command="^PQ"
          checked={label.overridePauseCount === "Y"}
          onChange={(checked) =>
            setLabelConfig({ overridePauseCount: checked ? "Y" : undefined })
          }
          hint={t.label.overridePauseCountHint}
        />
      </RegionFocus>
    </div>
  );
}

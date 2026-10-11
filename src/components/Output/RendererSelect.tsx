import { useId } from "react";
import { useT } from "../../hooks/useT";
import { formatTemplate } from "../../lib/formatTemplate";
import { previewProviderChoices, previewProviderLabel } from "../../lib/previewProviderLabel";
import { selectEffectivePreviewProvider, useLabelStore } from "../../store/labelStore";
import type { PreviewProvider } from "../../store/slices/uiSlice";
import { sectionHeadingCls } from "../ui/formStyles";
import { Select } from "../ui/Select";

/** The renderer choice beside the action that uses its image, writing the same setting as the settings tab. */
export function RendererSelect() {
  const t = useT();
  const id = useId();
  const chosen = useLabelStore((s) => s.previewProvider);
  const effective = useLabelStore(selectEffectivePreviewProvider);
  const labelaryAvailable = useLabelStore((s) => s.thirdParty.labelary);
  const setProvider = useLabelStore((s) => s.setPreviewProvider);
  const choices = previewProviderChoices(t, { thirdParty: { labelary: labelaryAvailable } });
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={sectionHeadingCls}>
        {t.zebraPrint.rendererHeading}
      </label>
      <Select<PreviewProvider>
        id={id}
        value={chosen}
        onChange={setProvider}
        groups={[{ options: choices.map((c) => ({ value: c.provider, label: c.label, disabled: c.disabled, tooltip: c.reason })) }]}
      />
      {effective !== chosen && (
        <span className="text-[10px] text-muted">
          {formatTemplate(t.printerSettings.preview.providerInUseFmt, { provider: previewProviderLabel(t, effective) })}
        </span>
      )}
    </div>
  );
}

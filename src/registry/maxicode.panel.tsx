import type { ObjectTypeUi } from "./panelTypes";
import { useT } from "../hooks/useT";
import { useLabelStore } from "../store/labelStore";
import { validateMaxicodeBwip } from "../components/Canvas/bwipHelpers";
import { SectionCard, StaticSectionCard } from "../components/Properties/SectionCard";
import { ContentEditorButton } from "../components/Properties/ContentEditorButton";
import { FieldLabel } from "../components/Properties/ZplCmd";
import { Select } from "../components/ui/Select";
import { fieldMode, boundDefaultOrContent, asLabelObject } from "@zplab/core/lib/variableField";
import { type MaxicodeProps, ALL_MODES } from "@zplab/core/registry/maxicode";

export const maxicodePanel: ObjectTypeUi<MaxicodeProps> = {
  PropertiesPanel: ({ obj, onChange }) => {
    const t = useT();
    const p = obj.props;
    const loc = t.registry.maxicode;
    const variables = useLabelStore((s) => s.variables);
    // Resolve the diagnostic line beneath the mode dropdown. Hard
    // errors (bwip-js encoder rejections, mostly SCM-format issues
    // in mode 2/3) win over the soft mode-6 advisory. A template field's
    // content is markers (no fixed value), so skip it; single-bind validates
    // the variable's current default (the printed value).
    const lo = asLabelObject(obj);
    const error = fieldMode(lo, variables) === "template"
      ? null
      : validateMaxicodeBwip(boundDefaultOrContent(lo, variables), p.mode);
    const advisory = p.mode === 6 ? loc.mode6Advisory : null;
    const diagnostic = error
      ? { text: error, className: "text-error font-mono" }
      : advisory
        ? { text: advisory, className: "text-muted" }
        : null;
    return (
      <>
        <StaticSectionCard title={t.properties.contentSection} cmd="^FD">
          <ContentEditorButton obj={obj} />
        </StaticSectionCard>

        <SectionCard id={`${obj.type}-settings`} title={t.properties.settingsSection}>
          <div className="flex flex-col gap-1">
            <FieldLabel cmd="^BD">{loc.mode}</FieldLabel>
            <Select<MaxicodeProps["mode"]>
              value={p.mode}
              onChange={(mode) => onChange({ mode })}
              aria-label={loc.mode}
              groups={[{ options: ALL_MODES.map((m) => ({ value: m, label: String(m) })) }]}
            />
            {diagnostic && (
              <p className={`text-[10px] leading-snug ${diagnostic.className}`}>
                {diagnostic.text}
              </p>
            )}
          </div>

        </SectionCard>
      </>
    );
  },
};

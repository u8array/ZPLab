import { useEffect, useRef } from "react";
import { useT } from "../../hooks/useT";
import { useLabelStore } from "../../store/labelStore";
import { usePreviewBinding } from "../../store/usePreviewBinding";
import { CheckboxRow } from "./CheckboxRow";
import { NumberInput } from "./NumberInput";
import { SegmentedControl } from "../ui/SegmentedControl";
import { inputCls, labelCls } from "../ui/formStyles";
import { getEntry, objectResolvesCtrl, specForObject } from "@zplab/core/registry";
import {
  serialDisablePatch,
  serialEnablePatch,
  serialSeed,
  type SerialMode,
} from "@zplab/core/registry/serialField";
import type { LabelObjectBase } from "@zplab/core/types/LabelObject";

type SerialLeaf = LabelObjectBase & {
  props: { content?: string; serial?: SerialMode; gs1?: boolean; preSerialContent?: string };
};

interface Props {
  obj: SerialLeaf;
  onChange: (patch: { serial?: SerialMode; content?: string; preSerialContent?: string }) => void;
}

/** Settings-section serial toggle, the gs1-mode analogue: on derives the seed
 *  from the field's resolved content (emitter parity), off restores the
 *  snapshotted template. */
export function SerialModeCheckbox({ obj, onChange }: Props) {
  const t = useT();
  const { resolveDefaults } = usePreviewBinding();
  const entry = getEntry(obj.type);
  // gs1 hides the toggle only while serial is OFF; legacy designs may still
  // carry both flags, so serial-on must keep its way out.
  if (!entry?.serialisable || (obj.props.gs1 && !obj.props.serial)) return null;
  const spec = specForObject(obj);
  return (
    <CheckboxRow
      checked={!!obj.props.serial}
      onChange={(c) =>
        onChange(
          c
            ? serialEnablePatch(
                obj.props.content ?? "",
                resolveDefaults(obj.props.content ?? "", { resolveCtrl: objectResolvesCtrl(obj) }),
                spec,
              )
            : serialDisablePatch(obj.props),
        )
      }
      label={t.registry.serial.serialMode}
      cmd={obj.props.serial?.zplMode === "SF" ? "^SF" : "^SN"}
    />
  );
}

/** Replaces the free content editor while serial is on: a firmware counter's
 *  seed is charset-locked, so free typing would drift from the print. */
export function SerialParts({ obj, onChange }: Props) {
  const t = useT();
  const seedRef = useRef<HTMLInputElement>(null);
  const editorFocusRequest = useLabelStore((s) => s.editorFocusRequest);
  // External focus request (canvas dblclick): the seed input is this field's
  // content editor, so it takes the gesture TemplateContentInput otherwise gets.
  useEffect(() => {
    if (editorFocusRequest?.id !== obj.id) return;
    const seed = seedRef.current;
    if (!seed || document.activeElement === seed) return;
    seed.focus();
    seed.select();
  }, [editorFocusRequest, obj.id]);
  const serial = obj.props.serial;
  if (!serial) return null;
  const spec = specForObject(obj);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span className={labelCls}>{t.registry.serial.content}</span>
        <input
          ref={seedRef}
          className={inputCls}
          aria-label={t.registry.serial.content}
          value={obj.props.content ?? ""}
          onChange={(e) => onChange({ content: serialSeed(e.target.value, spec) })}
        />
      </div>
      <NumberInput
        label={t.registry.serial.increment}
        value={serial.increment}
        min={1}
        // ^SN/^SF take an integer increment; NumberInput's clamp lets 1.5 through.
        onChange={(increment) => onChange({ serial: { ...serial, increment: Math.trunc(increment) } })}
        zplCmd={`^${serial.zplMode}`}
      />
      <div className="flex flex-col gap-1">
        <span className={labelCls}>{t.registry.serial.zplMode}</span>
        <SegmentedControl
          value={serial.zplMode}
          onChange={(zplMode) => zplMode && onChange({ serial: { ...serial, zplMode } })}
          options={[
            { value: "SN", label: t.registry.serial.zplModeSN },
            { value: "SF", label: t.registry.serial.zplModeSF },
          ]}
          aria-label={t.registry.serial.zplMode}
        />
      </div>
    </div>
  );
}

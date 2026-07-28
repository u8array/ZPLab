import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { labelCls, inputCls, zplCommandTagCls } from "../ui/formStyles";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Select } from "../ui/Select";
import { clampBoundedInt, readBoundedInt } from "@zplab/core/lib/inputParse";
import { stripUnsafeChars } from "@zplab/core/types/PrinterProfile";

const commandTagCls = zplCommandTagCls;
const hintCls = "font-mono text-[10px] text-muted/70 normal-case tracking-normal";

export function ZplFieldHint({ children }: { children: ReactNode }) {
  return <span className={hintCls}>{children}</span>;
}

export function ZplCommandLabel({
  text,
  command,
  htmlFor,
}: {
  text: string;
  command: string;
  htmlFor?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <label htmlFor={htmlFor} className={labelCls}>
        {text}
      </label>
      <span className={commandTagCls}>{command}</span>
    </div>
  );
}

/** Tag sits outside `<label>` so clicking it doesn't toggle. */
export function ZplCheckbox({
  text,
  command,
  checked,
  onChange,
  hint,
}: {
  text: string;
  command: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  hint?: ReactNode;
}) {
  const row = (
    <div className="flex items-center justify-between gap-2">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="accent-accent"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="text-xs text-text">{text}</span>
      </label>
      <span className={commandTagCls}>{command}</span>
    </div>
  );
  if (!hint) return row;
  return (
    <ZplField>
      {row}
      <ZplFieldHint>{hint}</ZplFieldHint>
    </ZplField>
  );
}

export function ZplField({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-1">{children}</div>;
}

/** Per-slot label for shared-tag grids (^PR, ^MF); pipes useId to child. */
export function ZplSubField({
  label,
  children,
  className,
}: {
  label: string;
  children: (id: string) => ReactNode;
  /** Replaces the cell layout entirely (not merged), e.g. `fieldGridCell`. */
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className ?? "flex flex-col gap-1"}>
      <label htmlFor={id} className={labelCls}>
        {label}
      </label>
      {children(id)}
    </div>
  );
}

/** Local draft prevents sanitiser-rejected revert (frozen-field UX);
 *  IME composition defers sanitise until compositionend. */
export function SafeStringInput({
  id,
  value,
  onChange,
  sanitize = stripUnsafeChars,
  className,
  ...rest
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  sanitize?: (raw: string) => string;
} & Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "id" | "value" | "onChange" | "onInput" | "defaultValue" | "type"
  >) {
  const [draft, setDraft] = useState(value);
  const [lastExternal, setLastExternal] = useState(value);
  const [composing, setComposing] = useState(false);
  if (lastExternal !== value) {
    setLastExternal(value);
    setDraft(value);
  }
  return (
    <input
      {...rest}
      id={id}
      type="text"
      className={className ? `${inputCls} ${className}` : inputCls}
      value={draft}
      onCompositionStart={(e) => {
        setComposing(true);
        rest.onCompositionStart?.(e);
      }}
      onCompositionEnd={(e) => {
        setComposing(false);
        const next = sanitize(e.currentTarget.value);
        setDraft(next);
        onChange(next);
        rest.onCompositionEnd?.(e);
      }}
      onBlur={(e) => {
        setComposing(false);
        rest.onBlur?.(e);
      }}
      onChange={(e) => {
        if (composing) {
          setDraft(e.target.value);
          return;
        }
        const next = sanitize(e.target.value);
        setDraft(next);
        onChange(next);
      }}
    />
  );
}

/** Required+empty blur snaps back to last committed; optional clears. */
export function BoundedIntControl({
  id,
  min,
  max,
  value,
  onChange,
  disabled,
  required,
}: {
  id?: string;
  min: number;
  max: number;
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  const externalText = value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(externalText);
  const [lastExternal, setLastExternal] = useState(externalText);
  if (lastExternal !== externalText) {
    setLastExternal(externalText);
    setDraft(externalText);
  }
  return (
    <input
      id={id}
      type="number"
      className={inputCls}
      min={min}
      max={max}
      value={draft}
      disabled={disabled}
      aria-required={required || undefined}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const parsed = readBoundedInt(raw, min, max);
        // Sub-min digits stay in the draft.
        if (parsed !== undefined && parsed >= min) onChange(parsed);
      }}
      onBlur={(e) => {
        const raw = e.target.value;
        if (raw === "") {
          if (required) {
            setDraft(lastExternal);
            return;
          }
          onChange(undefined);
          return;
        }
        const clamped = clampBoundedInt(raw, min, max);
        if (clamped !== undefined) {
          setDraft(String(clamped));
          onChange(clamped);
        }
      }}
    />
  );
}

/** Themed custom-listbox variant of ZplEnumSelect for richer enums (value +
 *  name). The single-letter ZPL value shows as a right-badge; `optionLabel`
 *  should therefore be the name WITHOUT a letter prefix. */
export function ZplEnumCustomSelect<T extends string>({
  label,
  command,
  values,
  value,
  onChange,
  defaultLabel,
  optionLabel,
  optionBadge,
}: {
  label: string;
  command: string;
  values: readonly T[];
  value: T | undefined;
  onChange: (next: T | undefined) => void;
  /** Omit for a required field (no "unset" segment). */
  defaultLabel?: string;
  optionLabel: (v: T) => string;
  /** Right-badge; defaults to the value itself (the ZPL parameter letter). */
  optionBadge?: (v: T) => string;
}) {
  const groups = [
    {
      options: [
        ...(defaultLabel !== undefined ? [{ value: "", label: defaultLabel }] : []),
        ...values.map((v) => ({
          value: v as string,
          label: optionLabel(v),
          badge: optionBadge ? optionBadge(v) : v,
        })),
      ],
    },
  ];
  return (
    <ZplField>
      <ZplCommandLabel text={label} command={command} />
      <Select
        aria-label={label}
        value={value ?? ""}
        groups={groups}
        onChange={(v) => onChange(v === "" ? undefined : (v as T))}
      />
    </ZplField>
  );
}

/** Custom-listbox sub-select for shared-tag grids (^MF); no command tag, the
 *  parent ZplField carries it. Letter value shows as a right-badge. */
export function ZplEnumSubCustomSelect<T extends string>({
  label,
  values,
  value,
  onChange,
  defaultLabel,
  optionLabel,
  optionBadge,
  disabled,
  className,
}: {
  label: string;
  values: readonly T[];
  value: T | undefined;
  onChange: (next: T | undefined) => void;
  /** Omit for a required field (no "unset" segment). */
  defaultLabel?: string;
  optionLabel: (v: T) => string;
  optionBadge?: (v: T) => string;
  disabled?: boolean;
  /** Replaces the cell layout entirely (not merged), e.g. `fieldGridCell`. */
  className?: string;
}) {
  const groups = [
    {
      options: [
        ...(defaultLabel !== undefined ? [{ value: "", label: defaultLabel }] : []),
        ...values.map((v) => ({
          value: v as string,
          label: optionLabel(v),
          badge: optionBadge ? optionBadge(v) : v,
        })),
      ],
    },
  ];
  return (
    <div className={className ?? "flex flex-col gap-1"}>
      <label className={labelCls}>{label}</label>
      <Select
        aria-label={label}
        value={value ?? ""}
        groups={groups}
        disabled={disabled}
        onChange={(v) => onChange(v === "" ? undefined : (v as T))}
      />
    </div>
  );
}

/** Segmented-button variant of ZplEnumSelect for short enums (three-tier
 *  rule). Same props minus `isValid` (no free-text entry to validate). */
export function ZplEnumSegmented<T extends string>({
  label,
  command,
  values,
  value,
  onChange,
  defaultLabel,
  optionLabel,
  hint,
}: {
  label: string;
  command: string;
  values: readonly T[];
  value: T | undefined;
  onChange: (next: T | undefined) => void;
  defaultLabel: string;
  optionLabel: (v: T) => string;
  hint?: ReactNode;
}) {
  return (
    <ZplField>
      <ZplCommandLabel text={label} command={command} />
      <SegmentedControl
        aria-label={label}
        value={value}
        onChange={onChange}
        defaultLabel={defaultLabel}
        options={values.map((v) => ({ value: v, label: optionLabel(v) }))}
      />
      {hint ? <ZplFieldHint>{hint}</ZplFieldHint> : null}
    </ZplField>
  );
}

export function ZplBoundedIntInput({
  label,
  command,
  min,
  max,
  value,
  onChange,
  unit,
  hint,
}: {
  label: string;
  command: string;
  min: number;
  max: number;
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  unit?: string;
  hint?: ReactNode;
}) {
  const id = useId();
  const inputBox = (
    <div className="w-32">
      <BoundedIntControl id={id} min={min} max={max} value={value} onChange={onChange} />
    </div>
  );
  return (
    <ZplField>
      <ZplCommandLabel text={label} command={command} htmlFor={id} />
      {unit
        ? (
          <div className="flex items-center gap-2">
            {inputBox}
            <span className={labelCls}>{unit}</span>
          </div>
        )
        : inputBox}
      {hint ? <ZplFieldHint>{hint}</ZplFieldHint> : null}
    </ZplField>
  );
}

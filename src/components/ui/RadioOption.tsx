import { labelCls } from "./formStyles";

export function RadioOption<T extends string>({ name, value, current, onSelect, label, hint, disabled }: {
  name: string;
  value: T;
  current: T;
  onSelect: (v: T) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className={`flex items-center gap-2 ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}>
        <input
          type="radio"
          name={name}
          className="accent-accent"
          checked={current === value}
          disabled={disabled}
          onChange={() => onSelect(value)}
        />
        <span className={labelCls}>{label}</span>
      </label>
      {hint && <span className="text-[10px] text-muted pl-6">{hint}</span>}
    </div>
  );
}

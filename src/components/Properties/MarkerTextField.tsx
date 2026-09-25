import { useEffect, useRef, useState } from "react";
import { MarkerInsertMenu } from "./MarkerInsertMenu";
import { TemplateContentInput, type TemplateEditorHandle } from "./TemplateContentInput";
import { hasTemplateMarkers } from "@zplab/core/lib/fnTemplate";
import { markerOf } from "@zplab/core/types/Variable";

/** Builder field with marker chips and a caret-anchored insert menu. */
export function MarkerTextField({
  value,
  onChange,
  multiline = false,
  ariaLabel,
  hasError,
  autoFocus = false,
  autoComplete,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  multiline?: boolean;
  ariaLabel?: string;
  hasError?: boolean;
  placeholder?: string;
  /** Focus the field on mount, for rows created by a user action. */
  autoFocus?: boolean;
  /** HTML autofill token. A single-line field with one starts native so the browser can fill it. */
  autoComplete?: string;
}) {
  const editorRef = useRef<TemplateEditorHandle>(null);
  const nativeRef = useRef<HTMLInputElement>(null);
  // One-way: a chip cannot render in the native input, and flipping back on delete would lose the caret.
  const [chips, setChips] = useState(() => autoComplete === undefined || multiline || hasTemplateMarkers(value));
  // The native input unmounts under the user, so the editor cannot read the live caret.
  const caretAfterSwitch = useRef<number | null>(null);

  useEffect(() => {
    if (autoFocus) editorRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const at = caretAfterSwitch.current;
    if (at === null) return;
    caretAfterSwitch.current = null;
    editorRef.current?.focus(at);
  }, [chips]);

  const change = (next: string, caret: number) => {
    if (!chips && hasTemplateMarkers(next)) {
      caretAfterSwitch.current = caret;
      setChips(true);
    }
    onChange(next);
  };

  const insertNative = (body: string) => {
    const el = nativeRef.current;
    const lo = el?.selectionStart ?? value.length;
    const hi = el?.selectionEnd ?? lo;
    const marker = markerOf(body);
    change(value.slice(0, lo) + marker + value.slice(hi), lo + marker.length);
  };

  const borderCls = hasError ? "border-error" : "border-border";
  return (
    <div className="flex items-start gap-1 flex-1 min-w-0">
      {chips ? (
        <div className={`flex-1 min-w-0 bg-surface-2 border rounded-md focus-within:border-accent ${borderCls}`}>
          <TemplateContentInput
            ref={editorRef}
            value={value}
            onChange={onChange}
            multiline={multiline}
            ariaLabel={ariaLabel}
            placeholder={placeholder}
            boxClassName={`w-full bg-transparent px-2 py-1 text-xs font-mono leading-6 break-words focus:outline-none ${
              multiline ? "min-h-16 whitespace-pre-wrap" : ""
            }`}
          />
        </div>
      ) : (
        <input
          ref={nativeRef}
          autoComplete={autoComplete}
          placeholder={placeholder}
          spellCheck={false}
          className={`flex-1 min-w-0 bg-surface-2 border rounded-md px-2 py-1 text-xs font-mono leading-6 focus:border-accent focus:outline-none ${borderCls}`}
          value={value}
          onChange={(e) => change(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          aria-label={ariaLabel}
          autoFocus={autoFocus}
        />
      )}
      <MarkerInsertMenu onInsert={chips ? (body) => editorRef.current?.insertMarker(body) : insertNative} />
    </div>
  );
}

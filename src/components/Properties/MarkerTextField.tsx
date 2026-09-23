import { useEffect, useRef } from "react";
import { MarkerInsertMenu } from "./MarkerInsertMenu";
import { TemplateContentInput, type TemplateEditorHandle } from "./TemplateContentInput";

/** Builder field with marker chips and a caret-anchored insert menu. */
export function MarkerTextField({
  value,
  onChange,
  multiline = false,
  ariaLabel,
  hasError,
  autoFocus = false,
}: {
  value: string;
  onChange: (next: string) => void;
  multiline?: boolean;
  ariaLabel?: string;
  hasError?: boolean;
  /** Focus the editor on mount, for rows created by a user action. */
  autoFocus?: boolean;
}) {
  const editorRef = useRef<TemplateEditorHandle>(null);

  useEffect(() => {
    if (autoFocus) editorRef.current?.focus();
  }, [autoFocus]);

  return (
    <div className="flex items-start gap-1 flex-1 min-w-0">
      <div
        className={`flex-1 min-w-0 bg-surface-2 border rounded-md focus-within:border-accent ${
          hasError ? "border-error" : "border-border"
        }`}
      >
        <TemplateContentInput
          ref={editorRef}
          value={value}
          onChange={onChange}
          multiline={multiline}
          ariaLabel={ariaLabel}
          boxClassName={`w-full bg-transparent px-2 py-1 text-xs font-mono leading-6 break-words focus:outline-none ${
            multiline ? "min-h-16 whitespace-pre-wrap" : ""
          }`}
        />
      </div>
      <MarkerInsertMenu onInsert={(body) => editorRef.current?.insertMarker(body)} />
    </div>
  );
}

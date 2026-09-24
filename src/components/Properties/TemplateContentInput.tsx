import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useLayoutEffect,
} from "react";
import { flushSync } from "react-dom";
import { useT } from "../../hooks/useT";
import { useLabelStore } from "../../store/labelStore";
import { formatClockLabel } from "@zplab/core/lib/fcTemplate";
import {
  classifyMarkerBody,
  findAtomicMarker,
  findMarkerContaining,
  removeMarkerAt,
  tokeniseMarkers,
  type MarkerSegment,
} from "../../lib/markerTokens";
import {
  domToPlainText,
  findCaretPosition,
  getCaretOffset,
} from "../../lib/contentEditableCaret";
import { capLiteralLength, hasTemplateMarkers, literalInsertRoom, resolvedContentLength } from "@zplab/core/lib/fnTemplate";
import { markerOf, type Variable } from "@zplab/core/types/Variable";
import { controlKeyFromBody } from "@zplab/core/types/controlKey";

/** A selected token in the editor: its kind, the key the inspector needs
 *  (variable name / clock marker body), and the marker index for the ring. */
export interface SelectedMarker {
  kind: "var" | "clock" | "ctrl" | "orphan";
  key: string;
  index: number;
}

/** Imperative surface so code outside the editor can insert a token or place the caret. */
export interface TemplateEditorHandle {
  insertMarker: (markerBody: string) => void;
  focus: (at?: number) => void;
}

/** Caret offset within `editor`, or null when selection isn't inside it. */
function caretOffsetIn(
  editor: HTMLElement,
  sel: Selection | null,
  which: "anchor" | "focus" = "anchor",
): number | null {
  if (!sel || sel.rangeCount === 0) return null;
  const node = which === "anchor" ? sel.anchorNode : sel.focusNode;
  const offset = which === "anchor" ? sel.anchorOffset : sel.focusOffset;
  if (!node || !editor.contains(node)) return null;
  return getCaretOffset(editor, node, offset);
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  /** User input only; marker insertions skip sanitise. */
  sanitise?: (raw: string) => string;
  placeholder?: string;
  /** Accessible name when it should differ from the placeholder. */
  ariaLabel?: string;
  maxLength?: number;
  /** Length gates count a control chip as 1 byte only when the host field's
   *  emitter resolves chips; default counts its literal marker text. */
  ctrlAsByte?: boolean;
  /** Scopes editorFocusRequest so only the matching editor focuses. */
  objectId?: string;
  /** False for single-line restricted-charset fields. */
  multiline?: boolean;
  /** Index of the marker to ring as selected (from SelectedMarker.index). */
  selectedIndex?: number;
  /** Fired when a token chip is clicked (or empty space, with null). */
  onSelectMarker?: (sel: SelectedMarker | null) => void;
  /** Override the editor box styling (defaults to the hero look). The compact
   *  Properties-panel entry point passes its own. */
  boxClassName?: string;
}

/** Hero-editor box styling, the default when no boxClassName is passed. */
const editorBoxCls =
  "w-full bg-surface-2 border border-accent rounded-[7px] px-3 py-[11px] text-[13.5px] font-mono leading-[2.1] whitespace-pre-wrap break-words caret-accent focus:outline-none";

// Token chip pills. Variable/clock render as atomic widgets (see segmentsToHTML)
// so the chip can drop the raw `«»` syntax; orphan stays inline-editable text so
// a typo'd marker can be fixed in place. indigo = variable, info = clock,
// ok = control key, amber = orphan (soft warning).
const CHIP_BASE = "group inline-flex items-center align-[1px] rounded-[5px] border pl-2 pr-1 py-px select-none cursor-pointer";
const VAR_CLS = `${CHIP_BASE} border-indigo/60 bg-indigo-dim text-indigo`;
const CLOCK_CLS = `${CHIP_BASE} border-info/60 bg-info/15 text-info`;
const CTRL_CLS = `${CHIP_BASE} border-ok/60 bg-ok/10 text-ok font-mono`;
const ORPHAN_CLS = "rounded-[5px] border border-warning/60 bg-warning/10 px-1 text-warning";
const ZPL_SUB_CLS = "ml-0.5 text-[9px] text-muted/70";
// Selection ring: double box-shadow (surface gap + currentColor ring).
const SELECTED_RING = "shadow-[0_0_0_2px_var(--color-surface),0_0_0_3.5px_currentColor]";

// Hover-revealed remove control inside a chip; data-chip-remove is handled by
// a delegated mousedown listener on the editor (atomic marker removal).
const removeBtn = (label: string): string =>
  `<button type="button" data-chip-remove tabindex="-1" contenteditable="false" aria-label="${escapeAttr(label)}" class="ml-1 -mr-0.5 leading-none opacity-0 group-hover:opacity-85 focus:opacity-100 hover:opacity-100 cursor-pointer transition-opacity">×</button>`;

// Inline so `currentColor` (the chip's cyan) drives the stroke in both themes;
// it lives inside a data-m widget, so it never enters the editor's plain text.
const CLOCK_ICON =
  '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="inline-block mr-0.5 shrink-0" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 5V8l2 1.3"/></svg>';

interface ChipDeco {
  /** showZplCommands: appends the chip's ^FN/^FC code. */
  show: boolean;
  fnByName: ReadonlyMap<string, number>;
  /** Localised clock label for a marker body like `clock:Y` / `clock2:m`. */
  clockLabel: (body: string) => string;
  /** aria-label for the per-chip remove button. */
  removeLabel: string;
  /** Marker index to ring as selected (counts var/clock/orphan segments). */
  selectedIndex?: number;
}

/** Variable/clock chips are atomic widgets: the canonical `«…»` lives in
 *  `data-m` (read back by domToPlainText) while the visible content drops the
 *  raw syntax. `data-mi` is the marker index used for click-selection. Trailing
 *  `<br>` gives Chrome a caret target on the empty last line; domToPlainText
 *  strips it symmetrically. */
function segmentsToHTML(segments: MarkerSegment[], deco: ChipDeco): string {
  const parts: string[] = [];
  let markerIndex = -1;
  for (const s of segments) {
    if (s.kind === "text") {
      const lines = s.text.split("\n");
      lines.forEach((line, i) => {
        if (i > 0) parts.push("<br>");
        if (line !== "") parts.push(escapeHTML(line));
      });
      continue;
    }
    markerIndex += 1;
    const ring = markerIndex === deco.selectedIndex ? ` ${SELECTED_RING}` : "";
    const mi = `data-mi="${markerIndex}"`;
    // Focusable so the badge can be reached and removed by keyboard.
    const a11y = `tabindex="0" role="button"`;
    if (s.kind === "orphan") {
      parts.push(`<span class="${ORPHAN_CLS}${ring}" ${mi} ${a11y} aria-label="${escapeAttr(s.text)}">${escapeHTML(s.text)}</span>`);
      continue;
    }
    const body = s.text.slice(1, -1);
    const dm = `data-m="${escapeAttr(s.text)}" contenteditable="false"`;
    const x = removeBtn(deco.removeLabel);
    if (s.kind === "var") {
      const fn = deco.show ? deco.fnByName.get(body) : undefined;
      const zpl = fn !== undefined ? `<span class="${ZPL_SUB_CLS}">^FN${fn}</span>` : "";
      parts.push(`<span class="${VAR_CLS}${ring}" ${dm} ${mi} ${a11y} aria-label="${escapeAttr(body)}">${escapeHTML(body)}${zpl}${x}</span>`);
    } else if (s.kind === "ctrl") {
      // Keycap look: the key name (TAB, CR, ...) reads universally.
      const key = controlKeyFromBody(body);
      const zpl = deco.show ? `<span class="${ZPL_SUB_CLS}">^FH</span>` : "";
      parts.push(`<span class="${CTRL_CLS}${ring}" ${dm} ${mi} ${a11y} aria-label="${escapeAttr(key)}">${escapeHTML(key)}${zpl}${x}</span>`);
    } else {
      const zpl = deco.show ? `<span class="${ZPL_SUB_CLS}">^FC</span>` : "";
      const label = deco.clockLabel(body);
      parts.push(
        `<span class="${CLOCK_CLS}${ring}" ${dm} ${mi} ${a11y} aria-label="${escapeAttr(label)}">${CLOCK_ICON}${escapeHTML(label)}${zpl}${x}</span>`,
      );
    }
  }
  // Trailing newline anchor (stripped by domToPlainText). Skip it when empty so
  // the editor stays `:empty` and the CSS placeholder can render.
  if (parts.length > 0) parts.push("<br>");
  return parts.join("");
}

function escapeHTML(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** contenteditable editor with coloured marker chips. Parent owns the canonical
 *  plain string (value/onChange); useLayoutEffect rebuilds the DOM and restores
 *  the caret. The insert palette lives outside and drives it via the ref. */
export const TemplateContentInput = forwardRef<TemplateEditorHandle, Props>(
  function TemplateContentInput(
    { value, onChange, sanitise, placeholder, ariaLabel, maxLength, ctrlAsByte = false, objectId, multiline = true, selectedIndex, onSelectMarker, boxClassName },
    ref,
  ) {
    const t = useT();
    const variables = useLabelStore((s) => s.variables);
    const showZpl = useLabelStore((s) => s.showZplCommands);
    const editorFocusRequest = useLabelStore((s) => s.editorFocusRequest);
    const editorRef = useRef<HTMLDivElement>(null);
    const composingRef = useRef(false);
    // Last caret offset inside the editor, so an external palette button (which
    // takes focus on click) can still insert at the user's last position.
    const lastCaretRef = useRef<number>(value.length);
    // Bumped to force the rebuild effect when a sanitiser/cap rejects an edit
    // back to the current value (no value change, but stale chars in the DOM).
    const [resyncNonce, setResyncNonce] = useState(0);

    const variableNames = new Set(variables.map((v: Variable) => v.name));
    const segments = tokeniseMarkers(value, variableNames);

    const restoreCaret = (offset: number) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      const pos = findCaretPosition(editor, offset);
      const range = document.createRange();
      range.setStart(pos.node, pos.offset);
      range.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    };

    const insertMarker = (markerBody: string) => {
      const marker = markerOf(markerBody);
      const editor = editorRef.current;
      const sel = editor ? caretOffsetIn(editor, window.getSelection()) : null;
      const at = sel ?? lastCaretRef.current ?? value.length;
      const next = value.slice(0, at) + marker + value.slice(at);
      // Length-inheritance gate (same rule as paste): a token counts at its
      // resolved width and fits whole or not at all.
      if (maxLength !== undefined && resolvedContentLength(next, variables, ctrlAsByte) > maxLength) return;
      onChange(next);
      const caret = at + marker.length;
      lastCaretRef.current = caret;
      queueMicrotask(() => restoreCaret(caret));
    };

    useImperativeHandle(ref, () => ({
      insertMarker,
      focus: (at?: number) => {
        if (at === undefined) {
          editorRef.current?.focus();
          return;
        }
        lastCaretRef.current = at;
        restoreCaret(at);
      },
    }));

    // Skip rebuild when DOM plain text already matches; avoids clobbering caret.
    useLayoutEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const deco: ChipDeco = {
        show: showZpl,
        fnByName: new Map(variables.map((v: Variable) => [v.name, v.fnNumber])),
        clockLabel: (body: string) => formatClockLabel(body, (k) => t.app[k]),
        removeLabel: t.variables.unbindAria,
        selectedIndex,
      };
      const currentText = domToPlainText(editor);
      const desired = segmentsToHTML(segments, deco);
      if (currentText === value && editor.innerHTML === desired) return;
      const caretOffset = caretOffsetIn(editor, window.getSelection());
      editor.innerHTML = desired;
      if (caretOffset !== null && document.activeElement === editor) {
        const selAfter = window.getSelection();
        if (selAfter) {
          const pos = findCaretPosition(editor, caretOffset);
          const range = document.createRange();
          range.setStart(pos.node, pos.offset);
          range.collapse(true);
          selAfter.removeAllRanges();
          selAfter.addRange(range);
        }
      }
    }, [value, segments, showZpl, variables, t, resyncNonce, selectedIndex]);

    // External focus request (canvas dblclick): focus + selectAll for rename.
    useEffect(() => {
      if (!editorFocusRequest || editorFocusRequest.id !== objectId) return;
      const editor = editorRef.current;
      if (!editor) return;
      if (document.activeElement === editor) return;
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(editor);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }, [editorFocusRequest, objectId]);

    const rememberCaret = () => {
      const editor = editorRef.current;
      if (!editor) return;
      const off = caretOffsetIn(editor, window.getSelection());
      if (off !== null) lastCaretRef.current = off;
    };

    // React 19 onBeforeInput is unreliable on contenteditable; native listener
    // with latest-state ref so closure stays stable.
    const stateRef = useRef({ value, onChange, sanitise, maxLength, ctrlAsByte, multiline, variables });
    useLayoutEffect(() => {
      stateRef.current = { value, onChange, sanitise, maxLength, ctrlAsByte, multiline, variables };
    });

    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      /** Sync render+restore so follow-up keys land on the rebuilt DOM. */
      const commitInline = (next: string, nextCaret: number) => {
        flushSync(() => stateRef.current.onChange(next));
        restoreCaret(nextCaret);
        lastCaretRef.current = nextCaret;
      };
      const selectionRange = (fallbackLen: number) => {
        const sel = window.getSelection();
        const start = caretOffsetIn(editor, sel, "anchor") ?? fallbackLen;
        const end = caretOffsetIn(editor, sel, "focus") ?? start;
        return { lo: Math.min(start, end), hi: Math.max(start, end) };
      };
      /** Delete the whole `«...»` marker atomically rather than eroding mid-token. */
      const handleAtomicDelete = (direction: "backspace" | "delete") => {
        const { value } = stateRef.current;
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
        const caret = caretOffsetIn(editor, sel);
        if (caret === null) return false;
        const m = findAtomicMarker(value, caret, direction);
        if (!m) return false;
        commitInline(value.slice(0, m.start) + value.slice(m.end), m.start);
        return true;
      };
      const handleParagraph = () => {
        const { value } = stateRef.current;
        const { lo, hi } = selectionRange(value.length);
        commitInline(value.slice(0, lo) + "\n" + value.slice(hi), lo + 1);
      };
      /** ClipboardEvent for cross-engine plain-text paste; FF/Safari lack
       *  dataTransfer on beforeinput insertFromPaste. */
      const handlePaste = (e: ClipboardEvent) => {
        e.preventDefault();
        const { value, sanitise, maxLength, multiline, variables } = stateRef.current;
        const data = e.clipboardData?.getData("text/plain") ?? "";
        if (!data) return;
        let clean = sanitise ? sanitise(data) : data;
        // Single-line fields never hold line breaks; collapse pasted ones to spaces.
        if (!multiline) clean = clean.replace(/[\r\n]+/g, " ");
        const { lo, hi } = selectionRange(value.length);
        // Marker-bearing paste is atomic (a token counts at its resolved
        // width and can't be sliced): the whole paste fits or is rejected.
        // literalInsertRoom would count the pasted `«…»` as literal chars
        // and let a wide-resolving marker slip past the cap.
        if (hasTemplateMarkers(clean)) {
          const next = value.slice(0, lo) + clean + value.slice(hi);
          if (maxLength !== undefined && resolvedContentLength(next, variables, stateRef.current.ctrlAsByte) > maxLength) return;
          commitInline(next, lo + clean.length);
          return;
        }
        const room = literalInsertRoom(value, value.slice(lo, hi), maxLength, variables);
        const toInsert = room === Infinity ? clean : clean.slice(0, room);
        commitInline(value.slice(0, lo) + toInsert + value.slice(hi), lo + toInsert.length);
      };
      /** Per-chip ✕: remove that marker atomically. mousedown (not click) so we
       *  preventDefault before the browser moves the caret into the widget. */
      const handleChipRemove = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        if (!target?.closest?.("[data-chip-remove]")) return;
        const widget = target.closest("[data-m]");
        if (!widget || widget.parentNode !== editor) return;
        e.preventDefault();
        const dm = widget.getAttribute("data-m") ?? "";
        const idx = Array.prototype.indexOf.call(editor.childNodes, widget);
        const start = getCaretOffset(editor, editor, idx);
        const { value } = stateRef.current;
        commitInline(value.slice(0, start) + value.slice(start + dm.length), start);
      };
      const handler = (e: InputEvent) => {
        if (composingRef.current) return;
        switch (e.inputType) {
          case "historyUndo":
          case "historyRedo":
            // Drop browser undo/redo; zundo owns history.
            e.preventDefault();
            return;
          case "insertParagraph":
            // Single-line drops Enter; sanitise would otherwise flicker a stray <br>.
            e.preventDefault();
            if (stateRef.current.multiline) handleParagraph();
            return;
          case "deleteContentBackward":
          case "deleteContentForward": {
            const direction = e.inputType === "deleteContentBackward" ? "backspace" : "delete";
            if (handleAtomicDelete(direction)) e.preventDefault();
            return;
          }
        }
      };
      editor.addEventListener("beforeinput", handler);
      editor.addEventListener("paste", handlePaste);
      editor.addEventListener("mousedown", handleChipRemove);
      return () => {
        editor.removeEventListener("beforeinput", handler);
        editor.removeEventListener("paste", handlePaste);
        editor.removeEventListener("mousedown", handleChipRemove);
      };
    }, []);

    const onInput = () => {
      const editor = editorRef.current;
      if (!editor) return;
      if (composingRef.current) return;
      const raw = domToPlainText(editor);
      let next = raw;
      if (sanitise) next = sanitise(next);
      next = capLiteralLength(next, maxLength);
      // Marker content escapes capLiteralLength (an atomic token can't be
      // sliced), so typed growth past the resolved-width cap is rejected
      // instead. Shrinking edits pass so an over-cap field can be edited down.
      if (maxLength !== undefined && hasTemplateMarkers(next)) {
        const len = resolvedContentLength(next, variables, stateRef.current.ctrlAsByte);
        if (len > maxLength && len > resolvedContentLength(value, variables, stateRef.current.ctrlAsByte)) {
          setResyncNonce((n) => n + 1);
          return;
        }
      }
      if (next === value) {
        // Sanitiser/cap rejected the edit back to the current value: the DOM
        // still shows the rejected chars, so force a rebuild to the canonical.
        if (raw !== next) setResyncNonce((n) => n + 1);
        return;
      }
      onChange(next);
    };

    const onCompositionEnd = () => {
      composingRef.current = false;
      onInput();
    };

    const selectChip = (chip: Element) => {
      if (!onSelectMarker) return;
      const index = Number(chip.getAttribute("data-mi"));
      // data-m carries the canonical `«…»` for var/clock; an orphan chip's
      // visible text IS the raw marker.
      const body = (chip.getAttribute("data-m") ?? chip.textContent ?? "").replace(/^«|»$/g, "");
      onSelectMarker({ kind: classifyMarkerBody(body, variableNames), key: body, index });
    };

    /** Click: select a token chip (fills the inspector) or deselect on empty. */
    const onClick = (e: React.MouseEvent) => {
      rememberCaret();
      if (!onSelectMarker) return;
      const chip = (e.target as HTMLElement).closest?.("[data-mi]");
      if (!chip) {
        onSelectMarker(null);
        return;
      }
      selectChip(chip);
    };

    /** Widget-chip span at a caret boundary (or stuck inside one); orphans are
     *  editable text and keep native char-wise caret motion. */
    const chipSpanFor = (caret: number, dir: "left" | "right") => {
      let off = 0;
      for (const s of segments) {
        const end = off + s.text.length;
        if (s.kind === "var" || s.kind === "clock" || s.kind === "ctrl") {
          if (dir === "left" ? caret === end : caret === off) return { start: off, end };
          if (caret > off && caret < end) return { start: off, end };
        }
        off = end;
      }
      return null;
    };

    /** Keyboard on a focused badge: select, remove, or move to a sibling. */
    const onKeyDown = (e: React.KeyboardEvent) => {
      const editor = editorRef.current;
      if (!editor) return;
      const chip = (e.target as HTMLElement).closest?.("[data-mi]");
      if (!chip) {
        // Own the whole horizontal caret step: Chrome's native motion around
        // non-editable select-none chips skips or sticks in the ADJACENT text
        // too, so every plain-text step is computed on the canonical string
        // (chip = one atomic step to its far side) and set explicitly.
        if (
          (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
          !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey
        ) {
          const sel = window.getSelection();
          if (!sel?.isCollapsed) return;
          const caret = caretOffsetIn(editor, sel);
          if (caret === null) return;
          e.preventDefault();
          const dir = e.key === "ArrowLeft" ? "left" : "right";
          const span = chipSpanFor(caret, dir);
          const target = span
            ? dir === "left" ? span.start : span.end
            : Math.max(0, Math.min(value.length, caret + (dir === "left" ? -1 : 1)));
          restoreCaret(target);
          lastCaretRef.current = target;
        }
        return;
      }
      if (!editor.contains(chip)) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectChip(chip);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        // Remove by marker index (works for orphans too, unlike DOM-offset
        // math); then move focus to the chip that shifts into this slot so
        // keyboard users keep their place after the rebuild.
        const all = Array.from(editor.querySelectorAll("[data-mi]"));
        const pos = all.indexOf(chip);
        onChange(removeMarkerAt(value, Number(chip.getAttribute("data-mi")), variableNames));
        onSelectMarker?.(null);
        queueMicrotask(() => {
          const chips = editor.querySelectorAll<HTMLElement>("[data-mi]");
          (chips[Math.min(pos, chips.length - 1)] ?? editor).focus();
        });
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const all = Array.from(editor.querySelectorAll("[data-mi]"));
        const next = all[all.indexOf(chip) + (e.key === "ArrowRight" ? 1 : -1)];
        if (next) {
          e.preventDefault();
          (next as HTMLElement).focus();
        }
      }
    };

    /** Select the whole `«...»` instead of word-boundary fragment. */
    const onDoubleClick = () => {
      const editor = editorRef.current;
      if (!editor) return;
      const caret = caretOffsetIn(editor, window.getSelection()) ?? value.length;
      const m = findMarkerContaining(value, caret);
      if (!m) return;
      const startPos = findCaretPosition(editor, m.start);
      const endPos = findCaretPosition(editor, m.end);
      const range = document.createRange();
      range.setStart(startPos.node, startPos.offset);
      range.setEnd(endPos.node, endPos.offset);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    };

    const isEmpty = value.length === 0;

    return (
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline={multiline}
        aria-label={ariaLabel ?? placeholder ?? t.app.insertVariable}
        data-placeholder={isEmpty ? placeholder : undefined}
        spellCheck={false}
        className={`${boxClassName ?? `${editorBoxCls} min-h-[172px]`} relative block empty:before:content-[attr(data-placeholder)] empty:before:text-muted empty:before:pointer-events-none`}
        onInput={onInput}
        onKeyUp={rememberCaret}
        onKeyDown={onKeyDown}
        onClick={onClick}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={onCompositionEnd}
        onDoubleClick={onDoubleClick}
      />
    );
  },
);

import { tokenizeZplLine, opaquePayloadSpan } from "./zplTokenize";
import { TOKEN_CLASS, MAX_LINE_RENDER } from "./zplTokenStyles";

export interface HighlightRange {
  from: number;
  to: number;
  cls: string;
}

/** Decoration ranges for one document line whose first char sits at `base`;
 *  overlong lines colour only their head, mirroring the read-only pane's cap. */
export function zplLineHighlights(line: string, base: number): HighlightRange[] {
  const head = line.length > MAX_LINE_RENDER ? line.slice(0, MAX_LINE_RENDER) : line;
  const out: HighlightRange[] = [];
  let off = base;
  for (const tok of tokenizeZplLine(head)) {
    out.push({ from: off, to: off + tok.value.length, cls: TOKEN_CLASS[tok.type] });
    off += tok.value.length;
  }
  return out;
}

const FOLD_HEAD_CHARS = 40;

/** Foldable tail of an overlong opaque payload, or null. Bounded by the payload,
 *  not the line: a single-line label carries real fields after the blob. */
export function opaquePayloadFold(
  line: string,
  base: number,
): { from: number; to: number } | null {
  if (line.length <= MAX_LINE_RENDER) return null;
  // First OVERLONG payload, not first payload: a short blob may precede the
  // big one on a minified single-line stream.
  for (let searchFrom = 0; ; ) {
    const span = opaquePayloadSpan(line, searchFrom);
    if (!span) break;
    if (span.end - span.start > MAX_LINE_RENDER) {
      return { from: base + span.start + FOLD_HEAD_CHARS, to: base + span.end };
    }
    searchFrom = span.end;
  }
  // A ^CC/^CT remap hides commands from this stateless view; an overlong line
  // with no caret or tilde at all is one opaque run, so fold its tail.
  if (!/[\^~]/.test(line)) {
    return { from: base + FOLD_HEAD_CHARS, to: base + line.length };
  }
  return null;
}

/** Pure-CRLF test for the editor's lineSeparator facet: only a buffer with no
 *  bare \n may pin CRLF, else the LF parts collapse into one editor line. The
 *  facet is fixed at mount, so the mount key and the mount read MUST agree. */
export const isPureCrlf = (text: string): boolean =>
  /\r\n/.test(text) && !/(?<!\r)\n/.test(text);

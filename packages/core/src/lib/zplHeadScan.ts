import { jmDensityOf, type JmDensity } from "../types/LabelConfig";
import { applyPrefixRemap, tokenize } from "./zplParser/helpers";
import { MIN_DF_SPAN, MIN_JM_SPAN, type DfSpan, type FormatHead, type JmSpan } from "./zplOverlay/overlay";
import { canonicalStoredFormatPath, isStoredFormatPath } from "./storagePath";

/** A head's ^DF: the bytes of every one, and the path the first usable one names. */
export interface StoredFormatHead {
  path: string | undefined;
  spans: DfSpan[];
}

/** The ^DF a head token declares as a span, or undefined for any other token; an unusable path leaves `path` absent. */
function storedFormatOf(t: HeadToken): DfSpan | undefined {
  if (t.cmd !== "DF" || !t.isCaret) return undefined;
  const raw = t.rest.trimEnd();
  const span: DfSpan = { start: t.start, end: t.start + MIN_DF_SPAN + raw.length, caret: t.caret };
  if (isStoredFormatPath(raw)) span.path = canonicalStoredFormatPath(raw);
  return span;
}

/** The ^DF span whose path the model takes: the first usable one wins. */
export function storedFormatSpanOf(spans: readonly DfSpan[] | undefined): DfSpan | undefined {
  return spans?.find((s) => s.path !== undefined);
}

export const storedFormatPathOf = (spans: readonly DfSpan[] | undefined): string | undefined => storedFormatSpanOf(spans)?.path;

/** Folds one more ^DF into the head's record: every span is kept, the path follows the first usable one. */
function collectStoredFormat(into: StoredFormatHead | undefined, span: DfSpan | undefined): StoredFormatHead | undefined {
  if (!span) return into;
  const spans = into ? [...into.spans, span] : [span];
  return { path: storedFormatPathOf(spans), spans };
}

interface HeadToken {
  cmd: string;
  rest: string;
  /** Absolute offset in `zpl`. */
  start: number;
  /** Opened with the live caret prefix (vs the tilde form). */
  isCaret: boolean;
  /** Caret prefix live at this token, for a ^JM behind a ^CC remap. */
  caret: string;
  /** Delimiter live at this token, for reading a ^JM value. */
  delim: string;
}

/** Live prefix/delimiter chars a scan threads. `headTokens` mutates it on
 *  ^CC/^CT/^CD so a caller scanning several blocks in sequence sees the remaps
 *  persist; a caller wanting isolation passes a fresh object. */
export interface PrefixState {
  caretChar: string;
  tildeChar: string;
  delimiterChar: string;
}

/** Tokenize from `fromOffset` with the live caret/delimiter per token; `st` is mutated
 *  in place so a caller can thread it onward across blocks. */
function* headTokens(zpl: string, fromOffset: number, st: PrefixState): Generator<HeadToken> {
  for (const t of tokenize(zpl.slice(fromOffset), st)) {
    if (applyPrefixRemap(st, t.cmd, t.rest[0])) continue;
    const start = fromOffset + t.start;
    yield { cmd: t.cmd, rest: t.rest, start, isCaret: zpl[start] === st.caretChar, caret: st.caretChar, delim: st.delimiterChar };
  }
}

/** Resolve a format's ^JM density (spec p269) by scanning its head from its own
 *  ^XA up to the first ^FS/^XZ or the next ^XA; the last valid caret ^JM wins. */
export function lookaheadJmDensity(
  zpl: string,
  fromOffset: number,
  chars: { caretChar: string; tildeChar: string },
  delimiter: string,
): JmDensity | undefined {
  let density: JmDensity | undefined;
  const st: PrefixState = { caretChar: chars.caretChar, tildeChar: chars.tildeChar, delimiterChar: delimiter };
  for (const t of headTokens(zpl, fromOffset, st)) {
    if (t.cmd === "FS" || t.cmd === "XZ") break;
    if (t.cmd === "XA" && t.start > fromOffset) break;
    if (t.cmd !== "JM" || !t.isCaret) continue;
    density = jmDensityOf(t.rest, t.delim) ?? density;
  }
  return density;
}

/** Resolve a format's ^DF by scanning its head like `lookaheadJmDensity`; the first usable one names the path. */
export function lookaheadStoredFormat(
  zpl: string,
  fromOffset: number,
  chars: { caretChar: string; tildeChar: string },
  delimiter: string,
): StoredFormatHead | undefined {
  const st: PrefixState = { caretChar: chars.caretChar, tildeChar: chars.tildeChar, delimiterChar: delimiter };
  let found: StoredFormatHead | undefined;
  for (const t of headTokens(zpl, fromOffset, st)) {
    if (t.cmd === "FS" || t.cmd === "XZ") break;
    if (t.cmd === "XA" && t.start > fromOffset) break;
    found = collectStoredFormat(found, storedFormatOf(t));
  }
  return found;
}

/** Scan one block's format head (density, FormatHead); ^CC/^CT/^CD remaps mutate
 *  `st` in place. Density and ^JM spans count only up to the first ^FS/^XZ;
 *  `threadBody` keeps tokenizing past that so body remaps still reach `st`. */
function scanBlockHead(
  block: string,
  st: PrefixState,
  threadBody: boolean,
): { density: JmDensity | undefined; head: FormatHead | undefined; storedFormat: StoredFormatHead | undefined } {
  let seenXa = false;
  let openerCaret = "";
  let at: number | null = null;
  let inHead = false;
  let density: JmDensity | undefined;
  let storedFormat: StoredFormatHead | undefined;
  const jmSpans: JmSpan[] = [];
  for (const t of headTokens(block, 0, st)) {
    if (!seenXa) {
      if (t.cmd === "XA" && t.isCaret) {
        seenXa = true;
        inHead = true;
        openerCaret = t.caret;
        at = t.start + 3;
      }
      continue;
    }
    if (inHead && (t.cmd === "FS" || t.cmd === "XZ" || t.cmd === "XA")) {
      inHead = false;
      if (!threadBody) break;
      continue;
    }
    if (!inHead) continue;
    storedFormat = collectStoredFormat(storedFormat, storedFormatOf(t));
    if (t.cmd !== "JM" || !t.isCaret) continue;
    density = jmDensityOf(t.rest, t.delim) ?? density;
    jmSpans.push({ start: t.start, end: t.start + MIN_JM_SPAN + t.rest.trimEnd().length, delim: t.delim, caret: t.caret });
  }
  const head: FormatHead | undefined = at === null ? undefined : { caret: openerCaret, at, jmSpans, ...(storedFormat ? { dfSpans: storedFormat.spans } : {}) };
  return { density, head, storedFormat };
}

/** A legacy overlay block's head density and FormatHead, read from an isolated
 *  slice with default prefixes (no incoming state). A cross-block ^CC/^CT/^CD
 *  remap is unrecoverable from the slice alone; use `reconstructLegacyBlockHeads`. */
export function reconstructBlockHead(block: string): {
  density: JmDensity | undefined;
  head: FormatHead | undefined;
  storedFormat: StoredFormatHead | undefined;
} {
  return scanBlockHead(block, { caretChar: "^", tildeChar: "~", delimiterChar: "," }, false);
}

/** Per-block head density and FormatHead for a legacy stream, threading ^CC/^CT/^CD
 *  remaps and the latched ^JM density (unset at the start is full density A) across
 *  blocks in parser order; an `undefined` block inherits the running density, no head. */
export function reconstructLegacyBlockHeads(
  blocks: readonly (string | undefined)[],
): { density: JmDensity | undefined; head: FormatHead | undefined; storedFormat: StoredFormatHead | undefined }[] {
  const st: PrefixState = { caretChar: "^", tildeChar: "~", delimiterChar: "," };
  let carried: JmDensity | undefined;
  return blocks.map((block) => {
    if (block === undefined) return { density: carried, head: undefined, storedFormat: undefined };
    const { density: headDensity, head, storedFormat } = scanBlockHead(block, st, true);
    if (headDensity !== undefined) carried = headDensity;
    return { density: carried, head, storedFormat };
  });
}

/** Whether the stream ever opens a format, plus the density its leading ^JM
 *  declares when it never does: a ^JM latches only in a real wrapper-less body,
 *  with an ^XA anywhere ahead it is a preamble the lookahead never reads. */
export function scanBareStream(
  zpl: string,
  chars: { caretChar: string; tildeChar: string },
  delimiter: string,
): { hasXa: boolean; density: JmDensity | undefined; storedFormat: StoredFormatHead | undefined } {
  let density: JmDensity | undefined;
  let storedFormat: StoredFormatHead | undefined;
  let inHead = true;
  const st: PrefixState = { caretChar: chars.caretChar, tildeChar: chars.tildeChar, delimiterChar: delimiter };
  for (const t of headTokens(zpl, 0, st)) {
    if (t.cmd === "XA") return { hasXa: true, density: undefined, storedFormat: undefined };
    if (t.cmd === "FS" || t.cmd === "XZ") { inHead = false; continue; }
    if (!inHead) continue;
    storedFormat = collectStoredFormat(storedFormat, storedFormatOf(t));
    if (t.cmd !== "JM" || !t.isCaret) continue;
    density = jmDensityOf(t.rest, t.delim) ?? density;
  }
  return { hasXa: false, density, storedFormat };
}

import { jmDensityOf, type JmDensity } from "../types/LabelConfig";
import { applyPrefixRemap, tokenize } from "./zplParser/helpers";
import { MIN_JM_SPAN, type FormatHead, type JmSpan } from "./zplOverlay/overlay";

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

/** Scan one block's format head (density, FormatHead); ^CC/^CT/^CD remaps mutate
 *  `st` in place. Density and ^JM spans count only up to the first ^FS/^XZ;
 *  `threadBody` keeps tokenizing past that so body remaps still reach `st`. */
function scanBlockHead(
  block: string,
  st: PrefixState,
  threadBody: boolean,
): { density: JmDensity | undefined; head: FormatHead | undefined } {
  let seenXa = false;
  let openerCaret = "";
  let at: number | null = null;
  let inHead = false;
  let density: JmDensity | undefined;
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
    if (!inHead || t.cmd !== "JM" || !t.isCaret) continue;
    density = jmDensityOf(t.rest, t.delim) ?? density;
    jmSpans.push({ start: t.start, end: t.start + MIN_JM_SPAN + t.rest.trimEnd().length, delim: t.delim, caret: t.caret });
  }
  const head = at === null ? undefined : { caret: openerCaret, at, jmSpans };
  return { density, head };
}

/** A legacy overlay block's head density and FormatHead, read from an isolated
 *  slice with default prefixes (no incoming state). A cross-block ^CC/^CT/^CD
 *  remap is unrecoverable from the slice alone; use `reconstructLegacyBlockHeads`. */
export function reconstructBlockHead(block: string): {
  density: JmDensity | undefined;
  head: FormatHead | undefined;
} {
  return scanBlockHead(block, { caretChar: "^", tildeChar: "~", delimiterChar: "," }, false);
}

/** Per-block head density and FormatHead for a legacy stream, threading ^CC/^CT/^CD
 *  remaps and the latched ^JM density (unset at the start is full density A) across
 *  blocks in parser order; an `undefined` block inherits the running density, no head. */
export function reconstructLegacyBlockHeads(
  blocks: readonly (string | undefined)[],
): { density: JmDensity | undefined; head: FormatHead | undefined }[] {
  const st: PrefixState = { caretChar: "^", tildeChar: "~", delimiterChar: "," };
  let carried: JmDensity | undefined;
  return blocks.map((block) => {
    if (block === undefined) return { density: carried, head: undefined };
    const { density: headDensity, head } = scanBlockHead(block, st, true);
    if (headDensity !== undefined) carried = headDensity;
    return { density: carried, head };
  });
}

/** Whether the stream ever opens a format, plus the density its leading ^JM
 *  declares when it never does: a ^JM latches only in a real wrapper-less body,
 *  with an ^XA anywhere ahead it is a preamble the lookahead never reads. */
export function scanBareStream(
  zpl: string,
  chars: { caretChar: string; tildeChar: string },
  delimiter: string,
): { hasXa: boolean; density: JmDensity | undefined } {
  let density: JmDensity | undefined;
  let inHead = true;
  const st: PrefixState = { caretChar: chars.caretChar, tildeChar: chars.tildeChar, delimiterChar: delimiter };
  for (const t of headTokens(zpl, 0, st)) {
    if (t.cmd === "XA") return { hasXa: true, density: undefined };
    if (t.cmd === "FS" || t.cmd === "XZ") { inHead = false; continue; }
    if (!inHead || t.cmd !== "JM" || !t.isCaret) continue;
    density = jmDensityOf(t.rest, t.delim) ?? density;
  }
  return { hasXa: false, density };
}

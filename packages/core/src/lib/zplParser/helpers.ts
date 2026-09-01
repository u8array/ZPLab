import type { LabelObject } from "../../types/Group";
import { isZplRotation, type ZplRotation } from "../../registry/rotation";
import { opensImmediateCommand } from "../zplImmediate";

import { newId } from "../ids";
import { NON_LATIN1_RE } from "../binaryText";
/** Validated ZplRotation or `fallback` (default 'N'). */
export function readRotation(
  raw: string | undefined,
  fallback: ZplRotation = "N",
): ZplRotation {
  return raw && isZplRotation(raw) ? raw : fallback;
}

/** ^FO/^FT z-justification: explicit 0/1 wins, an omitted z falls back to the
 *  ^FW default (spec p.201/205); 2 (auto) has no fixed geometry, treated as L. */
export function readJustify(raw: string | undefined, fallback: "L" | "R"): "L" | "R" {
  const z = raw?.trim();
  if (z === "1") return "R";
  if (z === "0" || z === "2") return "L";
  return fallback;
}

/** Validate ^GB/^GC/^GD/^GE colour char; default "B" per spec. */
export function readColor(raw: string | undefined): "B" | "W" {
  return raw === "W" ? "W" : "B";
}

/** First non-space char, upper-cased; single-char enum handlers. */
export function firstChar(rest: string): string {
  return (rest.trim()[0] ?? "").toUpperCase();
}

/** Accepts a ^CC/^CT/^CD remap char only if it's printable, non-DEL, and
 *  distinct from both other role chars (a collision would collapse a
 *  prefix/delimiter boundary). Shared with the ^JM head scan so both agree on effective remaps. */
export function acceptsPrefixRemap(
  char: string | undefined,
  roleA: string,
  roleB: string,
): char is string {
  return !!char && char > " " && char !== "\x7F" && char !== roleA && char !== roleB;
}

/** Live command-prefix and delimiter chars; the tokenizer reads these on
 *  every scan so ^CC/^CT/^CD mutations take effect on the next command. */
export interface TokenizerChars {
  caretChar: string;
  tildeChar: string;
  delimiterChar: string;
}

/** Raw-binary payload commands: header slots before data, format/count slot
 *  indices, `formats` = letters whose count is the transmitted byte count
 *  (^GF b: B and C, p.215; ~DY t is the decompressed size for C, p.182). */
const BINARY_PAYLOAD_SPECS: Record<
  string,
  { params: number; format: number; count: number; formats: readonly string[] }
> = {
  GF: { params: 4, format: 0, count: 1, formats: ["B", "C"] },
  DY: { params: 5, format: 1, count: 3, formats: ["B"] },
};

/** Sanity cap on the header span scanned for delimiters; real headers are a
 *  path plus a few numerics, so a longer span means delimiter-less junk. */
const BINARY_HEADER_CAP = 128;

const UNSAFE_PAYLOAD_RE = /[^ -~]/;

export interface UnsafeRawFieldSpan extends BinaryPayloadSpan {
  start: number;
}

/** Byte-counted raw fields (^CC/^CT/^CD threaded like the parser) whose
 *  counted payload cannot survive a UTF-8 decode collapse, CRLF
 *  normalization, or a verbatim overlay replay. */
export function unsafeRawFieldSpans(text: string): UnsafeRawFieldSpan[] {
  const st: TokenizerChars = { caretChar: "^", tildeChar: "~", delimiterChar: "," };
  const spans: UnsafeRawFieldSpan[] = [];
  for (const t of tokenize(text, st)) {
    const arg = t.rest[0];
    if (t.cmd === "CC") { if (acceptsPrefixRemap(arg, st.tildeChar, st.delimiterChar)) st.caretChar = arg; continue; }
    if (t.cmd === "CT") { if (acceptsPrefixRemap(arg, st.caretChar, st.delimiterChar)) st.tildeChar = arg; continue; }
    if (t.cmd === "CD") { if (acceptsPrefixRemap(arg, st.caretChar, st.tildeChar)) st.delimiterChar = arg; continue; }
    if (t.cmd !== "GF" && t.cmd !== "DY") continue;
    const span = binaryPayloadEnd(text, t.cmd, t.start + 3, st.delimiterChar);
    if (!span) continue;
    const payload = text.slice(span.dataStart, span.end);
    // Chars above 0xFF (paste path) have no byte truth left to wrap; the
    // verbatim string is the only faithful preserve (see preserveGfData).
    if (UNSAFE_PAYLOAD_RE.test(payload) && !NON_LATIN1_RE.test(payload)) {
      spans.push({ start: t.start, ...span });
    }
  }
  return spans;
}

export interface BinaryPayloadSpan {
  dataStart: number;
  end: number;
  /** Slot bounds of the format letter, for a text-safe transcode. */
  formatStart: number;
  formatEnd: number;
  format: "B" | "C";
}

/** Data span of a byte-counted raw binary payload; null keeps the
 *  prefix-scan boundary (ASCII formats, wrappers, broken headers, and a
 *  count past the end of input, where the device would sit waiting). */
function binaryPayloadEnd(
  zpl: string,
  cmd: string,
  restStart: number,
  delimiter: string,
): BinaryPayloadSpan | null {
  const spec = BINARY_PAYLOAD_SPECS[cmd];
  if (!spec) return null;
  const params: string[] = [];
  let p = restStart;
  let formatStart = restStart;
  let formatEnd = restStart;
  for (let n = 0; n < spec.params; n++) {
    const next = zpl.indexOf(delimiter, p);
    if (next === -1 || next - restStart > BINARY_HEADER_CAP) return null;
    params.push(zpl.slice(p, next));
    if (n === spec.format) {
      formatStart = p;
      formatEnd = next;
    }
    p = next + 1;
  }
  const format = params[spec.format]?.trim().toUpperCase();
  if ((format !== "B" && format !== "C") || !spec.formats.includes(format)) return null;
  // Only genuine wrappers opt out; a raster whose first byte is ":" must
  // still be read byte-counted. parseGfWrapper trims, so skip whitespace too.
  let q = p;
  while (q < zpl.length && /\s/.test(zpl[q] ?? "")) q++;
  if (zpl.startsWith(":B64:", q) || zpl.startsWith(":Z64:", q)) return null;
  const count = Number.parseInt(params[spec.count] ?? "", 10);
  if (count <= 0 || Number.isNaN(count)) return null;
  const end = p + count;
  return end <= zpl.length ? { dataStart: p, end, formatStart, formatEnd, format } : null;
}

/** Command-name alphabet: a prefix char outside it can never be part of a
 *  name, so hitting one inside the name slots means the command is broken.
 *  An alphanumeric prefix remapped via ^CC stays ambiguous and is left to
 *  the plain two-char read (`AA0` = prefix A + name A0). */
const NAME_CHAR_RE = /[0-9A-Za-z@]/;

/** Commands whose rest is a free-text payload: a tilde inside it ends the
 *  field only when it opens a real immediate command (see zplImmediate.ts). */
const PAYLOAD_CMDS = new Set(["FD", "FV", "FX"]);

const LETTER_RE = /[A-Za-z]/;

/** Stream tokens incrementally so ^CC/^CT changes mid-parse apply to
 *  subsequent commands. The caller passes a live ref (typically
 *  `s.format`) whose `caretChar`/`tildeChar` may be mutated between
 *  iterations. */
export function* tokenize(
  zpl: string,
  chars: TokenizerChars,
): Generator<{ cmd: string; rest: string; start: number; end: number }> {
  // Between commands, any letter after a tilde is read as a command name so
  // unknown ~XX junk still surfaces in the import report; a tilde before a
  // non-letter is data (e.g. `~1`, a ^BX FNC1 escape).
  const isCmdStart = (i: number): boolean => {
    const ch = zpl[i];
    if (ch === chars.caretChar) return true;
    if (ch !== chars.tildeChar) return false;
    return LETTER_RE.test(zpl[i + 1] ?? "");
  };
  const isCmdStartInPayload = (i: number): boolean => {
    const ch = zpl[i];
    if (ch === chars.caretChar) return true;
    if (ch !== chars.tildeChar) return false;
    return opensImmediateCommand(zpl.slice(i + 1, i + 3));
  };
  let pos = 0;
  while (pos < zpl.length) {
    let cmdStart = -1;
    for (let i = pos; i < zpl.length; i++) {
      if (isCmdStart(i)) {
        cmdStart = i;
        break;
      }
    }
    if (cmdStart === -1 || cmdStart + 3 > zpl.length) return;
    // A non-name prefix char inside the two-char command name means the
    // command is incomplete: discard the fragment and resync at that prefix.
    // The +1 shape is what ZebraDesigner's `CT~~CD,` preamble relies on;
    // +2 keeps a stray `~` from eating the next command.
    const isResyncPoint = (c: string | undefined): c is string =>
      c !== undefined &&
      (c === chars.caretChar || c === chars.tildeChar) &&
      !NAME_CHAR_RE.test(c);
    if (isResyncPoint(zpl[cmdStart + 1])) {
      pos = cmdStart + 1;
      continue;
    }
    if (isResyncPoint(zpl[cmdStart + 2])) {
      pos = cmdStart + 2;
      continue;
    }
    const cmd = zpl.slice(cmdStart + 1, cmdStart + 3).toUpperCase();
    // ^CC/^CT/^CD take exactly one argument character; everything after
    // it belongs to the next command (using the new prefix if the handler
    // mutates it). Generic commands consume rest until the next delimiter.
    if (cmd === "CC" || cmd === "CT" || cmd === "CD") {
      const argChar = zpl[cmdStart + 3] ?? "";
      // Clamp: the arg slot may be missing at EOF, and `end` must stay a
      // valid slice index.
      pos = Math.min(cmdStart + 4, zpl.length);
      yield { cmd, rest: argChar, start: cmdStart, end: pos };
      continue;
    }
    const bin = binaryPayloadEnd(zpl, cmd, cmdStart + 3, chars.delimiterChar);
    if (bin !== null) {
      pos = bin.end;
      yield { cmd, rest: zpl.slice(cmdStart + 3, bin.end), start: cmdStart, end: bin.end };
      continue;
    }
    const boundary = PAYLOAD_CMDS.has(cmd) ? isCmdStartInPayload : isCmdStart;
    let endPos = zpl.length;
    for (let i = cmdStart + 3; i < zpl.length; i++) {
      if (boundary(i)) {
        endPos = i;
        break;
      }
    }
    pos = endPos;
    // `end` is exclusive: the index where the next command's prefix begins (or
    // end of input), so source.slice(start, end) is this token's verbatim text.
    yield { cmd, rest: zpl.slice(cmdStart + 3, endPos), start: cmdStart, end: endPos };
  }
}

export function int(s: string | undefined, fallback = 0): number {
  const n = Number.parseInt(s ?? "", 10);
  return Number.isNaN(n) ? fallback : n;
}

/** Optional-form of the dot-quantity reader. Returns undefined when
 *  the param is missing/NaN. `parseFloat` is load-bearing: ^MUI/^MUM
 *  admits fractional unit values (`^FO0.5,0.5` = half an inch);
 *  `parseInt` would silently truncate to 0. */
export function intDotsOrUndef(
  s: string | undefined,
  unitScale: number,
): number | undefined {
  const n = Number.parseFloat(s ?? "");
  if (Number.isNaN(n)) return undefined;
  return Math.round(n * unitScale);
}

/** Read a dot-quantity, applying the active ^MU `a`-slot multiplier.
 *  Use at every site the spec documents as "dots"; non-dot params
 *  (rotation, mode, counts) stay on plain `int`. */
export function intDots(
  s: string | undefined,
  unitScale: number,
  fallback = 0,
): number {
  return intDotsOrUndef(s, unitScale) ?? fallback;
}

/** Bind `intDots`/`intDotsOrUndef` to a parser state's live unit scale, so
 *  handler factories don't each rebuild the same closures. Reads
 *  `state.format.unitScale` at call time: load-bearing, since ^MU mid-format
 *  mutation and the ^XA ^JM lookahead both land before any read. */
export function dotsFor(state: { format: { unitScale: number } }): {
  dots: (raw: string | undefined, fb?: number) => number;
  dotsOrUndef: (raw: string | undefined) => number | undefined;
} {
  return {
    dots: (raw, fb = 0) => intDots(raw, state.format.unitScale, fb),
    dotsOrUndef: (raw) => intDotsOrUndef(raw, state.format.unitScale),
  };
}

/** Returns v if within [r.min, r.max], else undefined. */
export function inRange(v: number | undefined, r: { min: number; max: number }): number | undefined {
  return v !== undefined && v >= r.min && v <= r.max ? v : undefined;
}

/** Trim + uppercase for case-insensitive enum match. */
export function strParam(s: string | undefined): string {
  return (s ?? "").trim().toUpperCase();
}

export function makeObj(
  type: string,
  x: number,
  y: number,
  props: unknown,
  positionType?: "FO" | "FT",
  comment?: string,
): LabelObject {
  return {
    id: newId(),
    type,
    x,
    y,
    rotation: 0,
    positionType,
    comment,
    props,
  } as unknown as LabelObject;
}

/** Convert an imported graphic anchor to the model's top-left. `^FT` anchors a
 *  bottom corner (spec p.205): bottom-left, or bottom-right (z=1) when justify
 *  is "R". Lift by the height and, for "R", shift left by the width. `^FO` is
 *  already top-left. Mirrors the generator's {@link graphicAnchor}. */
export function ftTopLeft(
  x: number,
  y: number,
  w: number,
  h: number,
  positionType: "FO" | "FT",
  justify: "L" | "R",
): { x: number; y: number } {
  if (positionType !== "FT") return { x, y };
  return { x: justify === "R" ? x - w : x, y: y - h };
}

/** Derive a Variable name from a `^FX` comment that landed just before
 *  the `^FN`. Strips well-known prefixes (`Field:`, `Variable:`, `Var:`)
 *  so "Field: Customer Name" becomes `Customer_Name`. Returns null when
 *  the comment is missing or sanitises to empty. */
export function variableNameFromComment(comment: string | undefined): string | null {
  if (!comment) return null;
  const cleaned = comment
    .replace(/^\s*(field|variable|var)\s*[:-]\s*/i, "")
    .trim()
    .replace(/\s+/g, "_");
  return cleaned === "" ? null : cleaned;
}

/** ^CI N → TextDecoder label; unsupported variants fall back to UTF-8. */
export function ciToEncoding(n: number): { label: string; supported: boolean } {
  if (n === 28) return { label: "utf-8", supported: true };
  if (n === 27) return { label: "windows-1252", supported: true };
  if (n >= 0 && n <= 13) return { label: "windows-1252", supported: true };
  return { label: "utf-8", supported: false };
}

const decoderCache = new Map<string, TextDecoder>();
export function getDecoder(label: string): TextDecoder {
  let dec = decoderCache.get(label);
  if (!dec) {
    dec = new TextDecoder(label);
    decoderCache.set(label, dec);
  }
  return dec;
}

/** ^FH hex escapes → decoded string; contiguous pairs collect for multi-byte glyphs. */
export function decodeFH(
  text: string,
  delimiter: string,
  decoder: TextDecoder,
): string {
  const escaped = delimiter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const runRe = new RegExp(`(?:${escaped}[0-9A-Fa-f]{2})+`, "g");
  const stride = delimiter.length + 2;
  return text.replace(runRe, (run) => {
    const bytes = new Uint8Array(run.length / stride);
    for (let i = 0, b = 0; i < run.length; i += stride, b++) {
      bytes[b] = parseInt(run.slice(i + delimiter.length, i + stride), 16);
    }
    return decoder.decode(bytes);
  });
}

/** Scanned, not regex-matched: the old pattern backtracked cubically on long break runs. */
export function stripLineWrap(rest: string): string {
  const kept = rest.trimEnd().length;
  const nl = rest.slice(kept).search(/[\r\n]/);
  return nl === -1 ? rest : rest.slice(0, kept + nl);
}

/** Trailing horizontal whitespace of the last parameter, same reasoning. */
export function stripTrailingSpaces(value: string): string {
  let end = value.length;
  while (end > 0 && WS_NOT_BREAK_RE.test(value[end - 1] ?? "")) end--;
  return end === value.length ? value : value.slice(0, end);
}

const WS_NOT_BREAK_RE = /[^\S\r\n]/;

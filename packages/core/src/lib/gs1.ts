/**
 * GS1 domain helpers: AI catalog, segment parse/serialize, validation, and
 * check digits. Shared between the GS1 content builder, ZPL generation, and
 * bwip-js content prep. Pure, no UI.
 *
 * Element-string truth (verified via a GS1 decoder against bwip-js): the
 * human-readable `(01)…(10)…` parentheses are display-only; the encoded data
 * stream separates a VARIABLE-length AI from the next AI with a GS character
 * (0x1d). Fixed-length AIs need no separator. The last AI never gets one.
 */

import { GS1_AI_FULL_CATALOG } from "./gs1AiCatalog";
import { hasTemplateMarkers } from "./fnTemplate";
import { clockBodyLength } from "./fcTemplate";
import type { Variable } from "../types/Variable";
import type {
  Gs1AiCatalogEntry,
  Gs1AiKind,
  Gs1AiGroup,
  Gs1AiLinter,
} from "./gs1AiCatalog.types";

/** Group-separator: the FNC1 separator after a non-last variable-length AI. */
export const GS1_GS = "\x1d";

/** Symbologies that accept free-form AI content (Expanded, Expanded Stacked). */
export const GS1_DATABAR_EXPANDED_SYMBOLOGIES: ReadonlySet<number> = new Set([6, 7]);

/** Spec-maximum segments-per-row for ^BR Expanded Stacked (must be even, 2–22). */
export const GS1_DATABAR_DEFAULT_SEGMENTS = 22;

export type Gs1Kind = Gs1AiKind;
export type Gs1Group = Gs1AiGroup;

/** Resolved AI spec (a concrete AI, decimal ranges already expanded). Derived
 *  from the generated catalog; `decimalPlaces` is set only for `decimal` AIs. */
export interface Gs1AiSpec {
  ai: string;
  kind: Gs1Kind;
  /** Data length: exact for fixed kinds, maximum for variable kinds. */
  len: number;
  /** Mod-10 check digit is part of the (numeric) data. */
  checkDigit?: boolean;
  group: Gs1Group;
  /** Short EN title from the catalog; the builder localizes common AIs on top. */
  title: string;
  /** Implied decimal position (the AI's 4th digit) for `decimal` measure AIs. */
  decimalPlaces?: number;
  /** Value-shape linters from the dictionary; see {@link Gs1AiLinter}. */
  linters?: readonly Gs1AiLinter[];
  /** Date AIs: DD=00 ("whole month") permitted (dict flavor yymmd0). */
  day00?: boolean;
  /** Mandatory associations (alternatives of AI conjunctions, 'n' wildcards). */
  req?: readonly (readonly string[])[];
  /** AIs / 'n'-wildcard patterns invalid alongside this AI in one symbol. */
  ex?: readonly string[];
}

/** A built GS1 element: an AI plus its (unwrapped) data value. */
export interface Gs1Segment {
  ai: string;
  value: string;
}

export function isVariableKind(kind: Gs1Kind): boolean {
  return kind === "varNum" || kind === "varAlnum";
}

/** Runtime index over the full catalog. Range AIs (`3100-3105`, `91-99`) expand
 *  to concrete AIs, a decimal family's 4th digit being its implied decimal
 *  position; multi-component AIs are omitted (only their primary field is
 *  modeled, so they must not be builder-entered or matched during raw parsing). */
const AI_BY_CODE: ReadonlyMap<string, Gs1AiSpec> = (() => {
  const map = new Map<string, Gs1AiSpec>();
  const add = (e: Gs1AiCatalogEntry, ai: string, decimalPlaces?: number) => {
    map.set(ai, {
      ai, kind: e.kind, len: e.len, group: e.group, title: e.title,
      ...(e.checkDigit ? { checkDigit: true } : {}),
      ...(e.linters ? { linters: e.linters } : {}),
      ...(e.day00 ? { day00: true } : {}),
      ...(e.req ? { req: e.req } : {}),
      ...(e.ex ? { ex: e.ex } : {}),
      ...(decimalPlaces !== undefined ? { decimalPlaces } : {}),
    });
  };
  for (const e of GS1_AI_FULL_CATALOG) {
    if (e.multiComponent) continue;
    const range = /^(\d+)-(\d+)$/.exec(e.ai);
    const lo = range?.[1];
    const hi = range?.[2];
    if (lo && hi) {
      const hiN = Number(hi);
      for (let n = Number(lo); n <= hiN; n++) {
        add(e, String(n).padStart(lo.length, "0"), e.kind === "decimal" ? n % 10 : undefined);
      }
    } else {
      add(e, e.ai);
    }
  }
  return map;
})();

/** AI codes longest-first, so raw parsing matches 4/3-digit AIs before 2-digit. */
const AI_CODES_BY_LEN: readonly string[] = [...AI_BY_CODE.keys()].sort((a, b) => b.length - a.length);

/** All resolved specs (ranges expanded, multiComponent omitted); the palette
 *  module builds its group index from this. */
export const GS1_AI_SPECS: readonly Gs1AiSpec[] = [...AI_BY_CODE.values()];

export function aiSpec(ai: string): Gs1AiSpec | undefined {
  return AI_BY_CODE.get(ai);
}

/** Human-readable value of a `decimal` measure AI: the raw digits with the
 *  implied decimal point inserted `decimalPlaces` from the right (the point is
 *  encoded in the AI, not the data). `001500` @3 → `1.500`. Null when not a
 *  decimal AI or the value is not all digits. */
export function decimalValuePreview(ai: string, value: string): string | null {
  const spec = AI_BY_CODE.get(ai);
  if (spec?.kind !== "decimal" || spec.decimalPlaces === undefined) return null;
  if (!/^\d+$/.test(value)) return null;
  const d = spec.decimalPlaces;
  if (d === 0) return String(Number(value));
  const padded = value.padStart(d + 1, "0");
  const intPart = String(Number(padded.slice(0, -d)));
  return `${intPart}.${padded.slice(-d)}`;
}

/** GS1 mod-10 check digit (weights 3-1 from the right) for a numeric body. */
export function mod10CheckDigit(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const d = parseInt(body[body.length - 1 - i] ?? "0", 10);
    sum += d * (i % 2 === 0 ? 3 : 1);
  }
  return ((10 - (sum % 10)) % 10).toString();
}

/**
 * Pad to 13 digits and append the GTIN-14 check digit. Used for symbologies 1–5
 * where the user can supply a partial GTIN; bwip-js requires a fully-valid
 * 14-digit number, while Labelary completes it server-side.
 */
export function gtin14WithCheck(content: string): string {
  // A marker-bearing value must pass through verbatim: the digit strip and
  // check-digit math would destroy the «...» token.
  if (hasTemplateMarkers(content)) return content;
  let digits = content.replace(/\D/g, "");
  if (digits.startsWith("01") && digits.length > 14) digits = digits.slice(2);
  if (digits.length >= 14) return digits.slice(0, 14);
  const body = digits.padStart(13, "0");
  return body + mod10CheckDigit(body);
}

// CSET 82 minus parens: "(" / ")" are valid GS1 chars but make the bwip-js
// element string ambiguous (no escaping strategy yet), so the builder forbids
// them. Re-add once raw-GS1 / escaped input is wired.
const CSET82 = /^[0-9A-Za-z!"%&'*+,\-./:;<=>?_]*$/;
// CSET 39 (type-Y components, e.g. 8010 CPID): digits, uppercase, #, -, /.
const CSET39 = /^[0-9A-Z#\-/]*$/;
// base64url "filesafe" alphabet (type-Z components, 8030 DIGSIG).
const CSET64 = /^[A-Za-z0-9_-]*$/;

/** Charset check for an alnum value, honoring a cset39/cset64 override. */
function charsetOk(spec: Gs1AiSpec, value: string): boolean {
  if (spec.linters?.includes("cset39")) return CSET39.test(value);
  if (spec.linters?.includes("cset64")) return CSET64.test(value);
  return CSET82.test(value);
}

/** Char-class body (for a non-destructive input filter) of valid raw GS1
 *  Expanded content: CSET 82 (no parens) plus the GS separator. Hyphen last. */
export const GS1_EXPANDED_CHARSET = `0-9A-Za-z!"%&'*+,./:;<=>?_${GS1_GS}-`;

/** Valid GS1 seed (raw model form: AI 01 + a check-valid GTIN-14) used when a
 *  symbol switches into GS1 mode and its current content is not GS1, so the
 *  encoder renders a sample instead of throwing. */
export const GS1_SAMPLE_CONTENT = "0109501101530003";

/** 'n' is a digit wildcard in dictionary req/ex members (e.g. '31nn'). */
export function aiMatchesPattern(ai: string, pattern: string): boolean {
  if (ai.length !== pattern.length) return false;
  for (let i = 0; i < ai.length; i++) {
    const p = pattern[i];
    if (p === "n" ? !/\d/.test(ai[i] ?? "") : p !== ai[i]) return false;
  }
  return true;
}

/** Why adding `ai` would introduce a duplicate/ex conflict, or null when the
 *  addition is clean. Shares validateGs1Segments' tables; whole-set concerns
 *  stay with the validator: req rules and violations already inside
 *  `presentAis`, which the modal surfaces as its set error. */
export type Gs1AddBlock =
  | { kind: "duplicate" }
  | { kind: "excludedBy"; other: string };

export function gs1AddBlockReason(
  ai: string,
  presentAis: readonly string[],
): Gs1AddBlock | null {
  if (presentAis.includes(ai)) return { kind: "duplicate" };
  const spec = AI_BY_CODE.get(ai);
  for (const pattern of spec?.ex ?? []) {
    const other = presentAis.find((a) => aiMatchesPattern(a, pattern));
    if (other) return { kind: "excludedBy", other };
  }
  // ex pairings hit the validator regardless of which side declares them.
  for (const a of presentAis) {
    if (AI_BY_CODE.get(a)?.ex?.some((p) => aiMatchesPattern(ai, p))) {
      return { kind: "excludedBy", other: a };
    }
  }
  return null;
}

/** Set-level rule violation; `alternatives`/`other` feed the localized
 *  message's placeholders. */
export type Gs1SetError =
  | { key: "empty" | "duplicateAi" }
  | { key: "exclusiveAis"; ai: string; other: string }
  | { key: "missingRequired"; ai: string; alternatives: readonly (readonly string[])[] };

/** Set-level GS1 rule check; per-field errors are checked separately.
 *  `ex` pairings are always invalid inside one symbol, so they are enforced
 *  unconditionally (bwip rejects them on every symbology). `req` associations
 *  are defined across ALL carriers on the item (dictionary header), and bwip
 *  enforces them only on DataBar Expanded and GS1 DataMatrix (not GS1-128);
 *  `enforceReq` mirrors that, driven by GS1_REQ_ENFORCED_TYPES in
 *  gs1BuilderPalette.ts. */
export function validateGs1Segments(
  segments: readonly Gs1Segment[],
  enforceReq = false,
): Gs1SetError | null {
  if (segments.length === 0) return { key: "empty" };
  // bwip rejects a repeated AI with a differing value; the builder forbids any
  // duplicate AI (a same-value repeat is pointless here).
  const seen = new Set<string>();
  for (const s of segments) {
    if (seen.has(s.ai)) return { key: "duplicateAi" };
    seen.add(s.ai);
  }
  const ais = segments.map((s) => s.ai);
  for (const s of segments) {
    const spec = AI_BY_CODE.get(s.ai);
    for (const pattern of spec?.ex ?? []) {
      const other = ais.find((a) => a !== s.ai && aiMatchesPattern(a, pattern));
      if (other) return { key: "exclusiveAis", ai: s.ai, other };
    }
    if (enforceReq && spec?.req) {
      // Also enforced for requisites the builder can't add (8111 req=255):
      // the encoder rejects the pair anyway, so block here with the AI named
      // rather than failing later on the canvas.
      const satisfied = spec.req.some((alt) =>
        alt.every((member) => ais.some((a) => a !== s.ai && aiMatchesPattern(a, member))),
      );
      if (!satisfied) return { key: "missingRequired", ai: s.ai, alternatives: spec.req };
    }
  }
  return null;
}

/** Bare GTIN body for the non-Expanded symbologies (1-5): the (01) value if the
 *  content is multi-AI, else its digits. Used when switching away from Expanded
 *  so preview and ZPL agree instead of carrying stale multi-AI content. */
export function gtinBodyFromContent(content: string): string {
  const segs = parseGs1ToSegments(content);
  const gtin = segs?.find((s) => s.ai === "01");
  if (gtin) return gtin.value;
  // Unparseable fallback: strip a leading 01 AI prefix so the GTIN isn't
  // truncated with the prefix baked in.
  let digits = content.replace(/\D/g, "");
  if (digits.startsWith("01") && digits.length > 14) digits = digits.slice(2);
  return digits.slice(0, 14);
}

/**
 * Validate a segment's value for its AI. Returns a stable error key (for
 * localized messages) or null when valid. GTIN shorter than 14 is accepted
 * (the check digit is auto-completed downstream), so it returns null.
 */
export function validateGs1Segment(ai: string, value: string): string | null {
  return validateGs1SegmentImpl(ai, value);
}

/** Marker-aware verdict on the resolved value: a fixed-width AI must match
 *  the spec width exactly (no GTIN auto-completion for markers).
 *  emptyIsRuntimeValued: "" in a variable AI passes when true (authoring
 *  preview) but fails when false (per-row, where the resolved value IS the
 *  print value). Otherwise defers to validateGs1Segment. */
export function validateGs1SegmentResolved(
  ai: string,
  rawValue: string,
  resolved: string,
  emptyIsRuntimeValued = true,
): string | null {
  const spec = AI_BY_CODE.get(ai);
  if (!spec) return "unknownAi";
  const isMarker = hasTemplateMarkers(rawValue);
  if (isMarker && !hasTemplateMarkers(resolved)) {
    if (!isVariableKind(spec.kind) && resolved.length !== spec.len) return "exactLength";
  }
  if (emptyIsRuntimeValued && resolved === "" && isVariableKind(spec.kind) && isMarker) return null;
  return validateGs1SegmentImpl(ai, resolved);
}

function validateGs1SegmentImpl(ai: string, value: string): string | null {
  const spec = AI_BY_CODE.get(ai);
  if (!spec) return "unknownAi";
  if (value === "") return "empty";
  switch (spec.kind) {
    case "gtin": {
      if (!/^\d+$/.test(value)) return "digitsOnly";
      if (value.length > 14) return "tooLong";
      // A full 14-digit GTIN must carry a valid check digit; shorter input is
      // auto-completed downstream, so it is accepted here.
      if (value.length === 14 && mod10CheckDigit(value.slice(0, 13)) !== value[13]) return "checkDigit";
      return null;
    }
    case "fixedNum":
    case "decimal": {
      // Decimal measure AIs are a fixed 6-digit numeric field; the implied
      // decimal position lives in the AI, not the data, so it validates as fixed.
      if (!/^\d+$/.test(value)) return "digitsOnly";
      if (value.length !== spec.len) return "exactLength";
      if (spec.checkDigit && mod10CheckDigit(value.slice(0, -1)) !== value.slice(-1)) return "checkDigit";
      if (spec.linters?.includes("yesno") && value !== "0" && value !== "1") return "yesno";
      return null;
    }
    case "fixedAlnum": {
      if (!charsetOk(spec, value)) return "charset";
      if (value.length !== spec.len) return "exactLength";
      // Shape only; the real ISO 3166 list is left to the encoder.
      if (spec.linters?.includes("iso3166alpha2") && !/^[A-Z]{2}$/.test(value)) return "countryCode";
      return null;
    }
    case "date": {
      // Most date AIs are YYMMDD (len 6); a few (e.g. 7250 DOB) are YYYYMMDD
      // (len 8). The month/day live in the last 4 digits regardless of the year
      // width, so index from the end.
      if (value.length !== spec.len || !/^\d+$/.test(value)) return "dateFormat";
      const mm = Number(value.slice(-4, -2));
      const dd = Number(value.slice(-2));
      if (mm < 1 || mm > 12) return "dateMonth";
      // DD=00 ("whole month") only for yymmd0-flavored AIs; others need a real
      // day. Feb: exact leap check when the year is 4-digit, cap 29 for the
      // ambiguous-century YY form.
      if (dd === 0) return spec.day00 ? null : "dateDay";
      let maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1] ?? 31;
      if (mm === 2 && spec.len === 8) {
        const y = Number(value.slice(0, 4));
        if (!(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) maxDay = 28;
      }
      if (dd > maxDay) return "dateDay";
      return null;
    }
    case "varNum": {
      if (!/^\d+$/.test(value)) return "digitsOnly";
      if (value.length > spec.len) return "tooLong";
      return null;
    }
    case "varAlnum": {
      if (!charsetOk(spec, value)) return "charset";
      if (value.length > spec.len) return "tooLong";
      return null;
    }
  }
}

/** Escape a literal `>` in mode-D ^FD data; unescaped it reads as the >N
 *  invocation prefix. */
export function escapeGs1FdValue(value: string): string {
  return value.replaceAll(">", ">0");
}

/** Inverse of escapeGs1FdValue: >0 only. Leaves >8 / GS / subset invocations
 *  untouched so a foreign payload stays byte-stable. */
export function unescapeGs1FdValue(value: string): string {
  return value.replaceAll(">0", ">");
}

/** Typed `(AI)value…` parts, or null when the content is not entirely in that
 *  shape. The AIs are not checked against the catalog: a carrier that only
 *  needs the parentheses gone can work without it. */
export function typedGs1Shape(content: string): { ai: string; value: string }[] | null {
  const parts = [...content.matchAll(/\(([0-9]{2,4})\)([^(]*)/g)];
  if (parts.length === 0) return null;
  const covered = parts.reduce((n, m) => n + m[0].length, 0);
  return covered === content.length
    ? parts.map((m) => ({ ai: m[1] ?? "", value: m[2] ?? "" }))
    : null;
}

/** Typed parts whose AIs the catalog all carries, which is what deciding FNC1
 *  placement needs. */
export function typedGs1Parts(content: string): { ai: string; value: string }[] | null {
  const parts = typedGs1Shape(content);
  return parts?.every((p) => aiSpec(p.ai) !== undefined) ? parts : null;
}

/** Emits a typed part's value, completing a literal GTIN so binding another part does not ship a bare AI-01. */
export function typedSegmentValue(ai: string, value: string): string {
  if (aiSpec(ai)?.kind !== "gtin") return value;
  return /^[0-9]+$/.test(value) ? gtin14WithCheck(value) : value;
}

/** Typed content with its literal GTINs completed, for the carriers that ship
 *  the `(AI)value` form as written (^BC mode D). Null when the content is not
 *  in the typed form. */
export function completeTypedGtins(content: string): string | null {
  const parts = typedGs1Parts(content);
  if (!parts) return null;
  return parts.map((p) => `(${p.ai})${typedSegmentValue(p.ai, p.value)}`).join("");
}

/** Segment value as emitted, on the same rule the typed path uses: a GTIN gets
 *  completed only when it IS digits, so a value the parser could not structure
 *  (trailing text, a marker) reaches the symbol instead of being stripped. */
function segmentValue(s: Gs1Segment): string {
  return typedSegmentValue(s.ai, s.value);
}

/** A variable-length AI that is not the last segment needs a trailing FNC1
 *  separator (GS in raw content, >8 in ZPL) so the next AI isn't absorbed. */
function needsSeparator(s: Gs1Segment, index: number, count: number): boolean {
  const spec = AI_BY_CODE.get(s.ai);
  return !!spec && isVariableKind(spec.kind) && index < count - 1;
}

/** Element string `(01)…(10)…` for display and bwip-js input. GTIN values are
 *  completed to 14 digits so bwip-js accepts them. */
export function segmentsToElementString(segments: readonly Gs1Segment[]): string {
  return segments.map((s) => `(${s.ai})${segmentValue(s)}`).join("");
}

/** ZPL ^BC mode-D field data. Mode D auto-inserts only the LEADING FNC1
 *  (Labelary-decoded), so a >8 after each non-final variable AI is required or
 *  the next AI is read as value; a literal `>` escapes to >0. */
export function segmentsToZplFd(segments: readonly Gs1Segment[]): string {
  return segments
    .map((s, i) => `(${s.ai})${escapeGs1FdValue(segmentValue(s))}` +
      (needsSeparator(s, i, segments.length) ? ">8" : ""))
    .join("");
}


/** Undo the ^FD invocations on import: strip FNC1 markers (the parens already
 *  delimit segments) and unescape literal `>`. Order matters: `>08` is an
 *  escaped `>` followed by a data `8`, not an FNC1. */
export function zplFdToGs1Input(raw: string): string {
  return raw.replaceAll(">8", "").replaceAll(GS1_GS, "").replaceAll(">0", ">");
}

/** Canonical model content from a mode-D ^FD payload, or null (caller keeps
 *  it verbatim). Parens delimit segments, so >8 is stripped there; in the raw
 *  form >8 IS the separator and maps to GS. */
export function zplFdToModelContent(raw: string): string | null {
  if (raw.startsWith("(")) return elementStringToContent(zplFdToGs1Input(raw));
  const content = unescapeGs1FdValue(raw.replaceAll(">8", GS1_GS));
  const segs = parseGs1ToSegments(content);
  return segs && segs.length > 0 ? segmentsToContent(segs) : null;
}

/** Raw model `content`: AI+value concatenated, with a GS separator after a
 *  variable-length AI that is not the last segment. GTIN completed to 14. */
export function segmentsToContent(segments: readonly Gs1Segment[]): string {
  return segments
    .map((s, i) => s.ai + segmentValue(s) +
      (needsSeparator(s, i, segments.length) ? GS1_GS : ""))
    .join("");
}

/** AI code present at `pos`, longest match first, or null. */
function matchAiAt(content: string, pos: number): string | null {
  for (const code of AI_CODES_BY_LEN) {
    if (content.startsWith(code, pos)) return code;
  }
  return null;
}

/**
 * Parse model `content` (parenthesized OR raw with GS separators) into segments,
 * or null when it is not cleanly GS1 (caller falls back to free-text editing,
 * never corrupting the content). Variable AIs end at a GS char or the next AI's
 * boundary cannot be assumed, so unseparated variable runs return null.
 */
/** End index of a fixed-length AI value that may contain markers, or null when
 *  the resolved width can't hit `targetLen` exactly. Clock markers count at
 *  their fixed token width, variable markers at their default value's length,
 *  literals at one. Markers are atomic (never split across the boundary). */
function fixedFieldEnd(
  content: string,
  start: number,
  targetLen: number,
  varLen: Map<string, number>,
): number | null {
  const marker = /«([^»]+)»/y;
  let pos = start;
  let len = 0;
  while (len < targetLen) {
    if (pos >= content.length) return null;
    marker.lastIndex = pos;
    const m = marker.exec(content);
    if (m) {
      const body = m[1] ?? "";
      len += clockBodyLength(body) ?? varLen.get(body) ?? m[0].length;
      pos = marker.lastIndex;
    } else {
      len += 1;
      pos += 1;
    }
  }
  return len === targetLen ? pos : null;
}

export function parseGs1ToSegments(
  content: string,
  /** When given, fixed-length values may carry «marker»s counted at their
   *  resolved width (builder round-trip); imports parse without. */
  variables?: readonly Variable[],
): Gs1Segment[] | null {
  if (content === "") return [];
  // Element-string form only when it starts with "("; a "(" inside a varAlnum
  // value (valid CSET 82) must not flip raw content into parens parsing.
  if (content.startsWith("(")) {
    const segs: Gs1Segment[] = [];
    const re = /\((\d{2,4})\)([^(]*)/g;
    let m: RegExpExecArray | null;
    let consumed = 0;
    while ((m = re.exec(content)) !== null) {
      if (m.index !== consumed) return null;
      const ai = m[1] ?? "";
      if (!AI_BY_CODE.has(ai)) return null;
      segs.push({ ai, value: m[2] ?? "" });
      consumed = re.lastIndex;
    }
    return consumed === content.length && segs.length > 0 ? segs : null;
  }
  const segs: Gs1Segment[] = [];
  // Default lengths for marker-width slicing in fixed fields (builder mode).
  const varLen = new Map((variables ?? []).map((v) => [v.name, v.defaultValue.length]));
  let pos = 0;
  while (pos < content.length) {
    const ai = matchAiAt(content, pos);
    if (!ai) return null;
    const spec = AI_BY_CODE.get(ai);
    if (!spec) return null;
    pos += ai.length;
    if (isVariableKind(spec.kind)) {
      const gs = content.indexOf(GS1_GS, pos);
      const end = gs === -1 ? content.length : gs;
      segs.push({ ai, value: content.slice(pos, end) });
      pos = gs === -1 ? end : gs + 1;
    } else if (variables !== undefined && hasTemplateMarkers(content.slice(pos))) {
      // Builder mode: a fixed field may carry markers (clock composed to the
      // field width, or a variable whose default fills it). Slice by resolved
      // width so it round-trips exactly, or bail to free-text fallback.
      const end = fixedFieldEnd(content, pos, spec.len, varLen);
      if (end === null) return null;
      segs.push({ ai, value: content.slice(pos, end) });
      pos = end;
    } else {
      const value = content.slice(pos, pos + spec.len);
      if (value.length !== spec.len || value.includes("«")) return null;
      segs.push({ ai, value });
      pos += spec.len;
    }
  }
  return segs.length > 0 ? segs : null;
}

/**
 * If `raw` is a pasted element string `(AI)…(AI)…` (whitespace tolerated), parse
 * it and return the raw model content with GS separators; otherwise null. Lets
 * the input accept pasted GS1 notation instead of silently stripping the parens.
 */
export function elementStringToContent(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("(")) return null;
  const segs = parseGs1ToSegments(trimmed);
  return segs ? segmentsToContent(segs) : null;
}

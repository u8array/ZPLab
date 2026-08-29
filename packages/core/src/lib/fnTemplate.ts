import { markerOf, markerRe, type Variable } from "../types/Variable";
import { isControlBody } from "../types/controlKey";
import { clockBodyLength } from "./fcTemplate";

// ^FE embeds (#n#) <-> «name» markers. Recognition grammar lives in
// types/Variable next to markerOf so the two can't drift.

/** Replace every `«name»` marker with a literal `replacement` (identity-
 *  preserving on no match). Used when a variable is deleted so its template
 *  fields keep the last-known value as literal text, not an orphan marker. */
export function substituteTemplateMarker(
  content: string,
  name: string,
  replacement: string,
): string {
  let touched = false;
  const next = content.replace(markerRe(), (full, n: string) => {
    if (n !== name) return full;
    touched = true;
    return replacement;
  });
  return touched ? next : content;
}

/** Identity-preserving on no-match. */
export function renameTemplateMarker(
  content: string,
  oldName: string,
  newName: string,
): string {
  if (oldName === newName) return content;
  let touched = false;
  const next = content.replace(markerRe(), (full, name: string) => {
    if (name !== oldName) return full;
    touched = true;
    return markerOf(newName);
  });
  return touched ? next : content;
}

/** Rename many markers in ONE pass, looking each up against the ORIGINAL name.
 *  Order-independent and collision-safe: a swap (`a→b`, `b→a`) or chain can't
 *  cascade the way sequential single renames would. Identity on no match. */
export function renameTemplateMarkers(
  content: string,
  renames: ReadonlyMap<string, string>,
): string {
  if (renames.size === 0) return content;
  let touched = false;
  const next = content.replace(markerRe(), (full, name: string) => {
    const to = renames.get(name);
    if (to === undefined) return full;
    touched = true;
    return markerOf(to);
  });
  return touched ? next : content;
}

/** True when `content` carries at least one `«…»` marker. */
export function hasTemplateMarkers(content: string): boolean {
  return markerRe().test(content);
}


/** Printed length of `content` with markers resolved: a variable marker
 *  inherits its defaultValue's length, a clock marker its fixed token width,
 *  and an unknown marker counts as its literal characters (matching emit,
 *  where unresolved markers stay literal). A control-key chip counts one byte
 *  only when `ctrlAsByte` (the field's emitter resolves chips); elsewhere it
 *  stays literal at emit and counts its full marker text. */
export function resolvedContentLength(
  content: string,
  variables: readonly Variable[],
  ctrlAsByte = false,
): number {
  const byName = new Map(variables.map((v) => [v.name, v.defaultValue.length]));
  let len = 0;
  let last = 0;
  for (const m of content.matchAll(markerRe())) {
    len += (m.index ?? 0) - last;
    const body = m[1] ?? "";
    len += clockBodyLength(body)
      ?? (ctrlAsByte && isControlBody(body) ? 1 : undefined)
      ?? byName.get(body)
      ?? m[0].length;
    last = (m.index ?? 0) + m[0].length;
  }
  return len + (content.length - last);
}

/** A length cap truncates only a purely-literal payload: cutting around a
 *  marker would split the atomic `«…»` token. Marker-aware enforcement is
 *  the insert gate's job (literalInsertRoom). */
export function capLiteralLength(value: string, maxLength: number | undefined): string {
  if (maxLength === undefined || hasTemplateMarkers(value)) return value;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/** Characters of `insertion` that may replace `selection` inside `value`
 *  under a length cap, with markers counted at their resolved width. An
 *  insertion carrying a marker is atomic: it fits whole (`Infinity`) or not
 *  at all (0). */
export function literalInsertRoom(
  value: string,
  selection: string,
  maxLength: number | undefined,
  variables: readonly Variable[],
): number {
  if (maxLength === undefined) return Infinity;
  // The value's existing markers count at their resolved width; the pasted
  // insertion is plain text (a marker in it is literal, not an atomic token).
  const base = resolvedContentLength(value, variables) - resolvedContentLength(selection, variables);
  return Math.max(0, maxLength - base);
}

/** Apply `fn` to literal spans only, passing `«…»` markers through verbatim:
 *  an atomic token must survive to print-time substitution unchanged. Marker
 *  bodies are opaque; a variable name containing an encoding delimiter is not
 *  defended against. */
export function mapLiteralSpans(content: string, fn: (literal: string) => string): string {
  let out = "";
  let last = 0;
  for (const m of content.matchAll(markerRe())) {
    out += fn(content.slice(last, m.index ?? 0)) + m[0];
    last = (m.index ?? 0) + m[0].length;
  }
  return out + fn(content.slice(last));
}

/** Source order with duplicates (caller dedupes). */
export function extractTemplateRefs(content: string): string[] {
  return [...content.matchAll(markerRe())]
    .map((m) => m[1])
    .filter((n): n is string => n !== undefined);
}

/** Unresolved markers stay literal. */
export function resolveTemplateMarkers(
  content: string,
  resolve: (name: string) => string | undefined,
): string {
  return content.replace(markerRe(), (full, name: string) => {
    const v = resolve(name);
    return v !== undefined ? v : full;
  });
}

/** The one grammar for `#n#` / `#n,a,x,y#` embeds (spec p.191); group 2 is
 *  the substring-insert range. The parser's bootstrap scan and the marker
 *  substitution both read it, so they cannot disagree on what an embed is. */
export function embedPattern(embedChar: string): RegExp {
  const e = embedChar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${e}(\\d+)(,[^${e}]*)?${e}`, "g");
}

/** Unknown FN numbers stay literal; substring slice args dropped (lossy,
 *  reported by the parser as partial ^FE). */
export function embedsToMarkers(
  payload: string,
  embedChar: string,
  fnToName: ReadonlyMap<number, string>,
): string {
  return payload.replace(embedPattern(embedChar), (full, digits: string) => {
    const n = parseInt(digits, 10);
    const name = fnToName.get(n);
    return name !== undefined ? markerOf(name) : full;
  });
}

/** Unknown markers fall through literal; returns referenced fnNumbers
 *  so generator can emit matching ^FN headers. */
export function markersToEmbeds(
  content: string,
  variables: readonly Variable[],
  embedChar: string,
): { payload: string; referencedFnNumbers: ReadonlySet<number> } {
  const byName = new Map(variables.map((v) => [v.name, v]));
  const referenced = new Set<number>();
  const payload = content.replace(markerRe(), (full, name: string) => {
    const v = byName.get(name);
    if (!v) return full;
    referenced.add(v.fnNumber);
    return `${embedChar}${v.fnNumber}${embedChar}`;
  });
  return { payload, referencedFnNumbers: referenced };
}

/** Null when every candidate clashes (caller falls back to ^FH escape). */
// ^ and ~ are reserved ZPL prefixes; never offer them.
const EMBED_CHAR_CANDIDATES = ["#", "@", "|", "%", "&", "?", "!"] as const;

export function pickEmbedChar(payloads: readonly string[]): string | null {
  for (const c of EMBED_CHAR_CANDIDATES) {
    if (payloads.every((p) => !p.includes(c))) return c;
  }
  return null;
}

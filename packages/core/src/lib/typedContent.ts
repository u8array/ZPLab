/**
 * Typed barcode content: encode a chosen data type (URL, WiFi, vCard, …) to the
 * canonical string, and parse an existing string back to {type, fields} for
 * round-trip editing. Symbology-agnostic (QR, DataMatrix, …). Pure, no UI.
 *
 * Encodings follow the de-facto ZXing "Barcode Contents" conventions and the
 * relevant RFCs (mailto 6068, tel 3966, geo 5870), verified against a barcode
 * decoder. Parsing never throws and falls back to plain text, so it can't
 * corrupt unrecognized content.
 */

import { extractTemplateRefs, hasTemplateMarkers, mapLiteralSpans } from "./fnTemplate";
import { resolveForRow, variableSubstitutions } from "./variableBinding";
import type { ColumnMapping, Variable } from "../types/Variable";

// The array is the single source; the union derives from it so the two can't
// drift (the encode/complete switches and the modal's field Record stay
// compiler-exhaustive against it).
export const CONTENT_TYPES = [
  "url", "text", "wifi", "vcard", "mecard", "email", "tel", "sms", "geo",
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

export type ContentFields = Record<string, string>;

/** The ADR components the form offers, in the line's order from component 3 (RFC 2426 3.2.1). */
export const ADR_FIELDS = ["street", "city", "region", "postalCode", "country"] as const;
/** The contact fields in encode order. The escaper table and the form derive from it. */
export const VCARD_FIELDS = [
  "firstName", "lastName", "org", "title", "tel", "mobile", "email", "url", ...ADR_FIELDS, "note", "birthday",
] as const;

/** A date a scanner keeps: the dashes vCard allows and the MECARD encoder strips are optional. */
export const isContactDate = (s: string): boolean => s === "" || /^\d{4}-?\d{2}-?\d{2}$/.test(s);

/** The MECARD contact fields in encode order. One address value, not the vCard's five components. */
export const MECARD_FIELDS = ["firstName", "lastName", "org", "tel", "email", "url", "address", "note", "birthday"] as const;
/** Tag to field for the properties both the encoder and the parser treat as plain values. */
const MECARD_PROPERTIES = [["ORG", "org"], ["TEL", "tel"], ["EMAIL", "email"], ["URL", "url"], ["ADR", "address"], ["NOTE", "note"]] as const;

/** What the builder checks a marker as while its value is unknown: something every rule of the field accepts. */
export function markerStandIn(key: string): string {
  return key === "birthday" ? "0000-00-00" : "0";
}

// One structural-char class per format, shared by the literal ESCAPER and the
// marker-value VALIDATION (MARKER_UNSAFE below) so the two can't drift: a char
// the escaper protects is exactly a char a raw print-time value corrupts.
// mailto has no shared class: its literals go through encodeURIComponent, so
// its validation set below is a deliberate structural subset.
const WIFI_STRUCTURAL = /[\\;,":]/g;
// Without the quote that only WiFi's hex rule needs.
const MECARD_STRUCTURAL = /[\\;,:]/g;
// The encoder strips dashes from literals only, so a substituted date keeps them and loses its BDAY.
const MECARD_DATE_UNSAFE = /[\\;,:-]/g;
const VCARD_STRUCTURAL = /[\\,;\n]/g;

/** Escapes the structural chars in one pass, so ordering can't double-escape. */
function escBackslash(s: string, structural: RegExp): string {
  return mapLiteralSpans(s, (lit) => lit.replace(structural, (c) => `\\${c}`));
}

const escMecard = (s: string) => escBackslash(s, MECARD_STRUCTURAL);

/** WiFi additionally quotes an all-hex value so a scanner doesn't read it as hex.
 *  Undecidable with markers, so skipped: the resolved value isn't known at build time. */
function escWifi(s: string): string {
  const e = escBackslash(s, WIFI_STRUCTURAL);
  return s.length > 0 && !hasTemplateMarkers(s) && /^[0-9A-Fa-f]+$/.test(s) ? `"${e}"` : e;
}

/** vCard 3.0 text-value escaping; newline becomes the \n sequence. */
function escVcard(s: string): string {
  return mapLiteralSpans(s, (lit) =>
    lit.replace(VCARD_STRUCTURAL, (c) => (c === "\n" ? "\\n" : `\\${c}`)),
  );
}

/** Phone normalization for tel:/SMSTO: keep a single leading +, digits only. */
function normalizeTel(s: string): string {
  const plus = s.trim().startsWith("+") ? "+" : "";
  return plus + mapLiteralSpans(s, (lit) => lit.replace(/\D/g, ""));
}

// Fields whose literals the encoder escapes but whose print-time substitution
// bypasses it (^FN data is inserted raw; a shared FN slot can't be escaped
// per use). Fields whose literals are emitted raw anyway have no rule, and
// tel numbers tolerate separators per RFC 3966. mailto: `%` corrupts via
// percent-decoding, whitespace terminates the URI; non-ASCII is tolerated
// (scanners handle raw UTF-8).
const MAILTO_UNSAFE = /[&#%\s]/g;
const MARKER_UNSAFE: Partial<Record<ContentType, Record<string, RegExp>>> = {
  wifi: { ssid: WIFI_STRUCTURAL, password: WIFI_STRUCTURAL },
  vcard: Object.fromEntries(VCARD_FIELDS.map((key) => [key, VCARD_STRUCTURAL])),
  mecard: {
    ...Object.fromEntries(MECARD_FIELDS.map((key) => [key, MECARD_STRUCTURAL])),
    birthday: MECARD_DATE_UNSAFE,
  },
  email: { subject: MAILTO_UNSAFE, body: MAILTO_UNSAFE },
};

/** The structural characters in a print-time SUBSTITUTED value (a variable's
 *  default or a CSV cell, never the field's literal text, which the encoder
 *  escapes) that would corrupt this field's encoding. Deduped, whitespace
 *  shown as ␣; null when safe / no rule applies. Feeds the builder's
 *  per-field marker validation. */
export function markerUnsafeChars(
  type: ContentType,
  fieldKey: string,
  substituted: string,
): string | null {
  const re = MARKER_UNSAFE[type]?.[fieldKey];
  if (!re) return null;
  // Dedup AFTER mapping: distinct whitespace chars collapse into one ␣.
  const hits = [...new Set((substituted.match(re) ?? []).map((c) => (/\s/.test(c) ? "␣" : c)))];
  return hits.length > 0 ? hits.join(" ") : null;
}

/** Per-field offending chars for every marker-bearing field, checked over ALL
 *  print-time substitutions of each referenced variable (default + every bound
 *  CSV cell). The field's literal text is exempt: the encoder escapes it.
 *  Fields absent from the result are safe. Drives the builder's Apply gate. */
export function typedContentMarkerFindings(
  type: ContentType,
  fields: ContentFields,
  variables: readonly Variable[],
  dataset: { headers: readonly string[]; rows: readonly (readonly string[])[] } | null,
  columnMapping: ColumnMapping | null,
): Record<string, string> {
  const byName = new Map(variables.map((v) => [v.name, v]));
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(fields)) {
    if (!hasTemplateMarkers(raw)) continue;
    const hits = new Set<string>();
    for (const name of new Set(extractTemplateRefs(raw))) {
      const variable = byName.get(name);
      if (!variable) continue;
      for (const value of variableSubstitutions(variable, dataset, columnMapping)) {
        const chars = markerUnsafeChars(type, key, value);
        if (chars) for (const c of chars.split(" ")) hits.add(c);
      }
    }
    if (hits.size > 0) out[key] = [...hits].join(" ");
  }
  return out;
}

/** Rows whose print-time substitution yields an incomplete payload (e.g. an
 *  empty CSV cell blanking a required WiFi SSID). Each row is checked, but with
 *  no dataset OR a 0-row one the defaults print, so those validate `-1` instead.
 *  Clock markers are never empty. */
export function typedContentIncompleteRows(
  type: ContentType,
  fields: ContentFields,
  variables: readonly Variable[],
  dataset: { headers: readonly string[]; rows: readonly (readonly string[])[] } | null,
  columnMapping: ColumnMapping | null,
): number[] {
  if (!Object.values(fields).some(hasTemplateMarkers)) return [];
  const rows = dataset && columnMapping && dataset.rows.length > 0 ? dataset.rows.map((_, i) => i) : [-1];
  const bad: number[] = [];
  for (const rowIdx of rows) {
    const resolved = Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [
        k,
        hasTemplateMarkers(v) ? resolveForRow(v, rowIdx, variables, dataset, columnMapping) : v,
      ]),
    );
    if (!isContentComplete(type, resolved)) bad.push(rowIdx + 1);
  }
  return bad;
}

/** Whether `f` has enough valid input for `type` to produce a sound payload.
 *  Gates the modal's Apply: tel/sms need a digit, geo needs in-range numbers. */
export function isContentComplete(type: ContentType, f: ContentFields): boolean {
  switch (type) {
    case "url": return !!f.url?.trim();
    case "text": return !!f.text;
    case "wifi": return !!f.ssid?.trim();
    case "vcard":
    case "mecard": return !!(f.firstName?.trim() || f.lastName?.trim()) && isContactDate((f.birthday ?? "").trim());
    case "email": return !!f.to?.trim();
    case "tel":
    case "sms": return /\d/.test(f.number ?? "");
    case "geo": return inRange(f.lat, -90, 90) && inRange(f.lng, -180, 180);
  }
}

function inRange(s: string | undefined, min: number, max: number): boolean {
  if (!s || s.trim() === "") return false;
  const n = Number(s);
  return Number.isFinite(n) && n >= min && n <= max;
}

export function encodeContent(type: ContentType, f: ContentFields): string {
  switch (type) {
    case "url": {
      const url = (f.url ?? "").trim();
      if (!url) return "";
      // A leading marker may resolve to a full URL (scheme included), so no
      // https:// is forced onto it.
      if (url.startsWith("«")) return url;
      return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
    }
    case "text":
      return f.text ?? "";
    case "wifi": {
      const auth = f.auth === "WEP" || f.auth === "nopass" ? f.auth : "WPA";
      let out = `WIFI:T:${auth};S:${escWifi(f.ssid ?? "")};`;
      if (auth !== "nopass" && f.password) out += `P:${escWifi(f.password)};`;
      if (f.hidden === "true") out += "H:true;";
      return out + ";";
    }
    case "vcard": {
      const v = (key: string) => escVcard((f[key] ?? "").trim());
      const fn = `${(f.firstName ?? "").trim()} ${(f.lastName ?? "").trim()}`.trim();
      const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${v("lastName")};${v("firstName")};;;`, `FN:${escVcard(fn)}`];
      const property = (tag: string, key: string) => {
        const value = v(key);
        if (value) lines.push(`${tag}:${value}`);
      };
      property("ORG", "org");
      property("TITLE", "title");
      // As typed: the spec's own TEL example carries separators, and a scanner keeps the grouping.
      property("TEL", "tel");
      property("TEL;TYPE=CELL", "mobile");
      property("EMAIL", "email");
      property("URL", "url");
      const adr = ADR_FIELDS.map(v);
      if (adr.some(Boolean)) lines.push(`ADR:;;${adr.join(";")}`);
      property("NOTE", "note");
      property("BDAY", "birthday");
      lines.push("END:VCARD");
      return lines.join("\n");
    }
    case "mecard": {
      const v = (key: string) => escMecard((f[key] ?? "").trim());
      // A lone half stands without the comma: ZXing shows "Doe," as " Doe".
      const parts = [`N:${[v("lastName"), v("firstName")].filter(Boolean).join(",")}`];
      for (const [tag, key] of MECARD_PROPERTIES) {
        const value = v(key);
        if (value) parts.push(`${tag}:${value}`);
      }
      // The form's entry is the vCard's YYYY-MM-DD, but MECARD wants bare digits.
      const birthday = mapLiteralSpans(v("birthday"), (lit) => lit.replaceAll("-", ""));
      if (birthday) parts.push(`BDAY:${birthday}`);
      return `MECARD:${parts.join(";")};;`;
    }
    case "email": {
      const to = (f.to ?? "").trim();
      const params: string[] = [];
      const enc = (s: string) => mapLiteralSpans(s, encodeURIComponent);
      if (f.subject) params.push(`subject=${enc(f.subject)}`);
      if (f.body) params.push(`body=${enc(f.body.replace(/\r?\n/g, "\r\n"))}`);
      return `mailto:${to}${params.length ? `?${params.join("&")}` : ""}`;
    }
    case "tel":
      return `tel:${normalizeTel(f.number ?? "")}`;
    case "sms":
      return `SMSTO:${normalizeTel(f.number ?? "")}:${f.message ?? ""}`;
    case "geo":
      return `geo:${(f.lat ?? "").trim()},${(f.lng ?? "").trim()}`;
  }
}

/** Split on `delim` not preceded by an escaping backslash. */
function splitUnescaped(s: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (c === "\\" && i + 1 < s.length) {
      cur += c + s.charAt(i + 1);
      i++;
      continue;
    }
    if (c === delim) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/** Collapse `\x` escapes to `x` (and `\n` to newline). */
function unescape(s: string): string {
  return s.replace(/\\(.)/g, (_, c: string) => (c === "n" ? "\n" : c));
}

/** decodeURIComponent that returns the raw value on malformed input, so parsing
 *  never throws (e.g. a stray `%` in a pasted mailto:). */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function parseWifi(content: string): ContentFields {
  const body = content.slice(content.indexOf(":") + 1); // after "WIFI:"
  const f: ContentFields = {};
  for (const field of splitUnescaped(body, ";")) {
    if (!field) continue;
    const c = field.indexOf(":");
    if (c < 0) continue;
    const k = field.slice(0, c);
    let v = field.slice(c + 1);
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    v = unescape(v);
    if (k === "S") f.ssid = v;
    else if (k === "P") f.password = v;
    else if (k === "T") f.auth = v;
    else if (k === "H" && v.toLowerCase() === "true") f.hidden = "true";
  }
  return f;
}

/** The first non-empty value of a repeated property wins, as ZXing's primary does. Later ones have no field. */
function firstValueInto(f: ContentFields) {
  return (key: string, value: string) => {
    if (value !== "") f[key] ??= value;
  };
}

function parseMecard(content: string): ContentFields {
  const body = content.slice(content.indexOf(":") + 1);
  const f: ContentFields = {};
  const take = firstValueInto(f);
  for (const field of splitUnescaped(body, ";")) {
    const c = field.indexOf(":");
    if (c < 0) continue;
    const k = field.slice(0, c).toUpperCase();
    const v = field.slice(c + 1);
    if (k === "N") {
      const [last = "", first = ""] = splitUnescaped(v, ",").map(unescape);
      take("lastName", last);
      take("firstName", first);
    } else if (k === "BDAY") {
      const d = unescape(v);
      take("birthday", /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d);
    } else {
      const key = MECARD_PROPERTIES.find(([tag]) => tag === k)?.[1];
      if (key) take(key, unescape(v));
    }
  }
  return f;
}

function parseVcard(content: string): ContentFields {
  const f: ContentFields = {};
  const take = firstValueInto(f);
  // A folded line (RFC 2425) continues with a leading space or tab.
  for (const line of content.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const [tag = "", ...params] = line.slice(0, idx).toUpperCase().split(";");
    const val = line.slice(idx + 1);
    if (tag === "N") {
      const parts = splitUnescaped(val, ";").map(unescape);
      take("lastName", parts[0] ?? "");
      take("firstName", parts[1] ?? "");
    } else if (tag === "ORG") take("org", unescape(val));
    else if (tag === "TITLE") take("title", unescape(val));
    else if (tag === "TEL") {
      // vCard 2.1 writes the type bare, 3.0 as TYPE=.
      take(params.some((p) => p === "CELL" || /^TYPE=.*CELL/.test(p)) ? "mobile" : "tel", unescape(val));
    } else if (tag === "EMAIL") take("email", unescape(val));
    else if (tag === "URL") take("url", unescape(val));
    else if (tag === "ADR" && f.street === undefined) {
      const parts = splitUnescaped(val, ";").map(unescape).slice(2, 2 + ADR_FIELDS.length);
      if (parts.some(Boolean)) for (const [i, key] of ADR_FIELDS.entries()) f[key] = parts[i] ?? "";
    } else if (tag === "NOTE") take("note", unescape(val));
    else if (tag === "BDAY") take("birthday", unescape(val));
  }
  return f;
}

function parseEmail(content: string): ContentFields {
  const rest = content.slice("mailto:".length);
  const q = rest.indexOf("?");
  const to = q < 0 ? rest : rest.slice(0, q);
  const f: ContentFields = { to: safeDecode(to) };
  if (q >= 0) {
    for (const pair of rest.slice(q + 1).split("&")) {
      const eq = pair.indexOf("=");
      const k = eq < 0 ? pair : pair.slice(0, eq);
      const v = eq < 0 ? "" : pair.slice(eq + 1);
      const dv = safeDecode(v.replace(/\+/g, "%20"));
      if (k === "subject") f.subject = dv;
      else if (k === "body") f.body = dv.replace(/\r\n/g, "\n");
    }
  }
  return f;
}

/** Classify and parse existing barcode content. Specific prefixes first; URI schemes
 *  matched case-insensitively. Unknown content becomes plain text. */
export function parseContent(content: string): { type: ContentType; fields: ContentFields } {
  const t = content.trimStart();
  if (/^wifi:/i.test(t)) return { type: "wifi", fields: parseWifi(t) };
  if (/^begin:vcard/i.test(t)) return { type: "vcard", fields: parseVcard(t) };
  if (/^mecard:/i.test(t)) return { type: "mecard", fields: parseMecard(t) };
  if (/^mailto:/i.test(t)) return { type: "email", fields: parseEmail(t) };
  if (/^tel:/i.test(t)) return { type: "tel", fields: { number: t.slice(4) } };
  if (/^smsto:/i.test(t)) {
    const rest = t.slice(6);
    const sep = rest.indexOf(":");
    return {
      type: "sms",
      fields: sep < 0 ? { number: rest } : { number: rest.slice(0, sep), message: rest.slice(sep + 1) },
    };
  }
  if (/^geo:/i.test(t)) {
    const [lat = "", lng = ""] = t.slice(4).split(",");
    return { type: "geo", fields: { lat, lng } };
  }
  if (/^https?:\/\//i.test(t)) return { type: "url", fields: { url: content } };
  return { type: "text", fields: { text: content } };
}

/** Suggested QR error-correction level by content length (a hint, not a rule):
 *  shorter content can afford more recovery. */
export function recommendedEc(content: string): "L" | "M" | "Q" {
  if (content.length > 300) return "L";
  if (content.length > 120) return "M";
  return "Q";
}

import { aiSpec, gtin14WithCheck, mod10CheckDigit, typedSegmentValue, validateGs1Segment, validateGs1SegmentResolved, type Gs1Segment } from "./gs1";
import { hasTemplateMarkers, mapLiteralSpans } from "./fnTemplate";

export const DL_DEFAULT_DOMAIN = "https://id.gs1.org";

/** encodeURIComponent's keep set minus the tilde, which is no GS1 data, and minus the parens that delimit the element string. Anything else corrupts the link, since ^FD cannot percent-encode. */
export const DL_UNSAFE = /[^A-Za-z0-9\-_.!*']/g;
/** The domain prints as typed, so only whitespace and the query and fragment marks can break it. */
const DOMAIN_BREAKERS = /[\s?#]/;
/** A substituted domain carries host and path only, since the builder writes the scheme in front of the marker. */
export const DL_DOMAIN_UNSAFE = new RegExp(`${DOMAIN_BREAKERS.source}|://`, "g");
/** The GTIN lengths that carry their own check digit. */
export const LINK_GTIN_LENGTHS: readonly number[] = [8, 12, 13, 14];

export interface DigitalLink {
  /** Scheme, host and any path prefix in front of the primary key. */
  domain: string;
  /** The link's AIs, primary key first. */
  segments: Gs1Segment[];
  /** Query keys that are no AI, such as linkType. */
  foreignQuery: [string, string][];
}

export type DigitalLinkIssue =
  | { kind: "noPrimaryKey" }
  | { kind: "twoPrimaryKeys" }
  | { kind: "mixedQualifiers"; ai: string }
  | { kind: "duplicateAi"; ai: string };

const qualifierAlternatives = (ai: string) => aiSpec(ai)?.dlKey;

/** The link's AIs as an element string, values verbatim since a link GTIN keeps its own length.
 *  A paren or marker bracket in a literal is backslash-escaped so the tags stay unambiguous and an invalid row survives a remount. */
export function linkAis(segments: readonly Gs1Segment[]): string {
  return segments.map((s) => `(${s.ai})${mapLiteralSpans(s.value, (lit) => lit.replace(/[\\()«»]/g, (c) => `\\${c}`))}`).join("");
}

/** The inverse of linkAis. A marker is one token, so a paren in a variable name cannot open a tag. */
export function linkAisSegments(ais: string): Gs1Segment[] {
  const out: Gs1Segment[] = [];
  for (const m of ais.matchAll(/«[^»]*»|\\[\s\S]|\((\d{2,4})\)|[\s\S]/g)) {
    const last = out.at(-1);
    if (m[1] !== undefined) out.push({ ai: m[1], value: "" });
    else if (last) last.value += m[0].startsWith("\\") ? m[0].slice(1) : m[0];
  }
  return out;
}

/** The qualifier sequence to use: the alternative holding the most present qualifiers, the first on a tie. */
function qualifierSequence(primaryAi: string, present: ReadonlySet<string>): readonly string[] {
  const count = (alt: readonly string[]) => alt.filter((ai) => present.has(ai)).length;
  return [...(qualifierAlternatives(primaryAi) ?? [])].sort((a, b) => count(b) - count(a))[0] ?? [];
}

export function digitalLinkIssue(segments: readonly Gs1Segment[]): DigitalLinkIssue | null {
  const seen = new Set<string>();
  for (const s of segments) {
    if (seen.has(s.ai)) return { kind: "duplicateAi", ai: s.ai };
    seen.add(s.ai);
  }
  const primaries = [...seen].filter((ai) => qualifierAlternatives(ai) !== undefined);
  const primary = primaries[0];
  if (primary === undefined) return { kind: "noPrimaryKey" };
  if (primaries.length > 1) return { kind: "twoPrimaryKeys" };
  // The dictionary forbids mixing alternatives, such as 235 next to 10 or 21.
  const sequence = new Set(qualifierSequence(primary, seen));
  for (const alt of qualifierAlternatives(primary) ?? []) {
    const mixed = alt.find((ai) => seen.has(ai) && !sequence.has(ai));
    if (mixed !== undefined) return { kind: "mixedQualifiers", ai: mixed };
  }
  return null;
}

/** Any length without its own check digit is a body to complete. */
export function linkGtin(value: string): string {
  const digits = value.trim();
  if (hasTemplateMarkers(digits) || !/^\d+$/.test(digits) || !LINK_GTIN_LENGTHS.includes(digits.length)) return gtin14WithCheck(digits);
  return digits.padStart(14, "0");
}

/** The GTIN rule of the form: a complete GTIN must carry its own check digit. */
function linkGtinIssue(value: string): string | null {
  const digits = value.trim();
  if (hasTemplateMarkers(digits)) return null;
  const reason = validateGs1Segment("01", digits);
  if (reason !== null) return reason;
  if (!LINK_GTIN_LENGTHS.includes(digits.length)) return null;
  return mod10CheckDigit(digits.slice(0, -1)) === digits.slice(-1) ? null : "checkDigit";
}

/** The row rule of a link: every AI follows its GS1 rule, and a GTIN keeps its own check digit. */
export function linkSegmentIssue(ai: string, raw: string, resolved: string, emptyIsRuntimeValued = true): string | null {
  if (aiSpec(ai)?.kind !== "gtin") return validateGs1SegmentResolved(ai, raw, resolved, emptyIsRuntimeValued);
  if (hasTemplateMarkers(resolved)) return null;
  // A marker prints its value as is, so a substituted GTIN must already have all 14 digits.
  if (hasTemplateMarkers(raw) && resolved.length !== 14) return "exactLength";
  return linkGtinIssue(resolved);
}

/** A GTIN in a link carries 8, 12, 13 or 14 digits with its check digit, while every other key follows its own rule. */
function isLinkKeyValue(ai: string, value: string): boolean {
  if (aiSpec(ai)?.kind === "gtin") return LINK_GTIN_LENGTHS.includes(value.length) && linkGtinIssue(value) === null;
  return validateGs1Segment(ai, value) === null;
}

/** The issue adding `ai` to the present ones would create, so a palette can refuse it up front. */
export function digitalLinkAddIssue(ai: string, presentAis: readonly string[]): DigitalLinkIssue | null {
  // The refusal is about the identifier being added, so what the present ones already break stays out.
  const present = [...new Set(presentAis)].map((a) => ({ ai: a, value: "" }));
  const before = digitalLinkIssue(present);
  const issue = digitalLinkIssue([...present, { ai, value: "" }]);
  if (issue === null || issue.kind === "noPrimaryKey" || JSON.stringify(before) === JSON.stringify(issue)) return null;
  return issue.kind === "mixedQualifiers" ? { kind: "mixedQualifiers", ai } : issue;
}

/** The domain as the link carries it: lowercase scheme and host, no trailing slash, https when none was typed. */
export function normalizeDomain(domain: string): string {
  const d = domain.trim().replace(/\/+$/, "");
  if (d === "") return DL_DEFAULT_DOMAIN;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(d) ? d : `https://${d}`;
  if (hasTemplateMarkers(withScheme)) return withScheme;
  try {
    const url = new URL(withScheme);
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return withScheme;
  }
}

/** True when the domain parses as an http origin with an optional path and nothing behind it. */
export function isLinkDomain(domain: string): boolean {
  // A bare scheme would get https:// prepended and parse as a host, and the normalizer drops breakers and credentials.
  const d0 = domain.trim();
  if (/^[a-z][a-z0-9+.-]*:\/*$/i.test(d0) || DOMAIN_BREAKERS.test(d0) || /^(?:[a-z][a-z0-9+.-]*:\/\/)?[^/]*@/i.test(d0)) return false;
  const d = normalizeDomain(domain);
  if (hasTemplateMarkers(d)) return true;
  try {
    const url = new URL(d);
    return /^https?:$/.test(url.protocol) && url.hostname !== "" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

const segmentValue = (s: Gs1Segment) => (aiSpec(s.ai)?.kind === "gtin" ? linkGtin(s.value) : typedSegmentValue(s.ai, s.value.trim()));
const encode = (s: Gs1Segment) => mapLiteralSpans(segmentValue(s), encodeURIComponent);

/** Primary key first, its qualifiers in the standard's order, every other AI in the query. Null without a primary key. */
export function digitalLinkUri(domain: string, segments: readonly Gs1Segment[]): string | null {
  const primary = segments.find((s) => qualifierAlternatives(s.ai) !== undefined);
  if (!primary) return null;
  const sequence = qualifierSequence(primary.ai, new Set(segments.map((s) => s.ai)));
  const qualifiers = sequence.flatMap((ai) => segments.find((s) => s.ai === ai) ?? []);
  const inPath = new Set([primary.ai, ...sequence]);
  const path = [primary, ...qualifiers].map((s) => `/${s.ai}/${encode(s)}`).join("");
  const query = segments.filter((s) => !inPath.has(s.ai)).map((s) => `${s.ai}=${encode(s)}`).join("&");
  return `${normalizeDomain(domain)}${path}${query === "" ? "" : `?${query}`}`;
}

function decode(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

/** A link whose path carries a complete primary key followed by AI and value pairs. Any host, any prefix. */
export function parseDigitalLink(uri: string): DigitalLink | null {
  const trimmed = uri.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  // The URL parser would punycode or refuse a marker in the host, so markers travel as host-safe placeholders
  // whose tag the input provably lacks, in lowercase because the host comes back lowercased.
  let tag = "zplabm";
  while (trimmed.toLowerCase().includes(tag)) tag += "z";
  const markers: string[] = [];
  const masked = trimmed.replace(/«[^»]*»/g, (m) => `${tag}${markers.push(m) - 1}m`);
  const unmask = (s: string) => s.replace(new RegExp(`${tag}(\\d+)m`, "g"), (_, i: string) => markers[Number(i)] ?? "");
  let url: URL;
  try {
    url = new URL(masked);
  } catch {
    return null;
  }
  const parts = url.pathname.split("/").filter((p) => p !== "");
  const start = parts.findIndex((p) => qualifierAlternatives(p) !== undefined);
  if (start < 0 || (parts.length - start) % 2 !== 0) return null;
  const segments: Gs1Segment[] = [];
  for (let i = start; i < parts.length; i += 2) {
    const ai = parts[i] ?? "";
    const value = decode(parts[i + 1] ?? "");
    if (!aiSpec(ai) || value === null) return null;
    segments.push({ ai, value: unmask(value) });
  }
  // An ordinary URL can have a two-digit path segment, so only a complete key value makes a link,
  // and a marker behind a prefix proves nothing unless another AI pair follows.
  const key = segments[0];
  if (key && (hasTemplateMarkers(key.value) ? start > 0 && segments.length < 2 : !isLinkKeyValue(key.ai, key.value))) return null;
  if (url.username !== "" || url.password !== "") return null;
  // Split by hand because a form-decoding parser reads a raw plus as a space, while GS1 percent-encodes a literal one.
  const foreignQuery: [string, string][] = [];
  for (const pair of url.search.slice(1).split("&").filter((p) => p !== "")) {
    const eq = pair.indexOf("=");
    const ai = decode(eq < 0 ? pair : pair.slice(0, eq));
    const value = decode(eq < 0 ? "" : pair.slice(eq + 1));
    if (ai === null || value === null) return null;
    if (aiSpec(ai)) segments.push({ ai, value: unmask(value) });
    else foreignQuery.push([unmask(ai), unmask(value)]);
  }
  if (url.hash !== "") foreignQuery.push(["#", unmask(url.hash.slice(1))]);
  const prefix = parts.slice(0, start).map((p) => `/${p}`).join("");
  return { domain: unmask(`${url.origin}${prefix}`), segments, foreignQuery };
}

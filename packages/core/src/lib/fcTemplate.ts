// ^FC substitutes RTC into ^FD; clock-char + letter -> «clock:T» (primary),
// «clock2:T» (secondary, ^SO2 offset), «clock3:T» (tertiary, ^SO3 offset).
// Preview uses new Date(); printer RTC is authoritative at print time.
import { applyClockOffset, type ClockOffset } from "../types/LabelConfig";
import { CLOCK_BODY_RE, CLOCK_MARKER_RE, clockMarkerReGlobal } from "../types/clockMarker";
import { escapeRegExp } from "./escapeRegExp";

const TOKEN_FORMATTERS: Record<string, (d: Date) => string> = {
  Y: (d) => String(d.getFullYear()),
  y: (d) => String(d.getFullYear() % 100).padStart(2, "0"),
  m: (d) => String(d.getMonth() + 1).padStart(2, "0"),
  d: (d) => String(d.getDate()).padStart(2, "0"),
  H: (d) => String(d.getHours()).padStart(2, "0"),
  M: (d) => String(d.getMinutes()).padStart(2, "0"),
  S: (d) => String(d.getSeconds()).padStart(2, "0"),
  j: (d) => {
    // Sum month-lengths locally so DST can't cause off-by-one.
    const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const y = d.getFullYear();
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    let n = d.getDate();
    for (let i = 0; i < d.getMonth(); i++) {
      n += monthDays[i] ?? 0;
      if (i === 1 && leap) n += 1;
    }
    return String(n).padStart(3, "0");
  },
};

/** TS narrowing keeps this in sync with TOKEN_FORMATTERS. */
export const CLOCK_TOKEN_LABELS = [
  { token: "Y", labelKey: "clockYear4" },
  { token: "y", labelKey: "clockYear2" },
  { token: "m", labelKey: "clockMonth" },
  { token: "d", labelKey: "clockDay" },
  { token: "H", labelKey: "clockHour24" },
  { token: "M", labelKey: "clockMinute" },
  { token: "S", labelKey: "clockSecond" },
  { token: "j", labelKey: "clockJulianDay" },
] as const satisfies readonly { token: keyof typeof TOKEN_FORMATTERS; labelKey: string }[];

/** 1 = primary (no offset), 2 = secondary (^SO2), 3 = tertiary (^SO3). */
export type ClockChannel = 1 | 2 | 3;

/** ^FC date/time/tertiary; defaults `% { #`, alt picked on payload clash. */
export interface ClockChars {
  date: string;
  time: string;
  tertiary: string;
}

export const DEFAULT_CLOCK_CHARS: ClockChars = { date: "%", time: "{", tertiary: "#" };

/** Per-channel Date used at resolve time; secondary/tertiary already
 *  carry the ^SO offset applied. */
export interface ChannelDates {
  primary: Date;
  secondary: Date;
  tertiary: Date;
}

const CLOCK_BODY = CLOCK_MARKER_RE;
const clockRe = clockMarkerReGlobal;

function channelOf(suffix: string | undefined): ClockChannel {
  return suffix === "2" ? 2 : suffix === "3" ? 3 : 1;
}

// Printed width per token, derived from the formatters so the two can't drift.
// Every formatter pads to a fixed width and offsets never change it, so any
// reference instant yields the canonical widths (day-of-year forced to 3).
const REF_INSTANT = new Date(2024, 11, 31, 23, 59, 59);
const TOKEN_LENGTHS: Record<string, number> = Object.fromEntries(
  Object.entries(TOKEN_FORMATTERS).map(([token, fmt]) => [token, fmt(REF_INSTANT).length]),
);

/** Printed length of a clock marker body (`clock:Y` -> 4), or null when the
 *  body is not a known clock token. */
export function clockBodyLength(body: string): number | null {
  const m = body.match(CLOCK_BODY_RE);
  const token = m?.[2];
  return token !== undefined ? TOKEN_LENGTHS[token] ?? null : null;
}

/** Marker body for a clock token on a channel: `clock:T` / `clock2:T` / `clock3:T`.
 *  Single source for the `«clock…»` body grammar shared by the UI. */
export function clockMarkerBody(channel: ClockChannel, token: string): string {
  return channel === 1 ? `clock:${token}` : `clock${channel}:${token}`;
}

/** Parse a clock marker body (`clock:Y` / `clock2:m`) into its channel and label
 *  catalogue entry, or null when malformed / unknown token. */
export function parseClockBody(
  body: string,
): { channel: ClockChannel; entry: (typeof CLOCK_TOKEN_LABELS)[number] } | null {
  const m = body.match(CLOCK_BODY_RE);
  if (!m) return null;
  const entry = CLOCK_TOKEN_LABELS.find((x) => x.token === m[2]);
  return entry ? { channel: channelOf(m[1]), entry } : null;
}

/** Label keys this catalogue uses; resolver callers index translations by it. */
export type ClockLabelKey = (typeof CLOCK_TOKEN_LABELS)[number]["labelKey"];

/** Localised label for a clock marker body (`clock:Y` / `clock2:m`): the token
 *  label from `labelFor`, suffixed with the channel number for 2/3. Falls back
 *  to the raw body when unparseable. `labelFor` keeps this translation-agnostic. */
export function formatClockLabel(
  body: string,
  labelFor: (labelKey: ClockLabelKey) => string,
): string {
  const p = parseClockBody(body);
  if (!p) return body;
  const label = labelFor(p.entry.labelKey);
  return p.channel === 1 ? label : `${label} ${p.channel}`;
}

function dateForChannel(dates: ChannelDates, channel: ClockChannel): Date {
  return channel === 2 ? dates.secondary : channel === 3 ? dates.tertiary : dates.primary;
}

function charForChannel(chars: ClockChars, channel: ClockChannel): string {
  return channel === 2 ? chars.time : channel === 3 ? chars.tertiary : chars.date;
}

/** True when `content` carries at least one clock marker (any channel). */
export function hasClockMarkers(content: string): boolean {
  return CLOCK_BODY.test(content);
}

/** Source order, duplicates preserved (caller dedupes). */
export function extractClockTokens(
  content: string,
): { token: string; channel: ClockChannel }[] {
  return [...content.matchAll(clockRe())]
    .map((m) => ({ token: m[2] ?? "", channel: channelOf(m[1]) }))
    .filter((x) => x.token !== "");
}

/** Unknown tokens fall through as literal marker. */
export function resolveClockMarkers(content: string, dates: ChannelDates): string {
  return content.replace(clockRe(), (full, suffix: string, token: string) => {
    const fmt = TOKEN_FORMATTERS[token];
    if (!fmt) return full;
    return fmt(dateForChannel(dates, channelOf(suffix)));
  });
}

/** Build the ChannelDates triple from a primary Date and the two
 *  optional offsets (label-level ^SO2/^SO3). When an offset is absent
 *  the channel falls back to the primary Date so unconfigured
 *  secondary/tertiary markers resolve identically to primary. */
export function channelDatesFrom(
  primary: Date,
  secondaryOffset: ClockOffset | undefined,
  tertiaryOffset: ClockOffset | undefined,
): ChannelDates {
  return {
    primary,
    secondary: applyClockOffset(primary, secondaryOffset),
    tertiary: applyClockOffset(primary, tertiaryOffset),
  };
}

/** Only clock-char + known formatter letter converted; `%foo` stays.
 *  Date char emits `«clock:T»` (primary), time/tertiary chars emit
 *  `«clock2:T»` / `«clock3:T»` so the channel survives round-trip. */
export function tokensToMarkers(payload: string, chars: ClockChars): string {
  const tokenLetters = Object.keys(TOKEN_FORMATTERS).join("");
  const reFor = (c: string) =>
    new RegExp(
      `${escapeRegExp(c)}([${tokenLetters}])`,
      "g",
    );
  let out = payload;
  if (chars.date) out = out.replace(reFor(chars.date), (_f, t: string) => `«clock:${t}»`);
  if (chars.time) out = out.replace(reFor(chars.time), (_f, t: string) => `«clock2:${t}»`);
  if (chars.tertiary) out = out.replace(reFor(chars.tertiary), (_f, t: string) => `«clock3:${t}»`);
  return out;
}

/** Emits the per-channel clock char so the channel survives the
 *  round-trip; primary uses chars.date, secondary chars.time,
 *  tertiary chars.tertiary. */
export function markersToTokens(content: string, chars: ClockChars): string {
  return content.replace(clockRe(), (full, suffix: string, token: string) => {
    if (!(token in TOKEN_FORMATTERS)) return full;
    return `${charForChannel(chars, channelOf(suffix))}${token}`;
  });
}

/** Null when any slot exhausts; caller leaves markers literal. */
const DATE_CANDIDATES = ["%", "$", "*", "+", "="] as const;
const TIME_CANDIDATES = ["{", "<", "[", "(", "?"] as const;
const TERT_CANDIDATES = ["#", "@", "|", "&", "!"] as const;

function pickOne(candidates: readonly string[], payloads: readonly string[]): string | null {
  for (const c of candidates) {
    if (payloads.every((p) => !p.includes(c))) return c;
  }
  return null;
}

export function pickClockChars(payloads: readonly string[]): ClockChars | null {
  const date = pickOne(DATE_CANDIDATES, payloads);
  const time = pickOne(TIME_CANDIDATES, payloads);
  const tertiary = pickOne(TERT_CANDIDATES, payloads);
  if (!date || !time || !tertiary) return null;
  return { date, time, tertiary };
}

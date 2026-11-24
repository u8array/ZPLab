import type { LabelObjectBase } from "../types/LabelObject";
import { filterContent, violatesCharset, type ContentSpec } from "./contentSpec";

/** ^SN/^SF accept only alphanumerics in the serialized payload. */
export const serialSpec: ContentSpec = { charset: "0-9A-Za-z" };

/** Filter a serial seed to the intersection of the serial charset AND the
 *  symbology's own content charset (sequential filtering = intersection), so a
 *  numeric-only symbology (Interleaved 2of5, MSI) can't keep a letter seed.
 *  Serial-eligible types carry no maxLength, so only the charset narrows. */
export function serialSeed(raw: string, spec?: ContentSpec): string {
  return filterContent(filterContent(raw, serialSpec), spec);
}

/** Per-field firmware counter. Present on a field's props = serial mode:
 *  `content` is the seed, emitted via ^SN/^SF instead of a plain ^FD. */
export interface SerialMode {
  increment: number;
  zplMode: "SN" | "SF";
}

/** Seed for a freshly enabled serial field. */
export const SERIAL_DEFAULT: SerialMode = { increment: 1, zplMode: "SN" };

/** Checkbox-on props patch, the `gs1EnablePatch` analogue. Seeds from the
 *  field's marker-RESOLVED content (caller resolves with emitter parity) and
 *  snapshots the raw template so `serialDisablePatch` can restore it. */
export function serialEnablePatch(
  rawContent: string,
  resolvedContent: string,
  spec?: ContentSpec,
): { serial: SerialMode; content: string; preSerialContent: string } {
  return {
    serial: { ...SERIAL_DEFAULT },
    content: serialSeed(resolvedContent, spec),
    preSerialContent: rawContent,
  };
}

/** Checkbox-off patch: restores the snapshotted template when present; a field
 *  without one (parser-imported ^SN/^SF) keeps its seed as literal content. */
export function serialDisablePatch(props: { preSerialContent?: string }): {
  serial: undefined;
  preSerialContent: undefined;
  content?: string;
} {
  return {
    serial: undefined,
    preSerialContent: undefined,
    ...(props.preSerialContent !== undefined ? { content: props.preSerialContent } : {}),
  };
}

/** Single parser-side writer that flags a just-parsed leaf as serial. The caller
 *  keeps the leaf's seed content (never a variable marker), so a field carrying
 *  both ^FN and ^SN/^SF (contradictory ZPL) resolves to serial. */
export function applySerialToLeaf(
  leaf: LabelObjectBase & { props?: object },
  mode: SerialMode,
): void {
  leaf.props = { ...(leaf.props ?? {}), serial: mode };
}

interface SerialCharClass {
  mask: "d" | "A" | "a";
  /** Char code of the position's zero. */
  zero: number;
  radix: number;
}

/** How ^SF counts a seed character. The seed is filtered to `0-9A-Za-z`, so no `%`-skip positions arise. */
function serialCharClass(c: string): SerialCharClass {
  if (/[0-9]/.test(c)) return { mask: "d", zero: 48, radix: 10 };
  return /[a-z]/.test(c) ? { mask: "a", zero: 97, radix: 26 } : { mask: "A", zero: 65, radix: 26 };
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Adds to an ^SF string the way the printer does: every character counts in its own radix
 *  and carries to the left (`AAdddd`: BL9999 -> BM0000). A carry past the first character is lost. */
function sfAdd(text: string, delta: number): string {
  const chars = [...text];
  let carry = delta;
  for (let i = chars.length - 1; i >= 0 && carry !== 0; i--) {
    const { zero, radix } = serialCharClass(chars[i] ?? "");
    const value = (chars[i] ?? "").charCodeAt(0) - zero + carry;
    chars[i] = String.fromCharCode(zero + mod(value, radix));
    carry = Math.floor(value / radix);
  }
  return chars.join("");
}

const sfZero = (text: string) => [...text].map((c) => String.fromCharCode(serialCharClass(c).zero)).join("");

/** The ^SF increment string for a seed, one character per mask position in that position's radix.
 *  Counting down goes out as the complement, which the lost carry turns into a subtraction. */
function sfIncrement(seed: string, increment: number): string {
  if (seed === "") return String(increment);
  const zero = sfZero(seed);
  const aligned = sfAdd(zero, increment);
  const lead = [...aligned].findIndex((c, i) => c !== zero[i]);
  return lead === -1 ? aligned.slice(-1) : aligned.slice(lead);
}

/** The count a parsed ^SF increment stands for once the export has rebuilt the mask from the
 *  field data. An empty increment is the guide's default of one, in the last position the mask counts. */
export function sfIncrementValue(content: string, mask: string, increment: string): number {
  // By code point, matching how the mask is built, so a surrogate pair takes one position.
  const data = [...content];
  const masks = [...mask];
  const steps = [...increment];
  let value = 0;
  let weight = 1;
  let one: number | undefined;
  for (let i = 1; i <= data.length; i++) {
    const c = data[data.length - i] ?? "";
    // A character outside the serial charset gets no weight.
    if (violatesCharset(c, serialSpec)) continue;
    const { zero, radix } = serialCharClass(c);
    const m = masks[masks.length - i];
    if (m !== undefined && m !== "%") {
      one ??= weight;
      const digit = (steps[steps.length - i] ?? "").charCodeAt(0) - zero;
      if (digit >= 0 && digit < radix) value += digit * weight;
    }
    weight *= radix;
  }
  return increment === "" ? one ?? 0 : value;
}

/** Serialization field data for a seed, spec-conform per the ZPL guide.
 *  ^SN (`^SNv,n,z`): the start value `v` IS the field data, no ^FD; `z=Y` keeps
 *  the seed width via leading zeros. Indexes the rightmost integers only.
 *  ^SF (`^SFa,b`): a standard ^FD plus a mask `a` (which characters serialize)
 *  and increment `b`; supports alphanumeric rollover. The seed is re-filtered to
 *  alphanumerics so it can't smuggle ^/~ or commas into the parameter list. */
export function serialFieldData(content: string, serial: SerialMode): string {
  const safe = filterContent(content, serialSpec);
  if (serial.zplMode === "SF") {
    const mask = [...safe].map((c) => serialCharClass(c).mask).join("");
    return `^FD${safe}^SF${mask},${sfIncrement(safe, serial.increment)}^FS`;
  }
  return `^SN${safe},${serial.increment},Y^FS`;
}

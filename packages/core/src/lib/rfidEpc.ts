import { RFID_EPC_MAX_PARTITIONS, RFID_EPC_PARTITION_RANGE } from "../types/LabelConfig";

const { min: FIELD_MIN, max: FIELD_MAX } = RFID_EPC_PARTITION_RANGE;

/** The one EPC layout the ZPL guide documents (p.425): header, filter,
 *  partition, company prefix, item reference, serial number. */
export const SGTIN_96_FIELDS = [8, 3, 3, 20, 24, 38] as const;

/** Seed a partition list: a structure needs at least two fields, and wide
 *  totals need more because a field holds 64 bits at most. Null when the
 *  total does not fit 16 fields, or is too narrow for two. */
export function splitEpcBits(total: number | undefined): number[] | null {
  if (total === undefined) return [8, 8];
  // A 1-bit tag cannot hold two fields; growing it silently would be worse.
  if (total < 2) return null;
  const parts = Math.max(2, Math.ceil(total / FIELD_MAX));
  if (parts > RFID_EPC_MAX_PARTITIONS) return null;
  const base = Math.floor(total / parts);
  const remainder = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** The tag width is the given and the fields divide it (spec p.424: the
 *  partitions add up to n), so the last field is derived, never typed.
 *  Every helper below preserves that. */
export function epcTrailingField(total: number, leading: readonly number[]): number {
  return total - leading.reduce((a, b) => a + b, 0);
}

/** Bounds for a typed field: what keeps the derived trailing field within
 *  1..64 while the total stays put. */
export function epcFieldRange(
  total: number,
  parts: readonly number[],
  index: number,
): { min: number; max: number } {
  const others = parts
    .slice(0, -1)
    .reduce((sum, bits, i) => (i === index ? sum : sum + bits), 0);
  return {
    min: Math.max(FIELD_MIN, total - others - FIELD_MAX),
    max: Math.min(FIELD_MAX, total - others - FIELD_MIN),
  };
}

/** Bounds for the total: the typed fields claim their bits, and the trailing
 *  field has to fit in what remains. Unpartitioned totals are free. */
export function epcTotalRange(
  parts: readonly number[] | undefined,
  maxBits: number,
): { min: number; max: number } {
  if (!parts) return { min: FIELD_MIN, max: maxBits };
  const leading = parts.slice(0, -1).reduce((a, b) => a + b, 0);
  return { min: leading + FIELD_MIN, max: Math.min(maxBits, leading + FIELD_MAX) };
}

/** Add a field by halving the trailing one, so the tag width holds. Null when
 *  the structure is full or the trailing field cannot be split. */
export function epcAddField(total: number, parts: readonly number[]): number[] | null {
  if (parts.length >= RFID_EPC_MAX_PARTITIONS) return null;
  const trailing = epcTrailingField(total, parts.slice(0, -1));
  const taken = Math.floor(trailing / 2);
  if (taken < FIELD_MIN || trailing - taken < FIELD_MIN) return null;
  return [...parts.slice(0, -1), taken, trailing - taken];
}

/** Remove a field; its bits flow back from the end, total unchanged. Null
 *  when they fit nowhere without breaking the 64-bit cap; a lone survivor is
 *  no structure, so the caller drops it. */
export function epcRemoveField(
  total: number,
  parts: readonly number[],
  index: number,
): number[] | null {
  const kept = parts.filter((_, i) => i !== index);
  if (kept.length <= 1) return kept;
  const out = [...kept];
  let freed = total - out.reduce((a, b) => a + b, 0);
  for (let i = out.length - 1; i >= 0 && freed > 0; i--) {
    const room = FIELD_MAX - (out[i] ?? 0);
    const take = Math.min(room, freed);
    out[i] = (out[i] ?? 0) + take;
    freed -= take;
  }
  return freed === 0 ? out : null;
}

/** Retype one field, then let the trailing field absorb the difference. */
export function epcSetField(
  total: number,
  parts: readonly number[],
  index: number,
  bits: number,
): number[] {
  const range = epcFieldRange(total, parts, index);
  const clamped = Math.min(range.max, Math.max(range.min, bits));
  const leading = parts.slice(0, -1).map((b, i) => (i === index ? clamped : b));
  return [...leading, epcTrailingField(total, leading)];
}

/** Retype the trailing field: the leading ones are already claimed, so this
 *  sets the tag width rather than redistributing within it. */
export function epcSetTrailing(
  parts: readonly number[],
  bits: number,
): { partitions: number[]; total: number } {
  const clamped = Math.min(FIELD_MAX, Math.max(FIELD_MIN, bits));
  const leading = parts.slice(0, -1);
  return {
    partitions: [...leading, clamped],
    total: leading.reduce((a, b) => a + b, 0) + clamped,
  };
}

/** Retype the tag width; the trailing field takes the difference. */
export function epcSetTotal(parts: readonly number[], total: number): number[] {
  const leading = parts.slice(0, -1);
  return [...leading, epcTrailingField(total, leading)];
}

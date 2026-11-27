/**
 * Inline EAN/UPC field validation: length progress + check digit. Pure, no UI.
 *
 * Typing is capped at N data digits, but imported/parsed content can carry the
 * full code (N+1, the check digit included). N data digits get a computed check, an N+1 full code is verified, longer content is rejected.
 */

import type { PreflightProducerResult } from "../types/preflight";
import { eanCheckDigit, upceCheckDigit } from "./barcodeCheckDigits";

export type EanUpcType = "ean13" | "ean8" | "upca" | "upce";
export type EanUpcStatus = "empty" | "short" | "complete" | "badCheck" | "tooLong";

export interface EanUpcValidation {
  status: EanUpcStatus;
  /** Required data-digit count, without the check digit. */
  dataLen: number;
  /** Data digits entered so far (capped at dataLen). */
  digits: string;
  /** Digits still needed before the check digit; 0 unless status is "short". */
  remaining: number;
  /** Valid check digit, present when status is "complete". */
  checkDigit?: string;
  /** Full code incl. check digit, present when status is "complete". */
  fullCode?: string;
  /** badCheck only: the check digit that was expected / the one that was given. */
  expected?: string;
  got?: string;
}

const SPECS: Record<EanUpcType, { dataLen: number; check: (digits: string) => string }> = {
  ean13: { dataLen: 12, check: (d) => eanCheckDigit(d, 1, 3) },
  ean8: { dataLen: 7, check: (d) => eanCheckDigit(d, 3, 1) },
  upca: { dataLen: 11, check: (d) => eanCheckDigit(d, 3, 1) },
  upce: { dataLen: 6, check: (d) => upceCheckDigit(d) },
};

export function validateEanUpc(type: EanUpcType, raw: string): EanUpcValidation {
  const { dataLen, check } = SPECS[type];
  const all = raw.replace(/\D/g, "");
  const data = all.slice(0, dataLen);
  if (all.length === 0) return { status: "empty", dataLen, digits: data, remaining: dataLen };
  if (all.length < dataLen) {
    return { status: "short", dataLen, digits: data, remaining: dataLen - all.length };
  }
  const checkDigit = check(data);
  if (all.length === dataLen) {
    return { status: "complete", dataLen, digits: data, remaining: 0, checkDigit, fullCode: data + checkDigit };
  }
  if (all.length === dataLen + 1) {
    const got = all[dataLen];
    return got === checkDigit
      ? { status: "complete", dataLen, digits: data, remaining: 0, checkDigit, fullCode: data + checkDigit }
      : { status: "badCheck", dataLen, digits: data, remaining: 0, expected: checkDigit, got };
  }
  return { status: "tooLong", dataLen, digits: data, remaining: 0 };
}

const ALL_DIGITS = /^[0-9]+$/;

/** Registry `valuePreflight` for a check digit the printer computes. Non-digit content yields no findings. */
export function checkDigitPreflight(type: EanUpcType): (content: string) => PreflightProducerResult[] {
  return (content) => {
    if (!ALL_DIGITS.test(content)) return [];
    const v = validateEanUpc(type, content);
    return v.status === "badCheck" ? [{ kind: "checkDigitMismatch", detail: `${v.got} ≠ ${v.expected}` }] : [];
  };
}

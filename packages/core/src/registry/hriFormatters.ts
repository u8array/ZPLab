import { mod10CheckDigit } from "../lib/gs1";
import { fixedDigits, supplementData, upceData6FromFd, upperAZ } from "./firmwareRules";
import type { HriFormatProps } from "../types/ZplEmit";
import { code11CheckDigits, msiCheckDigits, eanCheckDigit, upceCheckDigit } from '../lib/barcodeCheckDigits';
import { code128FdToDisplayText } from '../lib/code128Subset';
import { code128Mode, planCode128Fd } from '../lib/code128Plan';
import { C0_OR_DEL_RE, resolveControlMarkers } from '../types/controlKey';

/**
 * HRI text formatters per 1D symbology. Each takes the user-provided
 * content string and returns the full HRI line the canvas should display.
 * Pure functions; kept here (not inline in each leaf) so they can be
 * unit-tested independently and re-used across the canvas + any future
 * non-canvas renderer (export, preview, …).
 */

/** The data digits of the line, cut or zero-filled to the bar length. */
function dataDigits(content: string, length: number): string {
  return fixedDigits(content.replace(/\D/g, ''), length).slice(0, length).padStart(length, '0');
}

export function formatEan13Hri(content: string): string {
  const d12 = dataDigits(content, 12);
  return d12 + eanCheckDigit(d12, 1, 3);
}

export function formatEan8Hri(content: string): string {
  const d7 = dataDigits(content, 7);
  return d7 + eanCheckDigit(d7, 3, 1);
}

export function formatUpcaHri(content: string): string {
  const d11 = dataDigits(content, 11);
  return d11 + eanCheckDigit(d11, 3, 1);
}

export function formatUpceHri(content: string): string {
  const d6 = upceData6FromFd(content);
  return `0${d6}${upceCheckDigit(d6)}`;
}

/** Code 11 HRI: data plus its check digit(s). ^B1 e=N encodes two (C+K),
 *  e=Y encodes one (C); checkDigit=true maps to e=Y, hence `two = !checkDigit`.
 *  The start/stop triangles are drawn as shapes, not part of this string. */
export function formatCode11Hri(content: string, props?: HriFormatProps): string {
  return `${content}${code11CheckDigits(content, !props?.checkDigit)}`;
}

const MOD43_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%";

/** ^B3 e=Y encodes and prints the Mod-43 check char (Labelary: ^FD1234 -> *1234A*). */
export function formatCode39Hri(content: string, props?: HriFormatProps): string {
  const data = upperAZ(content);
  if (!props?.checkDigit) return data;
  let sum = 0;
  for (const ch of data) {
    const v = MOD43_CHARSET.indexOf(ch);
    if (v < 0) return data;
    sum += v;
  }
  return data + MOD43_CHARSET[sum % 43];
}

/** ^B2 e=Y prints the Mod 10 check digit; an odd total gains the leading 0
 *  the firmware pads (spec p.68-69). */
export function formatInterleaved2of5Hri(content: string, props?: HriFormatProps): string {
  if (!/^\d+$/.test(content)) return content;
  const digits = props?.checkDigit ? content + mod10CheckDigit(content) : content;
  return digits.length % 2 === 1 ? `0${digits}` : digits;
}

/** ^BM e2=Y prints the encoded check digits in the HRI. */
export function formatMsiHri(content: string, props?: HriFormatProps): string {
  if (!props?.checkDigit || !props.msiHriCheck || !/^\d+$/.test(content)) return content;
  return content + msiCheckDigits(content, props.msiCheckMode ?? "B");
}


export function formatLogmarsHri(content: string): string {
  const data = upperAZ(content);
  let sum = 0;
  for (const c of data) {
    const idx = MOD43_CHARSET.indexOf(c);
    if (idx >= 0) sum += idx;
  }
  return `${data}${MOD43_CHARSET[sum % 43] ?? ''}`;
}

/** ^BS shows the supplement as a 2- or 5-digit string. */
export function formatUpcEanExtensionHri(content: string): string {
  return supplementData(content.replace(/\D/g, '')) || '00000';
}

/** Firmware prints no glyph for a control byte in the interpretation line
 *  (ZD230-verified: `AB<HT>CD…` prints `ABCDEFGH`), so strip them from every
 *  1D HRI line before layout, which is length-based. */
const C0_OR_DEL_RE_G = new RegExp(C0_OR_DEL_RE.source, 'g');

export function stripHriControlBytes(text: string): string {
  return text.replace(C0_OR_DEL_RE_G, '');
}

/** Plain ^BC HRI shows the DECODED data of the emitted field, never invocation
 *  codes (spec p.98, Fig 3/4). At m=A every byte is literal. GS1 mode bypasses
 *  this (mode-D grammar). */
export function formatCode128Hri(content: string, props?: HriFormatProps): string {
  return code128Mode(props) === 'A'
    ? resolveControlMarkers(content)
    : code128FdToDisplayText(planCode128Fd(content, 'whole').fd);
}

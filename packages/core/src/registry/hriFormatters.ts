import { code11CheckDigits, eanCheckDigit, upceCheckDigit } from '../lib/barcodeCheckDigits';
import { code128FdToDisplayText, code128PlainFd } from '../lib/code128Subset';

/**
 * HRI text formatters per 1D symbology. Each takes the user-provided
 * content string and returns the full HRI line the canvas should display.
 * Pure functions; kept here (not inline in each leaf) so they can be
 * unit-tested independently and re-used across the canvas + any future
 * non-canvas renderer (export, preview, …).
 *
 * EAN/UPC formatters pad short content to the spec length so the
 * displayed HRI matches what bwip actually encoded.
 */

export function formatEan13Hri(content: string): string {
  const d12 = content.replace(/\D/g, '').slice(0, 12).padEnd(12, '0');
  return d12 + eanCheckDigit(d12, 1, 3);
}

export function formatEan8Hri(content: string): string {
  const d7 = content.replace(/\D/g, '').slice(0, 7).padEnd(7, '0');
  return d7 + eanCheckDigit(d7, 3, 1);
}

export function formatUpcaHri(content: string): string {
  const d11 = content.replace(/\D/g, '').slice(0, 11).padEnd(11, '0');
  return d11 + eanCheckDigit(d11, 3, 1);
}

/** The 6 UPC-E data digits (number system and check digit excluded). */
function upceData6(content: string): string {
  return content.replace(/\D/g, "").slice(0, 6).padEnd(6, "0");
}

/** Extract the 6 data digits from a parsed ^B9 ^FD payload. ZPL carries
 *  the number-system digit (and optionally the check digit), so 7- and
 *  8-digit payloads drop the leading NS before keeping 6 data digits. */
export function upceData6FromFd(fd: string): string {
  const digits = fd.replace(/\D/g, "");
  return upceData6(digits.length >= 7 ? digits.slice(1) : digits);
}

export function formatUpceHri(content: string): string {
  const d6 = upceData6FromFd(content);
  return `0${d6}${upceCheckDigit(d6)}`;
}

/** Code 11 HRI: data plus its check digit(s). ^B1 e=N encodes two (C+K),
 *  e=Y encodes one (C); checkDigit=true maps to e=Y, hence `two = !checkDigit`.
 *  The start/stop triangles are drawn as shapes, not part of this string. */
export function formatCode11Hri(content: string, checkDigit?: boolean): string {
  return `${content}${code11CheckDigits(content, !checkDigit)}`;
}

const LOGMARS_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';

export function formatLogmarsHri(content: string): string {
  let sum = 0;
  for (const c of content) {
    const idx = LOGMARS_CHARSET.indexOf(c.toUpperCase());
    if (idx >= 0) sum += idx;
  }
  return `${content}${LOGMARS_CHARSET[sum % 43] ?? ''}`;
}

/** ^BS shows the supplement as a single 2- or 5-digit string, padded
 *  to whichever variant bwip actually rendered (anything other than 2
 *  becomes the 5-digit form). */
export function formatUpcEanExtensionHri(content: string): string {
  const t = content.replace(/\D/g, '');
  return t.length === 2 ? t : t.slice(0, 5).padEnd(5, '0');
}

/** Firmware prints no glyph for a control byte in the interpretation line
 *  (ZD230-verified: `AB<HT>CD…` prints `ABCDEFGH`), so strip them from every
 *  1D HRI line before layout, which is length-based. */
export function stripHriControlBytes(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x1F\x7F]/g, '');
}

/** Plain ^BC HRI shows the DECODED data, never invocation codes (spec p.98,
 *  Fig 3/4). Runs on the emit-escaped form, so typed text the escape protects
 *  is a fixed point. GS1 mode bypasses this (mode-D grammar). */
export function formatCode128Hri(content: string): string {
  return code128FdToDisplayText(code128PlainFd(content));
}

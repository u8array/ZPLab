/** Byte-per-char codecs. Manual on purpose: TextDecoder's latin1 labels
 *  alias windows-1252, not byte-identical in 0x80-0x9F. */

const FROM_CHAR_CODE_CHUNK = 0x8000;

export function latin1ToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < out.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

export function bytesToLatin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += FROM_CHAR_CODE_CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + FROM_CHAR_CODE_CHUNK));
  }
  return s;
}

/** Control bytes that mark true binary junk. High bytes are NOT included:
 *  they are legitimate text (UTF-8 or byte-per-char) outside counted spans. */
// eslint-disable-next-line no-control-regex
export const CONTROL_BYTES_RE = /[\0-\b\v\f\x0E-\x1F\x7F]/;

/** Chars above 0xFF: not a byte-per-char read, latin1 would corrupt them. */
export const NON_LATIN1_RE = /[\u0100-\uffff]/;

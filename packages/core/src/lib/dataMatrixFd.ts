// GS1 DataMatrix ^FD codec (Zebra PG pp. 146-147): leading FNC1, GS separators
// as `_1`, a literal `_` doubled, non-printable bytes as `_dNNN`. Non-GS1 field
// data is arbitrary bytes and never routed here. Pure, no UI.

import { aiSpec, GS1_GS, isVariableKind, typedGs1Parts, typedSegmentValue } from "./gs1";

/** Escape-sequence control character we emit (^BX g param). Kept outside
 *  `^`/`~` so it never collides with fdField's ^FH escaping. */
export const DATAMATRIX_FD_ESCAPE = "_";

const ESC = DATAMATRIX_FD_ESCAPE;

/** A non-printable single byte, written as `_dNNN` instead. Bounded to ≤ 0xff:
 *  `_dNNN` is a 3-digit byte escape, so a code point above 255 must pass
 *  through verbatim (else decode reads only its first 3 digits and corrupts). */
function needsDecimalEscape(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0xff);
}

/** Escape one data run: double the escape char (a literal `_` is valid GS1
 *  data but would otherwise read as a stray sequence), other bytes as
 *  `<esc>dNNN`. */
function escapeRun(s: string): string {
  let out = "";
  for (const ch of s) {
    if (ch === ESC) {
      out += ESC + ESC;
    } else if (needsDecimalEscape(ch.charCodeAt(0))) {
      out += `${ESC}d${String(ch.charCodeAt(0)).padStart(3, "0")}`;
    } else {
      out += ch;
    }
  }
  return out;
}

function decodeEscapes(fd: string, escape: string, from: number): string {
  let out = "";
  for (let i = from; i < fd.length; i++) {
    const c = fd.charAt(i);
    if (c === escape) {
      const next = fd.charAt(i + 1);
      if (next === escape) { out += escape; i++; continue; }
      if (next === "1") { out += GS1_GS; i++; continue; }
      if (next === "d") {
        const digits = fd.slice(i + 2, i + 5);
        const code = Number(digits);
        if (/^\d{3}$/.test(digits) && code <= 255) {
          out += String.fromCharCode(code);
          i += 4;
          continue;
        }
      }
    }
    out += c;
  }
  return out;
}

/** ^FD field data for GS1 DataMatrix: a leading FNC1 and each GS separator as
 *  the escape sequence (`_1`). Pairs with `^BX…,,,,_`. */
export function gs1ContentToDataMatrixFd(content: string): string {
  const fnc1 = ESC + "1";
  // A trailing GS would emit a dangling FNC1 (separator with no data); drop it.
  let body = content;
  while (body.endsWith(GS1_GS)) body = body.slice(0, -1);
  return fnc1 + body.split(GS1_GS).map(escapeRun).join(fnc1);
}

/** Inverse of gs1ContentToDataMatrixFd. Returns null when `fd` lacks the
 *  leading FNC1, so the caller keeps non-GS1 field data verbatim. */
export function dataMatrixFdToGs1Content(fd: string, escape: string): string | null {
  const fnc1 = escape + "1";
  if (!fd.startsWith(fnc1)) return null;
  return decodeEscapes(fd, escape, fnc1.length);
}

/** Typed `(AI)value…` content into the ^BX payload while the values are still
 *  opaque: the AI codes are literal, so parentheses and FNC1 placement are
 *  already decidable. Null when the content is not in the typed form. */
export function typedGs1ToDataMatrixFd(content: string): string | null {
  const parts = typedGs1Parts(content);
  if (!parts) return null;
  const fnc1 = ESC + "1";
  let out = fnc1;
  for (const [index, part] of parts.entries()) {
    // Same completion the literal path applies, or the bound form would carry
    // a different AI-01 payload than the same content written out.
    out += escapeRun(`${part.ai}${typedSegmentValue(part.ai, part.value)}`);
    const spec = aiSpec(part.ai);
    if (spec && isVariableKind(spec.kind) && index < parts.length - 1) out += fnc1;
  }
  return out;
}

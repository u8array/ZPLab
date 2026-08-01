/** Code 128 subset-invocation coding for ^BC field data (spec p.95-99).
 *
 *  The firmware drops ^FH-escaped C0 bytes from the symbol (ZD230-verified);
 *  only the invocation form encodes them. Emit and canvas share the planned
 *  symbol values, so printed module count equals rendered by construction
 *  (shared ^FN slots excepted: they emit raw and preflight warns). */

import { mapLiteralSpans } from "./fnTemplate";

const START_A = 103;
const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_A = 101;

/** Subset A: C0 bytes plus SP..`_`. */
function valueInA(code: number): number | null {
  if (code < 32) return code + 64;
  if (code <= 95) return code - 32;
  return null;
}

/** Subset B: SP..DEL. */
function valueInB(code: number): number | null {
  if (code < 32 || code > 127) return null;
  return code === 127 ? 95 : code - 32;
}

function charFromA(value: number): string {
  return String.fromCharCode(value < 64 ? value + 32 : value - 64);
}

function charFromB(value: number): string {
  return String.fromCharCode(value === 95 ? 127 : value + 32);
}

// eslint-disable-next-line no-control-regex
const C0_BYTE = /[\x00-\x1F]/;

export function hasControlBytes(text: string): boolean {
  return C0_BYTE.test(text);
}

/**
 * Symbol values (start code first, no check/stop) for `text`, using Subsets A
 * and B only. Numeric compaction is left out on purpose: one symbol per
 * character keeps the plan trivially reproducible on both sides. Returns null
 * when a character fits neither subset.
 */
export function planCode128Symbols(text: string): number[] | null {
  if (!text) return null;
  const codes = [...text].map((ch) => (ch.codePointAt(0) ?? 0));
  // Start with whichever subset the first subset-exclusive character needs, so
  // an all-A or all-B payload never pays for a switch.
  let inA = true;
  for (const code of codes) {
    const a = valueInA(code);
    const b = valueInB(code);
    if (a === null && b === null) return null;
    if (a === null) { inA = false; break; }
    if (b === null) break;
  }
  const values = [inA ? START_A : START_B];
  for (const code of codes) {
    let value = inA ? valueInA(code) : valueInB(code);
    if (value === null) {
      values.push(inA ? CODE_B : CODE_A);
      inA = !inA;
      value = inA ? valueInA(code) : valueInB(code);
      if (value === null) return null;
    }
    values.push(value);
  }
  return values;
}

/** Literal escapes (spec p.96, Table 2); same codes in Subsets A and B, the
 *  values here are Subset B's. */
const B_LITERAL_ESCAPE = new Map([
  [30, ">0"], // >
  [62, "><"], // ^
  [94, ">="], // ~
  [95, ">1"], // DEL
]);

/** Escape char (without the `>`) back to its symbol value. */
const ESCAPE_VALUE = new Map(
  [...B_LITERAL_ESCAPE].map(([value, esc]) => [esc.slice(1), value] as const),
);

/** Bare `>` needs `>0` (it reads as an invocation prefix); `^`/`~` need
 *  `><`/`>=` (firmware drops their ^FH hex form from the symbol, ZD230). A `>`
 *  opening a valid invocation code stays verbatim (unmodelled import). */
export function code128PlainFd(text: string): string {
  return text
    .replace(/>(?![0-9:;<=])/g, ">0")
    .replace(/\^/g, "><")
    .replace(/~/g, ">=");
}

/** Inverse of {@link code128PlainFd}; consumed via
 *  {@link code128DecodeLiterals}, whose callers gate on byte-identity. */
function code128PlainFdDecode(fd: string): string {
  return fd.replace(/>([0<=])/g, (_, c: string) => (c === "0" ? ">" : c === "<" ? "^" : "~"));
}

/** Span-limited plain escape: marker bodies survive (names may carry
 *  `>`/`^`/`~`), only literal spans feed the Code 128 FD grammar. Shared by
 *  emit, preview chain and the parser's reversal gate. */
export function code128EscapeLiterals(content: string): string {
  return mapLiteralSpans(content, code128PlainFd);
}

/** Inverse of {@link code128EscapeLiterals}; callers gate adoption on
 *  re-escaping byte-identically. */
export function code128DecodeLiterals(content: string): string {
  return mapLiteralSpans(content, code128PlainFdDecode);
}

/** Symbol values as a ^FD payload in invocation form. */
export function code128SymbolsToFd(values: readonly number[]): string {
  let inA = values[0] === START_A;
  let out = inA ? ">9" : ">:";
  for (const value of values.slice(1)) {
    if (value === CODE_B) { out += ">6"; inA = false; continue; }
    if (value === CODE_A) { out += ">7"; inA = true; continue; }
    out += inA
      ? String(value).padStart(2, "0")
      : B_LITERAL_ESCAPE.get(value) ?? charFromB(value);
  }
  return out;
}

/** Symbol values as bwip `raw` field data (three-digit `^NNN` values). */
export function code128SymbolsToBwipRaw(values: readonly number[]): string {
  return values.map((v) => `^${String(v).padStart(3, "0")}`).join("");
}

/** `text` (raw bytes) as an invocation-form ^FD payload; null when it holds no
 *  control byte or does not encode. */
export function code128ControlFd(text: string): string | null {
  if (!hasControlBytes(text)) return null;
  const values = planCode128Symbols(text);
  return values ? code128SymbolsToFd(values) : null;
}

/** {@link code128ControlFd}'s canvas twin: the same plan as bwip raw data. */
export function code128ControlBwipRaw(text: string): string | null {
  if (!hasControlBytes(text)) return null;
  const values = planCode128Symbols(text);
  return values ? code128SymbolsToBwipRaw(values) : null;
}

/** Shared Table-2 walk over a ^BC ^FD payload: symbol values plus the data
 *  characters the interpretation line shows. `ok` is false when a byte fits no
 *  subset (the only unreadable case under the lenient rules). */
function readCode128Fd(fd: string): { values: number[]; text: string; ok: boolean } {
  let mode: "A" | "B" | "C" = "B";
  let i = 0;
  const values = [START_B];
  if (fd.startsWith(">9")) { mode = "A"; values[0] = START_A; i = 2; }
  else if (fd.startsWith(">:")) { i = 2; }
  else if (fd.startsWith(">;")) { mode = "C"; values[0] = START_C; i = 2; }
  // SHIFT reads exactly the next character in the other subset (A<->B).
  let shifted = false;
  let text = "";
  let ok = true;
  while (i < fd.length) {
    const litMode = shifted ? (mode === "A" ? "B" : "A") : mode;
    if (fd[i] === ">") {
      const esc = fd[i + 1];
      i += 2;
      const literal = esc === undefined ? undefined : ESCAPE_VALUE.get(esc);
      if (literal !== undefined && litMode !== "C") {
        values.push(literal);
        text += litMode === "A" ? charFromA(literal) : charFromB(literal);
        shifted = false;
        continue;
      }
      // FNC symbols consume a pending SHIFT; the shift never reaches past them.
      switch (esc) {
        case "2": if (litMode !== "C") values.push(96); shifted = false; continue; // FNC3
        case "3": if (litMode !== "C") values.push(97); shifted = false; continue; // FNC2
        case "4":
          if (mode === "C") continue;
          values.push(98);
          shifted = true;
          continue;
        // Table 2's C column is blank for >5 and SHIFT: ignored there.
        case "5": if (mode !== "C") { values.push(99); mode = "C"; } shifted = false; continue;
        // Value 100 is CODE B from A/C and FNC4 from B; 101 is CODE A from
        // B/C and FNC4 from A. Either way the subset afterwards is the same.
        case "6": values.push(100); mode = "B"; shifted = false; continue;
        case "7": values.push(101); mode = "A"; shifted = false; continue;
        case "8": values.push(102); shifted = false; continue; // FNC1
        // Firmware swallows `>` plus an invalid escape char from the symbol
        // (ZD230-measured on a bare `>`), so model the same loss. `><`/`>=`
        // in C land here too (see the literal gate above).
        default: continue;
      }
    }
    // A/C data is two-digit values, B is ASCII (p.98). Lenient per p.99:
    // noninteger at D1 ignored, at D2 kills the pair, unpaired digit dropped.
    if (litMode !== "B") {
      const d1 = fd[i];
      if (!/\d/.test(d1 ?? "")) { i += 1; continue; }
      const d2 = fd[i + 1];
      if (d2 === undefined || d2 === ">") { i += 1; continue; }
      i += 2;
      if (!/\d/.test(d2)) continue;
      const value = parseInt(d1 + d2, 10);
      values.push(value);
      if (litMode === "C") text += d1 + d2;
      else if (value <= 95) text += charFromA(value);
      shifted = false;
      continue;
    }
    const value = valueInB(fd.charCodeAt(i));
    if (value === null) { ok = false; text += fd[i]; i += 1; continue; }
    values.push(value);
    text += fd[i];
    shifted = false;
    i += 1;
  }
  return { values, text, ok };
}

/**
 * Full Table-2 read of a ^BC ^FD payload as symbol values (start code first,
 * no check/stop), the firmware's lenient interpretation for rendering. Unlike
 * {@link code128FdToBytes} it keeps FNC/SHIFT/Subset-C streams the model
 * cannot represent. Null only for a byte no subset carries.
 */
export function code128FdToSymbols(fd: string): number[] | null {
  const r = readCode128Fd(fd);
  return r.ok ? r.values : null;
}

/** Data characters of a ^BC ^FD payload as the firmware's interpretation line
 *  prints them: invocation codes decode, FNC/SHIFT/switch symbols show nothing
 *  (spec p.98, Figures 3/4 render ^FDCODE128 and ^FD>:CODE128 identically). */
export function code128FdToDisplayText(fd: string): string {
  return readCode128Fd(fd).text;
}

/**
 * Inverse of {@link code128SymbolsToFd}: an invocation-form ^FD payload back to
 * its raw bytes. Deliberately STRICTER than {@link code128FdToSymbols}: it
 * gates parser adoption, so anything the emit would not reproduce byte-
 * identically (FNC/SHIFT escapes, Subset C, malformed pairs) returns null.
 */
export function code128FdToBytes(fd: string): string | null {
  // No start code means Subset B (spec p.98).
  let mode: "A" | "B" | "C" = "B";
  let out = "";
  let i = 0;
  if (fd.startsWith(">9")) { mode = "A"; i = 2; }
  else if (fd.startsWith(">:")) { mode = "B"; i = 2; }
  else if (fd.startsWith(">;")) { mode = "C"; i = 2; }
  while (i < fd.length) {
    if (fd[i] === ">") {
      const esc = fd[i + 1];
      i += 2;
      // Table 2 is read per source subset: the same escape is a switch from one
      // subset and FNC4 from the other, and Subset C has no literal column.
      const literal = esc === undefined ? undefined : ESCAPE_VALUE.get(esc);
      if (literal !== undefined) {
        if (mode === "C") return null;
        out += mode === "A" ? charFromA(literal) : charFromB(literal);
        continue;
      }
      switch (esc) {
        case "5": mode = "C"; continue;
        case "6": if (mode === "B") return null; mode = "B"; continue;
        case "7": if (mode === "A") return null; mode = "A"; continue;
        default: return null;
      }
    }
    if (mode === "B") { out += fd[i]; i += 1; continue; }
    const pair = fd.slice(i, i + 2);
    if (!/^\d\d$/.test(pair)) return null;
    i += 2;
    if (mode === "C") { out += pair; continue; }
    const value = parseInt(pair, 10);
    if (value > 95) return null;
    out += charFromA(value);
  }
  return out;
}

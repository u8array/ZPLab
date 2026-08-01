/** Code 128 subset-invocation coding for ^BC field data.
 *
 *  ^FH hex escapes reach the firmware but the Code 128 encoder drops every C0
 *  byte from the symbol (ZD230- and Labelary-verified). The spec's only way to
 *  encode them is the invocation form: a start code (`>9` Subset A) plus
 *  two-digit values per character, with `>6`/`>7` switching subsets mid-field
 *  (spec p.95-99, Table 2/3).
 *
 *  Emit and canvas share the planned symbol values, so the printed module count
 *  is the rendered one by construction instead of by matching bwip's heuristic.
 */

export const START_A = 103;
export const START_B = 104;
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

/** Subset B literals that would otherwise terminate or escape the field
 *  (spec p.96, Table 2). */
const B_LITERAL_ESCAPE = new Map([
  [30, ">0"], // >
  [62, "><"], // ^
  [94, ">="], // ~
  [95, ">1"], // DEL
]);

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

/**
 * Inverse of {@link code128SymbolsToFd}: an invocation-form ^FD payload back to
 * its raw bytes. Subset C pairs decode to their two digits. Returns null on an
 * FNC/SHIFT escape or malformed pair, which the model cannot represent.
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
      switch (esc) {
        case "0": if (mode !== "B") return null; out += ">"; continue;
        case "<": if (mode !== "B") return null; out += "^"; continue;
        case "=": if (mode !== "B") return null; out += "~"; continue;
        case "1": if (mode !== "B") return null; out += "\x7F"; continue;
        case "5": mode = "C"; continue;
        case "6": mode = "B"; continue;
        case "7": mode = "A"; continue;
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

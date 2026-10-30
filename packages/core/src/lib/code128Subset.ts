/** Code 128 subset-invocation coding for ^BC field data (spec p.95-99).
 *
 *  At m=N the firmware drops ^FH-escaped C0 bytes from the symbol (ZD230-verified).
 *  Only the invocation form encodes them, and the canvas reads the emitted ^FD
 *  back through the same Table-2 walk, so printed module count equals
 *  rendered by construction (shared ^FN slots excepted: they emit raw and
 *  preflight warns). At m=A the firmware reads the payload literally and packs
 *  it itself, so the canvas plans the bytes. */

import { mapLiteralSpans } from "./fnTemplate";
import { C0_OR_DEL_RE } from "../types/controlKey";

const START_A = 103;
const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_A = 101;
const CODE_C = 99;
const SHIFT = 98;
const FNC3 = 96;
const FNC2 = 97;
const FNC1 = 102;

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

/** DEL included: Subset B carries it as value 95 (`>1`), so it takes the
 *  invocation path like the C0 range instead of shipping as a raw byte. */
export function hasControlBytes(text: string): boolean {
  return C0_OR_DEL_RE.test(text);
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

/** Encoder position: Subset A, Subset B, or Subset C with the pairs of its stretch so far, capped at two. */
type State = "A" | "B" | 0 | 1 | 2;
const STATES: readonly State[] = ["B", "A", 0, 1, 2];
const C_AFTER_PAIR: Record<0 | 1 | 2, 1 | 2> = { 0: 1, 1: 2, 2: 2 };
const START: Record<"A" | "B" | 0, number> = { A: START_A, B: START_B, 0: START_C };
const CODE: Record<"A" | "B" | 0, number> = { A: CODE_A, B: CODE_B, 0: CODE_C };

/** The last two terms exist only to break symbol-count ties as ISO/IEC 15417 Annex E does, which opens C for four digits. */
interface Cost {
  symbols: number;
  shortStretches: number;
  pairs: number;
}

const cheaper = (a: Cost, b: Cost): boolean =>
  a.symbols !== b.symbols ? a.symbols < b.symbols : a.shortStretches !== b.shortStretches ? a.shortStretches < b.shortStretches : a.pairs > b.pairs;

const add = (step: Cost, tail: Cost): Cost => ({ symbols: step.symbols + tail.symbols, shortStretches: step.shortStretches + tail.shortStretches, pairs: step.pairs + tail.pairs });

/** Annex E's four-digit rule prefers a C stretch of two pairs, so a shorter one costs. */
const shortLeave = (state: State): number => (state === 0 || state === 1 ? 1 : 0);

const letterValue = (subset: "A" | "B", code: number): number | null => (subset === "A" ? valueInA(code) : valueInB(code));
const other = (subset: "A" | "B"): "A" | "B" => (subset === "A" ? "B" : "A");

interface Move {
  emits: number[];
  consumed: number;
  to: State;
  cost: Cost;
}

const move = (emits: number[], consumed: number, to: State, shortStretches = 0, pairs = 0): Move => ({ emits, consumed, to, cost: { symbols: emits.length, shortStretches, pairs } });

/** Moves at `i`. `cheaper` is strict, so this order decides every tie. */
function movesAt(text: string, i: number, from: State): Move[] {
  const code = text.charCodeAt(i);
  const next = text.charCodeAt(i + 1);
  const pair = /\d/.test(text.charAt(i)) && /\d/.test(text.charAt(i + 1)) ? (code - 48) * 10 + (next - 48) : undefined;
  if (from === 0 || from === 1 || from === 2) {
    if (pair !== undefined) return [move([pair], 2, C_AFTER_PAIR[from], 0, 1)];
    const leave = shortLeave(from);
    return (["B", "A"] as const).flatMap((subset) => {
      const value = letterValue(subset, code);
      return value === null ? [] : [move([CODE[subset], value], 1, subset, leave)];
    });
  }
  const own = letterValue(from, code);
  const away = letterValue(other(from), code);
  const moves: Move[] = [];
  if (own !== null) moves.push(move([own], 1, from));
  if (pair !== undefined) moves.push(move([CODE_C, pair], 2, 1, 0, 1));
  if (away !== null) moves.push(move([SHIFT, away], 1, from), move([CODE[other(from)], away], 1, other(from)));
  return moves;
}

/** Symbol values (start code first, no check and stop) for ^BC mode A: the cheapest plan over Subsets A, B and C,
 *  ties read as ISO/IEC 15417 Annex E does. Null for no data or a byte above DEL. Which digit of an odd run the
 *  firmware leaves in B is unmeasured. */
export function planCode128AutoSymbols(text: string): number[] | null {
  if (text === "" || [...text].some((ch) => ch.charCodeAt(0) > 127)) return null;
  const key = (i: number, state: State): string => `${i}:${state}`;
  // Filled from the end, so a move's tail is scored before the move.
  const plan = new Map<string, { cost: Cost; move: Move }>();
  const planned = (i: number, state: State): { cost: Cost; move: Move } => {
    const entry = plan.get(key(i, state));
    if (entry === undefined) throw new Error("plan table filled from the end");
    return entry;
  };
  const tail = (i: number, state: State): Cost =>
    i === text.length ? { symbols: 0, shortStretches: shortLeave(state), pairs: 0 } : planned(i, state).cost;
  for (let i = text.length - 1; i >= 0; i -= 1) {
    for (const state of STATES) {
      let best: { cost: Cost; move: Move } | undefined;
      for (const candidate of movesAt(text, i, state)) {
        const cost = add(candidate.cost, tail(i + candidate.consumed, candidate.to));
        if (best === undefined || cheaper(cost, best.cost)) best = { cost, move: candidate };
      }
      if (best !== undefined) plan.set(key(i, state), best);
    }
  }
  const start = (state: "A" | "B" | 0): Cost => add({ symbols: 1, shortStretches: 0, pairs: 0 }, tail(0, state));
  // A full tie opens in C for a leading run, and in B before A, as Annex E does.
  let state: State = cheaper(start("B"), start(0)) ? "B" : 0;
  if (cheaper(start("A"), start(state))) state = "A";
  const values = [START[state]];
  for (let i = 0; i < text.length; ) {
    const { move } = planned(i, state);
    values.push(...move.emits);
    state = move.to;
    i += move.consumed;
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

const ESCAPE_SYMBOL = new Map([
  ["2", FNC3],
  ["3", FNC2],
  ["4", SHIFT],
  ["5", CODE_C],
  ["6", CODE_B],
  ["7", CODE_A],
  ["8", FNC1],
]);

/** Shared Table-2 walk over a ^BC ^FD payload: symbol values plus the data
 *  characters the interpretation line shows. `ok` is false when a byte fits no
 *  subset (the only unreadable case under the lenient rules). */
function readCode128Fd(fd: string): { values: number[]; text: string; ok: boolean } {
  let subset: "A" | "B" | "C" = "B";
  let i = 0;
  const values = [START_B];
  if (fd.startsWith(">9")) { subset = "A"; values[0] = START_A; i = 2; }
  else if (fd.startsWith(">:")) { i = 2; }
  else if (fd.startsWith(">;")) { subset = "C"; values[0] = START_C; i = 2; }
  // A SHIFT's effect reaches the next emitted symbol, so it outlasts the
  // bytes the pair rule drops, ZD230-measured.
  let shifted = false;
  const readingSubset = (): "A" | "B" | "C" => (shifted ? (subset === "A" ? "B" : "A") : subset);
  const emit = (value: number): void => {
    shifted = false;
    values.push(value);
  };
  let text = "";
  // Value 100 is CODE B from A and C but FNC4 from B, 101 is CODE A from B
  // and C but FNC4 from A, read in the subset a SHIFT selects (p.96).
  // Table 2's C column is blank for SHIFT, CODE C, FNC2 and FNC3.
  const symbol = (value: number): void => {
    const reading = readingSubset();
    if (value === SHIFT) {
      if (reading !== "C") {
        values.push(SHIFT);
        shifted = true;
      }
    } else if (value === CODE_C) {
      if (reading !== "C") { emit(CODE_C); subset = "C"; }
    } else if (value === CODE_B) {
      emit(CODE_B);
      if (reading !== "B") subset = "B";
    } else if (value === CODE_A) {
      emit(CODE_A);
      if (reading !== "A") subset = "A";
    } else if (value === FNC1 || reading !== "C") {
      emit(value);
    }
  };
  let ok = true;
  while (i < fd.length) {
    const reading = readingSubset();
    if (fd[i] === ">") {
      const esc = fd[i + 1];
      i += 2;
      const literal = esc === undefined ? undefined : ESCAPE_VALUE.get(esc);
      if (literal !== undefined && reading !== "C") {
        text += reading === "A" ? charFromA(literal) : charFromB(literal);
        emit(literal);
        continue;
      }
      // The firmware swallows a `>` whose escape char means nothing in this
      // subset, ZD230-measured on a bare `>`.
      const value = esc === undefined ? undefined : ESCAPE_SYMBOL.get(esc);
      if (value !== undefined) symbol(value);
      continue;
    }
    // A/C data is two-digit values, B is ASCII (p.98). Lenient per p.99:
    // noninteger at D1 ignored, at D2 kills the pair, unpaired digit dropped.
    if (reading !== "B") {
      const d1 = fd.charAt(i);
      const d2 = fd.charAt(i + 1);
      if (!/\d/.test(d1)) { i += 1; continue; }
      if (d2 === ">") { i += 1; continue; }
      i += 2;
      if (!/\d/.test(d2)) continue;
      const pair = parseInt(d1 + d2, 10);
      if (reading === "A" && pair >= 96) { symbol(pair); continue; }
      text += reading === "C" ? d1 + d2 : charFromA(pair);
      emit(pair);
      continue;
    }
    const value = valueInB(fd.charCodeAt(i));
    if (value === null) { ok = false; text += fd.charAt(i); i += 1; continue; }
    text += fd.charAt(i);
    emit(value);
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
  let subset: "A" | "B" | "C" = "B";
  let out = "";
  let i = 0;
  if (fd.startsWith(">9")) { subset = "A"; i = 2; }
  else if (fd.startsWith(">:")) { subset = "B"; i = 2; }
  else if (fd.startsWith(">;")) { subset = "C"; i = 2; }
  while (i < fd.length) {
    if (fd[i] === ">") {
      const esc = fd[i + 1];
      i += 2;
      // Table 2 is read per source subset: the same escape is a switch from one
      // subset and FNC4 from the other, and Subset C has no literal column.
      const literal = esc === undefined ? undefined : ESCAPE_VALUE.get(esc);
      if (literal !== undefined) {
        if (subset === "C") return null;
        out += subset === "A" ? charFromA(literal) : charFromB(literal);
        continue;
      }
      const value = esc === undefined ? undefined : ESCAPE_SYMBOL.get(esc);
      if (value === CODE_C) { subset = "C"; continue; }
      if (value === CODE_B && subset !== "B") { subset = "B"; continue; }
      if (value === CODE_A && subset !== "A") { subset = "A"; continue; }
      return null;
    }
    if (subset === "B") { out += fd[i]; i += 1; continue; }
    const pair = fd.slice(i, i + 2);
    if (!/^\d\d$/.test(pair)) return null;
    i += 2;
    if (subset === "C") { out += pair; continue; }
    const value = parseInt(pair, 10);
    if (value > 95) return null;
    out += charFromA(value);
  }
  return out;
}

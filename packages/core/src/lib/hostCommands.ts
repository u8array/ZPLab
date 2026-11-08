import { commandSyntax, commandTakesPrefix, isHostCommand } from "../catalog";
import { CONTROL_BYTES_RE } from "./binaryText";
import { printQuantityOf } from "./printQuantity";
import { canonicalStoredFormatPath, isStoredFormatPath, recallKeys, storageKey } from "./storagePath";
import { applyPrefixRemap, fhBytes, fhIndicator, getDecoder, inRange, int, strParam, stripDataLineBreaks, tokenize, type TokenizerChars } from "./zplParser/helpers";

/** A canonical line is a two-letter id behind its prefix, then the parameters. */
export const hostCommandParts = (line: string): { id: string; params: string } => ({ id: line.slice(0, 3), params: line.slice(3) });

/** ^HV returns a ^FN field of its own format, so unlike its section mates it stays with the fields. */
export const isFieldHostCommand = (id: string): boolean => id === "^HV";

export interface FieldHostParams {
  slot: number;
  /** How many bytes of the field the reply carries, 1 to 256, and 64 where unspelled or out of range, spec p.239. */
  bytes: number;
  header: string;
  terminator: string;
  perLabel: boolean;
}

const REPLY_BYTES = { min: 1, max: 256 };

export function fieldHostParams(params: string, delimiter = ","): FieldHostParams {
  const [slot = "", bytes = "", header = "", terminator = "", per = ""] = params.split(delimiter);
  return { slot: int(slot), bytes: inRange(Number.parseInt(bytes, 10), REPLY_BYTES) ?? 64, header, terminator, perLabel: strParam(per) === "L" };
}

const fieldSlotOf = (line: string): number => fieldHostParams(hostCommandParts(line).params).slot;

function withFieldSlot(line: string, slot: number): string {
  const { id, params } = hostCommandParts(line);
  const [, ...rest] = params.split(",");
  return [`${id}${slot}`, ...rest].join(",");
}

/** The ^HV lines follow a renumbered slot, since the field they name moved with it. */
export function renumberFieldHostCommands(lines: readonly string[], slots: ReadonlyMap<number, number>): string[] {
  return lines.map((line) => {
    if (!isFieldHostCommand(hostCommandParts(line).id)) return line;
    const moved = slots.get(fieldSlotOf(line));
    return moved === undefined ? line : withFieldSlot(line, moved);
  });
}

/** ^HV's header and terminator are field data, so its padding is the author's bytes, not the stream's. */
const keepsPadding = (id: string): boolean => id === "^HV";

/** The bytes behind the id that are the command's own: none where the catalog's syntax takes no parameter, since the rest
 *  is the field data around it. A line break around them is always the stream's. */
const hostCommandParams = (id: string, rest: string): string => {
  if (commandSyntax(id) === id) return "";
  return keepsPadding(id) ? rest.replace(/^[\r\n]+|[\r\n]+$/g, "") : rest.trim();
};

/** A page's questions by where they go. */
export interface HostCommandPlacement {
  /** Ahead of the format, where an immediate command answers with no partial format in its status. */
  immediate: readonly string[];
  /** Once in the head, ahead of a ^DF that would store it. */
  head: readonly string[];
  field: readonly string[];
}

export function splitHostCommands(lines: readonly string[] = []): HostCommandPlacement {
  const id = (line: string) => hostCommandParts(line).id;
  return {
    immediate: lines.filter((line) => id(line).startsWith("~")),
    head: lines.filter((line) => id(line).startsWith("^") && !isFieldHostCommand(id(line))),
    field: lines.filter((line) => isFieldHostCommand(id(line))),
  };
}

/** The params as the generator spells them, the delimiter the syntax spells back to a comma.
 *  No such spelling exists for a literal comma in a remapped list, or for a remapped delimiter that is also a character
 *  of the syntax's own punctuation, such as the colon of a d:o.x path. */
function canonicalHostParams(id: string, params: string, delimiter: string): string | undefined {
  const syntax = commandSyntax(id).slice(3);
  const listed = delimiter !== "," && syntax.includes(",");
  if (listed && params.includes(",")) return undefined;
  const punctuation = syntax.replace(/[A-Za-z0-9,]/g, "");
  if (listed && punctuation.includes(delimiter) && params.includes(delimiter)) return undefined;
  const spelled = listed ? params.split(delimiter).join(",") : params;
  return isHostCommandLine(`${id}${spelled}`) ? spelled : undefined;
}

const PLAIN_CHARS: TokenizerChars = { caretChar: "^", tildeChar: "~", delimiterChar: "," };

/** One host command and nothing else, spelled as the generator spells it, so a line regenerates into a block without other bytes riding in. */
export function isHostCommandLine(line: string): boolean {
  if (/[\r\n]/.test(line) || CONTROL_BYTES_RE.test(line)) return false;
  const [only, ...rest] = [...hostCommandTokens(line, { ...PLAIN_CHARS })];
  return rest.length === 0 && only?.start === 0 && only.end === line.length && `${only.id}${hostCommandParams(only.id, hostCommandParts(line).params)}` === line;
}

interface CommandToken {
  /** Canonical prefix and name, so a remapped caret still reads as `^`. */
  id: string;
  rest: string;
  start: number;
  end: number;
}

/** Every command in `zpl` but the ^CC, ^CT and ^CD that remap `chars` as they go, like the parser. */
function* commandTokens(zpl: string, chars: TokenizerChars): Generator<CommandToken> {
  for (const t of tokenize(zpl, chars)) {
    const id = `${zpl[t.start] === chars.caretChar ? "^" : "~"}${t.cmd}`;
    if (applyPrefixRemap(chars, t.cmd, t.rest[0])) continue;
    yield { id, rest: t.rest, start: t.start, end: t.end };
  }
}

interface HostCommandToken {
  id: string;
  params: string;
  start: number;
  end: number;
}

/** Whether `zpl` holds a caret command the printer honours only inside an open format. */
export function needsOpenFormat(zpl: string): boolean {
  for (const t of commandTokens(zpl, { ...PLAIN_CHARS })) {
    if (t.id.startsWith("^") && !commandTakesPrefix(t.id.slice(1), "~")) return true;
  }
  return false;
}

/** The host commands in `zpl` in the order the printer meets them. */
export function* hostCommandTokens(zpl: string, chars: TokenizerChars): Generator<HostCommandToken> {
  for (const t of commandTokens(zpl, chars)) {
    if (isHostCommand(t.id)) yield { id: t.id, params: hostCommandParams(t.id, t.rest), start: t.start, end: t.end };
  }
}

/** Where the printer answers a host command: an immediate one anywhere, a format one only inside an open format, stored
 *  behind the block's ^DF and ignored otherwise. */
export type HostAsk = "asked" | "ignored" | "stored";

export interface HostCommandAsk extends HostCommandToken {
  ask: HostAsk;
  /** False where the document's delimiter cannot be spelled back to a comma, so `params` are the raw bytes. */
  canonical: boolean;
  /** What `params` split by: the comma of the canonical spelling, or the document's delimiter where none exists. */
  delimiter: string;
  /** The ^FD a ^HV may return, cut to its bytes: the stored format's, which seals the slot on the ZD230, and the printing
   *  format's, which prints as a stray field, since which of the two the reply carries is unmeasured. */
  data: string[];
  /** The ^FH indicator in force, under which the printer decodes a hex-spelled header or terminator, spec p.239. */
  fhIndicator?: string;
  /** How many labels the format that answers it prints, from the last ^PQ the printer meets in that format. Zero where
   *  no format answers it, or where that format only stores or holds no field. */
  labels: number;
  /** False where the document cannot vouch for the replies, see FILLS_FIELD and TOUCHES_TAG. */
  vouched: boolean;
}

export const sentBytes = (text: string, fhIndicator: string | undefined): Uint8Array => (fhIndicator === undefined ? new TextEncoder().encode(text) : fhBytes(text, fhIndicator));

/** As the transport hands a reply over, decoded as UTF-8 with replacement. */
export const received = (bytes: Uint8Array): string => getDecoder("utf-8").decode(bytes);

interface FieldClose {
  kind: "field";
  slot: number | undefined;
  data: Uint8Array | undefined;
  filled: boolean;
}

interface OpenField {
  slot?: number;
  data?: Uint8Array;
  filled: boolean;
  /** The command brings the field's data itself, so the field holds content without ^FD. */
  sourced: boolean;
  fhIndicator?: string;
}

/** What a format has done so far. Its questions learn the ^PQ and the field data when it closes. */
interface OpenFormat {
  answered: HostCommandAsk[];
  labels: number;
  /** The field data by slot that the format spells itself. */
  fields: Map<number, Uint8Array>;
  /** The field data by slot from the frames it recalls. */
  stored: Map<number, Uint8Array>;
  filledSlots: Set<number>;
  touchesTag: boolean;
  /** An empty format prints no label. A recall the document does not hold may fill it. */
  blank: boolean;
}

const freshFormat = (): OpenFormat => ({ answered: [], labels: 1, fields: new Map(), stored: new Map(), filledSlots: new Set(), touchesTag: false, blank: true });

/** What a format does in printer order. A storing format keeps it as its frame, replayed at every recall. */
type FrameEntry =
  | { kind: "ask"; ask: HostCommandAsk }
  | { kind: "recall"; path: string }
  | { kind: "quantity"; labels: number }
  | FieldClose
  | { kind: "touchesTag" }
  | { kind: "serialised" };

/** ^SN and ^SF fill their field at print time, spec p.341 and p.335. */
const FILLS_FIELD = new Set(["^SN", "^SF"]);

/** An ^RF with operation R or P reads the tag into its field, spec p.426. */
const readsTag = (id: string, rest: string): boolean => id === "^RF" && /^\s*[RP]/i.test(rest);

/** A tag read, write or lock that fails voids the label and prints it again, spec p.434. */
const TOUCHES_TAG = new Set(["^RF", "^RL", "^RU", "^RI", "^RT", "^WT"]);

export interface HostCommandWalk {
  asks: HostCommandAsk[];
  /** False where the document recalls a frame it does not hold, which may print, count, fill or ask unseen. */
  held: boolean;
  /** The labels the document prints, summed over the formats that print. */
  labels: number;
}

/** The host commands in `zpl` in printer order with their {@link HostAsk}. A stored command is listed again as asked at
 *  every ^XF of its frame, through the recalls the frame holds. */
export const hostCommandAsks = (zpl: string, chars: TokenizerChars = { ...PLAIN_CHARS }, formatOpen = false): HostCommandAsk[] => walkHostCommands(zpl, chars, formatOpen).asks;

export function walkHostCommands(zpl: string, chars: TokenizerChars = { ...PLAIN_CHARS }, formatOpen = false): HostCommandWalk {
  const frames = new Map<string, FrameEntry[]>();
  const asks: HostCommandAsk[] = [];
  let held = true;
  let labels = 0;
  let format = freshFormat();
  // ^RU puts the tag's serial into any ^FD from there on, spec p.439. Whether that ends with the format is unmeasured, so it is taken to last.
  let serialised = false;
  const recordField = ({ slot, data, filled }: FieldClose, into: Map<number, Uint8Array>) => {
    if (slot === undefined) return;
    if (data !== undefined) into.set(slot, data);
    if (filled || serialised) format.filledSlots.add(slot);
  };
  const slotData = ({ slot, bytes }: FieldHostParams): string[] =>
    [...new Set([format.stored.get(slot), format.fields.get(slot)].filter((data) => data !== undefined).map((data) => received(data.subarray(0, bytes))))];
  const closeFormat = (prints: boolean) => {
    const printed = prints && !format.blank ? format.labels : 0;
    labels += printed;
    for (const ask of format.answered) {
      ask.labels = printed;
      if (!isFieldHostCommand(ask.id)) continue;
      const params = fieldHostParams(ask.params, ask.delimiter);
      ask.data = slotData(params);
      ask.vouched = !format.filledSlots.has(params.slot) && !(params.perLabel && (format.touchesTag || serialised));
    }
    format = freshFormat();
  };
  const answer = (token: Omit<HostCommandAsk, "ask" | "labels">) => {
    const ask: HostCommandAsk = { ...token, ask: "asked", labels: 1 };
    asks.push(ask);
    format.answered.push(ask);
  };
  const apply = (entry: FrameEntry, into: Map<number, Uint8Array>, visited: ReadonlySet<string>) => {
    switch (entry.kind) {
      case "ask":
        answer(entry.ask);
        break;
      case "recall":
        recall(entry.path, visited);
        break;
      case "quantity":
        format.labels = entry.labels;
        break;
      case "field":
        format.blank = false;
        recordField(entry, into);
        break;
      case "touchesTag":
        format.touchesTag = true;
        break;
      case "serialised":
        serialised = true;
        break;
    }
  };
  // The visited set ends a recall cycle, so a frame that recalls itself stops there.
  const recall = (path: string, visited: ReadonlySet<string>) => {
    for (const key of recallKeys(path.trimEnd())) {
      const entries = frames.get(key);
      if (entries === undefined) continue;
      if (visited.has(key)) return;
      const seen = new Set(visited).add(key);
      for (const entry of entries) apply(entry, format.stored, seen);
      return;
    }
    held = false;
    format.blank = false;
  };
  let open = formatOpen;
  let frame: FrameEntry[] | undefined;
  const act = (entry: FrameEntry) => {
    if (frame !== undefined) frame.push(entry);
    else apply(entry, format.fields, new Set());
  };
  let named = false;
  let field: OpenField = { filled: false, sourced: false };
  const closeField = (sealed: boolean) => {
    if (open && (sealed || field.slot !== undefined || field.data !== undefined || field.sourced)) act({ kind: "field", slot: field.slot, data: field.data, filled: field.filled });
    field = { filled: false, sourced: false };
  };
  for (const t of commandTokens(zpl, chars)) {
    if (open && TOUCHES_TAG.has(t.id)) act({ kind: "touchesTag" });
    if (t.id === "^XA" || t.id === "^XZ") {
      closeField(false);
      closeFormat(frame === undefined);
      open = t.id === "^XA";
      frame = undefined;
      named = false;
    } else if (t.id === "^FH") {
      field.fhIndicator = fhIndicator(t.rest);
    } else if (t.id === "^FS") {
      closeField(true);
    } else if (FILLS_FIELD.has(t.id) || readsTag(t.id, t.rest)) {
      field.filled = true;
      // ^SF serialises the ^FD it follows, p.335, and brings no data of its own.
      if (t.id !== "^SF") field.sourced = true;
    } else if ((t.id === "^RT" || t.id === "^RI") && open) {
      // Both read the tag into the field their first parameter numbers, RFID Programming Guide p.115 and Guide 2 p.76.
      act({ kind: "field", slot: int(t.rest), data: undefined, filled: true });
    } else if (t.id === "^RU" && open) {
      act({ kind: "serialised" });
    } else if (t.id === "^FE" || t.id === "^FC") {
      // Ahead of the field's data, ^FE has the printer splice other fields into it, p.191, and ^FC the clock, p.189 and p.1614.
      if (field.data === undefined) field.filled = true;
    } else if (t.id === "^FN" && open) {
      // A bare ^FN numbers its field 0, spec p.200.
      field.slot = int(t.rest);
    } else if (t.id === "^FD" || t.id === "^FV") {
      const text = stripDataLineBreaks(t.rest);
      // An empty ^FV is ignored, spec p.207.
      if (t.id === "^FV" && text === "") continue;
      field.data = sentBytes(text, field.fhIndicator);
    } else if (t.id === "^DF" && open) {
      // The first ^DF opens the frame and the first usable path names it, as the parser keys its template.
      frame ??= [];
      const raw = t.rest.trimEnd();
      if (!named && isStoredFormatPath(raw)) {
        frames.set(storageKey(canonicalStoredFormatPath(raw)), frame);
        named = true;
      }
    } else if (t.id === "^XF" && open) {
      act({ kind: "recall", path: t.rest });
    } else if (t.id === "^PQ" && open) {
      const quantity = printQuantityOf(t.rest.split(chars.delimiterChar)[0]);
      if (quantity === undefined) continue;
      act({ kind: "quantity", labels: quantity });
    } else if (isHostCommand(t.id)) {
      const raw = hostCommandParams(t.id, t.rest);
      const spelled = canonicalHostParams(t.id, raw, chars.delimiterChar);
      const canonical = spelled !== undefined;
      const token = { id: t.id, params: spelled ?? raw, canonical, delimiter: canonical ? "," : chars.delimiterChar, data: [], vouched: true, fhIndicator: field.fhIndicator, start: t.start, end: t.end };
      if (t.id.startsWith("~") || (open && frame === undefined)) answer(token);
      else if (frame === undefined) asks.push({ ...token, ask: "ignored", labels: 0 });
      else {
        const ask: HostCommandAsk = { ...token, ask: "stored", labels: 0 };
        frame.push({ kind: "ask", ask });
        asks.push(ask);
      }
    }
  }
  closeFormat(frame === undefined);
  return { asks, held, labels };
}

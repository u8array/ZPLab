import { commandSyntax, commandTakesPrefix, isHostCommand } from "../catalog";
import { CONTROL_BYTES_RE } from "./binaryText";
import { canonicalStoredFormatPath, isStoredFormatPath, recallKeys, storageKey } from "./storagePath";
import { applyPrefixRemap, tokenize, type TokenizerChars } from "./zplParser/helpers";

/** A canonical line is a two-letter id behind its prefix, then the parameters. */
export const hostCommandParts = (line: string): { id: string; params: string } => ({ id: line.slice(0, 3), params: line.slice(3) });

/** ^HV returns a ^FN field of its own format, so unlike its section mates it stays with the fields. */
export const isFieldHostCommand = (id: string): boolean => id === "^HV";

const fieldSlotOf = (line: string): number => Number(hostCommandParts(line).params.split(",")[0]);

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
export const hostCommandParams = (id: string, rest: string): string => {
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

/** The command as the generator spells it: canonical prefix, and the delimiter the syntax spells back to a comma.
 *  No such spelling exists for a literal comma in a remapped list, or for a remapped delimiter that is also a character
 *  of the syntax's own punctuation, such as the colon of a d:o.x path. */
export function canonicalHostCommand(id: string, params: string, delimiter: string): string | undefined {
  const syntax = commandSyntax(id).slice(3);
  const listed = delimiter !== "," && syntax.includes(",");
  if (listed && params.includes(",")) return undefined;
  const punctuation = syntax.replace(/[A-Za-z0-9,]/g, "");
  if (listed && punctuation.includes(delimiter) && params.includes(delimiter)) return undefined;
  const spelled = `${id}${listed ? params.split(delimiter).join(",") : params}`;
  return isHostCommandLine(spelled) ? spelled : undefined;
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

interface HostCommandAsk extends HostCommandToken {
  ask: HostAsk;
}

/** A stored frame in printer order: its format questions and the recalls it makes, both resolved at its own recall. */
type FrameEntry = HostCommandAsk | { recall: string };

/** The host commands in `zpl` in printer order with their {@link HostAsk}. A stored command is listed again as asked at
 *  every ^XF of its frame, through the recalls the frame holds. */
export function* hostCommandAsks(zpl: string, chars: TokenizerChars, formatOpen = false): Generator<HostCommandAsk> {
  const frames = new Map<string, FrameEntry[]>();
  // The visited set ends a recall cycle, so a frame that recalls itself stops there.
  function* recalledAsks(path: string, visited: ReadonlySet<string>): Generator<HostCommandAsk> {
    for (const key of recallKeys(path.trimEnd())) {
      const entries = frames.get(key);
      if (entries === undefined) continue;
      if (visited.has(key)) return;
      const seen = new Set(visited).add(key);
      for (const entry of entries) {
        if ("recall" in entry) yield* recalledAsks(entry.recall, seen);
        else yield { ...entry, ask: "asked" };
      }
      return;
    }
  }
  let open = formatOpen;
  let frame: FrameEntry[] | undefined;
  let named = false;
  for (const t of commandTokens(zpl, chars)) {
    if (t.id === "^XA" || t.id === "^XZ") {
      open = t.id === "^XA";
      frame = undefined;
      named = false;
    } else if (t.id === "^DF" && open) {
      // The first ^DF opens the frame and the first usable path names it, as the parser keys its template.
      frame ??= [];
      const raw = t.rest.trimEnd();
      if (!named && isStoredFormatPath(raw)) {
        frames.set(storageKey(canonicalStoredFormatPath(raw)), frame);
        named = true;
      }
    } else if (t.id === "^XF" && open) {
      if (frame !== undefined) frame.push({ recall: t.rest });
      else yield* recalledAsks(t.rest, new Set());
    } else if (isHostCommand(t.id)) {
      const token = { id: t.id, params: hostCommandParams(t.id, t.rest), start: t.start, end: t.end };
      if (t.id.startsWith("~") || (open && frame === undefined)) yield { ...token, ask: "asked" };
      else if (frame === undefined) yield { ...token, ask: "ignored" };
      else {
        const stored: HostCommandAsk = { ...token, ask: "stored" };
        frame.push(stored);
        yield stored;
      }
    }
  }
}

/** The host commands a document asks, each spelling once, in the order the printer meets them. */
export function repliesToHost(zpl: string): string[] {
  const found: string[] = [];
  for (const t of hostCommandAsks(zpl, { ...PLAIN_CHARS })) {
    const spelled = `${t.id}${t.params}`;
    if (t.ask === "asked" && !found.includes(spelled)) found.push(spelled);
  }
  return found;
}

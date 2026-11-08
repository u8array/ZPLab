import { fieldHostParams, isFieldHostCommand, received, sentBytes, walkHostCommands, type FieldHostParams } from "./hostCommands";
import { framesReply, holdsFrameByte, leavesFrameOpen, outsideFrames } from "./hostStatus";

export interface ReplyMarks {
  header: string;
  terminator: string;
}

/** Where a scan stopped, `at` being the index behind the last mark it found. */
export interface ReplyScan {
  count: number;
  afterHeader: boolean;
  at: number;
}

/** Reads the replies with these marks left to right, so a mark counts once, from the start or from behind a header. */
export function scanReplies(text: string, marks: ReplyMarks, afterHeader = false): ReplyScan {
  const { header, terminator } = marks;
  let count = 0;
  let at = 0;
  if (header === "" && terminator === "") return { count, afterHeader, at };
  let wantsTerminator = afterHeader;
  for (;;) {
    if (header !== "" && !wantsTerminator) {
      const h = text.indexOf(header, at);
      if (h < 0) return { count, afterHeader: false, at };
      at = h + header.length;
    }
    wantsTerminator = false;
    if (terminator !== "") {
      const t = text.indexOf(terminator, at);
      if (t < 0) return { count, afterHeader: true, at };
      at = t + terminator.length;
    }
    count += 1;
  }
}

export const repliesIn = (text: string, marks: ReplyMarks): number => scanReplies(text, marks).count;

/** A mark that is only whitespace goes out all the same, yet a reader cannot tell it from the reply around it. */
const blankMark = (mark: string): boolean => mark !== "" && mark.trim() === "";

/** The marks a reader finds a ^HV reply by, undefined where it can find none. */
function fieldReplyMarks({ header, terminator }: Pick<FieldHostParams, "header" | "terminator">): ReplyMarks | undefined {
  if (holdsFrameByte(header) || holdsFrameByte(terminator) || blankMark(header) || blankMark(terminator)) return undefined;
  return header === "" && terminator === "" ? undefined : { header, terminator };
}

/** One ^HV spelling with its marks as the printer sends them, a ^FH spelling decoded. */
interface FieldReply extends ReplyMarks {
  command: string;
  /** How many replies this spelling earns over the whole document. */
  count: number;
  /** The distinct field data the document holds for the slot. */
  data: Set<string>;
}

/** A reply shape a reader waits for: the ^HV spellings that share a header and terminator, which is all it can tell apart. */
export interface AwaitedReply extends ReplyMarks {
  count: number;
  commands: string[];
}

/** What a document asks the printer and what comes back for it. */
export interface DocumentReplies {
  /** The host commands asked, each spelling once, in the order the printer meets them. */
  commands: string[];
  /** The ^HV replies a reader waits for, by the marks it finds them by. */
  awaited: AwaitedReply[];
  /** The ^HV spellings with no header or terminator a reader can find. */
  unmarked: string[];
  /** The ^HV spellings a reader would miscount, by their marks and the field data the document holds, or beside a reply
   *  it cannot frame off. */
  ambiguous: string[];
  /** The ^HV spellings the walk cannot vouch for, and all of them once the document recalls a frame it does not hold. */
  uncounted: string[];
}

interface ReplyGroup extends AwaitedReply {
  data: Set<string>;
}

const readerShape = ({ header, terminator, count, commands }: ReplyGroup): AwaitedReply => ({ header, terminator, count, commands });

function replyGroups(replies: Iterable<FieldReply>): ReplyGroup[] {
  const groups = new Map<string, ReplyGroup>();
  for (const reply of replies) {
    const marks = fieldReplyMarks(reply);
    if (marks === undefined) continue;
    const { header, terminator } = marks;
    const key = JSON.stringify([header, terminator]);
    const group = groups.get(key) ?? { header, terminator, count: 0, commands: [], data: new Set<string>() };
    group.count += reply.count;
    group.commands.push(reply.command);
    for (const data of reply.data) group.data.add(data);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** What a reader sees of a group's replies: the marks around the field data the document holds, and around an empty
 *  field, since a reply with data the document does not hold shows at least its marks. */
const replyTexts = (group: ReplyGroup): string[] => [group.header + group.terminator, ...[...group.data].map((data) => group.header + data + group.terminator)];

/** What a reply leaves the reader for the one behind it. */
interface Seam {
  afterHeader: boolean;
  carry: string;
  open: boolean;
}

const FRESH_SEAM: Seam = { afterHeader: false, carry: "", open: false };

/** The longest tail that is a proper prefix of the mark, which is all a mark across the seam can use of the text. */
function markStart(text: string, mark: string): string {
  for (let k = Math.max(0, text.length - mark.length + 1); k < text.length; k += 1) {
    const tail = text.slice(k);
    if (mark.startsWith(tail)) return tail;
  }
  return "";
}

/** The seam a reply leaves behind the one before it, and whether the reader counted it right. */
function seamAfter(seam: Seam, text: string, own: number, marks: ReplyMarks): { seam: Seam; counted: boolean } {
  const seen = seam.carry + outsideFrames(text, seam.open);
  const { count, afterHeader, at } = scanReplies(seen, marks, seam.afterHeader);
  const carry = markStart(seen.slice(at), afterHeader ? marks.terminator : marks.header);
  const open = holdsFrameByte(text) ? leavesFrameOpen(text) : seam.open;
  return { seam: { afterHeader, carry, open }, counted: count === own };
}

/** The seam check grows with the square of the groups, and a thousand take a second. */
export const MAX_REPLY_GROUPS = 200;

/** The commands whose replies a reader would miscount in some run of replies, its own or another group's. A reply
 *  reaches the next only through its seam, so the seams closed under every next reply stand in for every run. */
function ambiguousReplies(groups: readonly ReplyGroup[]): string[] {
  if (groups.length > MAX_REPLY_GROUPS) return groups.flatMap((group) => group.commands);
  const commands = new Set<string>();
  const parts = groups.flatMap((group) => replyTexts(group).map((text) => ({ group, text })));
  for (const group of groups) {
    const own = (part: { group: ReplyGroup }) => (part.group === group ? 1 : 0);
    const seams = new Map<string, Seam>([[JSON.stringify(FRESH_SEAM), FRESH_SEAM]]);
    let miscounts = false;
    // A Map iterates the seams added on the way, so this runs until no reply leaves a new one.
    for (const seam of seams.values()) {
      for (const part of parts) {
        const next = seamAfter(seam, part.text, own(part), group);
        miscounts ||= !next.counted;
        seams.set(JSON.stringify(next.seam), next.seam);
      }
      if (miscounts) break;
    }
    if (miscounts) group.commands.forEach((command) => commands.add(command));
  }
  return [...commands];
}

/** A reply the printer still owes: how many of the group's replies the body lacks. */
export interface OwedReply {
  commands: string[];
  missing: number;
  of: number;
}

/** The awaited replies the body does not hold yet. */
export function owedReplies(body: string, awaited: readonly AwaitedReply[]): OwedReply[] {
  const text = outsideFrames(body);
  return awaited
    .map((group) => ({ commands: group.commands, missing: group.count - repliesIn(text, group), of: group.count }))
    .filter((owed) => owed.missing > 0);
}

/** A mark the transport hands back as spelled. One it garbles merges with its neighbours on the wire, so it is no mark. */
function receivedMark(mark: string, fhIndicator: string | undefined): string {
  const bytes = sentBytes(mark, fhIndicator);
  const text = received(bytes);
  const back = new TextEncoder().encode(text);
  return back.length === bytes.length && back.every((byte, i) => byte === bytes[i]) ? text : "";
}

export function documentReplies(zpl: string): DocumentReplies {
  const { asks, held } = walkHostCommands(zpl);
  const commands = new Set<string>();
  const uncounted = new Set<string>();
  const replies = new Map<string, FieldReply>();
  let framed = true;
  for (const t of asks) {
    if (t.ask !== "asked") continue;
    const command = `${t.id}${t.params}`;
    commands.add(command);
    if (!isFieldHostCommand(t.id)) {
      framed &&= framesReply(t.id);
      continue;
    }
    if (t.labels === 0) continue;
    if (!held || !t.vouched) {
      uncounted.add(command);
      continue;
    }
    const { header, terminator, perLabel } = fieldHostParams(t.params, t.delimiter);
    const marks = { header: receivedMark(header, t.fhIndicator), terminator: receivedMark(terminator, t.fhIndicator) };
    // One spelling under two ^FH indicators sends two reply shapes.
    const key = JSON.stringify([command, marks.header, marks.terminator]);
    const reply = replies.get(key) ?? { command, ...marks, count: 0, data: new Set<string>() };
    reply.count += perLabel ? t.labels : 1;
    for (const data of t.data) reply.data.add(data);
    replies.set(key, reply);
  }
  const unmarked = [...replies.values()].filter((reply) => fieldReplyMarks(reply) === undefined).map((reply) => reply.command);
  const groups = replyGroups(replies.values());
  const ambiguous = framed ? ambiguousReplies(groups) : groups.flatMap((group) => group.commands);
  return { commands: [...commands], awaited: groups.map(readerShape), unmarked: [...new Set(unmarked)], ambiguous: [...new Set(ambiguous)], uncounted: [...uncounted] };
}

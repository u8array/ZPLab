// ZPL as a CodeMirror language, built on the core parser's tokenizer (prefix
// remaps, opaque payloads) so the editor never runs a second scanner.
import { NodeSet, NodeType, Parser, Tree, type Input, type PartialParse, type SyntaxNodeRef, type TreeFragment } from "@lezer/common";
import { styleTags, tags as t } from "@lezer/highlight";
import {
  defineLanguageFacet,
  ensureSyntaxTree,
  foldService,
  HighlightStyle,
  Language,
  languageDataProp,
  LanguageSupport,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import type { EditorState, Transaction, TransactionSpec } from "@codemirror/state";
import { applyPrefixRemap, PAYLOAD_CMDS, tokenize, type TokenizerChars } from "@zplab/core/lib/zplParser/helpers";
import { prefixCharsAt, spellPrefix } from "@zplab/core/lib/zplCanonicalPrefixes";

// A ~DY/~DG payload can be megabytes on one line; folding keeps the editor
// responsive, and the read-only preview truncates at the same length.
export const MAX_LINE_RENDER = 2000;
export const FOLD_HEAD_CHARS = 40;

const BLOB_CMDS = new Set(["DY", "DG", "DB", "DT", "DU", "GF"]);
/** Prefix character plus the two-character code. */
const CMD_NAME_LEN = 3;
const PREFIX_LEN = 1;
const STRUCTURAL_CMDS = new Set(["XA", "XZ"]);

// CmdName vs TildeCmdName records the prefix kind, which the text alone loses under a ^CC/^CT remap.
const NODE_NAMES = ["Document", "Command", "FormatCmd", "CmdName", "TildeCmdName", "Number", "Flag", "Separator", "FieldData", "Comment", "Payload", "Text"] as const;
type NodeName = (typeof NODE_NAMES)[number];

const zplData = defineLanguageFacet();

const nodeSet = new NodeSet(
  NODE_NAMES.map((name, id) => NodeType.define({ id, name, top: name === "Document" })),
).extend(
  styleTags({
    FormatCmd: t.controlKeyword,
    "CmdName TildeCmdName": t.keyword,
    Number: t.number,
    Flag: t.atom,
    Separator: t.separator,
    FieldData: t.string,
    Payload: t.string,
    Comment: t.comment,
    Text: t.content,
  }),
  languageDataProp.add({ Document: zplData }),
);

// extend() re-creates the types, so they are read back from the set.
const TYPE = Object.fromEntries(nodeSet.types.map((t) => [t.name, t])) as Record<NodeName, NodeType>;
const leaf = (name: NodeName, length: number): Tree => new Tree(TYPE[name], [], [], length);

/** One named group per node kind inside a delimiter-free piece. */
const PIECE_RE = /(?<Text>\s+)|(?<Number>\d*\.\d+|\d+)|(?<Flag>[^\d\s]+)/g;

/** Parameter run split into separators, numbers, flags and whitespace; field data never reaches here.
 *  Split on the delimiter first, like the core parser, so a ^CD remap to `.` or a digit still separates. */
function paramNodes(run: string, delimiter: string, into: Tree[], positions: number[], base: number): void {
  let at = 0;
  for (const piece of run.split(delimiter)) {
    if (at > 0) {
      into.push(leaf("Separator", delimiter.length));
      positions.push(base + at - delimiter.length);
    }
    for (const m of piece.matchAll(PIECE_RE)) {
      const name = Object.keys(m.groups ?? {}).find((g) => m.groups?.[g] !== undefined) as NodeName;
      into.push(leaf(name, m[0].length));
      positions.push(base + at + m.index);
    }
    at += piece.length + delimiter.length;
  }
}

/** A parameter run longer than a line is pasted data: one foldable payload, with the
 *  surrounding whitespace kept out so the fold starts on the data's own line. */
function pastedRunNodes(run: string, into: Tree[], positions: number[], base: number): void {
  const lead = /^\s*/.exec(run)?.[0].length ?? 0;
  const tail = lead < run.length ? (/\s*$/.exec(run)?.[0].length ?? 0) : 0;
  if (lead > 0) {
    into.push(leaf("Text", lead));
    positions.push(base);
  }
  if (lead < run.length) {
    into.push(leaf("Payload", run.length - lead - tail));
    positions.push(base + lead);
  }
  if (tail > 0) {
    into.push(leaf("Text", tail));
    positions.push(base + run.length - tail);
  }
}

type ZplToken = ReturnType<typeof tokenize> extends Iterable<infer T> ? T : never;

/** Text parsed per advance(): a few milliseconds, so CodeMirror's work budget can preempt a big paste. */
const PARSE_CHUNK = 64 * 1024;

/** Full reparse from 0 in preemptible chunks; previous-tree fragments are not reused. */
class ZplParse implements PartialParse {
  parsedPos = 0;
  stoppedAt: number | null = null;
  private readonly children: Tree[] = [];
  private readonly positions: number[] = [];
  private readonly chars: TokenizerChars = { caretChar: "^", tildeChar: "~", delimiterChar: "," };
  private readonly tokens: Iterator<ZplToken>;
  private readonly text: string;
  private done = false;

  constructor(text: string) {
    this.text = text;
    this.tokens = tokenize(text, this.chars);
  }

  advance(): Tree | null {
    const chunkEnd = this.parsedPos + PARSE_CHUNK;
    while (!this.done) {
      const next = this.tokens.next();
      if (next.done) {
        this.pushText(this.text.length);
        this.done = true;
        break;
      }
      this.pushCommand(next.value);
      if (this.stoppedAt !== null && this.parsedPos >= this.stoppedAt) break;
      if (this.parsedPos >= chunkEnd) return null;
    }
    // Balanced: the fold gutter resolves every visible line, which is O(children) on a flat top node.
    return new Tree(TYPE.Document, this.children, this.positions, this.parsedPos).balance();
  }

  stopAt(pos: number): void {
    this.stoppedAt = pos;
  }

  private pushText(to: number): void {
    if (to > this.parsedPos) {
      this.children.push(leaf("Text", to - this.parsedPos));
      this.positions.push(this.parsedPos);
    }
    this.parsedPos = to;
  }

  private pushCommand(tok: ZplToken): void {
    this.pushText(tok.start);
    // A tilde ~XA/~XZ is a plain tilde command, not a format delimiter.
    const nameKind: NodeName = this.text[tok.start] === this.chars.tildeChar ? "TildeCmdName" : STRUCTURAL_CMDS.has(tok.cmd) ? "FormatCmd" : "CmdName";
    const kids: Tree[] = [leaf(nameKind, CMD_NAME_LEN)];
    const kidPos: number[] = [0];
    this.pushRest(tok, kids, kidPos);
    this.children.push(new Tree(TYPE.Command, kids, kidPos, tok.end - tok.start));
    this.positions.push(tok.start);
    applyPrefixRemap(this.chars, tok.cmd, tok.rest);
    this.parsedPos = tok.end;
  }

  /** The bytes after the name, as one opaque leaf or a parameter split, by command kind. */
  private pushRest(tok: ZplToken, kids: Tree[], kidPos: number[]): void {
    const restLen = tok.rest.length;
    if (restLen === 0) return;
    const opaque: NodeName | null = tok.cmd === "FX" ? "Comment" : PAYLOAD_CMDS.has(tok.cmd) ? "FieldData" : BLOB_CMDS.has(tok.cmd) ? "Payload" : null;
    if (opaque) {
      kids.push(leaf(opaque, restLen));
      kidPos.push(CMD_NAME_LEN);
    } else if (restLen > MAX_LINE_RENDER) {
      pastedRunNodes(tok.rest, kids, kidPos, CMD_NAME_LEN);
    } else {
      paramNodes(tok.rest, this.chars.delimiterChar, kids, kidPos, CMD_NAME_LEN);
    }
  }
}

export function buildZplTree(text: string): Tree {
  const parse = new ZplParse(text);
  for (;;) {
    const tree = parse.advance();
    if (tree) return tree;
  }
}

class ZplParser extends Parser {
  createParse(input: Input, _fragments: readonly TreeFragment[], ranges: readonly { from: number; to: number }[]): PartialParse {
    // CodeMirror passes no ranges of its own, so the parse covers the whole document.
    return new ZplParse(input.read(0, ranges[ranges.length - 1]?.to ?? input.length));
  }
}

const zplLanguage = new Language(zplData, new ZplParser(), [], "zpl");

/** Tailwind colour per token kind (see index.css theme tokens); shared with the read-only preview. */
export const zplHighlightStyle = HighlightStyle.define([
  { tag: t.controlKeyword, class: "text-accent font-semibold" },
  { tag: t.keyword, class: "text-accent font-medium" },
  { tag: t.string, class: "text-string" },
  { tag: t.comment, class: "text-muted italic" },
  { tag: t.number, class: "text-info" },
  { tag: t.atom, class: "text-text" },
  { tag: t.separator, class: "text-muted" },
  { tag: t.content, class: "text-muted" },
]);

/** Parse budget per caret move; a big paste may leave the tree short, and the caret feed then says null. */
const CARET_PARSE_MS = 20;
/** Inserts and folds are rare and must see the whole document, even a multi-megabyte one. */
const WHOLE_DOC_PARSE_MS = 5000;

/** The tree covering `pos`, parsing for at most `ms` first; the partial tree when the budget runs out. */
const treeUpTo = (state: EditorState, pos: number, ms: number): Tree => ensureSyntaxTree(state, pos, ms) ?? syntaxTree(state);

/** A node the editor folds on sight: an overlong payload, or raw data outside any command. */
const isBlob = (n: SyntaxNodeRef): boolean =>
  (n.name === "Payload" || (n.name === "Text" && n.node.parent?.name === "Document")) && n.to - n.from > MAX_LINE_RENDER;

export interface BlobRange {
  from: number;
  to: number;
}

/** Blobs touching [from, to]; the one tree walk the fold gutter and the auto-fold share. */
export function blobRanges(state: EditorState, from: number, to: number): BlobRange[] {
  const out: BlobRange[] = [];
  treeUpTo(state, to, WHOLE_DOC_PARSE_MS).iterate({
    from,
    to,
    enter: (n) => {
      // A short command cannot hold a blob; skipping it keeps the walk cheap.
      if (n.name === "Command" && n.to - n.from <= MAX_LINE_RENDER) return false;
      if (!isBlob(n)) return undefined;
      out.push({ from: n.from, to: n.to });
      return false;
    },
  });
  return out;
}

/** Fold for a blob starting on this line. CodeMirror's tree folding only yields
 *  nodes that cross the line end, so a mid-line blob needs this service. */
function blobFold(state: EditorState, lineStart: number, lineEnd: number): BlobRange | null {
  for (const blob of blobRanges(state, lineStart, lineEnd)) {
    // Only the line a blob starts on offers its fold, or every line it spans would.
    if (blob.from < lineStart) continue;
    // The head stays visible so the command is still recognisable; the range ends before the next command.
    const from = Math.min(blob.from + FOLD_HEAD_CHARS, lineEnd);
    if (from < blob.to) return { from, to: blob.to };
  }
  return null;
}

export function zpl(): LanguageSupport {
  return new LanguageSupport(zplLanguage, [syntaxHighlighting(zplHighlightStyle), foldService.of(blobFold)]);
}

export interface CursorCommand {
  /** `^LL` or `~JA`: the prefix kind the source used, normalised back from any ^CC/^CT remap. */
  id: string;
}

const NAME_NODES = new Set(["CmdName", "TildeCmdName", "FormatCmd"]);

/** The command whose bytes surround `pos`, or null between commands; the command
 *  starting at the caret wins over the one ending there. */
export function commandAtCursor(state: EditorState, pos: number): CursorCommand | null {
  const tree = treeUpTo(state, pos, CARET_PARSE_MS);
  const commandOf = (side: -1 | 1) => {
    let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, side);
    while (node && node.name !== "Command") node = node.parent;
    return node;
  };
  const node = commandOf(1) ?? commandOf(-1);
  const name = node?.firstChild;
  if (!name || !NAME_NODES.has(name.name)) return null;
  const prefix = name.name === "TildeCmdName" ? "~" : "^";
  return { id: `${prefix}${state.doc.sliceString(name.from + PREFIX_LEN, name.to).toUpperCase()}` };
}

/** Positional: the page-th ^XZ of the live document (the export emits one block per page),
 *  else the last ^XZ, else null; goes stale if the user removes earlier blocks mid-session.
 *  Read from the tree, so a ^CC remap still finds it. */
export function formatCloseFor(state: EditorState, page: number): number | null {
  const tree = treeUpTo(state, state.doc.length, WHOLE_DOC_PARSE_MS);
  const closes: number[] = [];
  tree.iterate({
    enter: (n) => {
      // ~XZ closes too: the core parser reads XA/XZ prefix-blind, and the apply follows it.
      if (!NAME_NODES.has(n.name) || state.doc.sliceString(n.from + PREFIX_LEN, n.to).toUpperCase() !== "XZ") return undefined;
      closes.push(n.from);
      return false;
    },
  });
  return closes[page] ?? closes[closes.length - 1] ?? null;
}

/** User-event tag of a catalog insert, so the editor can tell it from typing. */
export const CATALOG_USER_EVENT = "input.catalog";

/** Whether a transaction counts as the user choosing a spot for later inserts. */
export function placesCaret(tr: Transaction): boolean {
  if (tr.isUserEvent("select.pointer") || tr.isUserEvent("delete")) return true;
  // A keyboard range (select all) is not a spot; a Tab focus dispatches nothing and leaves the caret at 0.
  if (tr.isUserEvent("select") && tr.state.selection.main.empty) return true;
  // The catalog's own insert must not count, or a second insert glues onto the first.
  return tr.isUserEvent("input") && !tr.isUserEvent(CATALOG_USER_EVENT);
}

/** The tree keeps only spelled names, so the head up to `pos` is replayed for the prefix in force. */
const spellAt = (state: EditorState, text: string, pos: number): string => spellPrefix(text, prefixCharsAt(state.doc.sliceString(0, pos)));

/** Where a catalog insert goes: the user's caret, or a page's block. */
export type InsertTarget = "caret" | { page: number };

/** Transaction that inserts a command: at the selection, or on its own line before the ^XZ
 *  of the page's block (at the end when no format is closed). */
export function commandInsertion(state: EditorState, text: string, target: InsertTarget): TransactionSpec {
  if (target === "caret") {
    const spelled = spellAt(state, text, state.selection.main.from);
    return { ...state.replaceSelection(spelled), userEvent: CATALOG_USER_EVENT, scrollIntoView: true };
  }
  const close = formatCloseFor(state, target.page);
  const at = close ?? state.doc.length;
  const spelled = spellAt(state, text, at);
  const lead = at > 0 && state.doc.lineAt(at).from !== at ? state.lineBreak : "";
  return {
    changes: { from: at, insert: `${lead}${spelled}${close === null ? "" : state.lineBreak}` },
    // A line break is one document position whatever the separator's length.
    selection: { anchor: at + (lead ? 1 : 0) + spelled.length },
    userEvent: CATALOG_USER_EVENT,
    scrollIntoView: true,
  };
}

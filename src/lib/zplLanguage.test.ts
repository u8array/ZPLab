// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { ensureSyntaxTree, foldable, syntaxTree } from "@codemirror/language";
import { highlightCode } from "@lezer/highlight";
import {
  buildZplTree,
  commandAtCursor,
  commandInsertion,
  formatCloseFor,
  placesCaret,
  zpl,
  zplHighlightStyle,
  CATALOG_USER_EVENT,
  FOLD_HEAD_CHARS,
  MAX_LINE_RENDER,
  type InsertTarget,
} from "./zplLanguage";

/** Flat `Name:text` list of the tree's leaves, in document order. */
function leaves(text: string): string[] {
  const out: string[] = [];
  buildZplTree(text).iterate({
    enter: (n) => {
      if (n.name !== "Document" && n.node.firstChild === null) out.push(`${n.name}:${text.slice(n.from, n.to)}`);
    },
  });
  return out;
}

describe("zpl language tree", () => {
  it("splits a command from its numeric coordinates", () => {
    expect(leaves("^FO100,200")).toEqual(["CmdName:^FO", "Number:100", "Separator:,", "Number:200"]);
  });

  it("takes exactly two characters as the command code and keeps field data opaque", () => {
    expect(leaves("^A0N,30,30^FDText, 12^FS")).toEqual([
      "CmdName:^A0", "Flag:N", "Separator:,", "Number:30", "Separator:,", "Number:30",
      "CmdName:^FD", "FieldData:Text, 12", "CmdName:^FS",
    ]);
  });

  it("marks ^XA and ^XZ as format commands and ^FX text as a comment", () => {
    expect(leaves("^XA^FXnote 1,2^FS^XZ")).toEqual(["FormatCmd:^XA", "CmdName:^FX", "Comment:note 1,2", "CmdName:^FS", "FormatCmd:^XZ"]);
  });

  it("separates flags from numbers and reads decimals", () => {
    expect(leaves("^BCN,100,Y,N,N^FO.5,1.25")).toEqual([
      "CmdName:^BC", "Flag:N", "Separator:,", "Number:100", "Separator:,", "Flag:Y", "Separator:,", "Flag:N", "Separator:,", "Flag:N",
      "CmdName:^FO", "Number:.5", "Separator:,", "Number:1.25",
    ]);
  });

  it("keeps a tilde escape inside field data but breaks at a real immediate command", () => {
    expect(leaves("^FD~d029abc~JA")).toEqual(["CmdName:^FD", "FieldData:~d029abc", "TildeCmdName:~JA"]);
  });

  it("treats download and graphic payloads as one node", () => {
    expect(leaves("~DYE:X.PNG,P,P,10,,89504E47^FS")).toEqual(["TildeCmdName:~DY", "Payload:E:X.PNG,P,P,10,,89504E47", "CmdName:^FS"]);
    expect(leaves("^GFA,2,2,1,FFFF^FS")).toEqual(["CmdName:^GF", "Payload:A,2,2,1,FFFF", "CmdName:^FS"]);
  });

  it("follows ^CC and ^CD remaps like the parser", () => {
    expect(leaves("^CC//XA/FO1,2/XZ")).toEqual(["CmdName:^CC", "Flag:/", "FormatCmd:/XA", "CmdName:/FO", "Number:1", "Separator:,", "Number:2", "FormatCmd:/XZ"]);
    expect(leaves("^CD;^FO1;2")).toEqual(["CmdName:^CD", "Flag:;", "CmdName:^FO", "Number:1", "Separator:;", "Number:2"]);
    // A dot delimiter separates before a decimal could form, as the core parser reads it.
    expect(leaves("^CD.^FO1.5")).toEqual(["CmdName:^CD", "Flag:.", "CmdName:^FO", "Number:1", "Separator:.", "Number:5"]);
  });

  it("keeps whitespace and stray text as text nodes and covers the document contiguously", () => {
    const text = "junk ^XA\n^FO1,1^FS\n^XZ tail";
    const parts = leaves(text);
    expect(parts.map((l) => l.slice(l.indexOf(":") + 1)).join("")).toBe(text);
    expect(parts[0]).toBe("Text:junk ");
    expect(parts).toContain("Text:\n");
    expect(leaves("")).toEqual([]);
  });
});

describe("zpl language folding", () => {
  const state = (doc: string) => EditorState.create({ doc, extensions: [zpl()] });
  const blob = "^XA^GFA,4000,4000,10," + "F".repeat(MAX_LINE_RENDER + 500) + "^FS^FO10,10^FDafter^FS^XZ";

  it("folds the tail of an overlong payload and keeps the command and ^FS visible", () => {
    const s = state(blob);
    const fold = foldable(s, 0, blob.length);
    expect(fold).not.toBeNull();
    expect(fold!.from).toBe(blob.indexOf("^GF") + 3 + FOLD_HEAD_CHARS);
    expect(fold!.to).toBe(blob.indexOf("^FS"));
  });

  it("leaves short payloads and long parameter runs alone", () => {
    expect(foldable(state("^XA^GFA,2,2,1,FFFF^FS^XZ"), 0, 30)).toBeNull();
    const longText = "^XA^FD" + "x".repeat(MAX_LINE_RENDER + 10) + "^FS^XZ";
    expect(foldable(state(longText), 0, longText.length)).toBeNull();
  });

  it("folds a prefix-remapped blob and a raw data line with no command at all", () => {
    const doc = "^CC/\n/XA/GFA,4000,4000,10," + "F".repeat(MAX_LINE_RENDER + 500) + "/FS/XZ";
    const s = state(doc);
    const line = s.doc.line(2);
    expect(foldable(s, line.from, line.to)?.to).toBe(doc.indexOf("/FS"));
    const raw = "^XA\n" + "F".repeat(MAX_LINE_RENDER + 500) + "\n^XZ";
    const r = state(raw);
    expect(foldable(r, r.doc.line(2).from, r.doc.line(2).to)).toEqual({ from: 4 + FOLD_HEAD_CHARS, to: r.doc.line(2).to });
  });

  it("treats an overlong parameter run as one payload and folds it, but never printed field data", () => {
    const hex = "F0".repeat(MAX_LINE_RENDER);
    const raw = `^XA\n${hex}\n^XZ`;
    expect(leaves(raw).filter((l) => l.startsWith("Payload:"))).toHaveLength(1);
    const r = state(raw);
    expect(foldable(r, r.doc.line(2).from, r.doc.line(2).to)).toEqual({ from: 4 + FOLD_HEAD_CHARS, to: r.doc.line(2).to });
    const field = `^XA\n^FD\n${"x".repeat(MAX_LINE_RENDER + 10)}\n^FS^XZ`;
    const f = state(field);
    expect(foldable(f, f.doc.line(3).from, f.doc.line(3).to)).toBeNull();
  });

  it("keeps an overlong whitespace run as text, never an empty or negative payload", () => {
    const doc = "^XA^FO" + " ".repeat(MAX_LINE_RENDER + 1) + "^XZ";
    const parts = leaves(doc);
    expect(parts.some((l) => l.startsWith("Payload:"))).toBe(false);
    expect(parts.map((l) => l.slice(l.indexOf(":") + 1)).join("")).toBe(doc);
  });

  it("clamps the fold start to the header line when the payload starts near its end", () => {
    const doc = "^GFA,4000,4000,10,\n" + "F".repeat(MAX_LINE_RENDER + 500) + "^FS";
    const s = state(doc);
    const fold = foldable(s, 0, s.doc.line(1).to);
    expect(fold).toEqual({ from: s.doc.line(1).to, to: doc.indexOf("^FS") });
    expect(foldable(s, s.doc.line(2).from, s.doc.line(2).to)).toBeNull();
  });

  it("offers a multi-line payload's fold only on the line it starts on", () => {
    const rows = Array.from({ length: 30 }, () => "F".repeat(100)).join("\n");
    const doc = `~DYE:X.GRF,A,G,${rows.length},100,${rows}\n^XA^XZ`;
    const s = state(doc);
    expect(foldable(s, s.doc.line(1).from, s.doc.line(1).to)).not.toBeNull();
    expect(foldable(s, s.doc.line(10).from, s.doc.line(10).to)).toBeNull();
  });

  it("exposes the tree to the editor state", () => {
    const s = state("^XA^FO1,1^FS^XZ");
    expect(syntaxTree(s).resolveInner(5, 1).name).toBe("CmdName");
  });

  it("parses a big document in chunks, so the editor's work budget can preempt it", () => {
    const big = "^XA\n" + "^FO10,10^FDx^FS\n".repeat(20_000) + "^XZ";
    const parse = zpl().language.parser.startParse(big);
    let yields = 0;
    let tree = parse.advance();
    while (tree === null) {
      yields++;
      tree = parse.advance();
    }
    expect(yields).toBeGreaterThan(0);
    expect(tree.length).toBe(big.length);
    expect(ensureSyntaxTree(state(big), big.length, 20_000)?.length).toBe(big.length);
  });
});

describe("commandAtCursor", () => {
  const at = (doc: string, pos: number) => commandAtCursor(EditorState.create({ doc, extensions: [zpl()] }), pos);

  it("reports the command around the caret", () => {
    const doc = "^XA^FO100,200^FDhi^FS^XZ";
    expect(at(doc, 4)).toEqual({ id: "^FO" });
    expect(at(doc, 11)).toEqual({ id: "^FO" });
    expect(at(doc, 16)).toEqual({ id: "^FD" });
    expect(at(doc, 1)).toEqual({ id: "^XA" });
  });

  it("looks right from whitespace, so a caret at a line start names that line's command", () => {
    const doc = "^XA\n^FO10,10^FS\n^XZ";
    expect(at(doc, 4)).toEqual({ id: "^FO" });
    expect(at(doc, 3)).toEqual({ id: "^XA" });
  });

  it("keeps the canonical prefix under a ^CC/^CT remap and for tilde commands", () => {
    expect(at("^CC//FO1,1/FS", 7)).toEqual({ id: "^FO" });
    expect(at("^CT!!JA", 6)).toEqual({ id: "~JA" });
    // Tilde-spelled format commands keep their prefix; they are not block delimiters.
    expect(at("~XA^FO1,1", 1)).toEqual({ id: "~XA" });
    expect(at("~DYE:X.PNG,P,P,1,,00", 8)).toEqual({ id: "~DY" });
  });

  it("answers null between commands", () => {
    expect(at("junk ^XA", 2)).toBeNull();
    expect(at("", 0)).toBeNull();
  });
});

describe("formatCloseFor", () => {
  const closeAt = (doc: string, page: number) => formatCloseFor(EditorState.create({ doc, extensions: [zpl()] }), page);

  it("names the ^XZ closing the page's block, counted on the live document", () => {
    const doc = "^XA\n^FDp1^FS\n^XZ\n^XA\n^FDp2^FS\n^XZ";
    expect(closeAt(doc, 0)).toBe(doc.indexOf("^XZ"));
    expect(closeAt(doc, 1)).toBe(doc.lastIndexOf("^XZ"));
    // A page the document no longer has falls back to the last close.
    expect(closeAt(doc, 5)).toBe(doc.lastIndexOf("^XZ"));
  });

  it("follows a ^CC remap, counts a tilde ~XZ like the core parser, and yields null without a close", () => {
    const remapped = "^XA\n^CC#\n#FDx#FS\n#XZ";
    expect(closeAt(remapped, 0)).toBe(remapped.indexOf("#XZ"));
    const tilde = "^XA\n^FDa^FS\n~XZ";
    expect(closeAt(tilde, 0)).toBe(tilde.indexOf("~XZ"));
    expect(closeAt("^XA\n^FDa^FS", 0)).toBeNull();
    expect(closeAt("", 0)).toBeNull();
  });
});

describe("commandInsertion", () => {
  const apply = (doc: string, text: string, target: InsertTarget, head = 0, lineSeparator?: string) => {
    const state = EditorState.create({
      doc,
      selection: { anchor: head },
      extensions: [zpl(), ...(lineSeparator ? [EditorState.lineSeparator.of(lineSeparator)] : [])],
    });
    const next = state.update(commandInsertion(state, text, target)).state;
    return { text: next.doc.sliceString(0, next.doc.length, next.lineBreak), head: next.selection.main.head };
  };

  it("puts a fresh command on its own line before the block's ^XZ, in the buffer's line ending", () => {
    expect(apply("^XA\n^FDa^FS\n^XZ", "^LL", { page: 0 }).text).toBe("^XA\n^FDa^FS\n^LL\n^XZ");
    expect(apply("^XA\r\n^FDa^FS\r\n^XZ", "^LL", { page: 0 }, 0, "\r\n").text).toBe("^XA\r\n^FDa^FS\r\n^LL\r\n^XZ");
    expect(apply("^XA^FDa^FS^XZ", "^LL", { page: 0 }).text).toBe("^XA^FDa^FS\n^LL\n^XZ");
  });

  it("appends after the last command when nothing closes the format, and lands the caret after the text", () => {
    const r = apply("^XA\n^FDa^FS", "^LL", { page: 0 });
    expect(r.text).toBe("^XA\n^FDa^FS\n^LL");
    expect(r.head).toBe(r.text.length);
  });

  it("replaces the selection when the caret is the user's", () => {
    expect(apply("^XA\n^FDa^FS\n^XZ", "^LL", "caret", 4).text).toBe("^XA\n^LL^FDa^FS\n^XZ");
  });

  it("lands the caret after the text even when the CRLF lead-in counts as one position", () => {
    const r = apply("^XA\r\n^FDa^FS^XZ", "^LL", { page: 0 }, 0, "\r\n");
    expect(r.text).toBe("^XA\r\n^FDa^FS\r\n^LL\r\n^XZ");
    expect(r.head).toBe("^XA\n^FDa^FS\n^LL".length);
  });

  it("spells the prefix in the ^CC/^CT characters in force at the insert point", () => {
    expect(apply("^XA^CC#\n#FDa#FS\n#XZ", "^LL", { page: 0 }).text).toBe("^XA^CC#\n#FDa#FS\n#LL\n#XZ");
    expect(apply("^XA^CC#\n#FDa#FS\n#XZ", "^LL", "caret", "^XA^CC#\n".length).text).toBe("^XA^CC#\n#LL#FDa#FS\n#XZ");
    expect(apply("^XA^CT!\n^XZ", "~JA", { page: 0 }).text).toBe("^XA^CT!\n!JA\n^XZ");
    // Before the remap the canonical prefix stands.
    expect(apply("^XA\n^FDa^FS\n^CC#\n#XZ", "^LL", "caret", 4).text).toBe("^XA\n^LL^FDa^FS\n^CC#\n#XZ");
  });

  it("targets the page's block, not the first block, while no caret is placed", () => {
    const doc = "^XA\n^FDp1^FS\n^XZ\n^XA\n^FDp2^FS\n^XZ";
    const state = EditorState.create({ doc, extensions: [zpl()] });
    const spec = commandInsertion(state, "^LL", { page: 1 });
    expect(state.update(spec).state.doc.toString()).toBe("^XA\n^FDp1^FS\n^XZ\n^XA\n^FDp2^FS\n^LL\n^XZ");
  });
});

describe("placesCaret", () => {
  const tr = (spec: TransactionSpec) => EditorState.create({ doc: "^XA^XZ", extensions: [zpl()] }).update(spec);

  it("counts pointer selections, empty caret moves, typing and deletes, never keyboard ranges or catalog inserts", () => {
    expect(placesCaret(tr({ selection: { anchor: 3 }, userEvent: "select.pointer" }))).toBe(true);
    expect(placesCaret(tr({ selection: { anchor: 0, head: 3 }, userEvent: "select.pointer" }))).toBe(true);
    expect(placesCaret(tr({ selection: { anchor: 3 }, userEvent: "select" }))).toBe(true);
    expect(placesCaret(tr({ selection: { anchor: 0, head: 3 }, userEvent: "select" }))).toBe(false);
    expect(placesCaret(tr({ changes: { from: 3, insert: "x" }, userEvent: "input.type" }))).toBe(true);
    expect(placesCaret(tr({ changes: { from: 3, insert: "^LL" }, userEvent: CATALOG_USER_EVENT }))).toBe(false);
    expect(placesCaret(tr({ changes: { from: 2, to: 3 }, userEvent: "delete.backward" }))).toBe(true);
  });
});

describe("zpl highlight style", () => {
  it("colours every token kind with the shared classes", () => {
    const text = "^XA^FO1,1^A0N,30,30^FDhi^FS^FXc^FS^XZ";
    const classes: string[] = [];
    highlightCode(text, buildZplTree(text), zplHighlightStyle, (_code, cls) => classes.push(cls), () => undefined);
    expect(classes).toContain("text-accent font-semibold");
    expect(classes).toContain("text-accent font-medium");
    expect(classes).toContain("text-info");
    expect(classes).toContain("text-string");
    expect(classes).toContain("text-muted italic");
  });
});

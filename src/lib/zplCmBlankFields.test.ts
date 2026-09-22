// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { zpl } from "./zplLanguage";
import { blankFieldsExt } from "./zplCmBlankFields";

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

function open(doc: string, hint?: string): EditorView {
  view = new EditorView({ state: EditorState.create({ doc, extensions: [zpl(), blankFieldsExt(hint)] }), parent: document.body });
  return view;
}

/** Document offsets carrying the hint. */
function hints(v: EditorView): number[] {
  const out: number[] = [];
  for (const deco of v.state.facet(EditorView.decorations)) {
    (typeof deco === "function" ? deco(v) : deco).between(0, v.state.doc.length, (from, _to, value) => {
      if ((value.spec.widget as { text?: string } | undefined)?.text === "placeholder") out.push(from);
    });
  }
  return out;
}

/** The offset right after the n-th `needle`. */
const after = (doc: string, needle: string, n = 1): number => {
  let at = -1;
  for (let i = 0; i < n; i++) at = doc.indexOf(needle, at + 1);
  return at + needle.length;
};

describe("blankFieldsExt", () => {
  it("labels an empty field right after its ^FD and leaves a filled one alone", () => {
    const doc = "^XA\n^FO10,10^BCN,100^FD^FS\n^FO10,80^A0N,30^FDHELLO^FS\n^XZ";
    const v = open(doc, "placeholder");
    expect(hints(v)).toEqual([after(doc, "^FD")]);
    expect(v.dom.querySelector(".cm-zplBlankHint")?.textContent).toBe("placeholder");
    expect(v.state.doc.toString()).not.toContain("placeholder");
  });

  it("skips a slot the printer fills through ^FN, armed, or bound after the data", () => {
    expect(hints(open("^XA\n^FO10,10^FN1^FD^FS\n^FO10,80^FN2^FH_^FD^FS\n^FO10,90^FD^FN3^FS\n^XZ", "placeholder"))).toEqual([]);
  });

  it("treats a line break as the nothing the printer prints, and labels ^FV like ^FD", () => {
    const v = open("^XA\n^FO1,1^FD\n^FS\n^FO1,9^FV^FS\n^FO1,9^FD ^FS\n^XZ", "placeholder");
    const doc = v.state.doc.toString();
    expect(hints(v)).toEqual([after(doc, "^FD"), after(doc, "^FV")]);
  });

  it("looks the field up in the tree, not in the visible slice", () => {
    const doc = "^XA\n^FO10,10\n^FN1\n^FD^FS\n^XZ";
    const v = open(doc, "placeholder");
    Object.defineProperty(v, "visibleRanges", { get: () => [{ from: doc.indexOf("^FD"), to: doc.length }] });
    expect(hints(v)).toEqual([]);
  });

  it("puts the QR label after the switch, whichever form it takes", () => {
    const doc = "^XA\n^FO1,1^BQN,2,4^FDQA,^FS\n^FO1,9^BQN,2,4^FDD030122,QM,^FS\n^FO1,9^BQN,2,4^FDQA,hi^FS\n^XZ";
    expect(hints(open(doc, "placeholder"))).toEqual([after(doc, "QA,"), after(doc, "QM,")]);
  });

  it("follows a ^CC remap", () => {
    const doc = "^XA^CC#\n#FO10,10#FD#FS\n#XZ";
    expect(hints(open(doc, "placeholder"))).toEqual([after(doc, "#FD")]);
  });

  it("labels a field that runs to the end of the document, and reads CRLF text", () => {
    const v = open("^XA\r\n^FO1,1^FD^FS\r\n^FO1,9^FD", "placeholder");
    const doc = v.state.doc.toString();
    expect(hints(v)).toEqual([after(doc, "^FD"), after(doc, "^FD", 2)]);
  });

  it("clears only the label that is typed into", () => {
    const doc = "^XA\n^FO10,10^FD^FS\n^FO10,80^FD^FS\n^XZ";
    const v = open(doc, "placeholder");
    expect(hints(v)).toHaveLength(2);
    v.dispatch({ changes: { from: after(doc, "^FD"), insert: "A" }, userEvent: "input.type" });
    expect(hints(v)).toEqual([after(doc, "^FD", 2) + 1]);
  });

  it("labels nothing without a hint text", () => {
    expect(hints(open("^XA^FO1,1^FD^FS^XZ"))).toEqual([]);
  });
});

// @vitest-environment jsdom
// Real CodeMirror: the reference panel's caret feed and insert seam run through the editor.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, fireEvent, within, screen } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { ZPLOutput } from "./ZPLOutput";
import { useLabelStore } from "../../store/labelStore";
import type { LabelObject, Page } from "@zplab/core/types/Group";

afterEach(cleanup);

const textObject = (id: string, x: number): LabelObject =>
  ({ id, type: "text", x, y: 10, rotation: 0, props: { content: "hello", fontHeight: 30, fontWidth: 0, rotation: "N" } }) as unknown as LabelObject;

/** One text object per page, so every block has a ^FO and a ^FD to anchor on. */
const setPages = (count: 1 | 2, currentPageIndex: number): void => {
  const pages = [{ objects: [textObject("t1", 10)] }, ...(count === 2 ? [{ objects: [textObject("t2", 20)] }] : [])] as Page[];
  useLabelStore.setState({ pages, currentPageIndex });
};

beforeEach(() => {
  useLabelStore.setState({
    label: { widthMm: 70, heightMm: 40, dpmm: 8 },
    variables: [],
    selectedIds: [],
    previewMode: { status: "idle" },
    sourceEdit: { status: "off" },
    sourceShadow: null,
  });
  setPages(1, 0);
});

const detail = () => within(screen.getByTestId("catalog-detail"));
const mount = () => {
  const { container } = render(<ZPLOutput onResizeMouseDown={() => undefined} />);
  return EditorView.findFromDOM(container as HTMLElement)!;
};
const blocksOf = (view: EditorView) => view.state.doc.toString().split("^XA").slice(1);
const placePointerCaret = (view: EditorView, needle: string, length = 0): number => {
  const pos = view.state.doc.toString().indexOf(needle);
  act(() => {
    view.focus();
    view.dispatch({ selection: { anchor: pos, head: pos + length }, userEvent: "select.pointer" });
  });
  return pos;
};

describe("reference panel wiring", () => {
  it("inserts before the closing ^XZ while no caret has been placed", () => {
    const view = mount();
    expect(detail().getByText(/Place the cursor/)).toBeTruthy();
    fireEvent.doubleClick(screen.getByRole("option", { name: /\^LL/ }));
    expect(view.state.doc.toString()).toMatch(/\n\^LL\n\^XZ$/);
    expect(useLabelStore.getState().sourceEdit.status).toBe("editing");
  });

  it("targets the current page's block while no caret is placed", () => {
    act(() => setPages(2, 1));
    const view = mount();
    fireEvent.doubleClick(screen.getByRole("option", { name: /\^LL/ }));
    const blocks = blocksOf(view);
    // The label's own ^LL320 lives in both blocks; the inserted bare ^LL sits on its own line.
    expect(blocks[0]).not.toMatch(/\n\^LL\n/);
    expect(blocks[1]).toMatch(/\n\^LL\n\^XZ/);
  });

  it("keeps targeting by page after an earlier insert has grown the draft", () => {
    act(() => setPages(2, 0));
    const view = mount();
    fireEvent.doubleClick(screen.getByRole("option", { name: /\^LL/ }));
    act(() => useLabelStore.setState({ currentPageIndex: 1 }));
    fireEvent.doubleClick(screen.getByRole("option", { name: /\^PW/ }));
    const blocks = blocksOf(view);
    expect(blocks[0]).toMatch(/\n\^LL\n\^XZ/);
    expect(blocks[0]).not.toMatch(/\n\^PW\n/);
    expect(blocks[1]).toMatch(/\n\^PW\n\^XZ/);
  });

  it("follows the caret once it is placed and inserts there", () => {
    const view = mount();
    const pos = placePointerCaret(view, "^FO");
    expect(detail().getByText("field origin")).toBeTruthy();
    // The detail shows the caret's own command, so that is what the button inserts, at the caret.
    fireEvent.click(detail().getByRole("button", { name: /^Insert$/ }));
    expect(view.state.doc.toString().slice(pos, pos + 6)).toBe("^FO^FO");
  });

  it("forgets the placed caret when the user switches pages", () => {
    act(() => setPages(2, 0));
    const view = mount();
    placePointerCaret(view, "^FO");
    expect(detail().getByText("field origin")).toBeTruthy();
    act(() => useLabelStore.setState({ currentPageIndex: 1 }));
    // The panel and the insert agree: no caret counts until the user places one again.
    expect(detail().getByText(/Place the cursor/)).toBeTruthy();
    fireEvent.doubleClick(screen.getByRole("option", { name: /\^LL/ }));
    const blocks = blocksOf(view);
    expect(blocks[0]).not.toMatch(/\^LL\^FO/);
    expect(blocks[1]).toMatch(/\n\^LL\n\^XZ/);
  });

  it("keeps Escape inside the panel from discarding an edit session", () => {
    mount();
    fireEvent.doubleClick(screen.getByRole("option", { name: /\^LL/ }));
    expect(useLabelStore.getState().sourceEdit.status).toBe("editing");
    const row = screen.getByRole("option", { name: /\^PW/ });
    fireEvent.click(row);
    expect(detail().getByText("print width")).toBeTruthy();
    fireEvent.keyDown(row, { key: "Escape" });
    expect(detail().queryByText("print width")).toBeNull();
    // A dirty session only asks before discarding, so the absent prompt is the real assertion.
    expect(screen.queryByText(/Discard the edited code/)).toBeNull();
    expect(useLabelStore.getState().sourceEdit.status).toBe("editing");
  });

  it("replaces a pointer-made range selection instead of inserting before ^XZ", () => {
    const view = mount();
    const pos = placePointerCaret(view, "hello", 5);
    fireEvent.doubleClick(screen.getByRole("option", { name: /\^LL/ }));
    expect(view.state.doc.toString().slice(pos - 3, pos + 5)).toBe("^FD^LL^F");
  });
});

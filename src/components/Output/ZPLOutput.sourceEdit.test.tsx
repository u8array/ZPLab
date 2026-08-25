// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen, act, waitFor } from "@testing-library/react";

const copiedTexts: string[] = [];
vi.mock("../../lib/clipboard", () => ({
  copyText: (text: string) => {
    copiedTexts.push(text);
    return Promise.resolve("copied");
  },
}));
// CodeMirror needs layout APIs jsdom lacks; the props plus the focus handle
// are the whole contract (real-CM invariants live in ZplCodeMirror.test.tsx).
vi.mock("./ZplCodeMirror", () => {
  function MockCodeMirror({ value, onChange, ariaLabel, placeholderText, readOnly, highlightLines, ref }: {
    value: string;
    onChange: (v: string) => void;
    ariaLabel: string;
    placeholderText: string;
    readOnly?: boolean;
    highlightLines?: ReadonlySet<number>;
    ref?: React.Ref<{ focus(): void }>;
  }) {
    const el = React.useRef<HTMLTextAreaElement>(null);
    React.useImperativeHandle(ref, () => ({ focus: () => el.current?.focus() }), []);
    return (
      <textarea
        ref={el}
        aria-label={ariaLabel}
        placeholder={placeholderText}
        value={value}
        readOnly={readOnly}
        data-highlights={[...(highlightLines ?? [])].sort((a, b) => a - b).join(",")}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return { default: MockCodeMirror };
});
import { ZPLOutput } from "./ZPLOutput";
import { useLabelStore } from "../../store/labelStore";
import type { LabelObject, Page } from "@zplab/core/types/Group";

const textObject = (id: string): LabelObject =>
  ({
    id, type: "text", x: 10, y: 10, rotation: 0,
    props: { content: "hello", fontHeight: 30, fontWidth: 0, rotation: "N" },
  }) as never;
const pages: Page[] = [{ objects: [textObject("t1")] }];

beforeEach(() => {
  useLabelStore.setState({
    label: { widthMm: 70, heightMm: 40, dpmm: 8 },
    pages,
    variables: [],
    currentPageIndex: 0,
    selectedIds: [],
    previewMode: { status: "idle" },
    sourceEdit: { status: "off" },
    sourceShadow: null,
  });
  useLabelStore.temporal.getState().clear();
});

afterEach(() => {
  cleanup();
  copiedTexts.length = 0;
  vi.restoreAllMocks();
});

const t = () => useLabelStore.getState().translations;
const editor = () => screen.getByRole("textbox") as HTMLTextAreaElement;
const typeDraft = (value: string) => fireEvent.change(editor(), { target: { value } });
const panelRoot = (container: HTMLElement) => container.firstElementChild as HTMLElement;
// The blur-apply decision is deferred a tick behind focusout. jsdom's window
// never has focus, so the alt-tab guard is mocked to "window focused".
const leavePanel = async (container: HTMLElement) => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  // Move focus out for real; the handler checks activeElement, not the event.
  (document.activeElement as HTMLElement | null)?.blur?.();
  fireEvent.focusOut(panelRoot(container));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe("the implicit session", () => {
  it("is read-only while a preview is active", () => {
    useLabelStore.setState({ previewMode: { status: "active", url: "blob:x" } });
    render(<ZPLOutput onResizeMouseDown={vi.fn()} />);
    expect(editor().readOnly).toBe(true);
  });

  it("is read-only with the refusal reason when the export trips the gate", () => {
    const blob = {
      id: "b1", type: "text", x: 10, y: 10, rotation: 0,
      props: { content: "F".repeat(70_000), fontHeight: 30, fontWidth: 0, rotation: "N" },
    } as never;
    useLabelStore.setState({ pages: [{ objects: [blob] }] });
    render(<ZPLOutput onResizeMouseDown={vi.fn()} />);
    expect(editor().readOnly).toBe(true);
    expect(screen.getByText(t().output.editSourceGateBlob)).toBeTruthy();
  });

  it("seeds the session from the shown export on the first keystroke", () => {
    render(<ZPLOutput onResizeMouseDown={vi.fn()} />);
    const shown = editor().value;
    typeDraft(shown + "\n^FX added");
    const s = useLabelStore.getState().sourceEdit;
    expect(s.status).toBe("editing");
    if (s.status === "editing") {
      expect(s.baseline).toBe(shown);
      expect(s.draft).toBe(shown + "\n^FX added");
    }
  });
});

describe("the selection highlight", () => {
  it("tints exactly the selected object's emitted lines", () => {
    useLabelStore.setState({ selectedIds: ["t1"] });
    render(<ZPLOutput onResizeMouseDown={vi.fn()} />);
    const lines = editor().value.split("\n");
    const tinted = (editor().dataset.highlights ?? "")
      .split(",")
      .filter(Boolean)
      .map(Number);
    expect(tinted.length).toBeGreaterThan(0);
    expect(tinted.some((i) => lines[i]?.includes("^FDhello"))).toBe(true);
  });

  it("tints nothing without a selection", () => {
    render(<ZPLOutput onResizeMouseDown={vi.fn()} />);
    expect(editor().dataset.highlights).toBe("");
  });
});

describe("the printer-impact notice", () => {
  it("names replayed setup commands", async () => {
    const { importZplText } = await import("@zplab/core/lib/zplImportService");
    const imported = importZplText("^XA^JUS\n^FO10,10^A0N,30,30^FDX^FS\n^XZ", 8);
    useLabelStore.setState({ pages: imported.pages, variables: imported.variables });
    const { container } = render(<ZPLOutput onResizeMouseDown={vi.fn()} />);
    await waitFor(() => {
      expect(
        [...container.querySelectorAll("p")].some((p) => p.textContent?.includes("^JU")),
      ).toBe(true);
    });
  });

  it("shows nothing for a plain design", () => {
    const { container } = render(<ZPLOutput onResizeMouseDown={vi.fn()} />);
    expect(
      [...container.querySelectorAll("p")].some((p) => p.textContent?.includes("^JU")),
    ).toBe(false);
  });
});

describe("leaving the editor", () => {
  it("applies an untouched buffer as a pure no-op", () => {
    render(<ZPLOutput onResizeMouseDown={vi.fn()} />);
    const shown = editor().value;
    typeDraft(shown + "x");
    typeDraft(shown);
    fireEvent.click(screen.getByRole("button", { name: t().output.editSourceApply }));
    expect(useLabelStore.getState().sourceEdit.status).toBe("off");
    expect(useLabelStore.getState().pages).toBe(pages);
    expect(useLabelStore.temporal.getState().pastStates).toHaveLength(0);
  });

  it("cannot resurrect a stale confirm dialog in a new session", () => {
    render(<ZPLOutput onResizeMouseDown={vi.fn()} />);
    // replayRisk finding forces the confirm dialog.
    typeDraft("^XA^JZY^FO10,10^A0N,30,30^FDX^FS^XZ");
    fireEvent.click(screen.getByRole("button", { name: t().output.editSourceApply }));
    expect(screen.getByRole("button", { name: t().output.editSourceConfirmApply })).toBeTruthy();
    // External document replacement ends the session under the open dialog.
    act(() => {
      useLabelStore
        .getState()
        .loadDesign({ widthMm: 100, heightMm: 50, dpmm: 8 }, [{ objects: [] }], []);
    });
    expect(screen.queryByRole("button", { name: t().output.editSourceConfirmApply })).toBeNull();
    act(() => {
      useLabelStore.setState({ pages, label: { widthMm: 70, heightMm: 40, dpmm: 8 } });
    });
    typeDraft("^XA^FO10,10^A0N,30,30^FDY^FS^XZ");
    expect(screen.queryByRole("button", { name: t().output.editSourceConfirmApply })).toBeNull();
  });

  it("copies the live buffer, not the pre-edit export", () => {
    render(<ZPLOutput onResizeMouseDown={vi.fn()} />);
    typeDraft("^XA^FDedited^FS^XZ");
    fireEvent.click(screen.getByRole("button", { name: t().output.copy }));
    expect(copiedTexts).toEqual(["^XA^FDedited^FS^XZ"]);
  });

  it("asks before discarding a modified buffer", () => {
    render(<ZPLOutput onResizeMouseDown={vi.fn()} />);
    typeDraft("^XA^XZ");
    fireEvent.click(screen.getByRole("button", { name: t().app.cancel }));
    expect(useLabelStore.getState().sourceEdit.status).toBe("editing");
    fireEvent.click(screen.getByRole("button", { name: t().output.editSourceDiscard }));
    expect(useLabelStore.getState().sourceEdit.status).toBe("off");
  });
});

describe("focus leaving the panel", () => {
  it("applies a clean edit", async () => {
    const { container } = render(<ZPLOutput onResizeMouseDown={vi.fn()} />);
    typeDraft("^XA^FO10,10^A0N,30,30^FDedited^FS^XZ");
    await leavePanel(container);
    expect(useLabelStore.getState().sourceEdit.status).toBe("off");
    const obj = useLabelStore.getState().pages[0]?.objects[0];
    expect((obj as { props: { content?: string } }).props.content).toBe("edited");
  });

  it("ends an untouched session silently", async () => {
    const { container } = render(<ZPLOutput onResizeMouseDown={vi.fn()} />);
    const shown = editor().value;
    typeDraft(shown + "x");
    typeDraft(shown);
    await leavePanel(container);
    expect(useLabelStore.getState().sourceEdit.status).toBe("off");
    expect(useLabelStore.getState().pages).toBe(pages);
    expect(useLabelStore.temporal.getState().pastStates).toHaveLength(0);
  });

  it("stops on the confirm dialog for a lossy edit instead of applying silently", async () => {
    const { container } = render(<ZPLOutput onResizeMouseDown={vi.fn()} />);
    typeDraft("^XA^JZY^FO10,10^A0N,30,30^FDX^FS^XZ");
    await leavePanel(container);
    expect(useLabelStore.getState().sourceEdit.status).toBe("editing");
    expect(screen.getByRole("button", { name: t().output.editSourceConfirmApply })).toBeTruthy();
    // The dialog's own focus traffic must not re-trigger the blur apply.
    await leavePanel(container);
    expect(screen.getAllByRole("button", { name: t().output.editSourceConfirmApply })).toHaveLength(1);
  });

  it("keeps the session on a refused buffer and refocuses so Escape works", async () => {
    const { container } = render(<ZPLOutput onResizeMouseDown={vi.fn()} />);
    typeDraft("^XA^FO10,10^A0N,30,30^FDbroken^FS");
    await leavePanel(container);
    expect(useLabelStore.getState().sourceEdit.status).toBe("editing");
    // The reason lands synchronously with the click, not 300ms later.
    expect(useLabelStore.getState().sourceShadow?.refusal).toBe("unbalanced");
    // The refocus is deferred behind the pointerdown's default focus.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.activeElement).toBe(editor());
  });

  it("cancelling the dialog sticks when a focusable element outside holds focus", async () => {
    // The focus trap restores the outside element on unmount; if that restore
    // overrode focusEditor, the re-blur would loop the dialog straight back.
    render(
      <>
        <button data-testid="outside">canvasish</button>
        <ZPLOutput onResizeMouseDown={vi.fn()} />
      </>,
    );
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    typeDraft("^XA^JZY^FO10,10^A0N,30,30^FDX^FS^XZ");
    act(() => screen.getByTestId("outside").focus());
    fireEvent.focusOut(screen.getByRole("region"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByRole("button", { name: t().output.editSourceConfirmApply })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: t().app.cancel }).at(-1)!);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByRole("button", { name: t().output.editSourceConfirmApply })).toBeNull();
    expect(document.activeElement).toBe(editor());
  });

  it("re-arms the blur apply by refocusing the editor when the dialog is cancelled", async () => {
    const { container } = render(<ZPLOutput onResizeMouseDown={vi.fn()} />);
    typeDraft("^XA^JZY^FO10,10^A0N,30,30^FDX^FS^XZ");
    await leavePanel(container);
    // Focus stranded outside the panel would make this the session's last
    // reachable focusout; refocusing restores the gesture.
    fireEvent.click(screen.getAllByRole("button", { name: t().app.cancel }).at(-1)!);
    expect(document.activeElement).toBe(editor());
    await leavePanel(container);
    expect(screen.getByRole("button", { name: t().output.editSourceConfirmApply })).toBeTruthy();
  });

  it("Escape asks before discarding", () => {
    const { container } = render(<ZPLOutput onResizeMouseDown={vi.fn()} />);
    typeDraft("^XA^XZ");
    fireEvent.keyDown(panelRoot(container), { key: "Escape" });
    expect(screen.getByRole("button", { name: t().output.editSourceDiscard })).toBeTruthy();
  });
});

describe("authoring into an empty document", () => {
  it("renders the editor and applies a from-scratch buffer on blur", async () => {
    useLabelStore.setState({ pages: [{ objects: [] }] });
    const { container } = render(<ZPLOutput onResizeMouseDown={vi.fn()} />);
    expect(editor().value).toBe("");
    expect(editor().placeholder).toBe(t().output.editSourcePlaceholder);
    typeDraft("^XA^FO10,10^A0N,30,30^FDfresh^FS^XZ");
    const s = useLabelStore.getState().sourceEdit;
    expect(s.status).toBe("editing");
    if (s.status === "editing") expect(s.baseline).toBe("");
    await leavePanel(container);
    expect(useLabelStore.getState().sourceEdit.status).toBe("off");
    const obj = useLabelStore.getState().pages[0]?.objects[0];
    expect((obj as { props: { content?: string } }).props.content).toBe("fresh");
  });

  it("a stray whitespace keystroke authored nothing and exits clean on blur", async () => {
    useLabelStore.setState({ pages: [{ objects: [] }] });
    const { container } = render(<ZPLOutput onResizeMouseDown={vi.fn()} />);
    typeDraft(" ");
    expect(useLabelStore.getState().sourceEdit.status).toBe("editing");
    await leavePanel(container);
    // Without the nothing-authored short-circuit this held an unappliable
    // session (Apply disabled, every outside click swallowed).
    expect(useLabelStore.getState().sourceEdit.status).toBe("off");
  });

  it("refuses to apply an emptied buffer over a non-empty document", async () => {
    const { container } = render(<ZPLOutput onResizeMouseDown={vi.fn()} />);
    typeDraft("");
    await leavePanel(container);
    // Clearing the text must never read as "delete everything".
    expect(useLabelStore.getState().sourceEdit.status).toBe("editing");
    expect(useLabelStore.getState().pages).toBe(pages);
  });
});

describe("outside pointerdown", () => {
  it("applies synchronously, so the same click acts on the unfrozen store", () => {
    render(
      <>
        <button data-testid="outside">canvasish</button>
        <ZPLOutput onResizeMouseDown={vi.fn()} />
      </>,
    );
    typeDraft("^XA^FO10,10^A0N,30,30^FDedited^FS^XZ");
    // No timer flush: by the time the target's own handlers run, the session
    // must already be over (a deferred apply swallowed the first click).
    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(useLabelStore.getState().sourceEdit.status).toBe("off");
  });

  it("swallows the whole gesture (pointerdown AND click) when the exit holds", async () => {
    const pointerAction = vi.fn();
    const clickAction = vi.fn();
    render(
      <>
        <button data-testid="outside" onPointerDown={pointerAction} onClick={clickAction}>
          canvasish
        </button>
        <ZPLOutput onResizeMouseDown={vi.fn()} />
      </>,
    );
    // The exit stops on the confirm dialog; neither event may fire foreign UI.
    typeDraft("^XA^JZY^FO10,10^A0N,30,30^FDX^FS^XZ");
    fireEvent.pointerDown(screen.getByTestId("outside"));
    fireEvent.click(screen.getByTestId("outside"));
    expect(screen.getByRole("button", { name: t().output.editSourceConfirmApply })).toBeTruthy();
    expect(pointerAction).not.toHaveBeenCalled();
    expect(clickAction).not.toHaveBeenCalled();
    // The guard is one-shot: after the gesture settles (disarm defers one
    // tick past the click dispatch), clicks work again.
    fireEvent.pointerUp(window);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    fireEvent.click(screen.getAllByRole("button", { name: t().app.cancel }).at(-1)!);
    expect(screen.queryByRole("button", { name: t().output.editSourceConfirmApply })).toBeNull();
  });

  it("lets the click through when the exit applies cleanly", () => {
    const outsideAction = vi.fn();
    render(
      <>
        <button data-testid="outside" onPointerDown={outsideAction}>canvasish</button>
        <ZPLOutput onResizeMouseDown={vi.fn()} />
      </>,
    );
    typeDraft("^XA^FO10,10^A0N,30,30^FDedited^FS^XZ");
    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(useLabelStore.getState().sourceEdit.status).toBe("off");
    expect(outsideAction).toHaveBeenCalledTimes(1);
  });

  it("holds the session on panel chrome (the resize rail lives inside the root)", () => {
    const { container } = render(<ZPLOutput onResizeMouseDown={vi.fn()} />);
    typeDraft("^XA^FO10,10^A0N,30,30^FDedited^FS^XZ");
    const rail = container.querySelector(".cursor-row-resize");
    expect(rail).not.toBeNull();
    fireEvent.pointerDown(rail!);
    expect(useLabelStore.getState().sourceEdit.status).toBe("editing");
  });
});

describe("keyboard focus after button exits", () => {
  it("returns to the editor on a clean footer apply", () => {
    render(<ZPLOutput onResizeMouseDown={vi.fn()} />);
    typeDraft("^XA^FO10,10^A0N,30,30^FDedited^FS^XZ");
    fireEvent.click(screen.getByRole("button", { name: t().output.editSourceApply }));
    expect(useLabelStore.getState().sourceEdit.status).toBe("off");
    expect(document.activeElement).toBe(editor());
  });

  it("returns to the editor on a clean cancel", () => {
    render(<ZPLOutput onResizeMouseDown={vi.fn()} />);
    const shown = editor().value;
    typeDraft(shown + "x");
    typeDraft(shown);
    fireEvent.click(screen.getByRole("button", { name: t().app.cancel }));
    expect(useLabelStore.getState().sourceEdit.status).toBe("off");
    expect(document.activeElement).toBe(editor());
  });

  it("returns to the editor after confirming a lossy apply", () => {
    render(<ZPLOutput onResizeMouseDown={vi.fn()} />);
    typeDraft("^XA^JZY^FO10,10^A0N,30,30^FDX^FS^XZ");
    fireEvent.click(screen.getByRole("button", { name: t().output.editSourceApply }));
    fireEvent.click(screen.getByRole("button", { name: t().output.editSourceConfirmApply }));
    expect(useLabelStore.getState().sourceEdit.status).toBe("off");
    expect(document.activeElement).toBe(editor());
  });
});

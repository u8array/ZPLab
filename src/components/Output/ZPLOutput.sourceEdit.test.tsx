// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen, act, waitFor } from "@testing-library/react";

const copiedTexts: string[] = [];
vi.mock("../../lib/clipboard", () => ({
  copyText: (text: string) => {
    copiedTexts.push(text);
    return Promise.resolve("copied");
  },
}));
// CodeMirror needs layout APIs jsdom lacks; value-in/onChange-out is the whole contract.
vi.mock("./ZplCodeMirror", () => ({
  default: ({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
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
  });
  useLabelStore.temporal.getState().clear();
});

afterEach(() => {
  cleanup();
  copiedTexts.length = 0;
});

const t = () => useLabelStore.getState().translations;
const editButton = () => screen.getByRole("button", { name: t().output.editSource });

describe("the source-edit toggle", () => {
  it("is disabled while a preview is active", () => {
    useLabelStore.setState({ previewMode: { status: "active", url: "blob:x" } });
    render(<ZPLOutput />);
    expect((editButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("enters edit mode with the shown export as the buffer; the footer owns the exit", () => {
    render(<ZPLOutput />);
    fireEvent.click(editButton());
    const s = useLabelStore.getState().sourceEdit;
    expect(s.status).toBe("editing");
    if (s.status === "editing") expect(s.draft).toContain("^XA");
    expect((editButton() as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the selection highlight", () => {
  beforeEach(() => {
    // jsdom has no scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("tints exactly the selected object's emitted lines", () => {
    useLabelStore.setState({ selectedIds: ["t1"] });
    const { container } = render(<ZPLOutput />);
    const tinted = [...container.querySelectorAll("span.block")].filter((el) =>
      el.className.includes("bg-accent"),
    );
    expect(tinted.length).toBeGreaterThan(0);
    expect(tinted.some((el) => el.textContent?.includes("^FDhello"))).toBe(true);
  });

  it("tints nothing without a selection", () => {
    const { container } = render(<ZPLOutput />);
    expect(
      [...container.querySelectorAll("span.block")].some((el) =>
        el.className.includes("bg-accent"),
      ),
    ).toBe(false);
  });
});

describe("the printer-impact notice", () => {
  it("names replayed setup commands", async () => {
    const { importZplText } = await import("@zplab/core/lib/zplImportService");
    const imported = importZplText("^XA^JUS\n^FO10,10^A0N,30,30^FDX^FS\n^XZ", 8);
    useLabelStore.setState({ pages: imported.pages, variables: imported.variables });
    const { container } = render(<ZPLOutput />);
    await waitFor(() => {
      expect(
        [...container.querySelectorAll("p")].some((p) => p.textContent?.includes("^JU")),
      ).toBe(true);
    });
  });

  it("shows nothing for a plain design", () => {
    const { container } = render(<ZPLOutput />);
    expect(
      [...container.querySelectorAll("p")].some((p) => p.textContent?.includes("^JU")),
    ).toBe(false);
  });
});

describe("leaving the editor", () => {
  it("applies an untouched buffer as a pure no-op", () => {
    render(<ZPLOutput />);
    fireEvent.click(editButton());
    fireEvent.click(screen.getByRole("button", { name: t().output.editSourceApply }));
    expect(useLabelStore.getState().sourceEdit.status).toBe("off");
    expect(useLabelStore.getState().pages).toBe(pages);
    expect(useLabelStore.temporal.getState().pastStates).toHaveLength(0);
  });

  it("cannot resurrect a stale confirm dialog in a new session", () => {
    render(<ZPLOutput />);
    fireEvent.click(editButton());
    // replayRisk finding forces the confirm dialog.
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "^XA^JZY^FO10,10^A0N,30,30^FDX^FS^XZ" },
    });
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
    fireEvent.click(editButton());
    expect(screen.queryByRole("button", { name: t().output.editSourceConfirmApply })).toBeNull();
  });

  it("copies the live buffer, not the pre-edit export", () => {
    render(<ZPLOutput />);
    fireEvent.click(editButton());
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "^XA^FDedited^FS^XZ" } });
    fireEvent.click(screen.getByRole("button", { name: t().output.copy }));
    expect(copiedTexts).toEqual(["^XA^FDedited^FS^XZ"]);
  });

  it("asks before discarding a modified buffer", () => {
    render(<ZPLOutput />);
    fireEvent.click(editButton());
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "^XA^XZ" } });
    fireEvent.click(screen.getByRole("button", { name: t().app.cancel }));
    expect(useLabelStore.getState().sourceEdit.status).toBe("editing");
    fireEvent.click(screen.getByRole("button", { name: t().output.editSourceDiscard }));
    expect(useLabelStore.getState().sourceEdit.status).toBe("off");
  });
});

// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import ZplCodeMirror from "./ZplCodeMirror";
import { isEditableTarget } from "../../lib/dom";

afterEach(cleanup);

describe("ZplCodeMirror keyboard surface", () => {
  it("reads as an editable target from every real focus/click node", () => {
    // Keys from the read-only scroller or the gutter must never fall
    // through to canvas handlers.
    const { container } = render(
      <ZplCodeMirror value={"^XA\n^XZ"} onChange={vi.fn()} ariaLabel="zpl" readOnly />,
    );
    const view = EditorView.findFromDOM(container as HTMLElement);
    expect(view).not.toBeNull();
    expect(isEditableTarget(view!.scrollDOM as HTMLElement)).toBe(true);
    const gutter = view!.dom.querySelector<HTMLElement>(".cm-gutters");
    expect(gutter).not.toBeNull();
    expect(isEditableTarget(gutter)).toBe(true);
  });
});

describe("ZplCodeMirror line separators", () => {
  it("mounts a CRLF buffer without a write-back", () => {
    const changes: string[] = [];
    const value = "^XA\r\n^PW560\r\n^FO10,10^A0N,30,30^FDHi^FS\r\n^XZ";
    render(<ZplCodeMirror value={value} onChange={(v) => changes.push(v)} ariaLabel="zpl" />);
    // A separator mismatch surfaced as a mount RangeError or an LF-joined onChange.
    expect(changes).toEqual([]);
  });

  it("mounts a lone-\\r buffer without writing normalized bytes to the store", () => {
    const changes: string[] = [];
    render(
      <ZplCodeMirror value={"^XA\n^FDa\rb^FS\n^XZ"} onChange={(v) => changes.push(v)} ariaLabel="zpl" />,
    );
    expect(changes).toEqual([]);
  });

  it("mounts a mixed-separator buffer without a write-back and splits every line", () => {
    const changes: string[] = [];
    const value = "^XA\r\n^FDone^FS\r\n^XZ\n^XA\n^FDtwo^FS\n^XZ";
    const { container } = render(
      <ZplCodeMirror value={value} onChange={(v) => changes.push(v)} ariaLabel="zpl" />,
    );
    expect(changes).toEqual([]);
    const lines = container.querySelectorAll(".cm-line");
    expect(lines.length).toBeGreaterThanOrEqual(6);
  });

  it("mounts an LF buffer cleanly", () => {
    const changes: string[] = [];
    render(
      <ZplCodeMirror value={"^XA\n^FDHi^FS\n^XZ"} onChange={(v) => changes.push(v)} ariaLabel="zpl" />,
    );
    expect(changes).toEqual([]);
  });

  it("does not write back a prop-driven value change", () => {
    // Regression: with onChange as the session trigger, an echoed prop sync
    // would turn every canvas edit into a source-edit session (app freeze).
    const changes: string[] = [];
    const onChange = (v: string) => changes.push(v);
    const { rerender } = render(
      <ZplCodeMirror value={"^XA\n^FDone^FS\n^XZ"} onChange={onChange} ariaLabel="zpl" />,
    );
    rerender(<ZplCodeMirror value={"^XA\n^FDtwo^FS\n^XZ"} onChange={onChange} ariaLabel="zpl" />);
    expect(changes).toEqual([]);
  });
});

describe("ZplCodeMirror history epoch", () => {
  it("clears the undo history when the epoch bumps", async () => {
    const changes: string[] = [];
    const props = (epoch: number) => ({
      value: "^XA\n^FDone^FS\n^XZ",
      onChange: (v: string) => changes.push(v),
      ariaLabel: "zpl",
      historyEpoch: epoch,
    });
    const { container, rerender } = render(<ZplCodeMirror {...props(0)} />);
    const view = EditorView.findFromDOM(container as HTMLElement);
    expect(view).not.toBeNull();
    act(() => {
      view!.dispatch({ changes: { from: 8, insert: "X" } });
    });
    expect(changes).toHaveLength(1);
    // Store echo, then an APPLY ends the session: the new export CONTAINS the
    // edit (unlike cancel, whose revert-splice annuls the event spatially),
    // so the history event stays mappable and only the epoch clear kills it.
    rerender(<ZplCodeMirror {...props(0)} value={changes[0]!} />);
    rerender(<ZplCodeMirror {...props(1)} value={changes[0]!} />);
    const { undo } = await import("@codemirror/commands");
    act(() => {
      undo(view!);
    });
    expect(changes).toHaveLength(1);
    expect(view!.state.doc.toString()).toBe(changes[0]);
  });
});

describe("ZplCodeMirror payload folding", () => {
  it("auto-folds a payload blob pasted after mount", async () => {
    const { container } = render(
      <ZplCodeMirror value={"^XA\n^XZ"} onChange={vi.fn()} ariaLabel="zpl" />,
    );
    const view = EditorView.findFromDOM(container as HTMLElement);
    expect(view).not.toBeNull();
    const blob = `^GFA,8,8,1,${"F".repeat(3000)}^FS\n`;
    act(() => {
      view?.dispatch({ changes: { from: 4, insert: blob } });
    });
    await waitFor(() => {
      expect(container.querySelector(".cm-foldPlaceholder")).not.toBeNull();
    });
  });

  it("keeps folds through a small prop change (minimal splice, not full replace)", async () => {
    const doc = (fd: string) => `^XA\n^GFA,8,8,1,${"F".repeat(3000)}^FS\n^FD${fd}^FS\n^XZ`;
    const onChange = vi.fn();
    const { container, rerender } = render(
      <ZplCodeMirror value={doc("one")} onChange={onChange} ariaLabel="zpl" />,
    );
    await waitFor(() => {
      expect(container.querySelector(".cm-foldPlaceholder")).not.toBeNull();
    });
    rerender(<ZplCodeMirror value={doc("two")} onChange={onChange} ariaLabel="zpl" />);
    // Synchronously, no waitFor: a full replace dropped the fold and only a
    // deferred rescan restored it (visible flicker per drag/resize frame).
    expect(container.querySelector(".cm-foldPlaceholder")).not.toBeNull();
  });

  it("skips highlight dispatches when the set content is unchanged", () => {
    const lines = () => new Set([1]);
    const onChange = vi.fn();
    const { container, rerender } = render(
      <ZplCodeMirror value={"^XA\n^FDx^FS\n^XZ"} onChange={onChange} ariaLabel="zpl" highlightLines={lines()} />,
    );
    const view = EditorView.findFromDOM(container as HTMLElement);
    expect(view).not.toBeNull();
    const dispatches = vi.spyOn(view!, "dispatch" as never);
    // Fresh Set identity, same content: reacting to identity re-scrolled the
    // pane on every model change while an object was selected.
    rerender(
      <ZplCodeMirror value={"^XA\n^FDx^FS\n^XZ"} onChange={onChange} ariaLabel="zpl" highlightLines={lines()} />,
    );
    expect(dispatches).not.toHaveBeenCalled();
  });

  it("re-folds a blob after a prop-driven document replace", async () => {
    // The full-doc sync drops fold ranges; the typed-in-a-blob protection
    // must not stop the re-fold (the replaced range contains overlong lines).
    const blob = (fd: string) => `^XA\n^GFA,8,8,1,${"F".repeat(3000)}^FS\n^FD${fd}^FS\n^XZ`;
    const onChange = vi.fn();
    const { container, rerender } = render(
      <ZplCodeMirror value={blob("one")} onChange={onChange} ariaLabel="zpl" />,
    );
    await waitFor(() => {
      expect(container.querySelector(".cm-foldPlaceholder")).not.toBeNull();
    });
    rerender(<ZplCodeMirror value={blob("two")} onChange={onChange} ariaLabel="zpl" />);
    await waitFor(() => {
      expect(container.querySelector(".cm-foldPlaceholder")).not.toBeNull();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("auto-folds when a small paste pushes an existing blob line over the cap", async () => {
    const nearCap = `^GFA,8,8,1,${"F".repeat(1980)}`;
    const { container } = render(
      <ZplCodeMirror value={`^XA\n${nearCap}\n^XZ`} onChange={vi.fn()} ariaLabel="zpl" />,
    );
    expect(container.querySelector(".cm-foldPlaceholder")).toBeNull();
    const view = EditorView.findFromDOM(container as HTMLElement);
    act(() => {
      view?.dispatch({ changes: { from: 4 + nearCap.length, insert: "F".repeat(100) } });
    });
    await waitFor(() => {
      expect(container.querySelector(".cm-foldPlaceholder")).not.toBeNull();
    });
  });
});

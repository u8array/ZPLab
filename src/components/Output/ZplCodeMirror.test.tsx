// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import ZplCodeMirror from "./ZplCodeMirror";

afterEach(cleanup);

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

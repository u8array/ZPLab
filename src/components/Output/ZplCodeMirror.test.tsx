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
      <ZplCodeMirror value={"^XA\n^XZ"} onChange={vi.fn()} ariaLabel="zpl" placeholderText="ph" readOnly />,
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
    render(<ZplCodeMirror value={value} onChange={(v) => changes.push(v)} ariaLabel="zpl" placeholderText="ph" />);
    // A separator mismatch surfaced as a mount RangeError or an LF-joined onChange.
    expect(changes).toEqual([]);
  });

  it("mounts a lone-\\r buffer without writing normalized bytes to the store", () => {
    const changes: string[] = [];
    render(
      <ZplCodeMirror value={"^XA\n^FDa\rb^FS\n^XZ"} onChange={(v) => changes.push(v)} ariaLabel="zpl" placeholderText="ph" />,
    );
    expect(changes).toEqual([]);
  });

  it("mounts a mixed-separator buffer without a write-back and splits every line", () => {
    const changes: string[] = [];
    const value = "^XA\r\n^FDone^FS\r\n^XZ\n^XA\n^FDtwo^FS\n^XZ";
    const { container } = render(
      <ZplCodeMirror value={value} onChange={(v) => changes.push(v)} ariaLabel="zpl" placeholderText="ph" />,
    );
    expect(changes).toEqual([]);
    const lines = container.querySelectorAll(".cm-line");
    expect(lines.length).toBeGreaterThanOrEqual(6);
  });

  it("mounts an LF buffer cleanly", () => {
    const changes: string[] = [];
    render(
      <ZplCodeMirror value={"^XA\n^FDHi^FS\n^XZ"} onChange={(v) => changes.push(v)} ariaLabel="zpl" placeholderText="ph" />,
    );
    expect(changes).toEqual([]);
  });

  it("does not write back a prop-driven value change", () => {
    // Regression: with onChange as the session trigger, an echoed prop sync
    // would turn every canvas edit into a source-edit session (app freeze).
    const changes: string[] = [];
    const onChange = (v: string) => changes.push(v);
    const { rerender } = render(
      <ZplCodeMirror value={"^XA\n^FDone^FS\n^XZ"} onChange={onChange} ariaLabel="zpl" placeholderText="ph" />,
    );
    rerender(<ZplCodeMirror value={"^XA\n^FDtwo^FS\n^XZ"} onChange={onChange} ariaLabel="zpl" placeholderText="ph" />);
    expect(changes).toEqual([]);
  });
});

describe("ZplCodeMirror placeholder", () => {
  it("shows the placeholder only while the doc is empty, live on a locale switch", () => {
    const { container, rerender } = render(
      <ZplCodeMirror value="" onChange={vi.fn()} ariaLabel="zpl" placeholderText="Type ZPL" />,
    );
    expect(container.querySelector(".cm-placeholder")?.textContent).toBe("Type ZPL");
    // Locale switch mid-run must reconfigure, not keep the mount snapshot.
    rerender(
      <ZplCodeMirror value="" onChange={vi.fn()} ariaLabel="zpl" placeholderText="ZPL eingeben" />,
    );
    expect(container.querySelector(".cm-placeholder")?.textContent).toBe("ZPL eingeben");
    rerender(
      <ZplCodeMirror value="^XA^XZ" onChange={vi.fn()} ariaLabel="zpl" placeholderText="ZPL eingeben" />,
    );
    expect(container.querySelector(".cm-placeholder")).toBeNull();
  });
});

describe("ZplCodeMirror diagnostics", () => {
  it("maps string offsets to doc positions and renders the lint range", async () => {
    const { forEachDiagnostic } = await import("@codemirror/lint");
    // CRLF buffer: the one CRLF before the range shifts doc positions by one.
    const value = "^XA^FDx^FS\r\n^XZ^XZ";
    const strayAt = value.indexOf("^XZ^XZ") + 3;
    const { container } = render(
      <ZplCodeMirror
        value={value}
        onChange={vi.fn()}
        ariaLabel="zpl" placeholderText="ph"
        diagnostics={[{ from: strayAt, to: strayAt + 3, severity: "error", message: "boom" }]}
      />,
    );
    const view = EditorView.findFromDOM(container as HTMLElement);
    expect(view).not.toBeNull();
    const seen: { from: number; to: number; message: string }[] = [];
    forEachDiagnostic(view!.state, (d, from, to) => seen.push({ from, to, message: d.message }));
    expect(seen).toEqual([{ from: strayAt - 1, to: strayAt + 2, message: "boom" }]);
    expect(container.querySelector(".cm-lintRange-error")).not.toBeNull();
  });

  it("clears the marker once a fresh build reports nothing", async () => {
    // The early-out must skip only the no-op case; skipping the transition
    // leaves a red squiggle on a buffer the user already repaired.
    const { forEachDiagnostic } = await import("@codemirror/lint");
    const value = "^XA^FDx^FSstray^XZ";
    const { container, rerender } = render(
      <ZplCodeMirror
        value={value}
        onChange={vi.fn()}
        ariaLabel="zpl" placeholderText="ph"
        diagnostics={[{ from: 10, to: 15, severity: "error", message: "boom" }]}
      />,
    );
    rerender(
      <ZplCodeMirror
        value={value}
        onChange={vi.fn()}
        ariaLabel="zpl" placeholderText="ph"
        diagnostics={[]}
      />,
    );
    const view = EditorView.findFromDOM(container as HTMLElement)!;
    const seen: string[] = [];
    forEachDiagnostic(view.state, (d) => seen.push(d.message));
    expect(seen).toEqual([]);
  });

  it("renders the repair site as a weaker second mark", async () => {
    const { forEachDiagnostic } = await import("@codemirror/lint");
    const value = "^XA^FDa^FS^XA^FDb^FS^XZ";
    const { container } = render(
      <ZplCodeMirror
        value={value}
        onChange={vi.fn()}
        ariaLabel="zpl" placeholderText="ph"
        diagnostics={[
          { from: 0, to: 3, severity: "error", message: "never closed" },
          { from: 10, to: 13, severity: "related", message: "still open here" },
        ]}
      />,
    );
    const view = EditorView.findFromDOM(container as HTMLElement)!;
    const seen: string[] = [];
    forEachDiagnostic(view.state, (d) => seen.push(d.severity));
    // One problem stays one problem: the context mark must not read as a
    // second error.
    expect(seen).toEqual(["error", "hint"]);
    expect(container.querySelector(".cm-lintRange-error")?.textContent).toBe("^XA");
  });

  it("renders a finding warning as CM warning, not error or hint", async () => {
    const { forEachDiagnostic } = await import("@codemirror/lint");
    const value = "^XA^FDa^FS^XZ~PH";
    const { container } = render(
      <ZplCodeMirror
        value={value}
        onChange={vi.fn()}
        ariaLabel="zpl" placeholderText="ph"
        diagnostics={[{ from: 13, to: 16, severity: "warning", message: "device action" }]}
      />,
    );
    const view = EditorView.findFromDOM(container as HTMLElement)!;
    const seen: string[] = [];
    forEachDiagnostic(view.state, (d) => seen.push(d.severity));
    expect(seen).toEqual(["warning"]);
    expect(container.querySelector(".cm-lintRange-warning")?.textContent).toBe("~PH");
  });

  it("does not re-dispatch an identical set (an open tooltip would close)", () => {
    const value = "^XA^FDx^FSstray^XZ";
    const lint = () => [{ from: 10, to: 15, severity: "error" as const, message: "boom" }];
    const { container, rerender } = render(
      <ZplCodeMirror value={value} onChange={vi.fn()} ariaLabel="zpl" placeholderText="ph" diagnostics={lint()} />,
    );
    const view = EditorView.findFromDOM(container as HTMLElement)!;
    const dispatches = vi.spyOn(view, "dispatch" as never);
    // A settled re-parse hands a fresh but equal array every 300ms.
    rerender(
      <ZplCodeMirror value={value} onChange={vi.fn()} ariaLabel="zpl" placeholderText="ph" diagnostics={lint()} />,
    );
    expect(dispatches).not.toHaveBeenCalled();
  });

  it("does not re-dispatch after the lag, when the settled parse marks the same bytes", () => {
    // null -> CM maps the mark through the edit -> the fresh build describes
    // the same bytes at shifted offsets. The editor already shows them.
    const value = "^XA^FDx^FSstray^XZ";
    const { container, rerender } = render(
      <ZplCodeMirror
        value={value}
        onChange={vi.fn()}
        ariaLabel="zpl" placeholderText="ph"
        diagnostics={[{ from: 10, to: 15, severity: "error" as const, message: "boom" }]}
      />,
    );
    const view = EditorView.findFromDOM(container as HTMLElement)!;
    const shifted = "AB" + value;
    rerender(
      <ZplCodeMirror value={shifted} onChange={vi.fn()} ariaLabel="zpl" placeholderText="ph" diagnostics={null} />,
    );
    const dispatches = vi.spyOn(view, "dispatch" as never);
    rerender(
      <ZplCodeMirror
        value={shifted}
        onChange={vi.fn()}
        ariaLabel="zpl" placeholderText="ph"
        diagnostics={[{ from: 12, to: 17, severity: "error" as const, message: "boom" }]}
      />,
    );
    expect(dispatches).not.toHaveBeenCalled();
  });

  it("keeps the previous set live-mapped while the parse lags (null)", async () => {
    // Re-dispatching a lagging build would re-anchor its offsets onto the
    // newer doc and dim live commands.
    const { forEachDiagnostic } = await import("@codemirror/lint");
    const value = "^XA^FDx^FSstray^XZ";
    const lints = [{ from: 10, to: 15, severity: "error" as const, message: "ignored" }];
    const { container, rerender } = render(
      <ZplCodeMirror value={value} onChange={vi.fn()} ariaLabel="zpl" placeholderText="ph" diagnostics={lints} />,
    );
    rerender(
      <ZplCodeMirror value={"AB" + value} onChange={vi.fn()} ariaLabel="zpl" placeholderText="ph" diagnostics={null} />,
    );
    const view = EditorView.findFromDOM(container as HTMLElement)!;
    const seen: string[] = [];
    forEachDiagnostic(view.state, (_d, from, to) => seen.push(view.state.doc.sliceString(from, to)));
    expect(seen).toEqual(["stray"]);
  });
});

describe("ZplCodeMirror history epoch", () => {
  it("clears the undo history when the epoch bumps", async () => {
    const changes: string[] = [];
    const props = (epoch: number) => ({
      value: "^XA\n^FDone^FS\n^XZ",
      onChange: (v: string) => changes.push(v),
      ariaLabel: "zpl",
      placeholderText: "ph",
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
      <ZplCodeMirror value={"^XA\n^XZ"} onChange={vi.fn()} ariaLabel="zpl" placeholderText="ph" />,
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
      <ZplCodeMirror value={doc("one")} onChange={onChange} ariaLabel="zpl" placeholderText="ph" />,
    );
    await waitFor(() => {
      expect(container.querySelector(".cm-foldPlaceholder")).not.toBeNull();
    });
    rerender(<ZplCodeMirror value={doc("two")} onChange={onChange} ariaLabel="zpl" placeholderText="ph" />);
    // Synchronously, no waitFor: a full replace dropped the fold and only a
    // deferred rescan restored it (visible flicker per drag/resize frame).
    expect(container.querySelector(".cm-foldPlaceholder")).not.toBeNull();
  });

  it("skips highlight dispatches when the set content is unchanged", () => {
    const lines = () => new Set([1]);
    const onChange = vi.fn();
    const { container, rerender } = render(
      <ZplCodeMirror value={"^XA\n^FDx^FS\n^XZ"} onChange={onChange} ariaLabel="zpl" placeholderText="ph" highlightLines={lines()} />,
    );
    const view = EditorView.findFromDOM(container as HTMLElement);
    expect(view).not.toBeNull();
    const dispatches = vi.spyOn(view!, "dispatch" as never);
    // Fresh Set identity, same content: reacting to identity re-scrolled the
    // pane on every model change while an object was selected.
    rerender(
      <ZplCodeMirror value={"^XA\n^FDx^FS\n^XZ"} onChange={onChange} ariaLabel="zpl" placeholderText="ph" highlightLines={lines()} />,
    );
    expect(dispatches).not.toHaveBeenCalled();
  });

  it("re-folds a blob after a prop-driven document replace", async () => {
    // The full-doc sync drops fold ranges; the typed-in-a-blob protection
    // must not stop the re-fold (the replaced range contains overlong lines).
    const blob = (fd: string) => `^XA\n^GFA,8,8,1,${"F".repeat(3000)}^FS\n^FD${fd}^FS\n^XZ`;
    const onChange = vi.fn();
    const { container, rerender } = render(
      <ZplCodeMirror value={blob("one")} onChange={onChange} ariaLabel="zpl" placeholderText="ph" />,
    );
    await waitFor(() => {
      expect(container.querySelector(".cm-foldPlaceholder")).not.toBeNull();
    });
    rerender(<ZplCodeMirror value={blob("two")} onChange={onChange} ariaLabel="zpl" placeholderText="ph" />);
    await waitFor(() => {
      expect(container.querySelector(".cm-foldPlaceholder")).not.toBeNull();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("auto-folds when a small paste pushes an existing blob line over the cap", async () => {
    const nearCap = `^GFA,8,8,1,${"F".repeat(1980)}`;
    const { container } = render(
      <ZplCodeMirror value={`^XA\n${nearCap}\n^XZ`} onChange={vi.fn()} ariaLabel="zpl" placeholderText="ph" />,
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

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup, waitFor } from "@testing-library/react";
import { useZplOutputView } from "./useZplOutputView";
import { useLabelStore } from "../store/labelStore";
import type { LabelObject, Page } from "@zplab/core/types/Group";

const text = (id: string, content: string, y = 10): LabelObject =>
  ({
    id, type: "text", x: 10, y, rotation: 0,
    props: { content, fontHeight: 30, fontWidth: 0, rotation: "N" },
  }) as never;

const seed = (pages: Page[], over: Record<string, unknown> = {}) =>
  useLabelStore.setState({
    label: { widthMm: 70, heightMm: 40, dpmm: 8 },
    pages,
    variables: [],
    currentPageIndex: 0,
    selectedIds: [],
    previewMode: { status: "idle" },
    sourceEdit: { status: "off" },
    ...over,
  });

beforeEach(() => seed([{ objects: [text("a", "Alpha")] }]));
afterEach(cleanup);

describe("useZplOutputView gating", () => {
  it("keeps the export text while collapsed but skips highlight and notices", () => {
    seed([{ objects: [text("a", "Alpha")] }], { selectedIds: ["a"] });
    const { result } = renderHook(() => useZplOutputView(true));
    expect(result.current.zpl).toContain("^FDAlpha^FS");
    expect(result.current.highlightedLines.size).toBe(0);
    expect(result.current.notices).toEqual([]);
  });

  it("surfaces impact notices in the visible export view", async () => {
    const r = await import("@zplab/core/lib/zplImportService");
    const imported = r.importZplText("^XA^JUS\n^FO10,10^A0N,30,30^FDX^FS\n^XZ", 8);
    seed(imported.pages, { variables: imported.variables });
    const { result } = renderHook(() => useZplOutputView(false));
    await waitFor(() => {
      expect(result.current.notices.some((n) => n.includes("^JU"))).toBe(true);
    });
  });

  it("skips highlight and notices during a source-edit session", () => {
    seed([{ objects: [text("a", "Alpha")] }], {
      selectedIds: ["a"],
      sourceEdit: { status: "editing", draft: "^XA^XZ", baseline: "^XA^XZ", session: 1 },
    });
    const { result } = renderHook(() => useZplOutputView(false));
    expect(result.current.session).not.toBeNull();
    expect(result.current.highlightedLines.size).toBe(0);
    expect(result.current.notices).toEqual([]);
  });
});

describe("useZplOutputView selection resolution", () => {
  it("resolves a selected group to its leaves' lines", () => {
    const pages: Page[] = [
      {
        objects: [
          {
            id: "g", type: "group", x: 0, y: 0, rotation: 0,
            children: [text("b", "Beta", 60), text("c", "Gamma", 90)],
          } as never,
        ],
      },
    ];
    seed(pages, { selectedIds: ["g"] });
    const { result } = renderHook(() => useZplOutputView(false));
    const lines = result.current.zpl.split("\n");
    const marked = [...result.current.highlightedLines].map((i) => lines[i] ?? "");
    expect(marked.some((l) => l.includes("Beta"))).toBe(true);
    expect(marked.some((l) => l.includes("Gamma"))).toBe(true);
  });

  it("highlights only the current page's spans in a multi-page document", () => {
    const pages: Page[] = [
      { objects: [text("p0", "Zero")] },
      { objects: [text("p1", "One")] },
    ];
    seed(pages, { selectedIds: ["p1"], currentPageIndex: 1 });
    const { result } = renderHook(() => useZplOutputView(false));
    const lines = result.current.zpl.split("\n");
    const marked = [...result.current.highlightedLines].map((i) => lines[i] ?? "");
    expect(marked.length).toBeGreaterThan(0);
    expect(marked.every((l) => l.includes("One"))).toBe(true);
  });
});

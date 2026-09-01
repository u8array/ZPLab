// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";
import { useSourceShadowSync } from "./useSourceEditShadow";
import { usePreviewBinding } from "../store/usePreviewBinding";
import { useLabelStore, selectRenderObjects, selectRenderPages } from "../store/labelStore";
import { prepareSourceApply } from "@zplab/core/lib/zplSourceEdit";
import type { Page } from "@zplab/core/types/Group";

const seed = (over: Record<string, unknown> = {}) =>
  useLabelStore.setState({
    label: { widthMm: 70, heightMm: 40, dpmm: 8 },
    pages: [{ objects: [] }] as Page[],
    variables: [],
    currentPageIndex: 0,
    selectedIds: [],
    columnMapping: null,
    dataset: null,
    printerProfile: {},
    previewMode: { status: "idle" },
    sourceEdit: { status: "off" },
    sourceShadow: null,
    ...over,
  });

const session = (draft: string, baseline = "^XA^XZ") =>
  ({ status: "editing", draft, baseline, session: 1 }) as const;

const flushParse = async () => {
  await act(async () => {
    vi.advanceTimersByTime(350);
  });
};

const shadowObjects = () => selectRenderObjects(useLabelStore.getState());

beforeEach(() => {
  vi.useFakeTimers();
  seed();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("useSourceShadowSync", () => {
  it("carries spanned import findings for the parsed draft", async () => {
    const { rerender } = renderHook(() => useSourceShadowSync());
    const draft = "^XA^FO10,10^A0N,30,30^FDHi^FS^XZ~PH";
    act(() => {
      useLabelStore.setState({ sourceEdit: session(draft) });
    });
    rerender();
    await flushParse();
    const shadow = useLabelStore.getState().sourceShadow;
    const dev = shadow?.findings.find((f) => f.kind === "deviceAction");
    expect(dev?.span && draft.slice(dev.span.start, dev.span.end)).toBe("~PH");
  });

  it("clears findings on the refusal path (offsets would be stale)", async () => {
    const { rerender } = renderHook(() => useSourceShadowSync());
    act(() => {
      useLabelStore.setState({ sourceEdit: session("^XA~PH^FDx^FS") });
    });
    rerender();
    await flushParse();
    const shadow = useLabelStore.getState().sourceShadow;
    expect(shadow?.refusal?.reason).toBe("unbalanced");
    expect(shadow?.findings).toEqual([]);
  });

  it("parses an edited draft into the shadow; an untouched buffer stays live", async () => {
    const { rerender } = renderHook(() => useSourceShadowSync());
    act(() => {
      useLabelStore.setState({ sourceEdit: session("^XA^XZ", "^XA^XZ") });
    });
    rerender();
    await flushParse();
    expect(useLabelStore.getState().sourceShadow?.doc).toBeNull();
    act(() => {
      useLabelStore.setState({
        sourceEdit: session("^XA\n^PW480\n^FO10,10^A0N,30,30^FDHello^FS\n^XZ"),
      });
    });
    rerender();
    await flushParse();
    expect(shadowObjects()).toHaveLength(1);
    // Label geometry follows the draft's ^PW (480 dots / 8 dpmm = 60 mm).
    expect(useLabelStore.getState().sourceShadow?.doc?.label.widthMm).toBe(60);
  });

  it("previews exactly what applying would commit (baseline-deleted key)", async () => {
    // Baseline sets ^LS; the draft deletes it. Without the baseline the strip
    // would not run and the shadow would keep the stale labelShift.
    const baseline = "^XA\n^LS20\n^FO10,10^A0N,30,30^FDx^FS\n^XZ";
    const draft = "^XA\n^FO10,10^A0N,30,30^FDx^FS\n^XZ";
    const { rerender } = renderHook(() => useSourceShadowSync());
    act(() => {
      useLabelStore.setState({ sourceEdit: session(draft, baseline) });
    });
    rerender();
    await flushParse();
    const s = useLabelStore.getState();
    const applied = prepareSourceApply({
      text: draft,
      baseline,
      current: {
        label: s.label, pages: s.pages, variables: s.variables,
        printerProfile: s.printerProfile, columnMapping: s.columnMapping,
      },
    });
    if (!applied.ok) throw new Error("fixture");
    expect(s.sourceShadow?.doc?.label.labelShift).toBe(applied.next.label.labelShift);
    expect(s.sourceShadow?.doc?.label.labelShift).toBeUndefined();
  });

  it("resolves markers against the shadow's variables", async () => {
    const { result, rerender } = renderHook(() => {
      useSourceShadowSync();
      return usePreviewBinding();
    });
    act(() => {
      useLabelStore.setState({
        sourceEdit: session("^XA\n^FO10,10^A0N,30,30^FN1^FDAcme^FS\n^XZ"),
      });
    });
    rerender();
    await flushParse();
    rerender();
    const marker = `«${result.current.variables[0]?.name ?? ""}»`;
    expect(result.current.resolveDefaults(marker)).toBe("Acme");
  });

  it("keeps node identity for unchanged leading fields across a re-parse", async () => {
    const three = (mid: string) =>
      `^XA^FO10,10^A0N,30,30^FDa^FS^FO10,60^A0N,30,30^FD${mid}^FS^FO10,90^A0N,30,30^FDc^FS^XZ`;
    const { rerender } = renderHook(() => useSourceShadowSync());
    act(() => {
      useLabelStore.setState({ sourceEdit: session(three("b")) });
    });
    rerender();
    await flushParse();
    const before = shadowObjects().map((o) => o.id);
    act(() => {
      useLabelStore.setState({ sourceEdit: session(three("EDITED")) });
    });
    rerender();
    await flushParse();
    expect(shadowObjects().map((o) => o.id)).toEqual(before);
    expect(before[0]).toMatch(/^shadow:/);
  });

  it("keeps the last good doc over a refused buffer and exposes the refusal", async () => {
    const { rerender } = renderHook(() => useSourceShadowSync());
    act(() => {
      useLabelStore.setState({ sourceEdit: session("^XA^FO10,10^A0N,30,30^FDgood^FS^XZ") });
    });
    rerender();
    await flushParse();
    expect(shadowObjects()).toHaveLength(1);
    act(() => {
      useLabelStore.setState({ sourceEdit: session("^XA^FO10,10^A0N,30,30^FDbroken^FS") });
    });
    rerender();
    await flushParse();
    expect(shadowObjects()).toHaveLength(1);
    const refusal = useLabelStore.getState().sourceShadow?.refusal;
    expect(refusal?.reason).toBe("unbalanced");
    // One shape per verdict: the plan's own discriminant must not ride along,
    // or the slot holds two different objects for the same state.
    expect(refusal && "ok" in refusal).toBe(false);
  });

  it("keeps a refusal the exit pushed for this very draft", () => {
    // The exit reports synchronously and HOLDS the session; the debounce still
    // armed for the same text must not blank that verdict.
    const draft = "^XA^FO10,10^A0N,30,30^FDa^FS";
    const { rerender } = renderHook(() => useSourceShadowSync());
    act(() => {
      useLabelStore.setState({ sourceEdit: session(draft, "") });
    });
    rerender();
    act(() => {
      useLabelStore.getState().setSourceRefusal(
        { reason: "unbalanced", unbalanced: { kind: "unclosedXa", at: 0, cmd: "^XA" } },
        draft,
      );
    });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(useLabelStore.getState().sourceShadow?.refusal?.reason).toBe("unbalanced");
  });

  it("clears on session end and clamps the render page index", async () => {
    const { rerender } = renderHook(() => useSourceShadowSync());
    act(() => {
      useLabelStore.setState({
        sourceEdit: session(
          "^XA^FO10,10^A0N,30,30^FDp1^FS^XZ\n^XA^FO10,10^A0N,30,30^FDp2^FS^XZ",
        ),
        currentPageIndex: 5,
      });
    });
    rerender();
    await flushParse();
    expect(selectRenderPages(useLabelStore.getState())).toHaveLength(2);
    const contents = shadowObjects().map(
      (o) => (o as { props: { content?: string } }).props.content,
    );
    // Index past the shadow's pages clamps to its LAST page.
    expect(contents).toEqual(["p2"]);
    act(() => {
      useLabelStore.getState().cancelSourceEdit();
    });
    rerender();
    expect(useLabelStore.getState().sourceShadow).toBeNull();
  });
});

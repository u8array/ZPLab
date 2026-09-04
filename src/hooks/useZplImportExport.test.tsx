// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { useZplImportExport } from "./useZplImportExport";
import { useLabelStore } from "../store/labelStore";
import type { Page } from "@zplab/core/types/Group";

const pages: Page[] = [
  {
    objects: [
      {
        id: "q", type: "qrcode", x: 10, y: 10, rotation: 90,
        props: { content: "https://example.test", magnification: 4, errorCorrection: "M", model: 2, rotation: "R" },
      } as never,
    ],
  },
];

beforeEach(() => {
  useLabelStore.setState({
    label: { widthMm: 70, heightMm: 40, dpmm: 8 },
    pages,
    variables: [],
    currentPageIndex: 0,
    selectedIds: [],
    dataset: null,
    columnMapping: null,
    previewMode: { status: "idle" },
    zebraPrintSource: "label",
    keepExportMetadata: false,
  });
});

afterEach(cleanup);

describe("direct-print ZPL and the sidecar setting", () => {
  it("hands the printer plain ZPL by default", () => {
    const { result } = renderHook(() => useZplImportExport());
    const zpl = result.current.currentZpl();
    expect(zpl).not.toContain("ZPLLAB");
    expect(zpl).toContain("^GFA");
  });

  it("keeps the metadata once the user opted in", () => {
    useLabelStore.setState({ keepExportMetadata: true });
    const { result } = renderHook(() => useZplImportExport());
    expect(result.current.currentZpl()).toContain("^FXZPLLAB:");
  });
});

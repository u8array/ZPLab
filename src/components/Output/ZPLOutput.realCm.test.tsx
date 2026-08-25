// @vitest-environment jsdom
// Real CodeMirror (no mock): pins that the always-on pane's own value sync
// never echoes into the session trigger. The mocked-CM suite cannot see this
// (a controlled textarea's value change fires no onChange).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { ZPLOutput } from "./ZPLOutput";
import { useLabelStore } from "../../store/labelStore";
import type { LabelObject, Page } from "@zplab/core/types/Group";

afterEach(cleanup);

const textObject = (id: string, x: number): LabelObject =>
  ({
    id, type: "text", x, y: 10, rotation: 0,
    props: { content: "hello", fontHeight: 30, fontWidth: 0, rotation: "N" },
  }) as never;

beforeEach(() => {
  useLabelStore.setState({
    label: { widthMm: 70, heightMm: 40, dpmm: 8 },
    pages: [{ objects: [textObject("t1", 10)] }] as Page[],
    variables: [],
    currentPageIndex: 0,
    selectedIds: [],
    previewMode: { status: "idle" },
    sourceEdit: { status: "off" },
    sourceShadow: null,
  });
});

describe("model edits against the always-on pane", () => {
  it("do not start a source-edit session", () => {
    render(<ZPLOutput onResizeMouseDown={() => undefined} />);
    act(() => {
      useLabelStore.setState({ pages: [{ objects: [textObject("t1", 99)] }] as Page[] });
    });
    expect(useLabelStore.getState().sourceEdit.status).toBe("off");
  });
});

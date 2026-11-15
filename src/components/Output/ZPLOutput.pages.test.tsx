// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { ZPLOutput } from "./ZPLOutput";
import { useLabelStore } from "../../store/labelStore";
import { fallbackTranslations as en } from "../../locales";
import type { Page } from "@zplab/core/types/Group";

afterEach(cleanup);

const setPages = (count: number): void => {
  useLabelStore.setState({
    label: { widthMm: 70, heightMm: 40, dpmm: 8 },
    pages: Array.from({ length: count }, () => ({ objects: [] })) as Page[],
    variables: [],
    currentPageIndex: 0,
    selectedIds: [],
    previewMode: { status: "idle" },
    sourceEdit: { status: "off" },
    sourceShadow: null,
  });
};

beforeEach(() => setPages(2));

describe("ZPLOutput page navigation", () => {
  it("turns to the next page from the header of the collapsed panel", () => {
    const r = render(<ZPLOutput collapsed onResizeMouseDown={() => undefined} />);
    const name = en.app.pageIndicatorFmt.replace("{current}", "1").replace("{total}", "2");
    expect(r.getByRole("group", { name })).toBeTruthy();
    fireEvent.click(r.getByRole("button", { name: en.app.nextPage }));
    expect(useLabelStore.getState().currentPageIndex).toBe(1);
  });

  it("locks the step at the end of the range with aria-disabled", () => {
    const r = render(<ZPLOutput collapsed onResizeMouseDown={() => undefined} />);
    const prev = r.getByRole("button", { name: en.app.prevPage }) as HTMLButtonElement;
    expect(prev.getAttribute("aria-disabled")).toBe("true");
    expect(prev.disabled).toBe(false);
    act(() => useLabelStore.setState({ currentPageIndex: 1 }));
    expect(r.getByRole("button", { name: en.app.nextPage }).getAttribute("aria-disabled")).toBe("true");
    expect(prev.getAttribute("aria-disabled")).toBe("false");
  });

  it("lets a press move focus only while no session is open", () => {
    const r = render(<ZPLOutput collapsed onResizeMouseDown={() => undefined} />);
    const name = en.app.pageIndicatorFmt.replace("{current}", "1").replace("{total}", "2");
    const group = r.getByRole("group", { name });
    expect(fireEvent.mouseDown(group)).toBe(true);
    act(() => useLabelStore.getState().enterSourceEdit("^XA^XZ"));
    expect(fireEvent.mouseDown(group)).toBe(false);
  });

  it("locks the delete button during a session", () => {
    const r = render(<ZPLOutput collapsed onResizeMouseDown={() => undefined} />);
    act(() => useLabelStore.getState().enterSourceEdit("^XA^XZ"));
    const trash = r.getByRole("button", { name: en.app.deletePage });
    expect(trash.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(trash);
    expect(r.queryByRole("alertdialog")).toBeNull();
  });

  it("locks the step buttons and the delete button on a single page", () => {
    setPages(1);
    const r = render(<ZPLOutput collapsed onResizeMouseDown={() => undefined} />);
    for (const name of [en.app.prevPage, en.app.nextPage, en.app.deletePage]) {
      expect(r.getByRole("button", { name }).getAttribute("aria-disabled")).toBe("true");
    }
    fireEvent.click(r.getByRole("button", { name: en.app.deletePage }));
    expect(r.queryByRole("alertdialog")).toBeNull();
  });

  it("adds a page and turns to the new one", () => {
    setPages(1);
    const r = render(<ZPLOutput collapsed onResizeMouseDown={() => undefined} />);
    fireEvent.click(r.getByRole("button", { name: en.app.addPage }));
    expect(useLabelStore.getState().pages).toHaveLength(2);
    expect(useLabelStore.getState().currentPageIndex).toBe(1);
  });

  it("locks the add button during source editing", () => {
    const r = render(<ZPLOutput collapsed onResizeMouseDown={() => undefined} />);
    act(() => useLabelStore.getState().enterSourceEdit("^XA^XZ"));
    const add = r.getByRole("button", { name: en.app.addPage });
    expect(add.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(add);
    expect(useLabelStore.getState().pages).toHaveLength(2);
  });
});

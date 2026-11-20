// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { PaginationControl } from "./PaginationControl";
import { useGlobalShortcuts } from "../../hooks/useGlobalShortcuts";
import { useLabelStore } from "../../store/labelStore";
import { fallbackTranslations as en } from "../../locales";
import type { Page } from "@zplab/core/types/Group";

afterEach(cleanup);

function Pager() {
  useGlobalShortcuts();
  return <PaginationControl />;
}

const initial = useLabelStore.getState();
const pages = Array.from({ length: 3 }, () => ({ objects: [] })) as Page[];

beforeEach(() => {
  useLabelStore.setState({
    ...initial,
    pages,
    currentPageIndex: 0,
    previewMode: { status: "idle" },
    sourceEdit: { status: "off" },
  });
  useLabelStore.temporal.getState().clear();
});

afterEach(() => {
  useLabelStore.setState(initial);
  useLabelStore.temporal.getState().clear();
});

const openDeleteDialog = () => {
  render(<Pager />);
  fireEvent.click(screen.getByRole("button", { name: en.app.deletePage }));
  return screen.getByRole("alertdialog");
};

describe("PaginationControl under its delete dialog", () => {
  it("deletes the page the dialog opened on after a Page Down", () => {
    const dialog = openDeleteDialog();
    fireEvent.keyDown(document.activeElement ?? document.body, { code: "PageDown" });
    fireEvent.click(within(dialog).getByRole("button", { name: en.app.deletePage }));
    const left = useLabelStore.getState().pages;
    expect(left).toHaveLength(2);
    expect(left[0]).toBe(pages[1]);
  });

  it("keeps the page through an undo", () => {
    useLabelStore.getState().addPage();
    const count = useLabelStore.getState().pages.length;
    openDeleteDialog();
    fireEvent.keyDown(document.activeElement ?? document.body, { code: "KeyZ", key: "z", ctrlKey: true });
    expect(useLabelStore.getState().pages).toHaveLength(count);
  });
});

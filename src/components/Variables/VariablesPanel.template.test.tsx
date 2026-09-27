// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { VariablesPanel } from "./VariablesPanel";
import { useLabelStore } from "../../store/labelStore";
import { fallbackTranslations as en } from "../../locales";

afterEach(cleanup);

describe("VariablesPanel template row", () => {
  it("names the current page's template with its way and jumps back to the page", () => {
    act(() => {
      useLabelStore.setState({
        pages: [{ objects: [] }, { objects: [], storedFormatPath: "E:JOB.ZPL", storedFormatDelivery: "printer" }],
        currentPageIndex: 1,
        variables: [],
        dataset: null,
        sidebarTab: "variables",
        selectedIds: ["x"],
      });
    });
    const r = render(<VariablesPanel />);
    expect(r.getByText("Template of this page: E:JOB.ZPL · Already on the printer")).toBeTruthy();
    act(() => {
      fireEvent.click(r.getByRole("button", { name: en.template.openPage }));
    });
    expect(useLabelStore.getState().sidebarTab).toBe("properties");
    expect(useLabelStore.getState().selectedIds).toEqual([]);
    act(() => {
      useLabelStore.setState({ currentPageIndex: 0 });
    });
    expect(r.queryByText(/Template of this page/)).toBeNull();
  });
});

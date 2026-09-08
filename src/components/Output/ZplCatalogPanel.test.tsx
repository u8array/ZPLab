// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/react";
import { ZplCatalogPanel } from "./ZplCatalogPanel";

afterEach(cleanup);

describe("ZplCatalogPanel", () => {
  const detail = (getByTestId: (id: string) => HTMLElement) => within(getByTestId("catalog-detail"));

  it("shows the command under the caret and inserts it on request", () => {
    const onInsert = vi.fn();
    const { getByTestId, getByRole } = render(<ZplCatalogPanel cursor={{ id: "^LL" }} onInsert={onInsert} />);
    expect(detail(getByTestId).getByText("label length")).toBeTruthy();
    fireEvent.click(getByRole("button", { name: /^Insert$/ }));
    expect(onInsert).toHaveBeenCalledWith("^LL");
  });

  it("inserts on a double-click, whose first click pins the row", () => {
    const onInsert = vi.fn();
    const { getByRole, getByTestId } = render(<ZplCatalogPanel cursor={{ id: "^LL" }} onInsert={onInsert} />);
    // A real double-click is two clicks (detail 1 and 2) followed by dblclick.
    const row = getByRole("option", { name: /\^PW/ });
    fireEvent.click(row, { detail: 1 });
    fireEvent.click(row, { detail: 2 });
    fireEvent.doubleClick(row);
    expect(onInsert).toHaveBeenCalledWith("^PW");
    expect(detail(getByTestId).getByText("print width")).toBeTruthy();
  });

  it("disables the insert button when inserting is unavailable", () => {
    const { getByRole } = render(<ZplCatalogPanel cursor={{ id: "^LL" }} />);
    expect((getByRole("button", { name: /^Insert$/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the three support levels in web, desktop, lint order", () => {
    const levelsOf = (id: string) => {
      const { getByTestId, unmount } = render(<ZplCatalogPanel cursor={{ id }} onInsert={vi.fn()} />);
      const levels = [...getByTestId("catalog-detail").querySelectorAll("dd")].map((dd) => dd.textContent);
      unmount();
      return levels;
    };
    expect(levelsOf("^LL")).toEqual(["yes", "yes", "no"]);
    expect(levelsOf("^LF")).toEqual(["no", "planned", "no"]);
    expect(levelsOf("^JW")).toEqual(["no", "no", "no"]);
  });

  it("inserts the spelling under the caret, not the row's first prefix", () => {
    // ~HL shares the row with ^HL but is not the same thing on the printer.
    const onInsert = vi.fn();
    const { getByRole } = render(<ZplCatalogPanel cursor={{ id: "~HL" }} onInsert={onInsert} />);
    fireEvent.click(getByRole("button", { name: /^Insert$/ }));
    expect(onInsert).toHaveBeenCalledWith("~HL");
  });

  it("prompts for a caret when nothing is under it", () => {
    const { getByText } = render(<ZplCatalogPanel cursor={null} onInsert={vi.fn()} />);
    expect(getByText(/Place the cursor/)).toBeTruthy();
  });

  it("keeps a pinned row across caret moves until it is unpinned", () => {
    const { getByRole, getByTestId, rerender } = render(<ZplCatalogPanel cursor={{ id: "^LL" }} onInsert={vi.fn()} />);
    fireEvent.click(getByRole("option", { name: /\^PW/ }));
    expect(detail(getByTestId).getByText("print width")).toBeTruthy();
    rerender(<ZplCatalogPanel cursor={{ id: "^FO" }} onInsert={vi.fn()} />);
    expect(detail(getByTestId).getByText("print width")).toBeTruthy();
    fireEvent.click(getByRole("option", { name: /\^PW/ }));
    expect(detail(getByTestId).getByText("field origin")).toBeTruthy();
  });

  it("walks the list with the arrow keys, inserts on Enter and unpins on Escape", () => {
    const onInsert = vi.fn();
    const { getByRole, getByTestId } = render(<ZplCatalogPanel cursor={{ id: "^XA" }} onInsert={onInsert} />);
    const list = getByRole("listbox");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(detail(getByTestId).getByText("end label")).toBeTruthy();
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onInsert).toHaveBeenCalledWith("^XZ");
    fireEvent.keyDown(list, { key: "Escape" });
    expect(detail(getByTestId).getByText("start label")).toBeTruthy();
  });

  it("keeps a pin inert while the search hides its row, and Enter only activates a visible row", () => {
    const onInsert = vi.fn();
    const { getByRole, getByLabelText, getByTestId } = render(<ZplCatalogPanel cursor={{ id: "^FO" }} onInsert={onInsert} />);
    fireEvent.click(getByRole("option", { name: /\^PW/ }));
    fireEvent.change(getByLabelText("Search commands"), { target: { value: "^LL" } });
    expect(detail(getByTestId).getByText("field origin")).toBeTruthy();
    fireEvent.keyDown(getByRole("listbox"), { key: "Enter" });
    expect(onInsert).not.toHaveBeenCalled();
    fireEvent.change(getByLabelText("Search commands"), { target: { value: "" } });
    expect(detail(getByTestId).getByText("print width")).toBeTruthy();
    fireEvent.change(getByLabelText("Search commands"), { target: { value: "^LL" } });
    fireEvent.keyDown(getByRole("listbox"), { key: "ArrowDown" });
    fireEvent.keyDown(getByRole("listbox"), { key: "Enter" });
    expect(onInsert).toHaveBeenCalledWith("^LL");
  });

  it("starts an ArrowUp with no active row from the bottom", () => {
    const { getByRole, getAllByRole } = render(<ZplCatalogPanel cursor={null} onInsert={vi.fn()} />);
    fireEvent.keyDown(getByRole("listbox"), { key: "ArrowUp" });
    const options = getAllByRole("option");
    expect(getByRole("listbox").getAttribute("aria-activedescendant")).toBe(options.at(-1)?.id);
  });

  it("says so when the search matches nothing", () => {
    const { getByLabelText, getByText } = render(<ZplCatalogPanel cursor={null} onInsert={vi.fn()} />);
    fireEvent.change(getByLabelText("Search commands"), { target: { value: "zzzz" } });
    expect(getByText("No commands match the search.")).toBeTruthy();
  });

  it("keeps prefix twins apart in the DOM ids", () => {
    const { getByRole, container } = render(<ZplCatalogPanel cursor={{ id: "~PM" }} onInsert={vi.fn()} />);
    const ids = [...container.querySelectorAll("[role=option]")].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getByRole("listbox").getAttribute("aria-activedescendant")).toBe(getByRole("option", { name: /~PM/ }).id);
  });

  it("keeps the listbox itself the tab stop and marks the shown row as the active descendant", () => {
    const { getByRole } = render(<ZplCatalogPanel cursor={{ id: "^LL" }} onInsert={vi.fn()} />);
    const list = getByRole("listbox");
    expect(list.getAttribute("tabindex")).toBe("0");
    expect(list.getAttribute("aria-activedescendant")).toBe(getByRole("option", { name: /\^LL/ }).id);
  });
});

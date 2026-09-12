// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/react";
import { ZplCatalogPanel } from "./ZplCatalogPanel";

afterEach(cleanup);

describe("ZplCatalogPanel", () => {
  const detail = (getByTestId: (id: string) => HTMLElement) => within(getByTestId("catalog-detail"));

  it("shows the command under the caret with its description and inserts it on request", () => {
    const onInsert = vi.fn();
    const { getByTestId, getByRole } = render(<ZplCatalogPanel cursor={{ id: "^LL", from: 0 }} onInsert={onInsert} />);
    expect(detail(getByTestId).getByText("label length")).toBeTruthy();
    expect(getByTestId("catalog-detail").querySelector("p")?.textContent).toMatch(/\w+\.$/);
    fireEvent.click(getByRole("button", { name: /^Insert$/ }));
    expect(onInsert).toHaveBeenCalledWith("^LL");
  });

  it("inserts on a double-click, whose first click pins the row", () => {
    const onInsert = vi.fn();
    const { getByRole, getByTestId } = render(<ZplCatalogPanel cursor={{ id: "^LL", from: 0 }} onInsert={onInsert} />);
    // A real double-click is two clicks (detail 1 and 2) followed by dblclick.
    const row = getByRole("option", { name: /\^PW/ });
    fireEvent.click(row, { detail: 1 });
    fireEvent.click(row, { detail: 2 });
    fireEvent.doubleClick(row);
    expect(onInsert).toHaveBeenCalledWith("^PW");
    expect(detail(getByTestId).getByText("print width")).toBeTruthy();
  });

  it("marks the insert button aria-disabled when inserting is unavailable", () => {
    const { getByRole } = render(<ZplCatalogPanel cursor={{ id: "^LL", from: 0 }} />);
    // Pins aria-disabled: a disabled button would drop its focus to body.
    expect(getByRole("button", { name: /^Insert$/ }).getAttribute("aria-disabled")).toBe("true");
  });

  it("shows the three support levels in web, desktop, lint order", () => {
    const levelsOf = (id: string) => {
      const { getByTestId, unmount } = render(<ZplCatalogPanel cursor={{ id, from: 0 }} onInsert={vi.fn()} />);
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
    const { getByRole } = render(<ZplCatalogPanel cursor={{ id: "~HL", from: 0 }} onInsert={onInsert} />);
    fireEvent.click(getByRole("button", { name: /^Insert$/ }));
    expect(onInsert).toHaveBeenCalledWith("~HL");
  });

  it("prompts for a caret when nothing is under it", () => {
    const { getByText } = render(<ZplCatalogPanel cursor={null} onInsert={vi.fn()} />);
    expect(getByText(/Place the cursor/)).toBeTruthy();
  });

  it("releases the pin when the caret moves, and does not revive it on the way back", () => {
    // A pin that outlived the caret came back for every later ^FO.
    const { getByRole, getByTestId, rerender } = render(<ZplCatalogPanel cursor={{ id: "^FO", from: 4 }} onInsert={vi.fn()} />);
    fireEvent.click(getByRole("option", { name: /\^PW/ }));
    expect(detail(getByTestId).getByText("print width")).toBeTruthy();
    rerender(<ZplCatalogPanel cursor={{ id: "^LL", from: 20 }} onInsert={vi.fn()} />);
    expect(detail(getByTestId).getByText("label length")).toBeTruthy();
    rerender(<ZplCatalogPanel cursor={{ id: "^FO", from: 4 }} onInsert={vi.fn()} />);
    expect(detail(getByTestId).getByText("field origin")).toBeTruthy();
  });

  it("dismisses on Escape without letting focus leave the panel", () => {
    const { getByRole, getByTestId } = render(<ZplCatalogPanel cursor={{ id: "^FO", from: 4 }} onInsert={vi.fn()} />);
    const button = getByRole("button", { name: /^Insert$/ });
    button.focus();
    fireEvent.keyDown(button, { key: "Escape" });
    expect(detail(getByTestId).getByText(/Place the cursor/)).toBeTruthy();
    expect(document.activeElement).toBe(button);
  });

  it("clears the search on Escape instead of dismissing the detail", () => {
    const { getByRole, getByLabelText, getByTestId } = render(<ZplCatalogPanel cursor={{ id: "^FO", from: 4 }} onInsert={vi.fn()} />);
    const search = getByLabelText("Search commands") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "^LL" } });
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search.value).toBe("");
    expect(detail(getByTestId).getByText("field origin")).toBeTruthy();
    expect(getByRole("listbox")).toBeTruthy();
  });

  it("lets Escape in an empty search field fall through to the panel's step-back", () => {
    const { getByLabelText, getByTestId } = render(<ZplCatalogPanel cursor={{ id: "^FO", from: 4 }} onInsert={vi.fn()} />);
    fireEvent.keyDown(getByLabelText("Search commands"), { key: "Escape" });
    expect(detail(getByTestId).getByText(/Place the cursor/)).toBeTruthy();
  });

  it("leaves the empty state on ArrowDown at the caret's command, not at the first row", () => {
    const { getByRole, getByTestId } = render(<ZplCatalogPanel cursor={{ id: "^FO", from: 4 }} onInsert={vi.fn()} />);
    const list = getByRole("listbox");
    fireEvent.keyDown(list, { key: "Escape" });
    expect(detail(getByTestId).getByText(/Place the cursor/)).toBeTruthy();
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(detail(getByTestId).getByText("field origin")).toBeTruthy();
  });

  it("ends a dismissal when a row is chosen, so the next Escape returns to the caret", () => {
    const { getByRole, getAllByRole, getByTestId } = render(<ZplCatalogPanel cursor={{ id: "^FO", from: 4 }} onInsert={vi.fn()} />);
    const list = getByRole("listbox");
    fireEvent.keyDown(list, { key: "Escape" });
    const pw = getAllByRole("option").find((o) => o.textContent?.startsWith("^PW"));
    if (!pw) throw new Error("fixture");
    fireEvent.click(pw);
    expect(detail(getByTestId).getByText("print width")).toBeTruthy();
    fireEvent.keyDown(list, { key: "Escape" });
    expect(detail(getByTestId).getByText("field origin")).toBeTruthy();
  });

  it("steps back from a pin the search hides straight to the empty state", () => {
    // Pins the ladder on what shows: a hidden pin must not cost an extra press.
    const { getByRole, getByLabelText, getByTestId } = render(<ZplCatalogPanel cursor={{ id: "^FO", from: 4 }} onInsert={vi.fn()} />);
    fireEvent.click(getByRole("option", { name: /\^PW/ }));
    fireEvent.change(getByLabelText("Search commands"), { target: { value: "^LL" } });
    fireEvent.keyDown(getByRole("listbox"), { key: "Escape" });
    expect(detail(getByTestId).getByText(/Place the cursor/)).toBeTruthy();
  });

  it("resets on a fresh cursor report even for the same command and offset", () => {
    // The editor reports a new object only when the user asked again.
    const { getByRole, getByTestId, rerender } = render(<ZplCatalogPanel cursor={{ id: "^FO", from: 4 }} onInsert={vi.fn()} />);
    fireEvent.click(getByRole("option", { name: /\^PW/ }));
    rerender(<ZplCatalogPanel cursor={{ id: "^FO", from: 4 }} onInsert={vi.fn()} />);
    expect(detail(getByTestId).getByText("field origin")).toBeTruthy();
  });

  it("inserts the caret's spelling from Enter on the caret's own row", () => {
    const onInsert = vi.fn();
    const { getByRole } = render(<ZplCatalogPanel cursor={{ id: "~HL", from: 0 }} onInsert={onInsert} />);
    fireEvent.keyDown(getByRole("listbox"), { key: "Enter" });
    expect(onInsert).toHaveBeenCalledWith("~HL");
  });

  it("dismisses a pin on the caret's own twin row with one Escape", () => {
    const { getByRole, getByTestId } = render(<ZplCatalogPanel cursor={{ id: "~HL", from: 0 }} onInsert={vi.fn()} />);
    fireEvent.click(getByRole("option", { name: /\^HL/ }));
    fireEvent.keyDown(getByRole("listbox"), { key: "Escape" });
    expect(detail(getByTestId).getByText(/Place the cursor/)).toBeTruthy();
  });

  it("keeps the caret's spelling for Insert after ArrowDown out of the empty state", () => {
    const onInsert = vi.fn();
    const { getByRole } = render(<ZplCatalogPanel cursor={{ id: "~HL", from: 0 }} onInsert={onInsert} />);
    const list = getByRole("listbox");
    fireEvent.keyDown(list, { key: "Escape" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.click(getByRole("button", { name: /^Insert$/ }));
    expect(onInsert).toHaveBeenCalledWith("~HL");
  });

  it("keeps the prompt out of the live region", () => {
    const { getByRole, getByTestId } = render(<ZplCatalogPanel cursor={{ id: "^FO", from: 4 }} onInsert={vi.fn()} />);
    fireEvent.keyDown(getByRole("listbox"), { key: "Escape" });
    const live = getByTestId("catalog-detail").querySelector("[aria-live]");
    expect(live?.textContent ?? "").not.toMatch(/Place the cursor/);
    expect(detail(getByTestId).getByText(/Place the cursor/)).toBeTruthy();
  });

  it("changes nothing on Escape for a command without a catalog entry", () => {
    const { getByRole, getByTestId, queryAllByRole } = render(<ZplCatalogPanel cursor={{ id: "^ZQ", from: 3 }} onInsert={vi.fn()} />);
    const before = [getByTestId("catalog-detail").textContent, queryAllByRole("option", { selected: true }).length];
    fireEvent.keyDown(getByRole("listbox"), { key: "Escape" });
    const after = [getByTestId("catalog-detail").textContent, queryAllByRole("option", { selected: true }).length];
    expect(after).toEqual(before);
    expect(getByRole("button", { name: /^Insert$/ }).getAttribute("aria-disabled")).toBe("true");
  });

  it("ends a dismissal on an arrow walk, so the next Escape steps back to the caret", () => {
    const { getByRole, getByTestId } = render(<ZplCatalogPanel cursor={{ id: "^FO", from: 4 }} onInsert={vi.fn()} />);
    const list = getByRole("listbox");
    fireEvent.keyDown(list, { key: "Escape" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Escape" });
    expect(detail(getByTestId).getByText("field origin")).toBeTruthy();
  });

  it("unpins on a second click of the pinned row", () => {
    const { getByRole, getByTestId } = render(<ZplCatalogPanel cursor={{ id: "^FO", from: 4 }} onInsert={vi.fn()} />);
    fireEvent.click(getByRole("option", { name: /\^PW/ }), { detail: 1 });
    fireEvent.click(getByRole("option", { name: /\^PW/ }), { detail: 1 });
    expect(detail(getByTestId).getByText("field origin")).toBeTruthy();
  });

  it("leaves the empty state on Enter without inserting", () => {
    const onInsert = vi.fn();
    const { getByRole, getByTestId } = render(<ZplCatalogPanel cursor={{ id: "^FO", from: 4 }} onInsert={onInsert} />);
    const list = getByRole("listbox");
    fireEvent.keyDown(list, { key: "Escape" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onInsert).not.toHaveBeenCalled();
    expect(detail(getByTestId).getByText("field origin")).toBeTruthy();
  });

  it("walks the list with the arrow keys, inserts on Enter and unpins on Escape", () => {
    const onInsert = vi.fn();
    const { getByRole, getByTestId } = render(<ZplCatalogPanel cursor={{ id: "^XA", from: 0 }} onInsert={onInsert} />);
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
    const { getByRole, getByLabelText, getByTestId } = render(<ZplCatalogPanel cursor={{ id: "^FO", from: 0 }} onInsert={onInsert} />);
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
    const { getByRole, container } = render(<ZplCatalogPanel cursor={{ id: "~PM", from: 0 }} onInsert={vi.fn()} />);
    const ids = [...container.querySelectorAll("[role=option]")].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getByRole("listbox").getAttribute("aria-activedescendant")).toBe(getByRole("option", { name: /~PM/ }).id);
  });

  it("keeps the listbox itself the tab stop and marks the shown row as the active descendant", () => {
    const { getByRole } = render(<ZplCatalogPanel cursor={{ id: "^LL", from: 0 }} onInsert={vi.fn()} />);
    const list = getByRole("listbox");
    expect(list.getAttribute("tabindex")).toBe("0");
    expect(list.getAttribute("aria-activedescendant")).toBe(getByRole("option", { name: /\^LL/ }).id);
  });
});

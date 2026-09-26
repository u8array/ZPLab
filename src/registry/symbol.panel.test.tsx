// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { symbolPanel } from "./symbol.panel";
import { useLabelStore } from "../store/labelStore";
import { fallbackTranslations as en } from "../locales";
import type { SymbolProps } from "@zplab/core/registry/symbol";
import type { LabelObjectBase } from "@zplab/core/types/LabelObject";

afterEach(cleanup);
beforeEach(() => {
  act(() => {
    useLabelStore.setState({ showZplCommands: false } as never);
  });
});

const makeObj = (symbol: SymbolProps["symbol"]): LabelObjectBase & { props: SymbolProps } => ({
  id: "sym-1",
  type: "symbol",
  x: 0,
  y: 0,
  rotation: 0,
  props: { symbol, height: 40, width: 40, rotation: "N" },
});

const Panel = symbolPanel.PropertiesPanel;

describe("symbol panel certification-mark gate", () => {
  it("hides UL/CSA options without power-user mode", () => {
    const { getByRole, getAllByRole, queryByRole } = render(
      <Panel obj={makeObj("B")} onChange={() => undefined} />,
    );
    // Options only mount once the listbox is open; asserting against the
    // closed trigger would pass even with the gate removed.
    act(() => {
      getByRole("button", { name: en.registry.symbol.symbol }).click();
    });
    expect(getAllByRole("option").length).toBeGreaterThan(0);
    expect(queryByRole("option", { name: /UL/ })).toBeNull();
    expect(queryByRole("option", { name: /CSA/ })).toBeNull();
  });

  it("offers UL/CSA in power-user mode", () => {
    act(() => {
      useLabelStore.setState({ showZplCommands: true } as never);
    });
    const { getByRole, getByText } = render(
      <Panel obj={makeObj("B")} onChange={() => undefined} />,
    );
    act(() => {
      getByRole("button", { name: en.registry.symbol.symbol }).click();
    });
    expect(getByText(new RegExp(en.registry.symbol.symbolUL))).toBeTruthy();
    expect(getByText(new RegExp(en.registry.symbol.symbolCSA))).toBeTruthy();
  });

  it("keeps a carried UL selectable without power-user mode and shows the disclaimer", () => {
    const { getByRole, getByText, getAllByText, queryByText } = render(
      <Panel obj={makeObj("D")} onChange={() => undefined} />,
    );
    expect(getByText(en.registry.symbol.certMarkWarningFmt.replace("{mark}", "UL"))).toBeTruthy();
    act(() => {
      getByRole("button", { name: en.registry.symbol.symbol }).click();
    });
    // Current value stays listed (trigger + option); CSA stays hidden.
    expect(getAllByText(new RegExp(en.registry.symbol.symbolUL)).length).toBeGreaterThan(1);
    expect(queryByText(new RegExp(en.registry.symbol.symbolCSA))).toBeNull();
  });

  it("mirrors the carried-value exception for CSA", () => {
    const { getByRole, getByText, getAllByText, queryByText } = render(
      <Panel obj={makeObj("E")} onChange={() => undefined} />,
    );
    expect(getByText(en.registry.symbol.certMarkWarningFmt.replace("{mark}", "CSA"))).toBeTruthy();
    act(() => {
      getByRole("button", { name: en.registry.symbol.symbol }).click();
    });
    expect(getAllByText(new RegExp(en.registry.symbol.symbolCSA)).length).toBeGreaterThan(1);
    expect(queryByText(new RegExp(en.registry.symbol.symbolUL))).toBeNull();
  });

  it("shows no disclaimer for plain trademark symbols", () => {
    const { queryByText } = render(
      <Panel obj={makeObj("C")} onChange={() => undefined} />,
    );
    expect(queryByText(/certification mark/)).toBeNull();
  });
});

describe("symbol panel with a bound slot", () => {
  const bound = { ...makeObj("A"), props: { ...makeObj("A").props, content: "«mark»" } } as LabelObjectBase & { props: SymbolProps };
  beforeEach(() => {
    act(() => {
      useLabelStore.setState({ variables: [{ id: "v1", name: "mark", fnNumber: 1, defaultValue: "c" }] } as never);
    });
  });

  it("shows the slot's default as the printer reads it and names the variable", () => {
    const { getByRole, getByText } = render(<Panel obj={bound} onChange={() => undefined} />);
    expect(getByRole("button", { name: en.registry.symbol.symbol }).textContent).toContain("™");
    expect(getByText(en.variables.badgeBoundFmt.replace("{name}", "mark"))).toBeTruthy();
  });

  it("writes a new choice to the variable's default, not to the symbol prop", () => {
    const changes: object[] = [];
    const { getByRole, getAllByRole } = render(<Panel obj={bound} onChange={(c) => changes.push(c)} />);
    act(() => {
      getByRole("button", { name: en.registry.symbol.symbol }).click();
    });
    act(() => {
      getAllByRole("option").find((o) => o.textContent?.includes("®"))?.click();
    });
    expect(changes).toEqual([]);
    expect(useLabelStore.getState().variables[0]?.defaultValue).toBe("A");
  });
});

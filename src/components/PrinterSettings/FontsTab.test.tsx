// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { FontsTab } from "./FontsTab";
import { useLabelStore } from "../../store/labelStore";
import { loadFontBytes, removeFont } from "@zplab/core/lib/fontCache";

beforeEach(async () => {
  await loadFontBytes(new Uint8Array([0, 1, 0, 0]), "E:ARIAL.TTF");
  act(() => useLabelStore.setState({ printerProfile: {} }));
});

afterEach(() => {
  cleanup();
  removeFont("E:ARIAL.TTF");
});

describe("FontsTab", () => {
  it("lists a cache row under its own path and provisions it under that path", () => {
    const { getByTitle, queryByTitle, getByLabelText } = render(<FontsTab />);
    expect(getByTitle("E:ARIAL.TTF")).toBeTruthy();
    expect(queryByTitle("E:E:ARIAL.TTF")).toBeNull();
    act(() => {
      fireEvent.click(getByLabelText(/Send at setup/));
    });
    expect(useLabelStore.getState().printerProfile.setupFonts).toEqual([{ path: "E:ARIAL.TTF" }]);
  });

  it("shows an imported entry as provisioned, whatever its spelling, and not as missing", () => {
    act(() => useLabelStore.setState({ printerProfile: { setupFonts: [{ path: "e:arial.ttf" }] } }));
    const { getByLabelText, queryByText } = render(<FontsTab />);
    expect((getByLabelText(/Send at setup/) as HTMLInputElement).checked).toBe(true);
    expect(queryByText(/Font missing/)).toBeNull();
    act(() => {
      fireEvent.click(getByLabelText(/Send at setup/));
    });
    expect(useLabelStore.getState().printerProfile.setupFonts).toBeUndefined();
  });
});

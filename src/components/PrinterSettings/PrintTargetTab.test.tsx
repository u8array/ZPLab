// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { PrintTargetTab } from "./PrintTargetTab";
import { useLabelStore } from "../../store/labelStore";
import { DEFAULT_PRINT_TARGET } from "../../lib/printTarget";
import { fallbackTranslations as en } from "../../locales";

afterEach(cleanup);

beforeEach(() => {
  act(() => {
    useLabelStore.setState({ printTarget: DEFAULT_PRINT_TARGET });
  });
});

describe("PrintTargetTab", () => {
  it("binds the way to the print target and keeps the address in reach for the preview", () => {
    const r = render(<PrintTargetTab />);
    act(() => {
      fireEvent.change(r.getByPlaceholderText("192.168.1.100"), { target: { value: "172.17.17.175" } });
    });
    expect(useLabelStore.getState().printTarget.host).toBe("172.17.17.175");
    act(() => {
      fireEvent.click(r.getByLabelText(en.zebraPrint.tabBrowserPrint));
    });
    expect(useLabelStore.getState().printTarget.transport).toBe("browserprint");
    expect(r.getByText(en.zebraPrint.discover)).toBeTruthy();
    expect(r.getByPlaceholderText("192.168.1.100")).toBeTruthy();
  });

  it("shows the network way for a stored way this build lacks without rewriting the choice", () => {
    act(() => {
      useLabelStore.getState().setPrintTarget({ transport: "local" });
    });
    const r = render(<PrintTargetTab />);
    expect((r.getByLabelText(en.zebraPrint.tabNetwork) as HTMLInputElement).checked).toBe(true);
    expect(useLabelStore.getState().printTarget.transport).toBe("local");
  });
});

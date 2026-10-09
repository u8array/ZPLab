// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { ZplSendPanel } from "./ZplSendPanel";
import { useLabelStore } from "../../store/labelStore";
import { DEFAULT_PRINT_TARGET } from "../../lib/printTarget";
import { fallbackTranslations as en } from "../../locales";

afterEach(cleanup);

beforeEach(() => {
  act(() => {
    useLabelStore.setState({ zebraPrintSource: "label", dataset: null, columnMapping: null, printTarget: { ...DEFAULT_PRINT_TARGET, host: "172.17.17.175", browserPrintUid: "bp-1" } });
  });
});

describe("ZplSendPanel print target", () => {
  it("opens on the way last used and keeps the choice when a tab is clicked", () => {
    act(() => {
      useLabelStore.getState().setPrintTarget({ transport: "browserprint" });
    });
    const r = render(<ZplSendPanel zpl="^XA^XZ" />);
    expect(r.getByText(en.zebraPrint.discover)).toBeTruthy();
    act(() => {
      fireEvent.click(r.getByText(en.zebraPrint.tabNetwork));
    });
    expect(useLabelStore.getState().printTarget.transport).toBe("network");
    expect((r.getByDisplayValue("172.17.17.175") as HTMLInputElement).value).toBe("172.17.17.175");
  });

  it("shows the network tab for a way this build lacks without rewriting the choice", () => {
    act(() => {
      useLabelStore.getState().setPrintTarget({ transport: "local" });
    });
    const r = render(<ZplSendPanel zpl="^XA^XZ" />);
    expect(r.getByDisplayValue("172.17.17.175")).toBeTruthy();
    expect(useLabelStore.getState().printTarget.transport).toBe("local");
  });

  it("commits the host trimmed and a typed port at once and refuses a keystroke that leaves no port", () => {
    const r = render(<ZplSendPanel zpl="^XA^XZ" />);
    const host = r.getByDisplayValue("172.17.17.175");
    const port = r.getByDisplayValue("9100");
    act(() => {
      fireEvent.change(host, { target: { value: " 10.0.0.9 " } });
      fireEvent.change(port, { target: { value: "6101" } });
    });
    expect(useLabelStore.getState().printTarget).toMatchObject({ host: "10.0.0.9", port: 6101 });
    act(() => {
      fireEvent.change(port, { target: { value: "70000" } });
    });
    expect(useLabelStore.getState().printTarget.port).toBe(6101);
    expect((port as HTMLInputElement).value).toBe("6101");
    expect((r.getByText(en.zebraPrint.send) as HTMLButtonElement).disabled).toBe(false);
  });
});

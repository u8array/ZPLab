// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { WayPanel } from "./ZebraWayPanel.testkit";
import { useLabelStore } from "../../store/labelStore";
import { DEFAULT_PRINT_TARGET } from "../../lib/printTarget";
import { fallbackTranslations as en } from "../../locales";

afterEach(cleanup);

beforeEach(() => {
  act(() => {
    useLabelStore.setState({ dataset: null, columnMapping: null, printTarget: { ...DEFAULT_PRINT_TARGET, host: "172.17.17.175", browserPrintUid: "bp-1" } });
  });
});

describe("ZebraWayPanel print target", () => {
  it("picks a device on the way shown", () => {
    const r = render(<WayPanel way="browserprint" zpl={() => "^XA^XZ"} />);

    expect(r.getByText(en.zebraPrint.discover)).toBeTruthy();
    expect(r.queryByDisplayValue("172.17.17.175")).toBeNull();
  });

  it("commits the host trimmed and a typed port at once and refuses a keystroke that leaves no port", () => {
    const r = render(<WayPanel way="network" zpl={() => "^XA^XZ"} />);
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

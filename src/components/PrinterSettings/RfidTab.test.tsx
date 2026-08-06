// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { TAB_GATES } from "./tabVisibility";
import { RfidTab } from "./RfidTab";
import { useLabelStore } from "../../store/labelStore";

afterEach(() => {
  cleanup();
  act(() => {
    useLabelStore
      .getState()
      .setLabelConfig({ rfidEpcBits: undefined, rfidEpcPartitions: undefined, rfidPosition: undefined });
  });
});

describe("TAB_GATES.rfid", () => {
  it("has no gate: the tab is always visible like other per-label tabs", () => {
    expect(TAB_GATES.rfid).toBeUndefined();
  });
});

describe("RfidTab programming position", () => {
  it("carries the distance across a unit change, not the raw number", () => {
    act(() => useLabelStore.getState().setLabelConfig({ rfidPosition: "520" }));
    const { getByRole } = render(<RfidTab />);
    // 520 dots at 8 dpmm is 65 mm forward.
    fireEvent.click(getByRole("button", { name: /Absolute from the top/ }));
    fireEvent.click(getByRole("option", { name: /Forward from the edge/ }));
    expect(useLabelStore.getState().label.rfidPosition).toBe("F65");
  });

  it("lands on the leading edge when the direction flips", () => {
    act(() => useLabelStore.getState().setLabelConfig({ rfidPosition: "B14" }));
    const { getByRole } = render(<RfidTab />);
    fireEvent.click(getByRole("button", { name: /Backfeed before the edge/ }));
    fireEvent.click(getByRole("option", { name: /Forward from the edge/ }));
    expect(useLabelStore.getState().label.rfidPosition).toBe("F0");
  });
});

describe("RfidTab EPC editor", () => {
  it("shows the unpartitioned tag as one field, so adding splits it", () => {
    act(() => useLabelStore.getState().setLabelConfig({ rfidEpcBits: 96 }));
    const { getByLabelText, queryAllByLabelText } = render(<RfidTab />);
    expect((getByLabelText("Partition sizes 1") as HTMLInputElement).value).toBe("96");
    expect(queryAllByLabelText("Remove partition")).toHaveLength(0);
    fireEvent.click(getByLabelText("Add partition"));
    expect(queryAllByLabelText(/Partition sizes/)).toHaveLength(2);
  });

  it("splits an existing total on the first partition instead of dropping it", () => {
    act(() => useLabelStore.getState().setLabelConfig({ rfidEpcBits: 96 }));
    const { getByLabelText } = render(<RfidTab />);
    fireEvent.click(getByLabelText("Add partition"));
    expect(useLabelStore.getState().label.rfidEpcPartitions).toEqual([48, 48]);
    expect(useLabelStore.getState().label.rfidEpcBits).toBe(96);
  });

  it("keeps the tag width while fields are added and retyped", () => {
    act(() => useLabelStore.getState().setLabelConfig({ rfidEpcBits: 96 }));
    const { getByLabelText } = render(<RfidTab />);
    fireEvent.click(getByLabelText("Add partition"));
    expect(useLabelStore.getState().label.rfidEpcPartitions).toEqual([48, 48]);
    fireEvent.click(getByLabelText("Add partition"));
    expect(useLabelStore.getState().label.rfidEpcPartitions).toEqual([48, 24, 24]);

    const first = getByLabelText("Partition sizes 1");
    fireEvent.change(first, { target: { value: "8" } });
    fireEvent.blur(first);
    expect(useLabelStore.getState().label.rfidEpcPartitions).toEqual([8, 24, 64]);
    expect(useLabelStore.getState().label.rfidEpcBits).toBe(96);
  });

  it("lets the trailing field set the tag width", () => {
    act(() => useLabelStore.getState().setLabelConfig({ rfidEpcBits: 96 }));
    const { getByLabelText } = render(<RfidTab />);
    fireEvent.click(getByLabelText("Add partition"));
    const trailing = getByLabelText("Partition sizes 2");
    fireEvent.change(trailing, { target: { value: "60" } });
    fireEvent.blur(trailing);
    const label = useLabelStore.getState().label;
    expect(label.rfidEpcPartitions).toEqual([48, 60]);
    expect(label.rfidEpcBits).toBe(108);
  });

  it("collapses to the plain total when only one field would remain", () => {
    act(() => useLabelStore.getState().setLabelConfig({ rfidEpcBits: 96 }));
    const { getByLabelText, getAllByLabelText } = render(<RfidTab />);
    fireEvent.click(getByLabelText("Add partition"));
    fireEvent.click(getAllByLabelText("Remove partition")[0]!);
    const label = useLabelStore.getState().label;
    expect(label.rfidEpcPartitions).toBeUndefined();
    expect(label.rfidEpcBits).toBe(96);
  });

  it("dropping the last partition clears the structure", () => {
    const { getByLabelText, getAllByLabelText } = render(<RfidTab />);
    fireEvent.click(getByLabelText("Add partition"));
    fireEvent.click(getAllByLabelText("Remove partition")[0]!);
    expect(useLabelStore.getState().label.rfidEpcPartitions).toBeUndefined();
  });
});

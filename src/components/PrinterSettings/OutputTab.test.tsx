// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { OutputTab } from "./OutputTab";
import { useLabelStore } from "../../store/labelStore";

afterEach(() => {
  cleanup();
  act(() => useLabelStore.getState().setLabelConfig({ labelShift: undefined }));
});

describe("OutputTab label shift", () => {
  it("clamps the label shift to the ^LS maximum", () => {
    const { getByLabelText } = render(<OutputTab />);
    // Far beyond 9999 dots in any unit.
    act(() => {
      fireEvent.change(getByLabelText(/^Label shift/), { target: { value: "4000" } });
    });
    expect(useLabelStore.getState().label.labelShift).toBe(9999);
  });
});

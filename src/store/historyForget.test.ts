// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "@testing-library/react";
import { forgetHistoryUsing, useLabelStore } from "./labelStore";
import type { LabelObject } from "@zplab/core/types/Group";

const image = (id: string, imageId: string): LabelObject =>
  ({ id, type: "image", x: 0, y: 0, rotation: 0, props: { imageId, widthDots: 8, threshold: 128 } }) as unknown as LabelObject;

beforeEach(() => {
  act(() => useLabelStore.setState({ pages: [{ objects: [] }] }));
  useLabelStore.temporal.getState().clear();
});
afterEach(() => {
  useLabelStore.temporal.getState().clear();
  act(() => useLabelStore.setState({ pages: [{ objects: [] }] }));
});

describe("forgetHistoryUsing", () => {
  it("drops only the steps that name the file and leaves a surviving step usable", () => {
    act(() => useLabelStore.setState({ pages: [{ objects: [image("a", "cat")] }] }));
    act(() => useLabelStore.setState({ pages: [{ objects: [image("a", "cat"), image("b", "dog")] }] }));
    act(() => useLabelStore.setState({ pages: [{ objects: [image("b", "dog")] }] }));
    act(() => useLabelStore.temporal.getState().undo());
    const { pastStates, futureStates } = useLabelStore.temporal.getState();
    expect([pastStates.length, futureStates.length]).toEqual([2, 1]);
    expect(forgetHistoryUsing("images", "cat")).toBe(1);
    expect([useLabelStore.temporal.getState().pastStates.length, useLabelStore.temporal.getState().futureStates.length]).toEqual([1, 1]);
    expect(forgetHistoryUsing("images", "dog")).toBe(1);
    expect([useLabelStore.temporal.getState().pastStates.length, useLabelStore.temporal.getState().futureStates.length]).toEqual([1, 0]);
    expect(forgetHistoryUsing("images", "cat")).toBe(0);
    act(() => useLabelStore.temporal.getState().undo());
    expect(useLabelStore.getState().pages[0]?.objects).toEqual([]);
  });
});

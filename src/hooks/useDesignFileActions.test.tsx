// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { useDesignFileActions } from "./useDesignFileActions";
import { useLabelStore } from "../store/labelStore";

afterEach(cleanup);

describe("useDesignFileActions", () => {
  it("hands the New menu item straight to the store's newDesign", () => {
    const { result } = renderHook(() => useDesignFileActions());
    expect(result.current.handleNew).toBe(useLabelStore.getState().newDesign);
  });
});

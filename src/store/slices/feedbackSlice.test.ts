import { describe, it, expect } from "vitest";
import { createFeedbackSlice } from "./feedbackSlice";
import { makeSlice } from "../../test/sliceHarness";

describe("feedbackSlice", () => {
  it("starts empty", () => {
    expect(makeSlice(createFeedbackSlice).get().userError).toBeNull();
  });

  it("setUserError defaults retryExport to false", () => {
    const { get } = makeSlice(createFeedbackSlice);
    get().setUserError("boom");
    expect(get().userError).toEqual({ message: "boom", retryExport: false });
  });

  it("setUserError offers the export retry only when asked (the print path)", () => {
    const { get } = makeSlice(createFeedbackSlice);
    get().setUserError("print failed", { retryExport: true });
    expect(get().userError).toEqual({ message: "print failed", retryExport: true });
  });

  it("is most-recent-wins: a second error replaces the first", () => {
    const { get } = makeSlice(createFeedbackSlice);
    get().setUserError("first", { retryExport: true });
    get().setUserError("second");
    expect(get().userError).toEqual({ message: "second", retryExport: false });
  });

  it("clearUserError empties the channel", () => {
    const { get } = makeSlice(createFeedbackSlice);
    get().setUserError("boom");
    get().clearUserError();
    expect(get().userError).toBeNull();
  });
});

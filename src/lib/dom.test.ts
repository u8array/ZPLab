// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { isEditableTarget } from "./dom";

describe("isEditableTarget", () => {
  it.each(["INPUT", "TEXTAREA", "SELECT"])("accepts a %s", (tag) => {
    expect(isEditableTarget(document.createElement(tag))).toBe(true);
  });

  it("accepts every focusable node of a marked editor host", () => {
    // Real CM shape: read-only focus lands on the scroller ABOVE the
    // role=textbox content, gutters beside it; only the host marker covers them.
    const host = document.createElement("div");
    host.setAttribute("data-text-surface", "");
    const scroller = document.createElement("div");
    const content = document.createElement("div");
    content.setAttribute("role", "textbox");
    content.setAttribute("contenteditable", "false");
    const gutter = document.createElement("div");
    scroller.appendChild(content);
    host.append(gutter, scroller);
    document.body.appendChild(host);
    expect(isEditableTarget(scroller)).toBe(true);
    expect(isEditableTarget(content)).toBe(true);
    expect(isEditableTarget(gutter)).toBe(true);
    host.remove();
  });

  it("rejects plain elements", () => {
    expect(isEditableTarget(document.createElement("div"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

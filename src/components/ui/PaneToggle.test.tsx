// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { PaneToggle } from "./PaneToggle";

afterEach(cleanup);

describe("PaneToggle", () => {
  it("keeps one button across the fold, names the state, drops the body reference and turns its chevron", () => {
    const onToggle = vi.fn();
    const { getByRole, rerender } = render(<PaneToggle side="left" open title="Command list" onToggle={onToggle} controls="body" />);
    const button = getByRole("button", { name: "Command list" });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-controls")).toBe("body");
    const openChevron = button.querySelector("path")?.getAttribute("d");
    rerender(<PaneToggle side="left" open={false} title="Command list" onToggle={onToggle} controls="body" />);
    expect(getByRole("button", { name: "Command list" })).toBe(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-controls")).toBeNull();
    expect(button.querySelector("path")?.getAttribute("d")).not.toBe(openChevron);
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("gives the two sides different open chevrons", () => {
    const chevron = (side: "left" | "right") => render(<PaneToggle side={side} open title={side} onToggle={vi.fn()} />).container.querySelector("path")?.getAttribute("d");
    const left = chevron("left");
    const right = chevron("right");
    expect(left).not.toBe(right);
  });
});

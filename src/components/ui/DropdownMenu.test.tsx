// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { DropdownItem, DropdownMenu } from "./DropdownMenu";

afterEach(cleanup);

describe("DropdownMenu", () => {
  it("opens on the trigger, runs the entry and closes", () => {
    const pick = vi.fn();
    render(
      <DropdownMenu label="File" maxHeight="260px">
        <DropdownItem onClick={pick}>Open</DropdownItem>
        <DropdownItem disabled>Locked</DropdownItem>
      </DropdownMenu>,
    );
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "File" }));
    expect(screen.getByRole("menu").style.getPropertyValue("--anchor-max-height")).toBe("260px");
    fireEvent.click(screen.getByRole("menuitem", { name: "Locked" }));
    expect(pick).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Open" }));
    expect(pick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

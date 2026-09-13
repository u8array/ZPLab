// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { useState } from "react";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { ConfirmDialog } from "./ConfirmDialog";

afterEach(cleanup);

function Opener({ destructive }: { destructive: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      {open && (
        <ConfirmDialog
          message="Sure?"
          confirmLabel="Yes"
          cancelLabel="No"
          destructive={destructive}
          onConfirm={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      )}
    </>
  );
}

describe("ConfirmDialog focus", () => {
  it.each([true, false])("returns focus to the opener after closing, past its own autoFocus (destructive: %s)", (destructive) => {
    render(<Opener destructive={destructive} />);
    const opener = screen.getByRole("button", { name: "open" });
    opener.focus();
    fireEvent.click(opener);
    const inside = screen.getByRole("button", { name: destructive ? "No" : "Yes" });
    expect(document.activeElement).toBe(inside);
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(document.activeElement).toBe(opener);
  });
});

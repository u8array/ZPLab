// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { useState } from "react";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { StoredFormatField } from "./StoredFormatField";
import { fallbackTranslations as en } from "../../locales";

afterEach(cleanup);

function Spy({ initial, log }: { initial?: string; log: (string | undefined)[] }) {
  const [path, setPath] = useState<string | undefined>(initial);
  return (
    <StoredFormatField
      path={path}
      locked={false}
      onChange={(next) => {
        log.push(next);
        setPath(next);
      }}
    />
  );
}

const nameInput = (r: ReturnType<typeof render>) => r.container.querySelector("input") as HTMLInputElement;

describe("StoredFormatField", () => {
  it("writes a drive, a sanitized name and the fixed extension", () => {
    const log: (string | undefined)[] = [];
    const r = render(<Spy log={log} />);
    fireEvent.change(nameInput(r), { target: { value: "job-1 x" } });
    expect(log).toEqual(["E:JOB1X.ZPL"]);
    expect(nameInput(r).value).toBe("JOB1X");
  });

  it("caps the name at what ^DF stores, keeps a long imported name, and clears the field on an empty name", () => {
    const log: (string | undefined)[] = [];
    const r = render(<Spy initial="R:ABCDEFGHIJKL.ZPL" log={log} />);
    expect(nameInput(r).value).toBe("ABCDEFGHIJKL");
    fireEvent.change(nameInput(r), { target: { value: "ABCDEFGHIJKLMNOPQ" } });
    fireEvent.change(nameInput(r), { target: { value: "" } });
    expect(log).toEqual(["R:ABCDEFGHIJKLMNOP.ZPL", undefined]);
  });

  it("explains the field in a tooltip on the label, not in a paragraph", () => {
    const r = render(<Spy log={[]} />);
    expect(r.queryByText(en.label.storedFormatHint)).toBeNull();
    act(() => {
      fireEvent.focus(r.getByText(en.label.storedFormat));
    });
    expect(r.getByRole("tooltip").textContent).toBe(en.label.storedFormatHint);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { useState } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { NumberInput } from "./NumberInput";

afterEach(cleanup);

const inputOf = (r: ReturnType<typeof render>) =>
  r.container.querySelector("input") as HTMLInputElement;

describe("NumberInput decimal drafts", () => {
  it("accepts a typed decimal and does not re-commit the same value on blur", () => {
    // jsdom's number input sanitises "2." to "", so the observable pin is the
    // full sequence: the draft keeps the field editable and 2.5 sticks. The
    // blur must not append a duplicate commit (double undo step otherwise).
    const committed: number[] = [];
    function Spy() {
      const [value, setValue] = useState(2);
      return <NumberInput label="ratio" value={value} min={2} max={3} step={0.1}
        onChange={(n) => { committed.push(n); setValue(n); }} />;
    }
    const r = render(<Spy />);
    const input = inputOf(r);
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.change(input, { target: { value: "2.5" } });
    expect(input.value).toBe("2.5");
    fireEvent.blur(input);
    expect(input.value).toBe("2.5");
    expect(committed).toEqual([2.5]);
  });

  it("never commits a numerically equal value (no phantom undo steps)", () => {
    const committed: number[] = [];
    function Spy() {
      const [value, setValue] = useState(2);
      return <NumberInput label="ratio" value={value} min={2} max={3} step={0.1}
        onChange={(n) => { committed.push(n); setValue(n); }} />;
    }
    const r = render(<Spy />);
    const input = inputOf(r);
    // "2.0" fires a change event (DOM value differs) but parses to the
    // current store value; the store must not see it.
    fireEvent.change(input, { target: { value: "2.0" } });
    fireEvent.blur(input);
    expect(committed).toEqual([]);
    // React keeps numerically-equal number-input text as-is; only the
    // parsed value matters.
    expect(Number(input.value)).toBe(2);
  });

  it("holds out-of-range intermediates and clamp-commits on blur", () => {
    const committed: number[] = [];
    function Spy() {
      const [value, setValue] = useState(2);
      return <NumberInput label="ratio" value={value} min={2} max={3}
        onChange={(n) => { committed.push(n); setValue(n); }} />;
    }
    const r = render(<Spy />);
    const input = inputOf(r);
    fireEvent.change(input, { target: { value: "25" } });
    expect(input.value).toBe("25");
    expect(committed).toEqual([]);
    fireEvent.blur(input);
    expect(committed).toEqual([3]);
    expect(input.value).toBe("3");
  });
});

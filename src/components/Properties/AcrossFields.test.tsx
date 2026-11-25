// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { useState } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { LabelConfig } from "@zplab/core/types/LabelConfig";
import { AcrossFields } from "./AcrossFields";

afterEach(cleanup);

// A 94 mm liner in three with a gap of 2 mm leaves labels of 30 mm.
const liner: LabelConfig = { widthMm: 94, heightMm: 30, dpmm: 8, labelsAcross: { count: 3, gapMm: 2 } };

function mount(initial: LabelConfig = liner) {
  let current = initial;
  function Spy() {
    const [label, setLabel] = useState(initial);
    current = label;
    return <AcrossFields label={label} unit="mm" onUpdate={(patch) => setLabel((l) => ({ ...l, ...patch }))} />;
  }
  const { container } = render(<Spy />);
  const [count, gap, width] = [...container.querySelectorAll("input")];
  return { count, gap, width, gapMm: () => current.labelsAcross?.gapMm };
}

const type = (input: HTMLInputElement | undefined, value: string) => {
  if (!input) throw new Error("no input");
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

describe("AcrossFields", () => {
  it("shows the count alone on a single label", () => {
    const { count, gap } = mount({ ...liner, labelsAcross: undefined });
    expect(count?.value).toBe("1");
    expect(gap).toBeUndefined();
  });

  it("stores the gap a typed width needs", () => {
    const { gap, width, gapMm } = mount();
    expect(width?.value).toBe("30");
    type(width, "28");
    expect(gapMm()).toBe(5);
    expect(gap?.value).toBe("5");
  });

  it("keeps the gap when the width is cleared or set to 0", () => {
    const { width, gapMm } = mount();
    type(width, "");
    expect(gapMm()).toBe(2);
    expect(width?.value).toBe("30");
    type(width, "0");
    expect(gapMm()).toBe(2);
  });

  it("closes the gap for a width the liner cannot hold and shows the width that fits", () => {
    const { width, gapMm } = mount();
    type(width, "40");
    expect(gapMm()).toBe(0);
    expect(width?.value).toBe("31.3");
  });
});

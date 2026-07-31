// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { UnitNumberInput } from "./UnitNumberInput";
import { useLabelStore } from "../../store/labelStore";

afterEach(cleanup);

// 8 dpmm design, current page halved by its own ^JM: 80 dots read as 10 mm at
// design scale and 20 mm at page scale.
const setPageDensity = (jmDensity: "A" | "B" | undefined) =>
  act(() => {
    useLabelStore.setState({
      label: { widthMm: 100, heightMm: 50, dpmm: 8 },
      pages: [{ objects: [], jmDensity }],
      currentPageIndex: 0,
      canvasSettings: { ...useLabelStore.getState().canvasSettings, unit: "mm" },
    } as never);
  });

const noop = (): void => undefined;

const shown = (el: HTMLElement) => (el.querySelector("input") as HTMLInputElement).value;

describe("UnitNumberInput density scope", () => {
  beforeEach(() => setPageDensity(undefined));

  it("shows a design field at the design density on a ^JMB page", () => {
    const { container } = render(
      <UnitNumberInput label="x" valueDots={80} onChangeDots={noop} scope="design" />,
    );
    expect(shown(container)).toBe("10");
    setPageDensity("B");
    expect(shown(container)).toBe("10");
  });

  it("shows an object prop at the page density on a ^JMB page", () => {
    const { container } = render(
      <UnitNumberInput label="x" valueDots={80} onChangeDots={noop} scope="page" />,
    );
    expect(shown(container)).toBe("10");
    setPageDensity("B");
    expect(shown(container)).toBe("20");
  });

  it("writes a design field back at the design density", () => {
    setPageDensity("B");
    let written: number | undefined;
    const { container } = render(
      <UnitNumberInput
        label="x"
        valueDots={80}
        onChangeDots={(d) => {
          written = d;
        }}
        scope="design"
      />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "5" } });
    });
    expect(written).toBe(40);
  });

  it("writes an object prop back at the page density on a ^JMB page", () => {
    setPageDensity("B");
    let written: number | undefined;
    const { container } = render(
      <UnitNumberInput
        label="x"
        valueDots={80}
        onChangeDots={(d) => {
          written = d;
        }}
        scope="page"
      />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "5" } });
    });
    expect(written).toBe(20);
  });

  // ^PW/^LL are physical head dots: a ^JMB design (effective dpmm halved) must
  // NOT reinterpret them. widthMm 100 round-trips as 100, not 50/200.
  it("keeps a physical field at raw head dpmm on a ^JMB design", () => {
    act(() => {
      useLabelStore.setState({
        label: { widthMm: 100, heightMm: 50, dpmm: 8, jmDensity: "B" },
        pages: [{ objects: [], jmDensity: "B" }],
        currentPageIndex: 0,
        canvasSettings: { ...useLabelStore.getState().canvasSettings, unit: "mm" },
      } as never);
    });
    let written: number | undefined;
    const { container } = render(
      <UnitNumberInput label="w" valueDots={800} onChangeDots={(d) => { written = d; }} scope="physical" />,
    );
    expect(shown(container)).toBe("100");
    const input = container.querySelector("input") as HTMLInputElement;
    // Raw dpmm 8 → 80 mm = 640 dots; the design-scope (effective 4) bug would write 320.
    act(() => {
      fireEvent.change(input, { target: { value: "80" } });
    });
    expect(written).toBe(640);
  });

  // Transient clear (allowUnset omitted) must retain the last valid value
  // rather than commit undefined/0, which previously froze the field at 0.
  it("does not commit on an empty field without allowUnset", () => {
    let calls = 0;
    const { container } = render(
      <UnitNumberInput label="w" valueDots={800} onChangeDots={() => { calls += 1; }} minDots={8} scope="physical" />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "" } });
    });
    expect(calls).toBe(0);
  });
});

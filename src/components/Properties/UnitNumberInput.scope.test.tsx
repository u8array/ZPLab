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
});

// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { boxPanel } from "./box.panel";
import { useLabelStore } from "../store/labelStore";
import { fallbackTranslations as en } from "../locales";
import type { BoxProps } from "@zplab/core/registry/box";
import type { LabelObjectBase } from "@zplab/core/types/LabelObject";

afterEach(cleanup);
beforeEach(() => {
  act(() => {
    useLabelStore.setState({
      label: { widthMm: 100, heightMm: 50, dpmm: 8 },
      pages: [{ objects: [] }],
      currentPageIndex: 0,
      propsPreview: null,
      canvasSettings: { ...useLabelStore.getState().canvasSettings, unit: "mm" },
    } as never);
  });
});

const box = (rounding: number): LabelObjectBase & { props: BoxProps } => ({
  id: "box-1",
  type: "box",
  x: 0,
  y: 0,
  rotation: 0,
  props: { width: 400, height: 200, thickness: 4, rounding, color: "B", reverse: false } as BoxProps,
});

const Panel = boxPanel.PropertiesPanel;
const openRounding = (r: ReturnType<typeof render>) => fireEvent.click(r.getByRole("button", { name: en.registry.box.rounding }));

describe("box panel rounding", () => {
  it("lists the nine steps with the radius each one gives this box", () => {
    const r = render(<Panel obj={box(1)} onChange={() => undefined} />);
    expect(r.getByRole("button", { name: en.registry.box.rounding }).textContent).toContain("1.6 mm");
    openRounding(r);
    const options = r.getAllByRole("option").map((o) => o.textContent);
    expect(options).toHaveLength(9);
    expect(options[0]).toContain("0 mm");
    expect(options[8]).toContain("12.5 mm");
  });

  it("shows the radius in the user's unit and the page's own density", () => {
    act(() => {
      useLabelStore.setState({ canvasSettings: { ...useLabelStore.getState().canvasSettings, unit: "in" }, pages: [{ objects: [], jmDensity: "B" }] } as never);
    });
    const r = render(<Panel obj={box(1)} onChange={() => undefined} />);
    // 12.5 dots at the halved 4 dpmm, 3.1 mm after the dots-to-mm rounding.
    expect(r.getByRole("button", { name: en.registry.box.rounding }).textContent).toContain("0.122 in");
  });

  it("leaves no preview behind once a step is chosen", () => {
    const r = render(<Panel obj={box(1)} onChange={() => undefined} />);
    openRounding(r);
    act(() => {
      useLabelStore.setState({ propsPreview: { id: "box-1", props: { rounding: 4 } } } as never);
    });
    fireEvent.click(r.getAllByRole("option")[2]!);
    expect(useLabelStore.getState().propsPreview).toBeNull();
  });

  it("still lists an imported index past the spec range, without a radius", () => {
    const r = render(<Panel obj={box(9)} onChange={() => undefined} />);
    expect(r.getByRole("button", { name: en.registry.box.rounding }).textContent).toBe("9");
    openRounding(r);
    const options = r.getAllByRole("option");
    expect(options).toHaveLength(10);
    expect(options[9]!.textContent).toBe("9");
  });
});

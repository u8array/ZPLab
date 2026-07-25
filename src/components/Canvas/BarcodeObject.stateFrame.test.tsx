// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Stage, Layer, Group, Rect } from "react-konva";
import type Konva from "konva";
import { StateFrame } from "./BarcodeObject";
import { stateFrameProps } from "./bwipHelpers";
import { naturalRect } from "./nodeRect";

describe("stateFrameProps", () => {
  it("frames the bar rect below-zone (EAN/UPC)", () => {
    const ub = { w: 200, h: 213, barW: 200, barH: 200, barLeftPx: 0, barTopPx: 0 };
    expect(stateFrameProps(ub)).toEqual({ x: 0, y: 0, width: 200, height: 200 });
  });

  it("frames the bar rect above-zone (logmars-style)", () => {
    const ub = { w: 200, h: 213, barW: 200, barH: 200, barLeftPx: 0, barTopPx: 13 };
    expect(stateFrameProps(ub)).toEqual({ x: 0, y: 13, width: 200, height: 200 });
  });

  it("equals the footprint when no zone is reserved", () => {
    const ub = { w: 200, h: 100, barW: 200, barH: 100, barLeftPx: 0, barTopPx: 0 };
    expect(stateFrameProps(ub)).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });
});

beforeAll(() => {
  // jsdom has no 2d context; Konva needs one for Stage/Layer plumbing and
  // sceneFunc draws. Geometry (getClientRect) never reads pixels back.
  const noop = () => undefined;
  HTMLCanvasElement.prototype.getContext = (() =>
    new Proxy({ getImageData: () => ({ data: new Uint8ClampedArray(4) }) }, {
      get: (target, prop) => (prop in target ? target[prop as keyof typeof target] : noop),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(cleanup);

describe("StateFrame vs transformer bbox", () => {
  // Regression: the warning frame rendered as plain Rects over the full
  // footprint, inflating naturalRect so the resize handles jumped onto it.
  it("does not inflate the group's naturalRect beyond the bar rect", () => {
    let group: Konva.Group | null = null;
    render(
      <Stage width={300} height={200}>
        <Layer>
          <Group ref={(n) => { group = n; }}>
            <Rect x={10} y={5} width={100} height={50} />
            <StateFrame width={150} height={80} color="#ff0000" />
          </Group>
        </Layer>
      </Stage>,
    );
    expect(group).not.toBeNull();
    expect(naturalRect(group!)).toEqual({ x: 10, y: 5, width: 100, height: 50 });
  });

  // Contrast pin: a plain Rect (the old StateFrame representation) DOES
  // inflate the bbox, which is exactly the bug the sceneFunc form avoids.
  it("a plain Rect of the same size would inflate it", () => {
    let group: Konva.Group | null = null;
    render(
      <Stage width={300} height={200}>
        <Layer>
          <Group ref={(n) => { group = n; }}>
            <Rect x={10} y={5} width={100} height={50} />
            <Rect width={150} height={80} listening={false} />
          </Group>
        </Layer>
      </Stage>,
    );
    expect(naturalRect(group!)).toEqual({ x: 0, y: 0, width: 150, height: 80 });
  });
});

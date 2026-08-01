// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Stage, Layer } from "react-konva";
import type Konva from "konva";
import { BarcodeObject } from "./BarcodeObject";
import type { LeafObject } from "@zplab/core/registry";
import type { LabelObject } from "@zplab/core/types/Group";

beforeAll(() => {
  const noop = () => undefined;
  HTMLCanvasElement.prototype.getContext = (() =>
    new Proxy({ getImageData: () => ({ data: new Uint8ClampedArray(4) }), measureText: () => ({ width: 0 }) }, {
      get: (target, prop) => (prop in target ? target[prop as keyof typeof target] : noop),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(cleanup);

/** Mode 2 without a separator never encodes, so the render lands on the
 *  fallback card; that card's Rect is what the geometry surfaces snap to. */
const uncodableMaxicode = (): LeafObject =>
  ({
    id: "m", type: "maxicode", x: 0, y: 0, rotation: 0, positionType: "FO",
    props: { mode: 2, content: "1234567890" },
  }) as LabelObject as LeafObject;

function cardRect(obj: LeafObject, dpmm: number) {
  let stage: Konva.Stage | null = null;
  render(
    <Stage width={600} height={400} ref={(n) => { stage = n; }}>
      <Layer>
        <BarcodeObject
          obj={obj}
          scale={1}
          dpmm={dpmm}
          offsetX={0}
          offsetY={0}
          isSelected={false}
          onSelect={() => undefined}
          onChange={() => undefined}
          snap={(d) => d}
          preBindingContent={(obj.props as { content: string }).content}
        />
      </Layer>
    </Stage>,
  );
  const r = stage!.findOne("Rect") as Konva.Rect;
  return { w: r.width(), h: r.height() };
}

describe("BarcodeObject fallback card size", () => {
  it("draws a fixed-footprint type at its real footprint, not the 200x80 card", () => {
    // 8 dpmm: the calibrated 202x192-dot footprint; px == dots/8 at scale 1
    // via dotsToPx.
    expect(cardRect(uncodableMaxicode(), 8)).toEqual({ w: 202 / 8, h: 192 / 8 });
  });
});

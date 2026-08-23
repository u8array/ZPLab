// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Stage, Layer } from "react-konva";
import type Konva from "konva";
import { BarcodeObject } from "./BarcodeObject";
import { ObjectRegistry, type LeafType } from "@zplab/core/registry";
import type { LeafObject } from "@zplab/core/registry";

beforeAll(() => {
  const noop = () => undefined;
  HTMLCanvasElement.prototype.getContext = (() =>
    new Proxy({
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      measureText: () => ({ width: 10 }),
    }, {
      get: (target, prop) => (prop in target ? target[prop as keyof typeof target] : noop),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(cleanup);

const noopHandlers = {
  isSelected: false,
  onSelect: () => undefined,
  onChange: () => undefined,
  snap: (n: number) => n,
};

function renderEan(printInterpretation: boolean) {
  const type: LeafType = "ean13";
  const obj = {
    id: "ean-zone",
    type,
    x: 10,
    y: 10,
    props: {
      ...(ObjectRegistry[type].defaultProps as object),
      content: "123456891234",
      height: 100,
      printInterpretation,
    },
  } as LeafObject;
  const stageRef = { current: null as Konva.Stage | null };
  render(
    <Stage width={800} height={600} ref={(n) => { stageRef.current = n; }}>
      <Layer>
        <BarcodeObject
          obj={obj}
          scale={1}
          dpmm={8}
          offsetX={0}
          offsetY={0}
          preBindingContent="123456891234"
          {...noopHandlers}
        />
      </Layer>
    </Stage>,
  );
  const image = stageRef.current?.findOne<Konva.Image>("Image");
  expect(image).toBeTruthy();
  return {
    height: image!.height(),
    textNodes: stageRef.current?.find("Text").length ?? 0,
  };
}

// Regression: HRI off squeezed the bwip bitmap into the bar rect, shortening
// bars and guards against the print.
describe("EAN guard zone is HRI-independent", () => {
  it("draws the same zone-stretched image with HRI off, minus the digits", () => {
    const withHri = renderEan(true);
    cleanup();
    const withoutHri = renderEan(false);
    expect(withoutHri.height).toBeCloseTo(withHri.height, 3);
    // 100 bar dots at scale 1 / 8 dpmm = 12.5px; the guard zone adds to that.
    expect(withoutHri.height).toBeGreaterThan(100 / 8);
    expect(withHri.textNodes).toBeGreaterThan(0);
    expect(withoutHri.textNodes).toBe(0);
  });
});

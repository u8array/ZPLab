// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Stage, Layer } from "react-konva";
import type Konva from "konva";
import { BarcodeObject } from "./BarcodeObject";
import { naturalRect } from "./nodeRect";
import { convertSymbologyMapper } from "../../lib/symbologySwitch";
import { ObjectRegistry, type LeafType } from "@zplab/core/registry";
import type { LeafObject } from "@zplab/core/registry";

beforeAll(() => {
  // jsdom has no 2d context; Konva needs one for Stage/Layer plumbing.
  // Geometry (getClientRect) never reads pixels back.
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

function makeBarcode(type: LeafType): LeafObject {
  return {
    id: "sym-test",
    type,
    x: 100,
    y: 100,
    props: { ...(ObjectRegistry[type].defaultProps as object) },
  } as LeafObject;
}

const noopHandlers = {
  isSelected: false,
  onSelect: () => undefined,
  onChange: () => undefined,
  snap: (n: number) => n,
};

// Regression: the EAN/UPC getSelfRect patch survived Konva's Image reuse
// across symbology switches, freezing every later type's measured rect.
describe("symbology switch re-measures the node footprint", () => {
  it("footprints track the type through a chain crossing EAN/UPC", () => {
    let obj = makeBarcode("code128");
    const stageRef = { current: null as Konva.Stage | null };
    const ui = (o: LeafObject) => (
      <Stage width={800} height={600} ref={(n) => { stageRef.current = n; }}>
        <Layer>
          <BarcodeObject
            obj={o}
            scale={1}
            dpmm={8}
            offsetX={0}
            offsetY={0}
            {...noopHandlers}
          />
        </Layer>
      </Stage>
    );
    const { rerender } = render(ui(obj));
    const rectOf = () => {
      const node = stageRef.current?.findOne<Konva.Node>("#sym-test");
      expect(node).toBeTruthy();
      return naturalRect(node!);
    };
    const switchTo = (t: LeafType) => {
      obj = convertSymbologyMapper(t)(obj) as LeafObject;
      rerender(ui(obj));
      return rectOf();
    };
    // EAN first: this is the branch that arms the stale getSelfRect patch.
    const ean = switchTo("ean13");
    // Direct EAN -> 2D (skips the HRI branch): must not inherit the EAN rect.
    const qr = switchTo("qrcode");
    expect(qr.width).toBeCloseTo(qr.height, 3);
    expect({ w: qr.width, h: qr.height }).not.toEqual({ w: ean.width, h: ean.height });
    // Chain on: each stop must produce its own footprint, not the previous one.
    const dm = switchTo("datamatrix");
    expect(dm.width).toBeCloseTo(dm.height, 3);
    expect(dm.width).not.toBeCloseTo(qr.width, 1);
    const pdf = switchTo("pdf417");
    expect(pdf.width).toBeGreaterThan(pdf.height);
    // Back to EAN and out through the 1D HRI branch (KImage reused, else-path
    // restore): the next type must measure its own footprint, not the EAN rect.
    const upc = switchTo("upca");
    const c128 = switchTo("code128");
    expect(c128.width).not.toBeCloseTo(upc.width, 1);
    expect(c128.width).not.toBeCloseTo(pdf.width, 1);
  });
});

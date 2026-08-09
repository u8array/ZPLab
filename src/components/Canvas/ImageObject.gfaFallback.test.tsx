// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Stage, Layer } from "react-konva";
import type Konva from "konva";
import { ImageObject } from "./ImageObject";
import type { LabelObject } from "@zplab/core/types/Group";

beforeAll(() => {
  const noop = () => undefined;
  // jsdom ships no ImageData; the preview builds one from the decoded raster.
  globalThis.ImageData = class {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  } as unknown as typeof globalThis.ImageData;
  HTMLCanvasElement.prototype.getContext = (() =>
    new Proxy(
      {
        getImageData: () => ({ data: new Uint8ClampedArray(4) }),
        measureText: () => ({ width: 0 }),
        putImageData: noop,
      },
      { get: (target, prop) => (prop in target ? target[prop as keyof typeof target] : noop) },
    )) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(cleanup);

/** 16x2 checkerboard: no store entry, only the encoded bytes an agent or an
 *  import produced. */
const gfaOnlyImage = (gfa: string | undefined): LabelObject =>
  ({
    id: "logo",
    type: "image",
    x: 0,
    y: 0,
    rotation: 0,
    props: { imageId: "", widthDots: 16, heightDots: 2, threshold: 128, rotation: "N", ...(gfa ? { _gfaCache: gfa } : {}) },
  }) as LabelObject;

function renderedImage(obj: LabelObject): Konva.Image | undefined {
  let stage: Konva.Stage | null = null;
  render(
    <Stage width={200} height={200} ref={(n) => { stage = n; }}>
      <Layer>
        <ImageObject
          obj={obj as never}
          scale={1}
          dpmm={8}
          offsetX={0}
          offsetY={0}
          isSelected={false}
          onSelect={() => undefined}
          onChange={() => undefined}
          snap={(d) => d}
        />
      </Layer>
    </Stage>,
  );
  return (stage as unknown as Konva.Stage | null)?.find("Image")[0] as Konva.Image | undefined;
}

describe("image without a store entry", () => {
  it("draws the encoded bytes instead of an empty placeholder", () => {
    const node = renderedImage(gfaOnlyImage("^GFA,4,4,2,FF00FF00"));
    expect(node).toBeDefined();
    const drawn = node?.image() as HTMLCanvasElement | undefined;
    expect(drawn?.width).toBe(16);
    expect(drawn?.height).toBe(2);
  });

  it("falls back to the placeholder when there are no bytes either", () => {
    expect(renderedImage(gfaOnlyImage(undefined))?.image()).toBeUndefined();
  });

  it("draws an imported graphic held verbatim as rawGf", () => {
    const obj = gfaOnlyImage(undefined) as unknown as { props: Record<string, unknown> };
    obj.props.rawGf = "^GFA,4,4,2,FF00FF00";
    const node = renderedImage(obj as never);
    expect((node?.image() as HTMLCanvasElement | undefined)?.width).toBe(16);
  });

  it("does not draw a payload it cannot decode", () => {
    expect(renderedImage(gfaOnlyImage("^GFB,4,4,2,binary"))?.image()).toBeUndefined();
  });
});

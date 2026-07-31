// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Stage, Layer } from "react-konva";
import type Konva from "konva";
import { BarcodeObject } from "./BarcodeObject";
import type { LeafObject } from "@zplab/core/registry";
import type { LabelObject } from "@zplab/core/types/Group";

beforeAll(() => {
  // jsdom has no 2d context; Konva needs one for Stage/Layer plumbing and
  // sceneFunc draws. Geometry never reads pixels back.
  const noop = () => undefined;
  HTMLCanvasElement.prototype.getContext = (() =>
    new Proxy({ getImageData: () => ({ data: new Uint8ClampedArray(4) }), measureText: () => ({ width: 0 }) }, {
      get: (target, prop) => (prop in target ? target[prop as keyof typeof target] : noop),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(cleanup);

// A mode 2/3 MaxiCode without a separator never encodes, so BarcodeObject
// lands in the fallback branch; the ⚠ red text is the alarm surface under test.
const mc = (content: string): LeafObject =>
  ({
    id: "m",
    type: "maxicode",
    x: 0,
    y: 0,
    rotation: 0,
    positionType: "FO",
    props: { mode: 2, content },
  }) as LabelObject as LeafObject;

function fallbackText(obj: LeafObject, preBindingContent: string) {
  let stage: Konva.Stage | null = null;
  render(
    <Stage width={300} height={200} ref={(n) => { stage = n; }}>
      <Layer>
        <BarcodeObject
          obj={obj}
          scale={1}
          dpmm={8}
          offsetX={0}
          offsetY={0}
          isSelected={false}
          onSelect={() => undefined}
          onChange={() => undefined}
          snap={(d) => d}
          preBindingContent={preBindingContent}
        />
      </Layer>
    </Stage>,
  );
  const t = stage!.findOne("Text") as Konva.Text;
  return { text: t.text(), fill: t.fill() };
}

describe("MaxiCode SCM alarm suppression wiring", () => {
  it("suppresses the red alarm for literal no-SCM content (preflight owns it)", () => {
    const out = fallbackText(mc("1234567890"), "1234567890");
    expect(out.fill).toBe("#374151");
    expect(out.text).toBe("maxicode");
  });

  it("keeps the red alarm for bound content resolving without a separator", () => {
    // obj arrives marker-resolved; the raw «scm» marker rides in the prop.
    const out = fallbackText(mc("1234567890"), "«scm»");
    expect(out.fill).toBe("#b91c1c");
    expect(out.text.startsWith("⚠")).toBe(true);
  });
});

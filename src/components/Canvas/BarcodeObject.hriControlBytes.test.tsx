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

const HT = "\x09";
const CR = "\x0D";

const code128 = (content: string): LeafObject =>
  ({
    id: "b", type: "code128", x: 0, y: 0, rotation: 0, positionType: "FO",
    props: {
      content, height: 100, moduleWidth: 2, printInterpretation: true,
      printInterpretationAbove: false, checkDigit: false, rotation: "N",
    },
  }) as LabelObject as LeafObject;

function hriText(obj: LeafObject): string | undefined {
  let stage: Konva.Stage | null = null;
  render(
    <Stage width={600} height={400} ref={(n) => { stage = n; }}>
      <Layer>
        <BarcodeObject
          obj={obj} scale={1} dpmm={8} offsetX={0} offsetY={0}
          isSelected={false} onSelect={() => undefined} onChange={() => undefined}
          snap={(d) => d}
          preBindingContent={(obj.props as { content: string }).content}
        />
      </Layer>
    </Stage>,
  );
  return (stage!.findOne("Text") as Konva.Text | undefined)?.text();
}

describe("1D interpretation line", () => {
  it("omits control bytes, as the firmware does", () => {
    // ZD230/Labelary print `ABCDEFGH` for this payload; a raw byte in the
    // Konva line would also skew the length-based centering.
    expect(hriText(code128(`AB${HT}CD${CR}EF`))).toBe("ABCDEF");
  });

  it("leaves a control-free line untouched", () => {
    expect(hriText(code128("ABCDEF"))).toBe("ABCDEF");
  });
});

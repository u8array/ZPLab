// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { Stage, Layer, Group } from "react-konva";
import type Konva from "konva";
import { KonvaObject } from "./KonvaObject";
import { applyPrintLook } from "../../lib/canvasImage";
import { ObjectRegistry, type LeafType } from "@zplab/core/registry";
import type { LeafObject } from "@zplab/core/registry";
import { useLabelStore } from "../../store/labelStore";
import { CANVAS_WARNING } from "../../hooks/useColorScheme";

beforeAll(() => {
  // jsdom has no 2d context. Konva needs one for Stage/Layer plumbing and sceneFunc draws.
  const noop = () => undefined;
  HTMLCanvasElement.prototype.getContext = (() =>
    new Proxy({ getImageData: () => ({ data: new Uint8ClampedArray(4) }), measureText: () => ({ width: 10 }) }, {
      get: (target, prop) => (prop in target ? target[prop as keyof typeof target] : noop),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(cleanup);

const handlers = { onSelect: () => undefined, onChange: () => undefined, snap: (n: number) => n };

const leaf = (type: LeafType, props: object = {}): LeafObject =>
  ({ id: `o-${type}`, type, x: 10, y: 10, props: { ...(ObjectRegistry[type].defaultProps as object), ...props } }) as LeafObject;

/** What a print sees of the object: every visible shape after the capture look, as a sorted signature. */
function drawing(obj: LeafObject, isSelected: boolean): string[] {
  let group: Konva.Group | null = null;
  const r = render(
    <Stage width={400} height={300}>
      <Layer>
        <Group ref={(n) => { group = n; }}>
          <KonvaObject obj={obj} scale={1} dpmm={8} offsetX={0} offsetY={0} isSelected={isSelected} {...handlers} />
        </Group>
      </Layer>
    </Stage>,
  );
  const g = group as unknown as Konva.Group;
  const restore = applyPrintLook(g, null);
  const shapes = g.find<Konva.Shape>((n: Konva.Node) => n.nodeType === "Shape" && n.isVisible());
  const seen = shapes.map((n) => {
    const w = n.strokeWidth();
    return [n.getClassName(), w > 0 ? n.stroke() : "", w, n.fill() ?? "", n.dash()?.join(",") ?? ""].join("|");
  }).sort();
  restore();
  r.unmount();
  return seen;
}

const cases: [string, LeafObject][] = [
  ["text", leaf("text", { content: "Hello" })],
  ["text block", leaf("text", { content: "Hello world", textMode: "fb", blockWidth: 200, blockLines: 2 })],
  ["code128", leaf("code128", { content: "123" })],
  ["ean13", leaf("ean13", { content: "123456891234" })],
  ["qrcode", leaf("qrcode", { content: "hello" })],
  ["sample barcode", leaf("code128", { content: "" })],
  ["image without preview", leaf("image")],
  ["box", leaf("box")],
  ["ellipse", leaf("ellipse")],
  ["line", leaf("line")],
];

describe("the capture look", () => {
  it.each(cases)("draws %s the same whether or not it is selected", (_name, obj) => {
    expect(drawing(obj, true)).toEqual(drawing(obj, false));
  });

  it("leaves out the tint of a variable the dataset does not supply", () => {
    act(() => {
      useLabelStore.setState({
        variables: [{ id: "v1", name: "sku", fnNumber: 1, defaultValue: "X" }],
        dataset: { headers: ["other"], rows: [["1"]], source: { kind: "csv", filename: "t.csv", importedAt: "", encoding: "utf-8", delimiter: ",", rowCount: 1 }, activeRowIndex: 0 },
        columnMapping: null,
      });
    });
    const obj = leaf("text", { content: "«sku»", width: 100, height: 40 });
    expect(drawing(obj, false).some((sig) => sig.includes(CANVAS_WARNING))).toBe(false);
    act(() => {
      useLabelStore.setState({ variables: [], dataset: null });
    });
  });

  it("draws a block text in glyph mode the same whether or not it is selected", () => {
    act(() => {
      useLabelStore.setState({ blockDragMode: "glyph" });
    });
    const obj = leaf("text", { content: "Hello world", textMode: "fb", blockWidth: 200, blockLines: 2 });
    expect(drawing(obj, true)).toEqual(drawing(obj, false));
    act(() => {
      useLabelStore.setState({ blockDragMode: "frame" });
    });
  });
});

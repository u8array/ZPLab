// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { Stage, Layer, Group } from "react-konva";
import type Konva from "konva";
import { KonvaObject } from "./KonvaObject";
import { applyPrintLook, captureLabelBlob, captureRegionBlob } from "./canvasCapture";
import { ObjectRegistry, type LeafType } from "@zplab/core/registry";
import type { LeafObject } from "@zplab/core/registry";
import { useLabelStore } from "../../store/labelStore";
import { CANVAS_WARNING } from "../../hooks/useColorScheme";
import { stubKonvaCanvas2dWithTextWidth } from "../../test/helpers";
import { getMeasuredBounds } from "../../lib/measuredBoundsCache";

beforeAll(() => stubKonvaCanvas2dWithTextWidth((text) => text.length * 10));

afterEach(cleanup);

const handlers = { onSelect: () => undefined, onChange: () => undefined, snap: (n: number) => n };

const leaf = (type: LeafType, props: object = {}): LeafObject =>
  ({ id: `o-${type}`, type, x: 10, y: 10, props: { ...(ObjectRegistry[type].defaultProps as object), ...props } }) as LeafObject;

function mount(obj: LeafObject, isSelected: boolean): { group: Konva.Group; unmount: () => void } {
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
  return { group: group as unknown as Konva.Group, unmount: r.unmount };
}

/** Every visible shape after the capture look, as a sorted signature. */
function drawing(obj: LeafObject, isSelected: boolean): string[] {
  const { group: g, unmount } = mount(obj, isSelected);
  const restore = applyPrintLook(g, null);
  const shapes = g.find<Konva.Shape>((n: Konva.Node) => n.nodeType === "Shape" && n.isVisible());
  const seen = shapes.map((n) => {
    const w = n.strokeWidth();
    return [n.getClassName(), w > 0 ? n.stroke() : "", w, n.fill() ?? "", n.dash()?.join(",") ?? ""].join("|");
  }).sort();
  restore();
  unmount();
  return seen;
}

/** A dataset without a column for the variable, so the field falls back to its default and is tinted in preview mode. */
const unsupplied = { headers: ["other"], rows: [["1"]], source: { kind: "csv" as const, filename: "t.csv", importedAt: "", encoding: "utf-8", delimiter: ",", rowCount: 1 }, activeRowIndex: 0 };

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
        dataset: unsupplied,
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

describe("a capture while the view shows markers", () => {
  const texts = (group: Konva.Group) => group.find<Konva.Text>("Text").map((n) => n.text());

  const showMarkers = (on: boolean) => {
    act(() => {
      const { canvasSettings } = useLabelStore.getState();
      useLabelStore.setState({
        variables: on ? [{ id: "v1", name: "sku", fnNumber: 1, defaultValue: "X1" }] : [],
        canvasSettings: { ...canvasSettings, dataRenderMode: on ? "schema" : "preview" },
      });
    });
  };

  afterEach(() => {
    showMarkers(false);
    act(() => {
      useLabelStore.setState({ dataset: null });
    });
  });

  it("draws the value and restores the marker in the view", async () => {
    showMarkers(true);
    const { group, unmount } = mount(leaf("text", { content: "«sku»" }), false);
    let drawn: string[] = [];
    vi.spyOn(group, "toCanvas").mockImplementation(() => {
      drawn = texts(group);
      return document.createElement("canvas");
    });
    expect(texts(group)).toEqual(["«sku»"]);
    await captureLabelBlob(group, null);
    expect(drawn).toEqual(["X1"]);
    expect(texts(group)).toEqual(["«sku»"]);
    unmount();
  });

  it("draws a bound barcode with the measured width of its value", async () => {
    showMarkers(true);
    const { group, unmount } = mount(leaf("code128", { content: "«sku»" }), false);
    const seen = (g: Konva.Group) => [texts(g), getMeasuredBounds("o-code128")?.width] as const;
    const view = seen(group);
    let drawn: ReturnType<typeof seen> | undefined;
    vi.spyOn(group, "toCanvas").mockImplementation(() => {
      drawn = seen(group);
      return document.createElement("canvas");
    });
    await captureLabelBlob(group, null);
    expect([view[1], drawn?.[1]]).toEqual([expect.any(Number), expect.any(Number)]);
    expect(seen(group)).toEqual(view);
    unmount();
    showMarkers(false);
    const fixed = mount(leaf("code128", { content: "X1" }), false);
    expect(drawn).toEqual(seen(fixed.group));
    expect(drawn).not.toEqual(view);
    fixed.unmount();
  });

  it("keeps the node of a field the view does not tint", async () => {
    showMarkers(true);
    act(() => {
      useLabelStore.setState({ dataset: unsupplied, columnMapping: null });
    });
    const { group, unmount } = mount(leaf("text", { content: "«sku»", width: 100, height: 40 }), false);
    vi.spyOn(group, "toCanvas").mockImplementation(() => document.createElement("canvas"));
    const node = group.findOne("#o-text");
    await captureLabelBlob(group, null);
    expect(node).toBeDefined();
    expect(group.findOne("#o-text")).toBe(node);
    unmount();
  });

  it("writes nothing to the store", async () => {
    showMarkers(true);
    const { group, unmount } = mount(leaf("text", { content: "«sku»" }), false);
    vi.spyOn(group, "toCanvas").mockImplementation(() => document.createElement("canvas"));
    const written = vi.fn();
    const stop = useLabelStore.subscribe(written);
    await captureLabelBlob(group, null);
    stop();
    expect(written).not.toHaveBeenCalled();
    unmount();
  });

  it("asks for the region with the measured footprint of the value", async () => {
    showMarkers(true);
    const { group, unmount } = mount(leaf("text", { content: "«sku»" }), false);
    vi.spyOn(group, "toCanvas").mockImplementation(() => document.createElement("canvas"));
    const view = getMeasuredBounds("o-text")?.width;
    let drawn: number | undefined;
    const rect = (measured: ReadonlyMap<string, { width: number }>) => {
      drawn = measured.get("o-text")?.width;
      return { x: 0, y: 0, width: 1, height: 1 };
    };
    await captureRegionBlob(group, null, rect, 1);
    expect([view, drawn, getMeasuredBounds("o-text")?.width]).toEqual([50, 20, 50]);
    unmount();
  });
});

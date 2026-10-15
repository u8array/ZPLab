// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import Konva from "konva";
import { getIdsIntersectingRect } from "./lassoGeometry";
import { shapeHitProps } from "./konvaObjectProps";
import { stubKonvaCanvas2d } from "../../test/helpers";

beforeAll(stubKonvaCanvas2d);

// Production-path slice on real Konva nodes: shapeHitProps stamps the marker
// exactly as the box renderer spreads it, findOne resolves it off the live
// scene graph. Only the React render and the Stage (canvas-bound) are faked.
const frameGroup = (isSelected: boolean): Konva.Group => {
  const group = new Konva.Group({ id: "frame" });
  group.add(
    new Konva.Rect({
      x: 1,
      y: 1,
      width: 198,
      height: 198,
      strokeWidth: 2,
      ...shapeHitProps(false, 2, isSelected),
    }),
  );
  return group;
};

const stageOf = (group: Konva.Group) =>
  ({ findOne: (sel: string) => (sel === "#frame" ? group : undefined) }) as unknown as Konva.Stage;

describe("lasso vs real Konva frame nodes", () => {
  it("skips an unselected hollow frame from inside, captures it on the ring", () => {
    const stage = stageOf(frameGroup(false));
    expect(getIdsIntersectingRect(stage, ["frame"], { x: 40, y: 40, w: 100, h: 100 })).toEqual([]);
    expect(getIdsIntersectingRect(stage, ["frame"], { x: -20, y: 40, w: 100, h: 100 })).toEqual([
      "frame",
    ]);
  });

  it("captures a selected frame from inside (no hollow marker stamped)", () => {
    const stage = stageOf(frameGroup(true));
    expect(getIdsIntersectingRect(stage, ["frame"], { x: 40, y: 40, w: 100, h: 100 })).toEqual([
      "frame",
    ]);
  });
});

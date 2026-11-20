import { describe, it, expect, vi } from "vitest";
import type Konva from "konva";
import { editHandlers, selectionHandlers, shapeHitProps, MIN_HIT_STROKE_PX } from "./konvaObjectProps";
import { HOLLOW_HIT_NAME } from "./lassoGeometry";

const clickEvt = (evt: Partial<MouseEvent>) =>
  ({ evt } as Konva.KonvaEventObject<MouseEvent>);

describe("selectionHandlers", () => {
  it("left click selects (single)", () => {
    const onSelect = vi.fn();
    selectionHandlers(onSelect).onClick(
      clickEvt({ button: 0, shiftKey: false, ctrlKey: false, metaKey: false }),
    );
    expect(onSelect).toHaveBeenCalledWith(false);
  });

  it("shift / ctrl / meta click toggles multi-select", () => {
    const onSelect = vi.fn();
    const h = selectionHandlers(onSelect);
    h.onClick(clickEvt({ button: 0, shiftKey: true }));
    h.onClick(clickEvt({ button: 0, ctrlKey: true }));
    h.onClick(clickEvt({ button: 0, metaKey: true }));
    expect(onSelect.mock.calls).toEqual([[true], [true], [true]]);
  });

  it("right click never changes the selection", () => {
    const onSelect = vi.fn();
    selectionHandlers(onSelect).onClick(clickEvt({ button: 2 }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("tap is always single-select", () => {
    const onSelect = vi.fn();
    selectionHandlers(onSelect).onTap();
    expect(onSelect).toHaveBeenCalledWith(false);
  });
});

describe("editHandlers", () => {
  it("only a plain primary double-click opens the field", () => {
    const open = vi.fn();
    const h = editHandlers(open);
    h.onDblClick(clickEvt({ button: 2 }));
    h.onDblClick(clickEvt({ button: 0, shiftKey: true }));
    h.onDblClick(clickEvt({ button: 0, ctrlKey: true }));
    h.onDblClick(clickEvt({ button: 0, metaKey: true }));
    expect(open).not.toHaveBeenCalled();
    h.onDblClick(clickEvt({ button: 0 }));
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("shapeHitProps", () => {
  it("filled shapes keep the full-area hit", () => {
    expect(shapeHitProps(true, 2, false)).toEqual({ fillEnabled: true });
  });

  it("unselected frames hit only on the stroke, widened for thin lines", () => {
    expect(shapeHitProps(false, 2, false)).toEqual({
      fillEnabled: false,
      hitStrokeWidth: MIN_HIT_STROKE_PX,
      name: HOLLOW_HIT_NAME,
    });
  });

  it("thick frames keep their real stroke as the hit zone", () => {
    expect(shapeHitProps(false, 20, false)).toEqual({
      fillEnabled: false,
      hitStrokeWidth: 20,
      name: HOLLOW_HIT_NAME,
    });
  });

  it("a selected frame hits on its full area so it can be dragged from the middle", () => {
    expect(shapeHitProps(false, 2, true)).toEqual({
      fillEnabled: true,
      hitStrokeWidth: MIN_HIT_STROKE_PX,
    });
  });
});

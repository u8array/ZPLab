import { describe, it, expect } from "vitest";
import {
  snapBoxHeight,
  positionDidMove,
  forceAspectBox,
  applyHeightSnap,
  applyModuleWidthSnap,
  barcodeHeightReflowGeometry,
  barcodeMwReflowGeometry,
  uniformReflowGeometry,
  pinInactiveEdges,
  computeNewModules,
  activeEdgesFromAnchorName,
  pinAnchoredEdge,
  shrinkingBelowFloor,
  type BarcodeHeightReflowStart,
  type BarcodeMwReflowStart,
  type BoundingBox,
} from "./transformerGeometry";

describe("barcodeMwReflowGeometry", () => {
  const edges = (over: Partial<BarcodeMwReflowStart["edges"]>): BarcodeMwReflowStart["edges"] =>
    ({ left: false, right: false, top: false, bottom: false, ...over });
  // Start box 100..300 x 50..130 px at moduleWidth 2 (mw axis: 100 px per module).
  const start = (over: Partial<BarcodeMwReflowStart> = {}): BarcodeMwReflowStart => ({
    rotation: "N",
    edges: edges({ right: true }),
    mw0: 2, mwBounds: { min: 1, max: 10 },
    leftX: 100,
    topY: 50,
    rightX: 300,
    bottomY: 130,
    ...over,
  });

  it("holds the current band's linear frame inside a module band", () => {
    // 240 px = 1.2x start extent, still module 2: the geometry reports the
    // band frame (200 px) so the caller can pin the node mid-band, which is
    // what keeps the module raster in rotated views without boundBoxFunc.
    expect(barcodeMwReflowGeometry(start(), 240)).toEqual({
      moduleWidth: 2, targetXPx: 100, targetYPx: 50, linearExtentPx: 200,
    });
    expect(barcodeMwReflowGeometry(start(), 200)).toEqual({
      moduleWidth: 2, targetXPx: 100, targetYPx: 50, linearExtentPx: 200,
    });
  });

  it("right-handle crossing keeps the left edge and bumps the module width", () => {
    const geo = barcodeMwReflowGeometry(start(), 300);
    expect(geo).toEqual({ moduleWidth: 3, targetXPx: 100, targetYPx: 50, linearExtentPx: 300 });
  });

  it("left-handle crossing keeps the right edge fixed", () => {
    const geo = barcodeMwReflowGeometry(start({ edges: edges({ left: true }) }), 300);
    // Linear width 300 pinned to rightX 300: x = 0.
    expect(geo).toEqual({ moduleWidth: 3, targetXPx: 0, targetYPx: 50, linearExtentPx: 300 });
  });

  it("stays quantised on the TOTAL extent after earlier bakes (no oscillation)", () => {
    // Pointer parked at 1.5x the start extent: still module 3 on the same
    // start baseline, regardless of what was baked meanwhile.
    expect(barcodeMwReflowGeometry(start(), 300)?.moduleWidth).toBe(3);
    // Pointer moves on to 2x: module 4 from the same start baseline.
    const geo = barcodeMwReflowGeometry(start(), 400);
    expect(geo).toEqual({ moduleWidth: 4, targetXPx: 100, targetYPx: 50, linearExtentPx: 400 });
  });

  it("clamps at the ^BY bounds and pins the frame there (hard stop)", () => {
    expect(barcodeMwReflowGeometry(start({ mw0: 10 }), 600)).toEqual({
      moduleWidth: 10, targetXPx: 100, targetYPx: 50, linearExtentPx: 200,
    });
    expect(barcodeMwReflowGeometry(start({ mw0: 1 }), 10)).toEqual({
      moduleWidth: 1, targetXPx: 100, targetYPx: 50, linearExtentPx: 200,
    });
  });

  it("R/B rotations quantise the vertical axis and pin top/bottom", () => {
    const rb = start({ rotation: "R", edges: edges({ bottom: true }) });
    // Vertical extent 80 px at mw 2; 120 px crosses to 3, top fixed.
    const geo = barcodeMwReflowGeometry(rb, 120);
    expect(geo).toEqual({ moduleWidth: 3, targetXPx: 100, targetYPx: 50, linearExtentPx: 120 });
    const topDrag = start({ rotation: "B", edges: edges({ top: true }) });
    const geoTop = barcodeMwReflowGeometry(topDrag, 120);
    // Bottom fixed at 130: new top = 130 - 120 = 10.
    expect(geoTop).toEqual({ moduleWidth: 3, targetXPx: 100, targetYPx: 10, linearExtentPx: 120 });
  });

  it("centered (Alt) mirrors the band around the start centre, any handle", () => {
    // Start centre x = 200; band 300 px -> 50..350 regardless of handle side.
    const geo = barcodeMwReflowGeometry(start(), 300, true);
    expect(geo).toEqual({ moduleWidth: 3, targetXPx: 50, targetYPx: 50, linearExtentPx: 300 });
    const leftGeo = barcodeMwReflowGeometry(start({ edges: edges({ left: true }) }), 300, true);
    expect(leftGeo?.targetXPx).toBe(50);
    // R/B: the mirrored axis is screen Y. Box 50..130 (centre 90), frame 120
    // -> module 3, linear 120 -> top = 30.
    const rb = barcodeMwReflowGeometry(
      start({ rotation: "R", edges: edges({ bottom: true }) }),
      120,
      true,
    );
    expect(rb).toEqual({ moduleWidth: 3, targetXPx: 100, targetYPx: 30, linearExtentPx: 120 });
  });

  it("rejects degenerate extents", () => {
    expect(barcodeMwReflowGeometry(start(), 0)).toBeNull();
    expect(barcodeMwReflowGeometry(start({ rightX: 100 }), 300)).toBeNull();
  });
});

describe("barcodeHeightReflowGeometry", () => {
  const edges = (over: Partial<BarcodeHeightReflowStart["edges"]>): BarcodeHeightReflowStart["edges"] =>
    ({ left: false, right: false, top: false, bottom: false, ...over });
  // Footprint 100..300 x 50..150 px; 20 px of the height axis is the HRI zone.
  const start = (over: Partial<BarcodeHeightReflowStart> = {}): BarcodeHeightReflowStart => ({
    rotation: "N",
    edges: edges({ bottom: true }),
    leftX: 100,
    topY: 50,
    rightX: 300,
    bottomY: 150,
    zonePx: 20,
    ...over,
  });

  it("bottom-handle drag keeps the top edge and maps frame straight to bar height", () => {
    // Frame is bar-only, so bar extent == frame (no zone subtraction); top edge
    // is the bbox top, unaffected by the bottom drag.
    expect(barcodeHeightReflowGeometry(start(), 140)).toEqual({
      barExtentPx: 140,
      targetXPx: 100,
      targetYPx: 50,
    });
  });

  it("top-handle drag pins the bottom edge via the bbox (frame + zone)", () => {
    const geo = barcodeHeightReflowGeometry(start({ edges: edges({ top: true }) }), 100);
    // Bbox extent = frame 100 + zone 20 = 120; bottom fixed at 150 -> top = 30.
    expect(geo).toEqual({ barExtentPx: 100, targetXPx: 100, targetYPx: 30 });
  });

  it("centered (Alt) mirrors the bbox (frame + zone) around the start centre", () => {
    // Frame 100 -> bbox 120; centre y = 100 (box 50..150) -> top = 40.
    const geo = barcodeHeightReflowGeometry(start(), 100, true);
    expect(geo).toEqual({ barExtentPx: 100, targetXPx: 100, targetYPx: 40 });
  });

  it("R/B rotations run the height axis on screen X and pin left/right", () => {
    const rb = start({ rotation: "R", edges: edges({ right: true }) });
    expect(barcodeHeightReflowGeometry(rb, 240)).toEqual({
      barExtentPx: 240,
      targetXPx: 100,
      targetYPx: 50,
    });
    const leftDrag = start({ rotation: "B", edges: edges({ left: true }) });
    // Bbox extent = frame 240 + zone 20 = 260; right fixed at 300 -> left = 40.
    expect(barcodeHeightReflowGeometry(leftDrag, 240)).toEqual({
      barExtentPx: 240,
      targetXPx: 40,
      targetYPx: 50,
    });
  });

  it("rejects a collapsed frame", () => {
    expect(barcodeHeightReflowGeometry(start(), 0)).toBeNull();
    expect(barcodeHeightReflowGeometry(start(), -5)).toBeNull();
  });
});

describe("pinAnchoredEdge", () => {
  // Start edge 100, extent 40 (so the opposite edge sits at 140).
  it("holds the min edge when the max side is grabbed", () => {
    expect(pinAnchoredEdge(false, 100, 40, 60)).toBe(100);
  });

  it("moves the min edge so the max edge stays fixed when the min side is grabbed", () => {
    // Opposite edge pinned at 140: grow to 60 -> start 80, shrink to 25 -> 115.
    expect(pinAnchoredEdge(true, 100, 40, 60)).toBe(80);
    expect(pinAnchoredEdge(true, 100, 40, 25)).toBe(115);
  });
});

describe("shrinkingBelowFloor", () => {
  const box = (width: number, height: number): BoundingBox => ({ x: 0, y: 0, width, height, rotation: 0 });

  it("vetoes shrinking an axis below the floor", () => {
    expect(shrinkingBelowFloor(box(100, 100), box(5, 100), 10)).toBe(true);
    expect(shrinkingBelowFloor(box(100, 100), box(100, 5), 10)).toBe(true);
  });

  it("allows a thin box (already below floor) to grow", () => {
    // A box converted from a horizontal line: ~1.4px tall. Growing height must pass.
    expect(shrinkingBelowFloor(box(200, 1.4), box(200, 60), 10)).toBe(false);
  });

  it("allows a thin box to be widened while staying thin", () => {
    expect(shrinkingBelowFloor(box(200, 1.4), box(400, 1.4), 10)).toBe(false);
  });

  it("does not veto a normal shrink that stays above the floor", () => {
    expect(shrinkingBelowFloor(box(100, 100), box(60, 60), 10)).toBe(false);
  });

  it("allows shrinking exactly to the floor (strict <)", () => {
    expect(shrinkingBelowFloor(box(100, 100), box(10, 100), 10)).toBe(false);
  });
});

describe("snapBoxHeight", () => {
  it("rounds to the nearest multiple of stepPx", () => {
    expect(snapBoxHeight(33, 10)).toBe(30);
    expect(snapBoxHeight(36, 10)).toBe(40);
  });

  it("never returns less than stepPx", () => {
    expect(snapBoxHeight(0, 10)).toBe(10);
    expect(snapBoxHeight(3, 10)).toBe(10);
  });

  it("works with fractional stepPx", () => {
    expect(snapBoxHeight(7.5, 2.5)).toBe(7.5);
    expect(snapBoxHeight(8.1, 2.5)).toBe(7.5);
  });
});

describe("positionDidMove", () => {
  it("returns false when the position matches within the tolerance", () => {
    expect(positionDidMove(100, 100)).toBe(false);
    expect(positionDidMove(100.4, 100)).toBe(false);
    expect(positionDidMove(99, 100)).toBe(false);
  });

  it("returns true once the delta exceeds the tolerance", () => {
    expect(positionDidMove(102, 100)).toBe(true);
    expect(positionDidMove(80, 100)).toBe(true);
  });
});

describe("applyHeightSnap", () => {
  // Captured from a real low-zoom box bottom-edge resize that triggered
  // the runaway top-anchor pin. dotPx ≈ 0.116 (≈ 4.3 px / dot at fit-zoom),
  // newBox.y drifted 0.8–10 px from oldBox.y due to Konva FP scale-driven
  // node-position updates, comfortably above the prior `dotPx * 0.5`
  // threshold, which incorrectly identified each frame as top-anchor and
  // pinned the bottom edge, marching the box upward.
  const oldBoxLowZoom = { x: 100, y: 346.809, width: 50, height: 27.426, rotation: 0 };
  const newBoxLowZoom = { x: 100, y: 347.611, width: 50, height: 27.826, rotation: 0 };
  const dotPxLowZoom = 0.232; // threshold dotPx * 0.5 = 0.116 → false positive

  it("returns newBox unchanged for shapes without a row anchor (regression: low-zoom drift)", () => {
    const result = applyHeightSnap(oldBoxLowZoom, newBoxLowZoom, dotPxLowZoom, null);
    expect(result).toEqual(newBoxLowZoom);
  });

  it("row-quantises the height for stacked-2D barcodes with a row anchor", () => {
    // anchor: nodeHeight=100, rowHeight=20 → stepPx = 5
    const anchor = { kind: "row" as const, nodeHeight: 100, rowHeight: 20, nodeWidth: 50, moduleWidth: 2, moduleWidthBounds: { min: 1, max: 10 }, rotation: "N" as const };
    const oldBox = { x: 0, y: 0, width: 50, height: 100, rotation: 0 };
    const newBox = { x: 0, y: 0, width: 50, height: 113, rotation: 0 };
    const result = applyHeightSnap(oldBox, newBox, 1, anchor);
    expect(result.height).toBe(115); // 113 rounds up to next 5-multiple
    expect(result.y).toBe(0);
  });

  it("pins the bottom edge for stacked-2D top-anchor resize", () => {
    const anchor = { kind: "row" as const, nodeHeight: 100, rowHeight: 20, nodeWidth: 50, moduleWidth: 2, moduleWidthBounds: { min: 1, max: 10 }, rotation: "N" as const };
    const oldBox = { x: 0, y: 0, width: 50, height: 100, rotation: 0 };
    // Top moves UP by 30 → top-anchor resize
    const newBox = { x: 0, y: -30, width: 50, height: 130, rotation: 0 };
    const result = applyHeightSnap(oldBox, newBox, 1, anchor);
    expect(result.height).toBe(130);
    // Bottom stays where it was (oldBox.y + oldBox.height = 100)
    expect(result.y + result.height).toBe(oldBox.y + oldBox.height);
  });

  it("R/B quantise the rowHeight axis on screen WIDTH, leaving height", () => {
    // Rotated stacked: rowHeight axis = screen width. nodeWidth=100, rowHeight=20
    // → stepPx = 5; width 113 -> 115, height untouched.
    const anchor = { kind: "row" as const, nodeHeight: 50, rowHeight: 20, nodeWidth: 100, moduleWidth: 2, moduleWidthBounds: { min: 1, max: 10 }, rotation: "R" as const };
    const oldBox = { x: 0, y: 0, width: 100, height: 50, rotation: 0 };
    const newBox = { x: 0, y: 0, width: 113, height: 50, rotation: 0 };
    const result = applyHeightSnap(oldBox, newBox, 1, anchor);
    expect(result.width).toBe(115);
    expect(result.height).toBe(50);
  });
});

describe("pinInactiveEdges + applyHeightSnap (multi-frame regression)", () => {
  // Invariant: on a pure bottom-edge drag the top stays at start.y even
  // when Konva's per-frame newBox.y drifts sub-pixel.

  // Captured from the buggy reproduction at viewRotation=0, low zoom:
  // Konva's per-frame y drifts by < 2 px on a pure bottom-edge drag
  // (above 2 px would be a real intentional top-edge drag).
  const start = { x: 100, y: 200, width: 80, height: 50, rotation: 0 };
  const driftedFrames = [
    { y: 200.4, height: 51.2 },
    { y: 200.9, height: 52.7 },
    { y: 201.5, height: 54.0 },
    { y: 199.8, height: 55.3 },
    { y: 201.2, height: 56.1 },
    { y: 200.6, height: 57.4 },
  ];
  const dotPx = 0.232; // representative low-zoom value (≈ 4.3 dots / px)

  it("keeps the top edge pinned to startBox.y across drifting frames", () => {
    let oldBox: BoundingBox = start;
    for (const frame of driftedFrames) {
      const newBox: BoundingBox = { ...oldBox, y: frame.y, height: frame.height };
      const afterSnap = applyHeightSnap(oldBox, newBox, dotPx, null);
      const active = {
        left:  Math.abs(afterSnap.x - start.x) > 2,
        right: Math.abs((afterSnap.x + afterSnap.width) - (start.x + start.width)) > 2,
        top:   Math.abs(afterSnap.y - start.y) > 2,
        bottom: Math.abs((afterSnap.y + afterSnap.height) - (start.y + start.height)) > 2,
      };
      const pinned = pinInactiveEdges(afterSnap, start, active);
      // Top edge invariant: stays at start.y (within float-cmp tolerance).
      expect(pinned.y).toBe(start.y);
      // Width and x untouched (no horizontal drag).
      expect(pinned.x).toBe(start.x);
      expect(pinned.width).toBe(start.width);
      // Height must reflect the grown bottom edge.
      expect(pinned.height).toBeGreaterThanOrEqual(start.height);
      oldBox = pinned;
    }
  });

  it("does not let cumulative drift carry the box out of frame", () => {
    // After 6 frames of drift, top must still be at start.y, not drifted up.
    let oldBox: BoundingBox = start;
    for (const frame of driftedFrames) {
      const newBox: BoundingBox = { ...oldBox, y: frame.y, height: frame.height };
      const afterSnap = applyHeightSnap(oldBox, newBox, dotPx, null);
      const active = {
        left: false, right: false,
        top: Math.abs(afterSnap.y - start.y) > 2,
        bottom: Math.abs((afterSnap.y + afterSnap.height) - (start.y + start.height)) > 2,
      };
      oldBox = pinInactiveEdges(afterSnap, start, active);
    }
    // Final state: top has not drifted; bottom is wherever the user dragged.
    expect(oldBox.y).toBe(start.y);
  });
});

describe("forceAspectBox", () => {
  const oldBox = { x: 100, y: 100, width: 50, height: 50, rotation: 0 };

  it("clamps to max axis when dragging the bottom-right corner", () => {
    const newBox = { x: 100, y: 100, width: 80, height: 60, rotation: 0 };
    expect(forceAspectBox(oldBox, newBox)).toEqual({
      x: 100, y: 100, width: 80, height: 80, rotation: 0,
    });
  });

  it("pins the bottom-right corner when dragging the top-left", () => {
    const newBox = { x: 70, y: 80, width: 80, height: 70, rotation: 0 };
    // Bottom-right of oldBox = (150, 150). Square of size 80 must end there.
    expect(forceAspectBox(oldBox, newBox)).toEqual({
      x: 70, y: 70, width: 80, height: 80, rotation: 0,
    });
  });

  it("pins the bottom-left corner when dragging the top-right", () => {
    const newBox = { x: 100, y: 80, width: 70, height: 70, rotation: 0 };
    expect(forceAspectBox(oldBox, newBox)).toEqual({
      x: 100, y: 80, width: 70, height: 70, rotation: 0,
    });
  });

  it("pins the top-right corner when dragging the bottom-left", () => {
    const newBox = { x: 80, y: 100, width: 70, height: 70, rotation: 0 };
    // Top-right of oldBox = (150, 100). Square of size 70 stays there.
    expect(forceAspectBox(oldBox, newBox)).toEqual({
      x: 80, y: 100, width: 70, height: 70, rotation: 0,
    });
  });

  it("preserves a rectangular aspect (DMRE DataMatrix) from the dominant axis", () => {
    // 8×18 symbol: twice as wide as tall (e.g. 90×40).
    const rect = { x: 100, y: 100, width: 90, height: 40, rotation: 0 };
    const out = forceAspectBox(rect, { x: 100, y: 100, width: 135, height: 40, rotation: 0 });
    expect(out.width).toBe(135);
    expect(out.height).toBe(60);
    expect(out.x).toBe(100);
    expect(out.y).toBe(100);
    // Dragging the taller axis dominates when its relative growth is larger.
    const tall = forceAspectBox(rect, { x: 100, y: 100, width: 90, height: 80, rotation: 0 });
    expect(tall.height).toBe(80);
    expect(tall.width).toBe(180);
  });
});

describe("computeNewModules", () => {
  it("rounds to integer module count", () => {
    expect(computeNewModules(4, 1.4, 1, 10)).toBe(6);
    expect(computeNewModules(3, 0.9, 1, 10)).toBe(3);
  });

  it("clamps to min", () => {
    expect(computeNewModules(4, 0.1, 2, 10)).toBe(2);
  });

  it("clamps to max", () => {
    expect(computeNewModules(4, 5, 1, 10)).toBe(10);
  });
});

describe("applyModuleWidthSnap", () => {
  const anchor = { kind: "moduleWidth" as const, moduleWidthBounds: { min: 1, max: 10 }, nodeWidth: 100, nodeHeight: 40, moduleWidth: 2, rotation: "N" as const };
  const oldBox: BoundingBox = { x: 50, y: 0, width: 100, height: 40, rotation: 0 };

  it("snaps width to the next integer moduleWidth multiple", () => {
    const newBox: BoundingBox = { ...oldBox, width: 160 };
    expect(applyModuleWidthSnap(oldBox, newBox, anchor).width).toBe(150);
  });

  it("pins the right edge when the left handle was dragged", () => {
    const newBox: BoundingBox = { ...oldBox, x: 20, width: 130 };
    const out = applyModuleWidthSnap(oldBox, newBox, anchor);
    expect(out.x + out.width).toBe(oldBox.x + oldBox.width);
  });

  it("clamps to ^BY range [1,10]", () => {
    const newBox: BoundingBox = { ...oldBox, width: 1000 };
    expect(applyModuleWidthSnap(oldBox, newBox, anchor).width).toBe(500);
  });

  it("no-ops when anchor kind is wrong", () => {
    const newBox: BoundingBox = { ...oldBox, width: 160 };
    expect(applyModuleWidthSnap(oldBox, newBox, null).width).toBe(160);
  });

  // R/B put the moduleWidth axis on the screen height (bars turn a quarter):
  // the snap quantises height and pins the vertical edge, not width.
  describe("rotated R/B (height axis)", () => {
    const rot = { kind: "moduleWidth" as const, moduleWidthBounds: { min: 1, max: 10 }, nodeWidth: 40, nodeHeight: 100, moduleWidth: 2, rotation: "B" as const };
    const oldRot: BoundingBox = { x: 0, y: 50, width: 40, height: 100, rotation: 0 };

    it("snaps height to the next integer moduleWidth multiple, leaves width", () => {
      const out = applyModuleWidthSnap(oldRot, { ...oldRot, height: 160 }, rot);
      expect(out.height).toBe(150);
      expect(out.width).toBe(40);
    });

    it("pins the bottom edge when the top handle was dragged", () => {
      const out = applyModuleWidthSnap(oldRot, { ...oldRot, y: 20, height: 130 }, rot);
      expect(out.y + out.height).toBe(oldRot.y + oldRot.height);
    });

    it("clamps overshoot to ^BY min (height stops, anchored edge holds)", () => {
      // Drag top way past min: height clamps to 1 module (50), bottom stays.
      const out = applyModuleWidthSnap(oldRot, { ...oldRot, y: 145, height: 5 }, rot);
      expect(out.height).toBe(50);
      expect(out.y + out.height).toBe(oldRot.y + oldRot.height);
    });
  });

  it("honours a row anchor's module-width floor (CODABLOCK A = 2)", () => {
    // nodeWidth=100, moduleWidth=2 → 50px/module; shrink hard, min 2 holds at 100px.
    const row = { kind: "row" as const, nodeHeight: 40, rowHeight: 20, nodeWidth: 100, moduleWidth: 2, moduleWidthBounds: { min: 2, max: 10 }, rotation: "N" as const };
    const out = applyModuleWidthSnap(oldBox, { ...oldBox, width: 10 }, row);
    expect(out.width).toBe(100); // 2 modules * 50px, not 1
  });
});

describe("uniformReflowGeometry", () => {
  const start = (edges: { left: boolean; right: boolean; top: boolean; bottom: boolean }) => ({
    edges,
    modules0: 4,
    min: 1,
    max: 10,
    leftX: 50,
    topY: 50,
    rightX: 150,
    bottomY: 150,
  });
  const E = (left: boolean, top: boolean) => ({ left, right: !left, top, bottom: !top });

  it("quantises to whole modules and keeps top-left on a bottom-right grab", () => {
    const geo = uniformReflowGeometry(start(E(false, false)), 140, 140);
    expect(geo).toEqual({ modules: 6, targetXPx: 50, targetYPx: 50, linearW: 150, linearH: 150 });
  });

  it("pins bottom-right when top-left was grabbed", () => {
    const geo = uniformReflowGeometry(start(E(true, true)), 140, 140);
    expect(geo?.targetXPx).toBe(150 - 150);
    expect(geo?.targetYPx).toBe(150 - 150);
    expect((geo?.targetXPx ?? 0) + (geo?.linearW ?? 0)).toBe(150);
    expect((geo?.targetYPx ?? 0) + (geo?.linearH ?? 0)).toBe(150);
  });

  it("centered (Alt) mirrors both axes around the start centre, any corner", () => {
    // Centre (100, 100), linear 150 -> 25..175 on both axes.
    for (const e of [E(false, false), E(true, true)]) {
      const geo = uniformReflowGeometry(start(e), 140, 140, true);
      expect(geo?.targetXPx).toBe(25);
      expect(geo?.targetYPx).toBe(25);
    }
  });

  // Regression: at 90 degree view rotation the visual right handles are the
  // node-frame TOP anchors; the pin must hold the node-frame bottom edge.
  it("pins the bottom edge on a top-edge grab (visual right side at 90deg)", () => {
    const geo = uniformReflowGeometry(start(E(false, true)), 250, 250);
    expect(geo?.modules).toBe(10);
    expect(geo?.targetXPx).toBe(50);
    expect((geo?.targetYPx ?? 0) + (geo?.linearH ?? 0)).toBe(150);
  });

  // Regression: total-extent quantise is reset-invariant. After baking modules
  // 5 and re-basing the scale, 137% must still map to 5, not oscillate back to
  // 4 (the mid-drag flicker).
  it("is stable across crossings (total extent, not incremental scale)", () => {
    const s = start(E(false, false));
    expect(uniformReflowGeometry(s, 125, 125)?.modules).toBe(5);
    expect(uniformReflowGeometry(s, 137, 137)?.modules).toBe(5);
    expect(uniformReflowGeometry(s, 137.5, 137.5)?.modules).toBe(6);
  });

  it("clamps to min on a collapse and to max on an overshoot", () => {
    expect(uniformReflowGeometry(start(E(false, false)), 1, 1)?.modules).toBe(1);
    expect(uniformReflowGeometry(start(E(false, false)), 900, 900)?.modules).toBe(10);
  });

  it("scales a rectangular start box by the same module factor", () => {
    // 8x18 DMRE at dimension 4: bbox 180x80. One module step up -> x1.25.
    const geo = uniformReflowGeometry(
      { edges: E(false, false), modules0: 4, min: 1, max: 10, leftX: 50, topY: 50, rightX: 230, bottomY: 130 },
      228.6,
      101.6,
    );
    expect(geo?.modules).toBe(5);
    expect(geo?.linearW).toBe(225);
    expect(geo?.linearH).toBe(100);
    expect(geo?.targetXPx).toBe(50);
    expect(geo?.targetYPx).toBe(50);
  });

  it("returns null for a degenerate start box", () => {
    expect(uniformReflowGeometry({ ...start(E(false, false)), rightX: 50 }, 140, 140)).toBeNull();
  });
});

describe("activeEdgesFromAnchorName", () => {
  it("decodes corner anchor names", () => {
    expect(activeEdgesFromAnchorName("top-left"))
      .toEqual({ left: true, right: false, top: true, bottom: false });
    expect(activeEdgesFromAnchorName("bottom-right"))
      .toEqual({ left: false, right: true, top: false, bottom: true });
  });

  it("decodes side anchor names", () => {
    expect(activeEdgesFromAnchorName("middle-right"))
      .toEqual({ left: false, right: true, top: false, bottom: false });
  });

  it("returns null for unknown or null input", () => {
    expect(activeEdgesFromAnchorName(null)).toBeNull();
    expect(activeEdgesFromAnchorName("rotater")).toBeNull();
  });
});

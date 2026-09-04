import type { LabelObject } from "@zplab/core/types/Group";

/**
 * Pixel-regression cases for the geometric primitives (box, line, ellipse) —
 * analogous to `testCases.ts` for barcodes. Each entry pairs a
 * canonical `LabelObject` (used by `renderShape` to produce the local
 * canvas) with the ZPL Labelary should render as the reference.
 *
 * ZPL is stored verbatim rather than re-derived from `obj` via the registry,
 * mirroring the barcode-fixtures pattern. The registry's runtime entry
 * (`src/registry/index.ts`) transitively imports the React components and
 * the zustand store, both of which crash under plain Node — keeping the
 * ZPL inline lets the fetch script run without a DOM polyfill. The trade-
 * off is that the strings need a manual update if a shape's `toZPL`
 * changes; cross-check via `zplGenerator.test.ts`.
 *
 * Initial set deliberately covers the geometry-asymmetry cases:
 *   - thick outline boxes (^GB thickness extrudes inward)
 *   - horizontal / vertical lines of varying thickness
 *   - ellipse outline (^GE thickness behaviour) including square (^GC)
 * Anti-aliasing-only cases (thickness 1, filled solid) are kept too as a
 * baseline that should match trivially.
 *
 * Diagonal lines (`^GD`) render through the same parallelogram geometry as
 * the canvas (`diagonalPolygonPoints`).
 */
export interface ShapeTestCase {
  id: string;
  obj: LabelObject;
  zpl_input: string;
  image_ref: string;
}

export const shapeTestCases: ShapeTestCase[] = [
  {
    id: "shape_box_rounded_thin",
    obj: {
      id: "r1",
      type: "box",
      x: 100,
      y: 100,
      rotation: 0,
      props: { width: 200, height: 200, thickness: 4, filled: false, color: "B", rounding: 4 },
    },
    zpl_input: "^XA^FO100,100^GB200,200,4,B,4^FS^XZ",
    image_ref: "shape_box_rounded_thin.png",
  },
  {
    id: "shape_box_rounded_thick",
    obj: {
      id: "r2",
      type: "box",
      x: 100,
      y: 100,
      rotation: 0,
      props: { width: 200, height: 200, thickness: 40, filled: false, color: "B", rounding: 4 },
    },
    zpl_input: "^XA^FO100,100^GB200,200,40,B,4^FS^XZ",
    image_ref: "shape_box_rounded_thick.png",
  },
  {
    id: "shape_box_rounded_wide_r8",
    obj: {
      id: "r3",
      type: "box",
      x: 100,
      y: 100,
      rotation: 0,
      props: { width: 300, height: 150, thickness: 10, filled: false, color: "B", rounding: 8 },
    },
    zpl_input: "^XA^FO100,100^GB300,150,10,B,8^FS^XZ",
    image_ref: "shape_box_rounded_wide_r8.png",
  },
  {
    id: "shape_box_outline_thin",
    obj: {
      id: "1",
      type: "box",
      x: 100,
      y: 100,
      rotation: 0,
      props: { width: 300, height: 200, thickness: 1, filled: false, color: "B", rounding: 0 },
    },
    zpl_input: "^XA^FO100,100^GB300,200,1,B,0^FS^XZ",
    image_ref: "shape_box_outline_thin.png",
  },
  {
    id: "shape_box_outline_thick",
    obj: {
      id: "2",
      type: "box",
      x: 100,
      y: 100,
      rotation: 0,
      props: { width: 300, height: 200, thickness: 12, filled: false, color: "B", rounding: 0 },
    },
    zpl_input: "^XA^FO100,100^GB300,200,12,B,0^FS^XZ",
    image_ref: "shape_box_outline_thick.png",
  },
  {
    // Filled box: box.toZPL substitutes thickness with min(w, h) — the
    // ZPL string below mirrors that exactly so Labelary renders a solid
    // rect. Keep in sync if `box.toZPL` changes.
    id: "shape_box_filled",
    obj: {
      id: "3",
      type: "box",
      x: 100,
      y: 100,
      rotation: 0,
      props: { width: 300, height: 200, thickness: 1, filled: true, color: "B", rounding: 0 },
    },
    zpl_input: "^XA^FO100,100^GB300,200,200,B,0^FS^XZ",
    image_ref: "shape_box_filled.png",
  },
  {
    id: "shape_line_horizontal_thick",
    obj: {
      id: "4",
      type: "line",
      x: 100,
      y: 200,
      rotation: 0,
      props: { angle: 0, length: 400, thickness: 10, color: "B" },
    },
    zpl_input: "^XA^FO100,200^GB400,10,10,B,0^FS^XZ",
    image_ref: "shape_line_horizontal_thick.png",
  },
  {
    id: "shape_line_vertical_thick",
    obj: {
      id: "5",
      type: "line",
      x: 200,
      y: 100,
      rotation: 0,
      props: { angle: 90, length: 400, thickness: 10, color: "B" },
    },
    zpl_input: "^XA^FO200,100^GB10,400,10,B,0^FS^XZ",
    image_ref: "shape_line_vertical_thick.png",
  },
  {
    id: "shape_ellipse_outline",
    obj: {
      id: "7",
      type: "ellipse",
      x: 100,
      y: 100,
      rotation: 0,
      props: { width: 300, height: 200, thickness: 8, filled: false, color: "B" },
    },
    zpl_input: "^XA^FO100,100^GE300,200,8,B^FS^XZ",
    image_ref: "shape_ellipse_outline.png",
  },
  {
    id: "shape_circle_outline",
    obj: {
      id: "8",
      type: "ellipse",
      x: 100,
      y: 100,
      rotation: 0,
      props: { width: 200, height: 200, thickness: 8, filled: false, color: "B", lockAspect: true },
    },
    zpl_input: "^XA^FO100,100^GE200,200,8,B^FS^XZ",
    image_ref: "shape_circle_outline.png",
  },

  // Reverse-direction lines — angle 180 / 270 extend the body backward
  // from (x, y). The renderer maps this to ^GB at (x - length, y) /
  // (x, y - length); the ZPL strings below precompute that shift so
  // Labelary positions the same band.
  {
    id: "shape_line_horizontal_left",
    obj: {
      id: "9",
      type: "line",
      x: 500,
      y: 200,
      rotation: 0,
      props: { angle: 180, length: 400, thickness: 10, color: "B" },
    },
    zpl_input: "^XA^FO100,200^GB400,10,10,B,0^FS^XZ",
    image_ref: "shape_line_horizontal_left.png",
  },
  {
    id: "shape_line_vertical_up",
    obj: {
      id: "10",
      type: "line",
      x: 200,
      y: 500,
      rotation: 0,
      props: { angle: 270, length: 400, thickness: 10, color: "B" },
    },
    zpl_input: "^XA^FO200,100^GB10,400,10,B,0^FS^XZ",
    image_ref: "shape_line_vertical_up.png",
  },

  // Thickness sweep — odd, larger, and right at the filled-clamp edge
  // (Zebra renders ^GB with `2 * thickness >= min(w, h)` as solid; for
  // 300×200 the threshold is t = 100, so t=99 is the densest still-
  // outline case and proves the clamp boundary).
  {
    id: "shape_box_outline_t3",
    obj: {
      id: "11",
      type: "box",
      x: 100,
      y: 100,
      rotation: 0,
      props: { width: 300, height: 200, thickness: 3, filled: false, color: "B", rounding: 0 },
    },
    zpl_input: "^XA^FO100,100^GB300,200,3,B,0^FS^XZ",
    image_ref: "shape_box_outline_t3.png",
  },
  {
    id: "shape_box_outline_t20",
    obj: {
      id: "12",
      type: "box",
      x: 100,
      y: 100,
      rotation: 0,
      props: { width: 300, height: 200, thickness: 20, filled: false, color: "B", rounding: 0 },
    },
    zpl_input: "^XA^FO100,100^GB300,200,20,B,0^FS^XZ",
    image_ref: "shape_box_outline_t20.png",
  },
  {
    id: "shape_box_outline_near_filled",
    obj: {
      id: "13",
      type: "box",
      x: 100,
      y: 100,
      rotation: 0,
      props: { width: 300, height: 200, thickness: 99, filled: false, color: "B", rounding: 0 },
    },
    zpl_input: "^XA^FO100,100^GB300,200,99,B,0^FS^XZ",
    image_ref: "shape_box_outline_near_filled.png",
  },
  {
    id: "shape_line_horizontal_t1",
    obj: {
      id: "14",
      type: "line",
      x: 100,
      y: 300,
      rotation: 0,
      props: { angle: 0, length: 400, thickness: 1, color: "B" },
    },
    zpl_input: "^XA^FO100,300^GB400,1,1,B,0^FS^XZ",
    image_ref: "shape_line_horizontal_t1.png",
  },
  {
    id: "shape_line_horizontal_t3",
    obj: {
      id: "15",
      type: "line",
      x: 100,
      y: 350,
      rotation: 0,
      props: { angle: 0, length: 400, thickness: 3, color: "B" },
    },
    zpl_input: "^XA^FO100,350^GB400,3,3,B,0^FS^XZ",
    image_ref: "shape_line_horizontal_t3.png",
  },

  // Diagonal lines (^GD). ZPL strings were derived from line.toZPL's diagonal branch
  // (Math.cos/sin → dx/dy → w/h/orientation/boxX/boxY).
  {
    id: "shape_line_diag_slash_45",
    obj: {
      id: "16",
      type: "line",
      x: 100,
      y: 500,
      rotation: 0,
      props: { angle: -45, length: 400, thickness: 6, color: "B" },
    },
    // angle 315°: dx=+283, dy=-283 → boxY shifts up by 283
    zpl_input: "^XA^FO100,217^GD283,283,6,B,R^FS^XZ",
    image_ref: "shape_line_diag_slash_45.png",
  },
  {
    id: "shape_line_diag_backslash_45",
    obj: {
      id: "17",
      type: "line",
      x: 100,
      y: 100,
      rotation: 0,
      props: { angle: 45, length: 400, thickness: 6, color: "B" },
    },
    zpl_input: "^XA^FO100,100^GD283,283,6,B,L^FS^XZ",
    image_ref: "shape_line_diag_backslash_45.png",
  },
  {
    id: "shape_line_diag_shallow",
    obj: {
      id: "18",
      type: "line",
      x: 100,
      y: 200,
      rotation: 0,
      props: { angle: 30, length: 400, thickness: 6, color: "B" },
    },
    zpl_input: "^XA^FO100,200^GD346,200,6,B,L^FS^XZ",
    image_ref: "shape_line_diag_shallow.png",
  },
  {
    id: "shape_line_diag_steep",
    obj: {
      id: "19",
      type: "line",
      x: 100,
      y: 200,
      rotation: 0,
      props: { angle: 60, length: 400, thickness: 6, color: "B" },
    },
    zpl_input: "^XA^FO100,200^GD200,346,6,B,L^FS^XZ",
    image_ref: "shape_line_diag_steep.png",
  },

  // Dimension-promotion cases for ^GB rects where thickness exceeds an
  // axis. Zebra firmware extrudes solid fields out to `max(w, t)` /
  // `max(h, t)`; renderShape used to draw the literal `w × h` and miss
  // the strip along the affected edge. Each case picks a different
  // axis so a regression touching only one branch is caught.
  {
    id: "shape_box_thickness_exceeds_height",
    obj: {
      id: "20",
      type: "box",
      // ^GB101,92,101: thickness > height → rect grows downward by
      // (t - h) = 9 dots. Reproduces the user-reported case where the
      // editor's box bottom was 9 dots above Labelary's. Reverse=true
      // mirrors the original ZPL; ^LRY only inverts ink colour and
      // does not affect geometry.
      x: 144,
      y: 160,
      rotation: 0,
      props: { width: 101, height: 92, thickness: 101, filled: false, color: "B", rounding: 0, reverse: true },
    },
    zpl_input: "^XA^LRY^FO144,160^GB101,92,101,B,0^FS^LRN^XZ",
    image_ref: "shape_box_thickness_exceeds_height.png",
  },
  {
    id: "shape_box_thickness_exceeds_width",
    obj: {
      id: "21",
      type: "box",
      // ^GB80,150,120: thickness > width → rect grows rightward by
      // (t - w) = 40 dots. Symmetric of the above; catches a fix that
      // only handles the height axis.
      x: 100,
      y: 100,
      rotation: 0,
      props: { width: 80, height: 150, thickness: 120, filled: false, color: "B", rounding: 0 },
    },
    zpl_input: "^XA^FO100,100^GB80,150,120,B,0^FS^XZ",
    image_ref: "shape_box_thickness_exceeds_width.png",
  },
  {
    id: "shape_box_thickness_exceeds_both",
    obj: {
      id: "22",
      type: "box",
      // ^GB60,40,90: thickness exceeds both axes → 90×90 square.
      // Square is the firmware's documented "create a square" form
      // (w, h, t all equal); the promotion path must collapse to that
      // shape when t pulls both axes up to the same value.
      x: 100,
      y: 100,
      rotation: 0,
      props: { width: 60, height: 40, thickness: 90, filled: false, color: "B", rounding: 0 },
    },
    zpl_input: "^XA^FO100,100^GB60,40,90,B,0^FS^XZ",
    image_ref: "shape_box_thickness_exceeds_both.png",
  },
];

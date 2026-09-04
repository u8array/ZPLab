// Pure geometry for ^GB/^GE/^GC/^GD. Outlines extrude inward; 2t >= min(w,h)
// collapses to solid. ^GD places the line on the parallelogram's left long edge.

export interface OutlineInset {
  /** t/2 unless filled. */
  offset: number;
  /** w - t unless filled. */
  width: number;
  /** h - t unless filled. */
  height: number;
  /** Firmware clamps outline to solid. */
  renderFilled: boolean;
}

/** ^GB draws a solid at least as wide and tall as its border. */
export function gbPromotedSize(w: number, h: number, t: number): { width: number; height: number } {
  return { width: Math.max(w, t), height: Math.max(h, t) };
}

export function outlineInset(
  w: number,
  h: number,
  t: number,
  filled: boolean,
  /** ^GB only; ^GE/^GC leave off. */
  promoteFilled = false,
): OutlineInset {
  const clampsToFilled = !filled && t * 2 >= Math.min(w, h);
  const renderFilled = filled || clampsToFilled;
  const { width: fillW, height: fillH } = promoteFilled ? gbPromotedSize(w, h, t) : { width: w, height: h };
  return {
    offset: renderFilled ? 0 : t / 2,
    width: renderFilled ? fillW : Math.max(0, w - t),
    height: renderFilled ? fillH : Math.max(0, h - t),
    renderFilled,
  };
}

/** Flat (x,y) tuple consumed by Konva.Line and 2D canvas paths. */
export type ParallelogramPoints = [
  number, number,
  number, number,
  number, number,
  number, number,
];

/** ^GD vertices; line on left long edge, +t in x. Validated against Labelary. */
export function diagonalPolygonPoints(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  t: number,
): ParallelogramPoints {
  const ddx = bx - ax;
  const ddy = by - ay;
  const w = Math.abs(ddx);
  const h = Math.abs(ddy);
  const orientation: "L" | "R" = ddx * ddy >= 0 ? "L" : "R";
  const boxX = ddx < 0 ? ax + ddx : ax;
  const boxY = ddy < 0 ? ay + ddy : ay;
  if (orientation === "L") {
    return [
      boxX,             boxY,
      boxX + t,         boxY,
      boxX + w + t,     boxY + h,
      boxX + w,         boxY + h,
    ];
  }
  return [
    boxX + w,         boxY,
    boxX + w + t,     boxY,
    boxX + t,         boxY + h,
    boxX,             boxY + h,
  ];
}

/** ^GB corner radii in dots (ZD230 and Labelary, 2026-09-04): outer per the guide,
 *  rounding/8 of half the shorter drawn side (p. 210); inner the same formula on the
 *  border-inset rectangle, not concentric. */
export interface CornerRadii {
  outer: number;
  inner: number;
}

export function boxCornerRadii(
  width: number,
  height: number,
  thickness: number,
  rounding: number,
): CornerRadii {
  const factor = Math.min(Math.max(rounding, 0), 8) / 16;
  const border = Math.max(1, thickness);
  const drawn = gbPromotedSize(width, height, border);
  const shorter = Math.min(drawn.width, drawn.height);
  return {
    outer: factor * shorter,
    inner: factor * Math.max(0, shorter - 2 * border),
  };
}

/** The 2D path calls a rounded ^GB needs; both canvas renderers satisfy it. */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
  closePath(): void;
}

function traceRoundedRect(path: PathSink, x: number, y: number, w: number, h: number, r: number, clockwise: boolean): void {
  const rr = Math.min(r, w / 2, h / 2);
  const corners: [number, number][] = [[x + w, y], [x + w, y + h], [x, y + h], [x, y]];
  const order = clockwise ? corners : [...corners].reverse();
  path.moveTo(x + rr, y);
  order.forEach(([cx, cy], i) => {
    const [nx, ny] = order[(i + 1) % order.length] ?? [cx, cy];
    path.arcTo(cx, cy, nx, ny, rr);
  });
  path.closePath();
}

/** One nonzero-winding path: outer arc clockwise, inner arc counter-clockwise. */
export function traceRoundedBoxRing(
  path: PathSink,
  w: number,
  h: number,
  t: number,
  radii: CornerRadii,
): void {
  traceRoundedRect(path, 0, 0, w, h, radii.outer, true);
  if (w - 2 * t > 0 && h - 2 * t > 0) traceRoundedRect(path, t, t, w - 2 * t, h - 2 * t, radii.inner, false);
}

export function traceRoundedBox(path: PathSink, w: number, h: number, outer: number): void {
  traceRoundedRect(path, 0, 0, w, h, outer, true);
}

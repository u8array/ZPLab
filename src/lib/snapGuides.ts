export const SNAP_THRESHOLD_PX = 6;
/** Extra px the alignment guide extends beyond the dragged + matched objects. */
const GUIDE_PADDING_PX = 8;

/** Edge-only point snap for line endpoints; centres-as-targets would trigger
 *  the "snaps to 50%" artefact. */
export function computePointSnap(
  point: { x: number; y: number },
  others: SnapRect[],
  threshold = SNAP_THRESHOLD_PX,
  labelRect?: SnapRect,
  lines?: SnapLines,
): { x: number; y: number; guides: SnapGuide[] } {
  const snapAxisPt = (
    drag: number,
    dragPerp: number,
    axis: 'x' | 'y',
  ): { value: number; guides: SnapGuide[] } => {
    let bestDelta = Infinity;
    let bestValue = drag;
    let bestGuides: SnapGuide[] = [];
    const consider = (target: number, perpFrom: number, perpTo: number) => {
      const d = Math.abs(target - drag);
      if (d > threshold || d > bestDelta) return;
      const guideOrientation: 'H' | 'V' = axis === 'x' ? 'V' : 'H';
      const guide: SnapGuide = {
        orientation: guideOrientation,
        type: 'align',
        pos: target,
        from: Math.min(dragPerp, perpFrom) - GUIDE_PADDING_PX,
        to: Math.max(dragPerp, perpTo) + GUIDE_PADDING_PX,
      };
      if (d < bestDelta) {
        bestDelta = d;
        bestValue = target;
        bestGuides = [guide];
      } else if (target === bestValue) {
        bestGuides.push(guide);
      }
    };
    for (const o of others) {
      const startEdge = axis === 'x' ? o.x : o.y;
      const endEdge = startEdge + (axis === 'x' ? o.width : o.height);
      const perpStart = axis === 'x' ? o.y : o.x;
      const perpEnd = perpStart + (axis === 'x' ? o.height : o.width);
      consider(startEdge, perpStart, perpEnd);
      consider(endEdge, perpStart, perpEnd);
    }
    if (labelRect) {
      // Label center allowed (not other objects'); avoids "50%" artefact.
      const startEdge = axis === 'x' ? labelRect.x : labelRect.y;
      const size = axis === 'x' ? labelRect.width : labelRect.height;
      const endEdge = startEdge + size;
      const center = startEdge + size / 2;
      const perpStart = axis === 'x' ? labelRect.y : labelRect.x;
      const perpEnd = perpStart + (axis === 'x' ? labelRect.height : labelRect.width);
      consider(startEdge, perpStart, perpEnd);
      consider(center, perpStart, perpEnd);
      consider(endEdge, perpStart, perpEnd);
    }
    for (const line of lines?.[axis] ?? []) consider(line, dragPerp, dragPerp);
    return { value: bestValue, guides: bestGuides };
  };

  const xRes = snapAxisPt(point.x, point.y, 'x');
  const yRes = snapAxisPt(point.y, point.x, 'y');
  return { x: xRes.value, y: yRes.value, guides: [...xRes.guides, ...yRes.guides] };
}

export interface SnapRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Fixed lines to snap to, in the caller's space: `x` holds the positions that pull along x, `y` along y. */
export interface SnapLines {
  x: readonly number[];
  y: readonly number[];
}

export interface SnapGuide {
  // 'V' = vertical line drawn at x=pos, from y=from to y=to
  // 'H' = horizontal line drawn at y=pos, from x=from to x=to
  orientation: 'H' | 'V';
  /** 'align' = edge/center alignment guide; 'space' = equal-spacing indicator */
  type: 'align' | 'space';
  pos: number;
  from: number;
  to: number;
}

export interface SnapResult {
  /** Snapped bounding-box top-left in stage pixels */
  x: number;
  y: number;
  guides: SnapGuide[];
}

interface AxisInfo {
  pos: number;
  size: number;
  perp: number;
  perpSize: number;
}

interface AnchorCandidate {
  value: number;
  guide: SnapGuide;
}

/** Start/center/end anchors; guide spans both drag and other. */
function objectAnchorCandidates(
  other: AxisInfo,
  dragPerp: number,
  dragPerpSize: number,
  alignOrientation: 'H' | 'V',
): AnchorCandidate[] {
  const oStart = other.pos;
  const oCenter = other.pos + other.size / 2;
  const oEnd = other.pos + other.size;
  const perpFrom = Math.min(dragPerp, other.perp) - GUIDE_PADDING_PX;
  const perpTo = Math.max(dragPerp + dragPerpSize, other.perp + other.perpSize) + GUIDE_PADDING_PX;
  return [oStart, oCenter, oEnd].map(value => ({
    value,
    guide: { orientation: alignOrientation, type: 'align', pos: value, from: perpFrom, to: perpTo },
  }));
}

/** A fixed line is one anchor candidate, shown over the dragged object's own extent. */
function lineAnchorCandidates(
  lines: readonly number[],
  dragPerp: number,
  dragPerpSize: number,
  alignOrientation: 'H' | 'V',
): AnchorCandidate[] {
  return lines.map(value => ({
    value,
    guide: {
      orientation: alignOrientation,
      type: 'align',
      pos: value,
      from: dragPerp - GUIDE_PADDING_PX,
      to: dragPerp + dragPerpSize + GUIDE_PADDING_PX,
    },
  }));
}

function labelAnchorCandidates(
  labelAxis: AxisInfo,
  alignOrientation: 'H' | 'V',
  labelExtent: { from: number; to: number } | undefined,
): AnchorCandidate[] {
  const lStart = labelAxis.pos;
  const lCenter = labelAxis.pos + labelAxis.size / 2;
  const lEnd = labelAxis.pos + labelAxis.size;
  const perpFrom = labelExtent ? labelExtent.from : labelAxis.perp;
  const perpTo = labelExtent ? labelExtent.to : labelAxis.perp + labelAxis.perpSize;
  return [lStart, lCenter, lEnd].map(value => ({
    value,
    guide: { orientation: alignOrientation, type: 'align', pos: value, from: perpFrom, to: perpTo },
  }));
}

/** 2 nearest per direction (equal-spacing needs consecutive pairs). */
function filterNearby(dragPos: number, dragSize: number, others: AxisInfo[]): AxisInfo[] {
  const dragEnd = dragPos + dragSize;
  const leftOf = others
    .filter(o => o.pos + o.size <= dragPos)
    .sort((a, b) => (b.pos + b.size) - (a.pos + a.size))
    .slice(0, 2);
  const rightOf = others
    .filter(o => o.pos >= dragEnd)
    .sort((a, b) => a.pos - b.pos)
    .slice(0, 2);
  const overlapping = others.filter(
    o => o.pos < dragEnd && o.pos + o.size > dragPos,
  );
  return [...leftOf, ...overlapping, ...rightOf];
}

export function computeSnap(
  dragged: SnapRect,
  others: SnapRect[],
  threshold = SNAP_THRESHOLD_PX,
  labelBounds?: { x: number; y: number; width: number; height: number },
  /** Separate from `others` so it bypasses nearest-2 filter. */
  labelRect?: SnapRect,
  lines?: SnapLines,
): SnapResult {
  const xDrag: AxisInfo = { pos: dragged.x, size: dragged.width,  perp: dragged.y, perpSize: dragged.height };
  const yDrag: AxisInfo = { pos: dragged.y, size: dragged.height, perp: dragged.x, perpSize: dragged.width  };
  const xOthers = others.map<AxisInfo>(o => ({ pos: o.x, size: o.width,  perp: o.y, perpSize: o.height }));
  const yOthers = others.map<AxisInfo>(o => ({ pos: o.y, size: o.height, perp: o.x, perpSize: o.width  }));

  const xLabelExtent = labelBounds ? { from: labelBounds.y, to: labelBounds.y + labelBounds.height } : undefined;
  const yLabelExtent = labelBounds ? { from: labelBounds.x, to: labelBounds.x + labelBounds.width } : undefined;

  // Label rect anchors; tested separately, outside the nearest-2 filter
  const xLblAxis = labelRect ? { pos: labelRect.x, size: labelRect.width, perp: labelRect.y, perpSize: labelRect.height } : undefined;
  const yLblAxis = labelRect ? { pos: labelRect.y, size: labelRect.height, perp: labelRect.x, perpSize: labelRect.width } : undefined;

  const { snapped: x, guides: xGuides } = snapAxis(xDrag, xOthers, threshold, 'V', xLabelExtent, xLblAxis, lines?.x);
  const { snapped: y, guides: yGuides } = snapAxis(yDrag, yOthers, threshold, 'H', yLabelExtent, yLblAxis, lines?.y);

  return { x, y, guides: [...xGuides, ...yGuides] };
}

function snapAxis(
  drag: AxisInfo,
  others: AxisInfo[],
  threshold: number,
  // Perpendicular to movement; equal-spacing uses the opposite.
  alignOrientation: 'H' | 'V',
  labelExtent?: { from: number; to: number },
  labelAxis?: AxisInfo,
  lines: readonly number[] = [],
): { snapped: number; guides: SnapGuide[] } {
  const spaceOrientation: 'H' | 'V' = alignOrientation === 'V' ? 'H' : 'V';
  let bestDelta = Infinity;
  let snapped = drag.pos;
  let guides: SnapGuide[] = [];

  const nearby = filterNearby(drag.pos, drag.size, others);

  function trySnap(newPos: number, newGuides: SnapGuide[]) {
    const d = Math.abs(newPos - drag.pos);
    if (d < threshold && d < bestDelta) {
      bestDelta = d;
      snapped = newPos;
      guides = newGuides;
    } else if (d < threshold && d === bestDelta && newPos === snapped) {
      guides.push(...newGuides);
    }
  }

  // Alignment: any of 3 drag anchors (start / center / end) → any of 3 other anchors.
  const dragAnchors = [drag.pos, drag.pos + drag.size / 2, drag.pos + drag.size];
  for (const other of nearby) {
    for (const cand of objectAnchorCandidates(other, drag.perp, drag.perpSize, alignOrientation)) {
      for (const da of dragAnchors) {
        trySnap(drag.pos + (cand.value - da), [cand.guide]);
      }
    }
  }

  // Equal spacing: check consecutive pairs (sorted by position)
  const sorted = [...nearby].sort((a, b) => a.pos - b.pos);

  for (let i = 0; i + 1 < sorted.length; i++) {
    const a    = sorted[i];
    const b    = sorted[i + 1];
    if (!a || !b) continue;
    const aEnd = a.pos + a.size;
    const bEnd = b.pos + b.size;
    const gap  = b.pos - aEnd;
    if (gap <= 0) continue;

    const perpMin = Math.min(drag.perp, a.perp, b.perp);
    const perpMax = Math.max(drag.perp + drag.perpSize, a.perp + a.perpSize, b.perp + b.perpSize);
    const perpMid = (perpMin + perpMax) / 2;

    // Place dragged right after b
    trySnap(bEnd + gap, [
      { orientation: spaceOrientation, type: 'space', pos: perpMid, from: aEnd,       to: b.pos },
      { orientation: spaceOrientation, type: 'space', pos: perpMid, from: bEnd,       to: bEnd + gap },
    ]);

    // Place dragged right before a
    const beforeA = a.pos - gap - drag.size;
    trySnap(beforeA, [
      { orientation: spaceOrientation, type: 'space', pos: perpMid, from: beforeA + drag.size, to: a.pos },
      { orientation: spaceOrientation, type: 'space', pos: perpMid, from: aEnd,                to: b.pos },
    ]);

    // Place dragged between a and b with equal gaps on both sides
    const innerSpace = b.pos - aEnd;
    if (innerSpace > drag.size) {
      const equalGap = (innerSpace - drag.size) / 2;
      const idealPos = aEnd + equalGap;
      trySnap(idealPos, [
        { orientation: spaceOrientation, type: 'space', pos: perpMid, from: aEnd,                 to: idealPos },
        { orientation: spaceOrientation, type: 'space', pos: perpMid, from: idealPos + drag.size, to: b.pos },
      ]);
    }
  }

  // Label alignment: snap to label edges and center (separate from object nearest-2 filter)
  if (labelAxis) {
    for (const cand of labelAnchorCandidates(labelAxis, alignOrientation, labelExtent)) {
      for (const da of dragAnchors) {
        trySnap(drag.pos + (cand.value - da), [cand.guide]);
      }
    }
  }

  for (const cand of lineAnchorCandidates(lines, drag.perp, drag.perpSize, alignOrientation)) {
    for (const da of dragAnchors) {
      trySnap(drag.pos + (cand.value - da), [cand.guide]);
    }
  }

  return { snapped, guides };
}

// ─── Resize-time snap ────────────────────────────────────────────────────────

export interface ActiveEdges {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}

export interface ResizeSnapResult {
  /** Snapped bounding-box top-left + size in stage pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  guides: SnapGuide[];
}

/** 2px tolerance guards Konva's FP scale drift from flipping static edges active. */
export function deriveActiveEdges(
  oldBox: SnapRect,
  newBox: SnapRect,
  tolerance = 2,
): ActiveEdges {
  return {
    left: Math.abs(newBox.x - oldBox.x) > tolerance,
    right: Math.abs((newBox.x + newBox.width) - (oldBox.x + oldBox.width)) > tolerance,
    top: Math.abs(newBox.y - oldBox.y) > tolerance,
    bottom: Math.abs((newBox.y + newBox.height) - (oldBox.y + oldBox.height)) > tolerance,
  };
}

interface EdgeMatch {
  delta: number;
  pos: number;
  guides: SnapGuide[];
}

/** Fresh object so callers don't bleed `guides` mutations into a shared ref. */
function noMatch(): EdgeMatch {
  return { delta: Infinity, pos: 0, guides: [] };
}

function considerEdge(current: EdgeMatch, candidatePos: number, dragPos: number, guide: SnapGuide, threshold: number): EdgeMatch {
  const d = Math.abs(candidatePos - dragPos);
  if (d >= threshold) return current;
  if (d < current.delta) return { delta: d, pos: candidatePos, guides: [guide] };
  if (d === current.delta && candidatePos === current.pos) {
    return { ...current, guides: [...current.guides, guide] };
  }
  return current;
}

interface ResizeAxisInput {
  posActive: boolean;
  endActive: boolean;
  pos: number;
  size: number;
  perp: number;
  perpSize: number;
}

interface AxisSnapResult {
  pos: number;
  size: number;
  guides: SnapGuide[];
}

function snapResizeAxis(
  drag: ResizeAxisInput,
  others: AxisInfo[],
  threshold: number,
  alignOrientation: 'H' | 'V',
  labelAxis?: AxisInfo,
  labelExtent?: { from: number; to: number },
  lines: readonly number[] = [],
): AxisSnapResult {
  const dragEnd = drag.pos + drag.size;
  const nearby = filterNearby(drag.pos, drag.size, others);

  // Resize aligns edges only; dragged center is ignored by design.
  const candidates: AnchorCandidate[] = [];
  for (const o of nearby) {
    candidates.push(...objectAnchorCandidates(o, drag.perp, drag.perpSize, alignOrientation));
  }
  if (labelAxis) {
    candidates.push(...labelAnchorCandidates(labelAxis, alignOrientation, labelExtent));
  }
  candidates.push(...lineAnchorCandidates(lines, drag.perp, drag.perpSize, alignOrientation));

  let leadMatch = noMatch();
  let endMatch = noMatch();
  for (const c of candidates) {
    if (drag.posActive) leadMatch = considerEdge(leadMatch, c.value, drag.pos, c.guide, threshold);
    if (drag.endActive) endMatch = considerEdge(endMatch, c.value, dragEnd, c.guide, threshold);
  }

  // Pick smaller-delta edge; snapping both would fight.
  let pos = drag.pos;
  let size = drag.size;
  const guides: SnapGuide[] = [];

  if (leadMatch.delta < Infinity && leadMatch.delta <= endMatch.delta) {
    pos = leadMatch.pos;
    size = dragEnd - pos;
    guides.push(...leadMatch.guides);
  } else if (endMatch.delta < Infinity) {
    size = endMatch.pos - drag.pos;
    guides.push(...endMatch.guides);
  }

  return { pos, size, guides };
}

/** Resize variant of computeSnap; only `activeEdges` participate. */
export function computeResizeSnap(
  newBox: SnapRect,
  others: SnapRect[],
  activeEdges: ActiveEdges,
  threshold = SNAP_THRESHOLD_PX,
  /** Label bounds used for guide-line spans. */
  labelBounds?: { x: number; y: number; width: number; height: number },
  /** Full-size label rect for edge / center anchor matching. */
  labelRect?: SnapRect,
  lines?: SnapLines,
): ResizeSnapResult {
  const xOthers = others.map<AxisInfo>(o => ({ pos: o.x, size: o.width,  perp: o.y, perpSize: o.height }));
  const yOthers = others.map<AxisInfo>(o => ({ pos: o.y, size: o.height, perp: o.x, perpSize: o.width  }));

  const xLabelExtent = labelBounds ? { from: labelBounds.y, to: labelBounds.y + labelBounds.height } : undefined;
  const yLabelExtent = labelBounds ? { from: labelBounds.x, to: labelBounds.x + labelBounds.width } : undefined;

  const xLblAxis = labelRect ? { pos: labelRect.x, size: labelRect.width,  perp: labelRect.y, perpSize: labelRect.height } : undefined;
  const yLblAxis = labelRect ? { pos: labelRect.y, size: labelRect.height, perp: labelRect.x, perpSize: labelRect.width  } : undefined;

  const xResult = snapResizeAxis(
    {
      posActive: activeEdges.left,
      endActive: activeEdges.right,
      pos: newBox.x, size: newBox.width,
      perp: newBox.y, perpSize: newBox.height,
    },
    xOthers, threshold, 'V', xLblAxis, xLabelExtent, lines?.x,
  );
  const yResult = snapResizeAxis(
    {
      posActive: activeEdges.top,
      endActive: activeEdges.bottom,
      pos: newBox.y, size: newBox.height,
      perp: newBox.x, perpSize: newBox.width,
    },
    yOthers, threshold, 'H', yLblAxis, yLabelExtent, lines?.y,
  );

  return {
    x: xResult.pos,
    y: yResult.pos,
    width: xResult.size,
    height: yResult.size,
    guides: [...xResult.guides, ...yResult.guides],
  };
}

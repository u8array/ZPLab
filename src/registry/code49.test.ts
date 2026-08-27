import { describe, it, expect } from 'vitest';
import { code49 } from '@zplab/core/registry/code49';
import { stackExtentDots, stackRowHeightDots } from '@zplab/core/registry/transformHelpers';
import type { Code49Props } from '@zplab/core/registry/code49';
import type { LabelObjectBase } from '@zplab/core/types/LabelObject';
import type { PreflightCtx } from '@zplab/core/types/preflight';
/**
 * Five paths write ^B4's height; all resolve through code49RowMultiplier.
 * The UI row is HTML min/max and is not unit-tested here.
 */

const baseObj = (
  overrides: Partial<Code49Props> = {},
): LabelObjectBase & { props: Code49Props } => ({
  id: 'test',
  type: 'code49',
  x: 0,
  y: 0,
  rotation: 0,
  props: {
    content: 'CODE49',
    height: 20,
    moduleWidth: 2,
    printInterpretation: true,
    printInterpretationAbove: false,
    mode: 'A',
    rotation: 'N',
    ...overrides,
  },
});

describe('code49 — normalizeChanges height clamp on moduleWidth change', () => {
  it('clamps height up when new moduleWidth pushes minimum above current h', () => {
    // mw 2 → range [16, 100], h=20 valid. Bump to mw=5 → range [40, 250].
    // h=20 falls below the new floor, must round up to 40.
    const obj = baseObj({ height: 20, moduleWidth: 2 });
    const result = code49.normalizeChanges?.(obj, { props: { moduleWidth: 5 } });
    expect((result?.props as Partial<Code49Props>).height).toBe(40);
  });

  it('clamps height down when new moduleWidth pushes maximum below current h', () => {
    // mw 8 → range [64, 400], h=300 valid. Drop to mw=2 → range [16, 100].
    // h=300 exceeds new ceiling, must round down to 100.
    const obj = baseObj({ height: 300, moduleWidth: 8 });
    const result = code49.normalizeChanges?.(obj, { props: { moduleWidth: 2 } });
    expect((result?.props as Partial<Code49Props>).height).toBe(100);
  });

  it('leaves height untouched when moduleWidth is not in the change set', () => {
    const obj = baseObj({ height: 20, moduleWidth: 2 });
    const changes = { props: { content: 'NEW' } };
    expect(code49.normalizeChanges?.(obj, changes)).toBe(changes);
  });

  it('skips clamping when incoming moduleWidth is not a positive number', () => {
    // Defends against JSON imports / undo with garbage in moduleWidth.
    // Render-edge guard handles the genuinely-broken case; normalize
    // shouldn't anchor the clamp range to nonsense input.
    const obj = baseObj({ height: 20, moduleWidth: 2 });
    const changes = { props: { moduleWidth: 0 } };
    expect(code49.normalizeChanges?.(obj, changes)).toBe(changes);
  });

  it('leaves the height alone on a width-only gesture (no ratchet)', () => {
    // Snapping on every module change inflated the height each pass: a drag
    // out and back would grow a 40-dot row by a third.
    let h = 60;
    for (const moduleWidth of [3, 4, 5, 6, 7, 6, 5, 4, 3, 2]) {
      const changes = code49.normalizeChanges?.(baseObj({ height: h, moduleWidth: 2 }), {
        props: { moduleWidth },
      });
      h = (changes?.props as Partial<Code49Props>).height ?? h;
    }
    expect(h).toBe(60);
  });

  it('respects an incoming height that is already valid for the new moduleWidth', () => {
    const obj = baseObj({ height: 20, moduleWidth: 2 });
    const changes = { props: { moduleWidth: 4, height: 64 } };
    const result = code49.normalizeChanges?.(obj, changes);
    // 64 is at the floor for mw=4 (8*4), keep as-is.
    expect((result?.props as Partial<Code49Props>).height).toBe(64);
  });
});

describe('code49 — commitTransform height clamp on resize drag', () => {
  it('clamps height up when a drag pulls it below the bwip minimum', () => {
    const obj = baseObj({ height: 20, moduleWidth: 2 });
    // Mimic a resize that halves the height and keeps moduleWidth roughly
    // intact. esy = 0.4 → new height ≈ 8 (below mw=2 floor of 16).
    const result = code49.commitTransform?.(obj, {
      sx: 1, sy: 0.4,
      snap: (v) => v,
      nodeHeight: 0,
      anchor: null,
    });
    expect(result?.height).toBeGreaterThanOrEqual(16);
  });

  it('clamps height down when a drag pushes it above the bwip maximum', () => {
    const obj = baseObj({ height: 20, moduleWidth: 2 });
    // esy = 10 → new height ≈ 200 (above mw=2 ceiling of 100).
    const result = code49.commitTransform?.(obj, {
      sx: 1, sy: 10,
      snap: (v) => v,
      nodeHeight: 0,
      anchor: null,
    });
    expect(result?.height).toBeLessThanOrEqual(100);
  });
});

describe('code49 — limited-support preflight', () => {
  // moduleWidth 4 at 8 dpmm = 0.5 mm, above the scannability floor, so the only
  // finding is the standing "not on all printers" warning.
  const ctx: PreflightCtx = { label: { widthMm: 100, heightMm: 50, dpmm: 8 }, unit: 'mm' };

  it('always warns that the symbology is not supported on all printers', () => {
    const findings = code49.preflight?.(baseObj({ moduleWidth: 4 }), ctx) ?? [];
    expect(findings.some((f) => f.kind === 'printerSupportLimited')).toBe(true);
  });
});

describe('code49 — the row stack the reflow drags against', () => {
  // 2 rows at mw 2: 2*40 + 3*2 = 86 dots of bars.
  const start = { rowHeight: 40, nodeHeight: 86 };
  const props = (over: Partial<Code49Props> = {}) => baseObj(over).props;

  it('describes the stack the transformer converts with', () => {
    expect(code49.barStack?.(start, props())).toEqual({ rows: 2, gapDots: 2 });
  });

  it('round-trips an extent through the row height and back', () => {
    const stack = code49.barStack!(start, props());
    const h = stackRowHeightDots(stack, 86);
    expect(h).toBe(40);
    expect(stackExtentDots(stack, h)).toBe(86);
  });

  it('counts rows from the height bwip actually drew, not the raw prop', () => {
    // 20 dots at mw 3 renders at the 8-module floor (24), so an 8-row stack
    // measures 8*24 + 9*3 = 219; the raw prop would imply 9 rows.
    const stack = code49.barStack?.({ rowHeight: 20, nodeHeight: 219 }, props({ moduleWidth: 3 }));
    expect(stack).toEqual({ rows: 8, gapDots: 3 });
  });
});

describe('code49 — commitTransform at identity scale (live-reflow contract)', () => {
  // The barcode live reflow bakes per-tick heights and re-commits them through
  // commitTransform with sx=sy=1 and identity snap: the call clamps into
  // bwip's window and snaps onto the module grid, nothing else.
  const identityCtx = { sx: 1, sy: 1, snap: (v: number) => v, nodeHeight: 0, anchor: null };

  it('clamps an out-of-range baked height at both bounds', () => {
    const low = code49.commitTransform?.(baseObj({ height: 10, moduleWidth: 2 }), identityCtx);
    expect(low?.height).toBe(16);
    const high = code49.commitTransform?.(baseObj({ height: 300, moduleWidth: 2 }), identityCtx);
    expect(high?.height).toBe(100);
  });

  it('snaps height onto the module grid: off-grid values cannot round-trip', () => {
    // h speaks whole multipliers; 40 at mw 3 would emit 13 and re-parse as 39,
    // so state, bytes and model would each hold a different number.
    const commit = code49.commitTransform?.(baseObj({ height: 40, moduleWidth: 3 }), identityCtx);
    expect(commit).toMatchObject({ height: 39 });
    const panel = code49.normalizeChanges?.(baseObj({ moduleWidth: 3 }), { props: { height: 40 } });
    expect((panel?.props as Partial<Code49Props>).height).toBe(39);
  });

  it('passes grid-aligned props through unchanged', () => {
    const result = code49.commitTransform?.(baseObj({ height: 42, moduleWidth: 3 }), identityCtx);
    expect(result).toMatchObject({ height: 42, moduleWidth: 3 });
  });
});

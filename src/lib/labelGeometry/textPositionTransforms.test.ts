import { describe, it, expect } from 'vitest';
import {
  EM_TOP_ABOVE_CAP,
  ZPL_FONT_HEIGHT_TO_CSS_RATIO,
  modelToZplAnchor,
  zplAnchorToModel,
} from '@zplab/core/lib/labelGeometry/textPositionTransforms';

const ROT = ['N', 'R', 'I', 'B'] as const;
const BIAS = 0.08;
const H = 30;
const W = 42;

describe('text position transforms — model ↔ ZPL anchor', () => {
  describe('modelToZplAnchor — FT (baseline)', () => {
    it('shifts Y down by fontHeight - bias under FT/N', () => {
      const r = modelToZplAnchor(100, 200, { fontHeight: H, rotation: 'N' }, 'FT');
      expect(r.x).toBeCloseTo(100);
      expect(r.y).toBeCloseTo(200 + H - H * BIAS);
    });

    it('shifts X left by fontHeight - bias under FT/R', () => {
      const r = modelToZplAnchor(100, 200, { fontHeight: H, rotation: 'R' }, 'FT');
      expect(r.x).toBeCloseTo(100 - H / ZPL_FONT_HEIGHT_TO_CSS_RATIO + H * BIAS);
      expect(r.y).toBeCloseTo(200);
    });

    it('shifts Y up by fontHeight - bias under FT/I', () => {
      const r = modelToZplAnchor(100, 200, { fontHeight: H, rotation: 'I' }, 'FT');
      expect(r.x).toBeCloseTo(100);
      expect(r.y).toBeCloseTo(200 - H / ZPL_FONT_HEIGHT_TO_CSS_RATIO + H * BIAS);
    });

    it('shifts X right by fontHeight - bias under FT/B', () => {
      const r = modelToZplAnchor(100, 200, { fontHeight: H, rotation: 'B' }, 'FT');
      expect(r.x).toBeCloseTo(100 + H / ZPL_FONT_HEIGHT_TO_CSS_RATIO - H * BIAS);
      expect(r.y).toBeCloseTo(200);
    });
  });

  describe('modelToZplAnchor — FO (cap-top)', () => {
    it('FO/N shifts Y down by ascender padding - bias', () => {
      const r = modelToZplAnchor(100, 200, { fontHeight: H, rotation: 'N' }, 'FO');
      expect(r.x).toBeCloseTo(100);
      expect(r.y).toBeCloseTo(200 + H * EM_TOP_ABOVE_CAP - H * BIAS);
    });

    // ^FO documents itself as the top-left of the character field regardless
    // of rotation. After Konva's rotation the pivot lands at a different
    // corner of the rotated bbox per rotation, so the shift must cover both
    // the EM-padding (pad - bias) AND the full h/w jump to the actual top-
    // left of the visible field.
    it('FO/R shifts X left by h + (padding - bias) (no inkWidth needed)', () => {
      const r = modelToZplAnchor(100, 200, { fontHeight: H, rotation: 'R' }, 'FO');
      expect(r.x).toBeCloseTo(
        100 - H / ZPL_FONT_HEIGHT_TO_CSS_RATIO - H * EM_TOP_ABOVE_CAP + H * BIAS,
      );
      expect(r.y).toBeCloseTo(200);
    });

    it('FO/I subtracts inkWidth on X and h + (pad - bias) on Y', () => {
      const r = modelToZplAnchor(100, 200, { fontHeight: H, rotation: 'I' }, 'FO', W);
      expect(r.x).toBeCloseTo(100 - W);
      expect(r.y).toBeCloseTo(
        200 - H / ZPL_FONT_HEIGHT_TO_CSS_RATIO - H * EM_TOP_ABOVE_CAP + H * BIAS,
      );
    });

    it('FO/B shifts X by (pad - bias) and Y up by inkWidth', () => {
      const r = modelToZplAnchor(100, 200, { fontHeight: H, rotation: 'B' }, 'FO', W);
      expect(r.x).toBeCloseTo(100 + H * EM_TOP_ABOVE_CAP - H * BIAS);
      expect(r.y).toBeCloseTo(200 - W);
    });

    it('treats undefined positionType like FO', () => {
      const a = modelToZplAnchor(100, 200, { fontHeight: H, rotation: 'N' }, undefined);
      const b = modelToZplAnchor(100, 200, { fontHeight: H, rotation: 'N' }, 'FO');
      expect(a).toEqual(b);
    });
  });

  describe('FT + ^FB block extent shift (literals pinned to Labelary fixtures)', () => {
    // Anchor (200,200), h=30, spacing=5, 3 lines. modelPos literals
    // verified against tmp/fb_ft_modelpos/ (2026-06-06, ±2 dots).
    const ANCHOR_X = 200;
    const ANCHOR_Y = 200;
    const BLK = 2 * (H + 5);

    it('FT/N block: model.y = 102.4 (above anchor)', () => {
      const r = zplAnchorToModel(ANCHOR_X, ANCHOR_Y,
        { fontHeight: H, rotation: 'N' }, 'FT', 0, BLK);
      expect(r.x).toBeCloseTo(200);
      expect(r.y).toBeCloseTo(102.4);
    });

    it('FT/R block: model.x = 297.6 (right of anchor)', () => {
      const r = zplAnchorToModel(ANCHOR_X, ANCHOR_Y,
        { fontHeight: H, rotation: 'R' }, 'FT', 0, BLK);
      expect(r.x).toBeCloseTo(297.6);
      expect(r.y).toBeCloseTo(200);
    });

    it('FT/I block: model.y = 297.6 (below anchor)', () => {
      const r = zplAnchorToModel(ANCHOR_X, ANCHOR_Y,
        { fontHeight: H, rotation: 'I' }, 'FT', 0, BLK);
      expect(r.x).toBeCloseTo(200);
      expect(r.y).toBeCloseTo(297.6);
    });

    it('FT/B block: model.x = 102.4 (left of anchor)', () => {
      const r = zplAnchorToModel(ANCHOR_X, ANCHOR_Y,
        { fontHeight: H, rotation: 'B' }, 'FT', 0, BLK);
      expect(r.x).toBeCloseTo(102.4);
      expect(r.y).toBeCloseTo(200);
    });

    it('FO applies the block extent on the R/I stacking axis only', () => {
      const axis = { N: null, R: 'x', I: 'y', B: null } as const;
      for (const rotation of ROT) {
        const fo = zplAnchorToModel(ANCHOR_X, ANCHOR_Y,
          { fontHeight: H, rotation }, 'FO', W, BLK);
        const foNoBlk = zplAnchorToModel(ANCHOR_X, ANCHOR_Y,
          { fontHeight: H, rotation }, 'FO', W, 0);
        const shifted = axis[rotation];
        if (!shifted) {
          // N/B stack on the anchor's positive side: no extent shift.
          expect(fo).toEqual(foNoBlk);
        } else {
          // R (x) / I (y) stack negative, so the model shifts by +BLK there.
          expect(fo[shifted]).toBeCloseTo(foNoBlk[shifted] + BLK);
          const other = shifted === 'x' ? 'y' : 'x';
          expect(fo[other]).toBeCloseTo(foNoBlk[other]);
        }
      }
    });
  });

  describe('FO + ^FB reading-axis uses blockWidth, not inkWidth', () => {
    // Labelary: an FO block ends at anchor+blockWidth on the reading axis
    // (I right edge = anchor.x+blockWidth, B bottom edge = anchor.y+blockWidth),
    // whereas a single line ends at anchor+inkWidth.
    const BLOCK_W = 300;
    it('FO/I block: model.x = anchor.x + blockWidth', () => {
      const r = zplAnchorToModel(0, 0, { fontHeight: H, rotation: 'I' }, 'FO', W, 0, BLOCK_W);
      expect(r.x).toBeCloseTo(BLOCK_W);
    });
    it('FO/B block: model.y = anchor.y + blockWidth', () => {
      const r = zplAnchorToModel(0, 0, { fontHeight: H, rotation: 'B' }, 'FO', W, 0, BLOCK_W);
      expect(r.y).toBeCloseTo(BLOCK_W);
    });
    it('single-line FO/I (blockWidth=0) still uses inkWidth', () => {
      const r = zplAnchorToModel(100, 200, { fontHeight: H, rotation: 'I' }, 'FO', W, 0, 0);
      expect(r.x).toBeCloseTo(100 + W);
    });
    it('single-line FO/B (blockWidth=0) still uses inkWidth', () => {
      const r = zplAnchorToModel(100, 200, { fontHeight: H, rotation: 'B' }, 'FO', W, 0, 0);
      expect(r.y).toBeCloseTo(200 + W);
    });
  });

  describe('round-trip', () => {
    for (const rotation of ROT) {
      for (const positionType of ['FO', 'FT', undefined] as const) {
        it(`zplAnchorToModel ∘ modelToZplAnchor = id for ${rotation}/${positionType ?? 'undef'}`, () => {
          const props = { fontHeight: 42, rotation };
          const objX = 123;
          const objY = 456;
          const inkWidth = 87;
          const anchor = modelToZplAnchor(objX, objY, props, positionType, inkWidth);
          const back = zplAnchorToModel(anchor.x, anchor.y, props, positionType, inkWidth);
          expect(back.x).toBeCloseTo(objX);
          expect(back.y).toBeCloseTo(objY);
        });
      }
    }
  });

  describe('device font anchor snap', () => {
    it('off-grid ^A height anchors by the snapped cell, not the request', () => {
      // ^AGN,84 snaps to mag 1 (60): same delta as an exact 60-dot request.
      const offGrid = zplAnchorToModel(100, 100, { fontHeight: 84, rotation: 'N', fontId: 'G' }, 'FO');
      const exact = zplAnchorToModel(100, 100, { fontHeight: 60, rotation: 'N', fontId: 'G' }, 'FO');
      expect(offGrid.y).toBeCloseTo(exact.y);
    });
    it('snapping up mirrors snapping down', () => {
      // 156 rounds to mag 3 (180).
      const up = zplAnchorToModel(100, 100, { fontHeight: 156, rotation: 'N', fontId: 'G' }, 'FO');
      const exact = zplAnchorToModel(100, 100, { fontHeight: 180, rotation: 'N', fontId: 'G' }, 'FO');
      expect(up.y).toBeCloseTo(exact.y);
    });
    it('scalable ids keep the requested height', () => {
      const dev = zplAnchorToModel(100, 100, { fontHeight: 84, rotation: 'N', fontId: '0' }, 'FO');
      const plain = zplAnchorToModel(100, 100, { fontHeight: 84, rotation: 'N' }, 'FO');
      expect(dev.y).toBeCloseTo(plain.y);
    });
    it('round-trips at off-grid heights', () => {
      const props = { fontHeight: 84, rotation: 'N' as const, fontId: 'G' };
      const anchor = modelToZplAnchor(123, 456, props, 'FO');
      const back = zplAnchorToModel(anchor.x, anchor.y, props, 'FO');
      expect(back.x).toBeCloseTo(123);
      expect(back.y).toBeCloseTo(456);
    });
  });
});

import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';

/** 4x4 inch label at 8 dpmm, matching the Labelary fixtures. */
export const INK_CANVAS_PX = 812;

/** White canvas with black fill, the ink convention darkBBox scans for. */
export function inkCanvas(px = INK_CANVAS_PX): { canvas: Canvas; ctx: SKRSContext2D } {
  const canvas = createCanvas(px, px);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = 'black';
  return { canvas, ctx };
}

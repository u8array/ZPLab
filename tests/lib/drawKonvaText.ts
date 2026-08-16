import { konvaBaselineY } from './konvaBaseline';

interface Canvas2dLike {
  font: string;
  textBaseline: string;
  measureText(text: string): TextMetrics;
  fillText(text: string, x: number, y: number): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
}

export interface KonvaTextDraw {
  text: string;
  /** Model-space top-left, device nudges already applied. */
  x: number;
  y: number;
  fontSizePx: number;
  fontFamily: string;
  fontStyle?: string;
  scaleX?: number;
  letterSpacingPx?: number;
}

/** Single copy of the Konva-equivalent placement chain; a
 *  half-replicated variant is how a placement regression slips past
 *  one gate but not another. */
export function drawKonvaText(ctx: Canvas2dLike, d: KonvaTextDraw): void {
  const style = d.fontStyle ? `${d.fontStyle} ` : '';
  ctx.font = `${style}${d.fontSizePx}px "${d.fontFamily}"`;
  ctx.textBaseline = 'alphabetic';
  const baselineY = konvaBaselineY(ctx, d.fontSizePx);
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.scale(d.scaleX ?? 1, 1);
  const spacing = d.letterSpacingPx ?? 0;
  if (spacing === 0) {
    ctx.fillText(d.text, 0, baselineY);
  } else {
    // Konva applies letterSpacing between glyphs; canvas2d fillText has
    // no portable equivalent, so draw per char.
    let x = 0;
    for (const ch of d.text) {
      ctx.fillText(ch, x, baselineY);
      x += ctx.measureText(ch).width + spacing;
    }
  }
  ctx.restore();
}

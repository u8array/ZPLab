import type { CSSProperties } from 'react';

/** A family with spaces or a leading digit needs the quotes, so an inner quote has to go. */
const quoted = (family: string) => `"${family.replace(/["\\]/g, '')}"`;

const WEIGHTS: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  book: 400,
  normal: 400,
  regular: 400,
  medium: 500,
  demibold: 600,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
};

/** The webview resolves an installed family by name, so the preview needs no bytes off disk. */
export function systemFontFaceStyle(font: { family: string; style: string }): CSSProperties {
  const words = font.style.toLowerCase().split(/[\s_-]+/).filter(Boolean);
  // Extra Light is one key and must beat light, so pairs come first.
  const pairs = words.slice(1).map((w, i) => words[i] + w);
  const weight = [...pairs, ...words].find((w) => Object.hasOwn(WEIGHTS, w));
  return {
    fontFamily: quoted(font.family),
    fontWeight: weight === undefined ? undefined : WEIGHTS[weight],
    fontStyle: words.includes('italic') || words.includes('oblique') ? 'italic' : undefined,
  };
}

/** An undefined family means the cache registered no `zpl-<id>` face for these bytes. */
export function cachedFontFaceStyle(family: string | undefined): CSSProperties | undefined {
  return family ? { fontFamily: quoted(family) } : undefined;
}

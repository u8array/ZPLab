import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { DARK_COLORS, LIGHT_COLORS, type CanvasColors } from './useColorScheme';

// Pins the JS copy to index.css, see useColorScheme and project_ticket_theme_token_single_source.
const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8');

/** CanvasColors key -> CSS custom property in index.css. */
const SHARED: Record<string, string> = {
  accent: '--color-accent',
  surface: '--color-surface',
  surface2: '--color-surface-2',
  border: '--color-border',
  muted: '--color-muted',
  error: '--color-error',
};

/** Extract `--color-*: #hex;` declarations from the `{...}` block after the
 *  given selector. Tracks brace depth so a future nested rule or comment
 *  inside the block doesn't truncate the parse at the wrong `}`. */
function blockVars(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`theme block not found: ${selector}`);
  const open = css.indexOf('{', start);
  let depth = 1;
  let i = open + 1;
  for (; depth > 0 && i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
  }
  const body = css.slice(open + 1, i - 1);
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/(--color-[\w-]+):\s*(#[0-9a-fA-F]+)\s*;/g)) {
    const [, name, value] = m;
    if (name && value) vars[name] = value.toLowerCase();
  }
  return vars;
}

const darkCss = blockVars('@theme');
const lightCss = blockVars(':root[data-theme="light"]');

describe('canvas colors mirror the index.css theme tokens', () => {
  for (const [key, cssVar] of Object.entries(SHARED)) {
    it(`dark ${key} == ${cssVar}`, () => {
      expect(DARK_COLORS[key as keyof CanvasColors].toLowerCase()).toBe(darkCss[cssVar]);
    });
    it(`light ${key} == ${cssVar}`, () => {
      expect(LIGHT_COLORS[key as keyof CanvasColors].toLowerCase()).toBe(lightCss[cssVar]);
    });
  }
});

/** WCAG relative luminance from a `#rgb` or `#rrggbb` string. */
function luminance(hex: string): number {
  if (!hex) throw new Error('luminance: missing color (a theme token was renamed or removed?)');
  const full =
    hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const ch = [1, 3, 5].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// `--color-muted` is secondary text; it must clear WCAG AA (4.5:1) on every
// surface it renders on. surface-2 is the lightest dark surface (worst case),
// so a token that passes there passes on bg/surface too. This is what caught
// #8a8a8a (4.27:1 on #282828) and forced #8f8f8f.
describe('muted text meets WCAG AA on its backgrounds', () => {
  for (const bg of ['--color-bg', '--color-surface', '--color-surface-2'] as const) {
    it(`dark muted on ${bg}`, () => {
      expect(contrast(darkCss['--color-muted']!, darkCss[bg]!)).toBeGreaterThanOrEqual(4.5);
    });
    it(`light muted on ${bg}`, () => {
      expect(contrast(lightCss['--color-muted']!, lightCss[bg]!)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

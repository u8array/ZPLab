import { useLabelStore } from '../store/labelStore';

/** Warning orange for canvas "needs attention" overlays (fallback tint,
 *  unconfigured-field placeholders). Theme-independent and readable on both
 *  schemes; not a CanvasColors member because index.css carries no
 *  counterpart token yet (theme-token SSOT ticket). */
export const CANVAS_WARNING = '#fb923c';

export interface CanvasColors {
  canvasBg: string;
  canvasDot: string;
  gridLine: string;
  gridSub: string;
  rulerBg: string;
  rulerCorner: string;
  rulerMajorTick: string;
  rulerMinorTick: string;
  rulerLabel: string;
  rulerSeparator: string;
  /** Selection stroke / handle colour for shapes and the Konva Transformer.
   *  Distinct from the UI accent (amber) on purpose; design tools follow
   *  a blue-ish convention here (Figma, Sketch, Illustrator) to keep
   *  contrast usable across the B/W shape colour space. */
  selection: string;
  /** UI accent (amber). Used for non-selection design-affordance overlays
   *  on the canvas; e.g. the ^FB wrap-guide line so the user can tell
   *  it apart from selection/transformer chrome. */
  accent: string;
  /** Panel surface / muted text / hairline / destructive, mirroring the DOM theme
   *  tokens in index.css. index.css is the source of truth, Konva can't read CSS
   *  variables and jsdom can't resolve them in tests, hence the JS copy. */
  surface: string;
  surface2: string;
  border: string;
  muted: string;
  error: string;
}

export const DARK_COLORS: CanvasColors = {
  canvasBg:       '#222222',
  canvasDot:      '#2c2c2c',
  gridLine:       '#bebebe',
  gridSub:        '#d8d8d8',
  rulerBg:        '#161616',
  rulerCorner:    '#111111',
  rulerMajorTick: '#b0b0b0',
  rulerMinorTick: '#686868',
  rulerLabel:     '#cccccc',
  rulerSeparator: '#2a2a2a',
  selection:      '#6366f1',
  accent:         '#f59e0b',
  surface:        '#1f1f1f',
  surface2:       '#282828',
  border:         '#333333',
  muted:          '#8f8f8f',
  error:          '#ef4444',
};

export const LIGHT_COLORS: CanvasColors = {
  canvasBg:       '#e4e4e7',
  canvasDot:      '#dcdce0',
  gridLine:       '#a1a1aa',
  gridSub:        '#d4d4d8',
  rulerBg:        '#f4f4f5',
  rulerCorner:    '#e4e4e7',
  rulerMajorTick: '#3f3f46',
  rulerMinorTick: '#71717a',
  rulerLabel:     '#27272a',
  rulerSeparator: '#d4d4d8',
  selection:      '#6366f1',
  accent:         '#d97706',
  surface:        '#fafafa',
  surface2:       '#f4f4f5',
  border:         '#d4d4d8',
  muted:          '#52525b',
  error:          '#b91c1c',
};

export function useColorScheme(): CanvasColors {
  const theme = useLabelStore((s) => s.theme);
  return theme === 'dark' ? DARK_COLORS : LIGHT_COLORS;
}

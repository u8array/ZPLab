import { z } from 'zod';
import { YES_NO_VALUES, intInRange, makeEnumGuard } from './typeHelpers';

/** Two row shapes: uploaded font (path + optional preview, bytes in cache)
 *  or manual printer-resident reference (path only, no bytes). Empty strings
 *  allowed for in-progress UI rows; completeness enforced at zplGenerator
 *  emit-time. Path-less rows are legacy (removed built-in-preview feature) and
 *  are scrubbed at load by dropLegacyFontBindings. */
export const customFontMappingSchema = z
  .object({
    alias: z.string().regex(/^[A-Z0-9]$/),
    path: z.string().optional(),
    previewFontName: z.string().optional(),
    embedInZpl: z.boolean().optional(),
  })
  .refine((m) => !m.embedInZpl || (!!m.path && !!m.previewFontName), {
    message:
      "embedInZpl requires both a printer path (~DY target) and a preview TTF (~DY bytes)",
  });
export type CustomFontMapping = z.infer<typeof customFontMappingSchema>;

export const MEDIA_TRACKING_VALUES = ['N', 'Y', 'W', 'M', 'A'] as const;
export type MediaTracking = (typeof MEDIA_TRACKING_VALUES)[number];

/** ^MF: F=Feed, C=Calibration, L=Length, N=No motion, S=Short calibration. */
export const MEDIA_FEED_VALUES = ['F', 'C', 'L', 'N', 'S'] as const;
export type MediaFeedMode = (typeof MEDIA_FEED_VALUES)[number];

export const isMediaTracking = makeEnumGuard(MEDIA_TRACKING_VALUES);
export const isMediaFeedMode = makeEnumGuard(MEDIA_FEED_VALUES);

/** ~JS backfeed sequence: A=100% after, B=before next label, N=normal,
 *  O=off, or percent-after in tens (printer rounds to the nearest ten, p276). */
export const BACKFEED_SEQUENCE_VALUES = ['A', 'B', 'N', 'O'] as const;
export type BackfeedSequence = (typeof BACKFEED_SEQUENCE_VALUES)[number];
export const isBackfeedSequence = makeEnumGuard(BACKFEED_SEQUENCE_VALUES);
export const BACKFEED_PERCENT_VALUES = [10, 20, 30, 40, 50, 60, 70, 80, 90] as const;
export type BackfeedPercent = (typeof BACKFEED_PERCENT_VALUES)[number];
export const isBackfeedPercent = (n: number): n is BackfeedPercent =>
  (BACKFEED_PERCENT_VALUES as readonly number[]).includes(n);

/** ^MM print mode (per-label cut/peel/tear behaviour). */
export const MEDIA_MODE_VALUES = ['T', 'V', 'D', 'K'] as const;
export type MediaMode = (typeof MEDIA_MODE_VALUES)[number];
export const isMediaMode = makeEnumGuard(MEDIA_MODE_VALUES);

/** ^MT media type. T=thermal transfer, D=direct thermal. */
export const MEDIA_TYPE_VALUES = ['T', 'D'] as const;
export type MediaType = (typeof MEDIA_TYPE_VALUES)[number];
export const isMediaType = makeEnumGuard(MEDIA_TYPE_VALUES);

/** ^PO print orientation. N=normal, I=inverted (180°). */
export const PRINT_ORIENTATION_VALUES = ['N', 'I'] as const;
export type PrintOrientation = (typeof PRINT_ORIENTATION_VALUES)[number];
export const isPrintOrientation = makeEnumGuard(PRINT_ORIENTATION_VALUES);

/** ^JM: B halves the print density, so every stream dot value lives in the
 *  halved scale; A restores full density. Model dots stay as-stream, the
 *  effectiveDpmm seam applies the interpretation. */
export const JM_DENSITY_VALUES = ['A', 'B'] as const;
export type JmDensity = (typeof JM_DENSITY_VALUES)[number];
export const isJmDensity = makeEnumGuard(JM_DENSITY_VALUES);

/** Density a `^JM` parameter tail declares, or undefined if invalid. Shared by
 *  parser and export so both agree where the value ends; `raw` runs to the next
 *  command, carrying further slots and the line break of multi-line ZPL. */
export function jmDensityOf(raw: string, delimiter: string): JmDensity | undefined {
  const v = (raw.split(delimiter)[0] ?? '').trim().toUpperCase();
  // A bare ^JM is full density (spec p269).
  if (v === '') return 'A';
  return isJmDensity(v) ? v : undefined;
}

/** The density dot values are interpreted in: head density, halved under ^JMB.
 *  Every mm<->dots and dots<->px boundary must use this instead of raw dpmm;
 *  exceptions are physical head selectors (Labelary URL, rescale) and the printer-preview raster. */
export function effectiveDpmm(label: { dpmm: number; jmDensity?: JmDensity }): number {
  return label.jmDensity === 'B' ? label.dpmm / 2 : label.dpmm;
}

/** The label under a per-page density override. Returns `label` itself when the
 *  override is absent or already the label's, so callers can memo on identity. */
export function withJmDensity(label: LabelConfig, jmDensity: JmDensity | undefined): LabelConfig {
  return jmDensity === undefined || jmDensity === label.jmDensity ? label : { ...label, jmDensity };
}

/** Print densities Zebra ships (152/203/300/600 dpi). The label settings UI
 *  offers exactly these; the ZPL geometry sidecar validates against the set. */
export const DPMM_VALUES = [6, 8, 12, 24] as const;
export type Dpmm = (typeof DPMM_VALUES)[number];
export const isDpmm = (n: number): n is Dpmm =>
  (DPMM_VALUES as readonly number[]).includes(n);

/** Numeric ranges shared between Zod schema, parser clamps and UI inputs. */
export const SPEED_RANGE = { min: 2, max: 14 } as const;
export const DARKNESS_PERMANENT_RANGE = { min: -30, max: 30 } as const;
export const DARKNESS_INSTANT_RANGE = { min: 0, max: 30 } as const;
/** ^ML: maximum label length, in dots. Zebra spec accepts 1..32000. */
export const MAX_LABEL_LENGTH_RANGE = { min: 1, max: 32000 } as const;
export const SLEW_DOT_ROWS_RANGE = { min: 0, max: 32000 } as const;
/** ^LT y range (Zebra -120..+120); shared with the density rescale clamp. */
export const LABEL_TOP_RANGE = { min: -120, max: 120 } as const;

/** ^MU b,c dpi tokens; 200 = 203 dpi; ratio drives resampling. */
export const MU_DPI_VALUES = [150, 200, 300, 600] as const;
export type MuDpi = (typeof MU_DPI_VALUES)[number];
export const isMuDpi = (n: number): n is MuDpi =>
  (MU_DPI_VALUES as readonly number[]).includes(n);
const muDpiSchema = z.number().refine(isMuDpi);

/** ^MU b,c; both-or-neither (no meaningful ratio with half-set). */
export const muResamplingSchema = z.object({
  formatDpi: muDpiSchema,
  outputDpi: muDpiSchema,
});
export type MuResampling = z.infer<typeof muResamplingSchema>;

/** Setting one slot seeds the other from it, keeping both-or-neither. */
export function composeMuResampling(
  current: MuResampling | undefined,
  slot: keyof MuResampling,
  dpi: MuDpi,
): MuResampling {
  return {
    formatDpi: slot === 'formatDpi' ? dpi : current?.formatDpi ?? dpi,
    outputDpi: slot === 'outputDpi' ? dpi : current?.outputDpi ?? dpi,
  };
}

/** ^SO offset slots; mirrors the b,c,d,e,f,g wire-format order. All
 *  fields signed; omitted = 0. Schema-natural order in our type is
 *  years/months/days/hours/minutes/seconds; the parser/generator
 *  swaps to wire order (months,days,years,...) at the boundary.
 *  Caps stay inside Int32 so firmware parsers don't reject the wire. */
const INT32_MAX = 2_147_483_647;
export const clockOffsetSchema = z.object({
  years: z.number().int().min(-100).max(100).optional(),
  months: z.number().int().min(-1200).max(1200).optional(),
  days: z.number().int().min(-36500).max(36500).optional(),
  hours: z.number().int().min(-876000).max(876000).optional(),
  minutes: z.number().int().min(-52560000).max(52560000).optional(),
  seconds: z.number().int().min(-INT32_MAX).max(INT32_MAX).optional(),
}).refine(
  (o) => !clockOffsetIsEmpty(o),
  { message: "at least one slot must be non-zero" },
);
export type ClockOffset = z.infer<typeof clockOffsetSchema>;

/** True when every slot is undefined or 0. */
export function clockOffsetIsEmpty(o: Record<string, number | undefined>): boolean {
  return !Object.values(o).some((x) => x !== undefined && x !== 0);
}

/** Empty / all-zero offsets become undefined so the refine doesn't
 *  reject the whole label. */
function coerceEmptyOffset(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  return clockOffsetIsEmpty(v as Record<string, number | undefined>) ? undefined : v;
}

/** New Date with offset applied via native setters (handles month /
 *  year / DST rollover). Undefined offset returns d verbatim. */
export function applyClockOffset(d: Date, offset: ClockOffset | undefined): Date {
  if (!offset) return d;
  const next = new Date(d);
  if (offset.years) next.setFullYear(next.getFullYear() + offset.years);
  if (offset.months) next.setMonth(next.getMonth() + offset.months);
  if (offset.days) next.setDate(next.getDate() + offset.days);
  if (offset.hours) next.setHours(next.getHours() + offset.hours);
  if (offset.minutes) next.setMinutes(next.getMinutes() + offset.minutes);
  if (offset.seconds) next.setSeconds(next.getSeconds() + offset.seconds);
  return next;
}

export const labelConfigSchema = z.object({
  widthMm: z.number(),
  heightMm: z.number(),
  dpmm: z.number(),
  /** Design-time safe-area inset (mm) from every edge. Drives the align/pin
   *  reference rect and a canvas guide; optional so older designs stay valid. */
  safeAreaMm: z.number().min(0).optional(),
  /** Emit x,y,1 (^FO/^FT) for right-justified 1D barcodes so the PRINTER
   *  anchors the right edge (variable data stays pinned). ZD230-verified;
   *  needs V50.14/V60.14+, older firmware would misplace x, hence opt-in. */
  emit1dZJustify: z.boolean().optional(),
  printQuantity: z.number().optional(),
  /** ^PQ p2: pause every N labels (0 = none). */
  pauseCount: z.number().int().min(0).max(99999999).optional(),
  /** ^PQ p3: replicates of each serialised label. */
  replicates: z.number().int().min(0).max(99999999).optional(),
  /** ^PQ p4: override pause count (cutter behaviour). */
  overridePauseCount: z.enum(YES_NO_VALUES).optional(),
  mediaMode: z.enum(MEDIA_MODE_VALUES).optional(),
  labelShift: z.number().optional(),
  /** ^LH x; field FOs shifted at export so screen == print. */
  labelHomeX: z.number().int().min(0).optional(),
  /** ^LH y; see labelHomeX. */
  labelHomeY: z.number().int().min(0).optional(),
  /** ^LT y; Zebra -120..+120. */
  labelTop: intInRange(LABEL_TOP_RANGE).optional(),
  printSpeed: intInRange(SPEED_RANGE).optional(),
  /** ^PR p2: slew (inter-label) speed. */
  slewSpeed: intInRange(SPEED_RANGE).optional(),
  /** ^PR p3: backfeed speed. */
  backfeedSpeed: intInRange(SPEED_RANGE).optional(),
  darkness: intInRange(DARKNESS_PERMANENT_RANGE).optional(),
  /** ~SD: instant darkness set, emitted before ^XA. 0-30. */
  instantDarkness: intInRange(DARKNESS_INSTANT_RANGE).optional(),
  mediaType: z.enum(MEDIA_TYPE_VALUES).optional(),
  printOrientation: z.enum(PRINT_ORIENTATION_VALUES).optional(),
  /** ^PM: mirror image (left/right flip). */
  mirror: z.enum(YES_NO_VALUES).optional(),
  defaultFontId: z.string().min(1).optional(),
  defaultFontHeight: z.number().int().positive().optional(),
  /** ^CF width param. Spec allows 0 → printer auto-derives from height. */
  defaultFontWidth: z.number().int().min(0).optional(),
  /** ^CW alias→path mappings emitted at the top of the label. */
  customFonts: z.array(customFontMappingSchema).optional(),
  /** ^MN: media tracking. */
  mediaTracking: z.enum(MEDIA_TRACKING_VALUES).optional(),
  /** ^ML: maximum label length, in dots. */
  maxLabelLength: intInRange(MAX_LABEL_LENGTH_RANGE).optional(),
  /** ^MF p1: feed action at power-up. */
  mediaFeedPowerUp: z.enum(MEDIA_FEED_VALUES).optional(),
  /** ^MF p2: feed action after head-close (same enum). */
  mediaFeedHeadClose: z.enum(MEDIA_FEED_VALUES).optional(),
  /** ^XB: suppress backfeed for the next label. Standalone toggle. */
  suppressBackfeed: z.boolean().optional(),
  /** ~JS: backfeed sequence. Immediate/transient, emitted before ^XA. */
  backfeedSequence: z
    .union([z.enum(BACKFEED_SEQUENCE_VALUES), z.number().refine(isBackfeedPercent)])
    .optional(),
  /** ^MU b,c; set only when both slots arrived valid. */
  muResampling: muResamplingSchema.optional(),
  /** ^JM: dot-density interpretation of this design's dot values. */
  jmDensity: z.enum(JM_DENSITY_VALUES).optional(),
  /** ^SO2: secondary clock offset (`«clock2:T»` markers resolve through this). */
  secondaryClockOffset: z.preprocess(coerceEmptyOffset, clockOffsetSchema.optional()),
  /** ^SO3: tertiary clock offset (`«clock3:T»` markers resolve through this). */
  tertiaryClockOffset: z.preprocess(coerceEmptyOffset, clockOffsetSchema.optional()),
  /** ^MC: N retains the bitmap as background of subsequent labels. */
  mapClear: z.enum(YES_NO_VALUES).optional(),
  /** ^PF: slew this many dot rows instead of printing blank bottom area. */
  slewDotRows: intInRange(SLEW_DOT_ROWS_RANGE).optional(),
  /** ^PH: feed one blank label after the format prints. */
  slewToHome: z.boolean().optional(),
  /** ^PP: pause after the format prints (until PAUSE or ~PS). */
  programmablePause: z.boolean().optional(),
});

export type LabelConfig = z.infer<typeof labelConfigSchema>;

declare const pageResolved: unique symbol;

/** A LabelConfig resolved against one page's ^JM override (phantom brand,
 *  compile-time only). Editor geometry and single-page emit demand it, so a
 *  raw design label cannot reach a dots<->mm boundary on a diverging page.
 *  Consumer-side only: a helper declared with a plain LabelConfig param
 *  still accepts a design label unchecked. */
export type PageLabel = LabelConfig & { readonly [pageResolved]: true };

/** Assert a label is already page-resolved, for the two spots the type cannot
 *  prove it: an absent override (design label == page label) and a public entry
 *  whose caller owns the page scope. Every use must say which at the call site. */
export const designAsPageLabel = (label: LabelConfig): PageLabel => label as PageLabel;

/** Fields holding a plain number, the only ones a density rescale may scale. */
export type NumericLabelConfigField = {
  [K in keyof LabelConfig]-?: NonNullable<LabelConfig[K]> extends number ? K : never;
}[keyof LabelConfig];

export interface LabelConfigFieldSpec {
  /** perLabel = print override `resetPerLabelConfig` clears back to unset;
   *  design = geometry or document state a reset must keep. */
  scope: 'design' | 'perLabel';
  /** A change reaches the emitted ZPL. false = design-time editor aid, so a
   *  patch touching only such fields keeps a page overlay's bytes valid. */
  emits: boolean;
  /** `always` = layout dots, scaled on a dpmm swap and on ^JM; `jmOnly` =
   *  printer-persistent dots that keep their value across a head swap but are
   *  reinterpreted by ^JM; `never` = physical head dots and non-dot values. */
  scales: 'never' | 'always' | 'jmOnly';
  /** The import fold keeps this inside its own ^XA block instead of letting it
   *  fall through to later blocks. Orthogonal to `scope`. */
  perFormat?: true;
  /** Spec bounds the scaled value is clamped into. */
  clamp?: { readonly min: number; readonly max: number };
  /** Post-scale floor. */
  floor?: number;
}

/** Non-numeric fields cannot scale, so the table may not claim they do. */
type SpecFor<K extends keyof LabelConfig> = K extends NumericLabelConfigField
  ? LabelConfigFieldSpec
  : LabelConfigFieldSpec & { scales: 'never' };

/** One row per LabelConfig field (scope, emits, scale); every consumer derives
 *  from here. The satisfies `-?` is load-bearing: LabelConfig's keys are
 *  optional, so without it the mapped type would accept a table omitting a field. */
export const LABEL_CONFIG_FIELDS = {
  widthMm: { scope: 'design', emits: true, scales: 'never' },
  heightMm: { scope: 'design', emits: true, scales: 'never' },
  // Design geometry: clearing or rescaling it would reinterpret every stored
  // dot value, so it is neither a per-label override nor itself scaled.
  dpmm: { scope: 'design', emits: true, scales: 'never' },
  safeAreaMm: { scope: 'design', emits: false, scales: 'never' },
  emit1dZJustify: { scope: 'design', emits: true, scales: 'never' },
  printQuantity: { scope: 'perLabel', emits: true, scales: 'never', perFormat: true },
  pauseCount: { scope: 'perLabel', emits: true, scales: 'never', perFormat: true },
  replicates: { scope: 'perLabel', emits: true, scales: 'never', perFormat: true },
  overridePauseCount: { scope: 'perLabel', emits: true, scales: 'never', perFormat: true },
  mediaMode: { scope: 'perLabel', emits: true, scales: 'never' },
  labelShift: { scope: 'perLabel', emits: true, scales: 'jmOnly' },
  labelHomeX: { scope: 'perLabel', emits: true, scales: 'always', floor: 0 },
  labelHomeY: { scope: 'perLabel', emits: true, scales: 'always', floor: 0 },
  labelTop: { scope: 'perLabel', emits: true, scales: 'jmOnly', clamp: LABEL_TOP_RANGE },
  printSpeed: { scope: 'perLabel', emits: true, scales: 'never' },
  slewSpeed: { scope: 'perLabel', emits: true, scales: 'never' },
  backfeedSpeed: { scope: 'perLabel', emits: true, scales: 'never' },
  darkness: { scope: 'perLabel', emits: true, scales: 'never' },
  instantDarkness: { scope: 'perLabel', emits: true, scales: 'never' },
  mediaType: { scope: 'perLabel', emits: true, scales: 'never' },
  printOrientation: { scope: 'perLabel', emits: true, scales: 'never' },
  mirror: { scope: 'perLabel', emits: true, scales: 'never' },
  defaultFontId: { scope: 'design', emits: true, scales: 'never' },
  defaultFontHeight: { scope: 'design', emits: true, scales: 'always', floor: 1 },
  defaultFontWidth: { scope: 'design', emits: true, scales: 'always', floor: 0 },
  customFonts: { scope: 'design', emits: true, scales: 'never' },
  mediaTracking: { scope: 'perLabel', emits: true, scales: 'never' },
  // ZD230-verified physical head dots, so a density change leaves them alone.
  maxLabelLength: { scope: 'perLabel', emits: true, scales: 'never' },
  mediaFeedPowerUp: { scope: 'perLabel', emits: true, scales: 'never' },
  mediaFeedHeadClose: { scope: 'perLabel', emits: true, scales: 'never' },
  suppressBackfeed: { scope: 'perLabel', emits: true, scales: 'never' },
  backfeedSequence: { scope: 'perLabel', emits: true, scales: 'never' },
  muResampling: { scope: 'design', emits: true, scales: 'never' },
  // Persists on the wire, but folding it back would retroactively rescale
  // earlier pages, so each page's own labelConfig carries it.
  jmDensity: { scope: 'design', emits: true, scales: 'never', perFormat: true },
  secondaryClockOffset: { scope: 'design', emits: true, scales: 'never' },
  tertiaryClockOffset: { scope: 'design', emits: true, scales: 'never' },
  // Persists on the wire; folding it back would bleed the bitmap into earlier
  // pages under ^MCN.
  mapClear: { scope: 'perLabel', emits: true, scales: 'never', perFormat: true },
  slewDotRows: { scope: 'perLabel', emits: true, scales: 'jmOnly', perFormat: true, clamp: SLEW_DOT_ROWS_RANGE },
  slewToHome: { scope: 'perLabel', emits: true, scales: 'never', perFormat: true },
  programmablePause: { scope: 'perLabel', emits: true, scales: 'never', perFormat: true },
} as const satisfies { [K in keyof LabelConfig]-?: SpecFor<K> };

const FIELD_ENTRIES = Object.entries(LABEL_CONFIG_FIELDS) as [
  keyof LabelConfig,
  LabelConfigFieldSpec,
][];

const fieldsWhere = (
  pred: (spec: LabelConfigFieldSpec) => boolean,
): readonly (keyof LabelConfig)[] =>
  FIELD_ENTRIES.filter(([, spec]) => pred(spec)).map(([key]) => key);

/** Widened row lookup; the literal-typed table itself cannot be indexed by a
 *  key union because the optional axes differ per row. */
export const labelConfigSpec = (key: keyof LabelConfig): LabelConfigFieldSpec =>
  LABEL_CONFIG_FIELDS[key];

/** Numeric fields a density rescale scales in the given mode. */
export const scaledLabelConfigFields = (
  mode: 'always' | 'jmOnly',
): readonly NumericLabelConfigField[] =>
  FIELD_ENTRIES.filter(([, spec]) => spec.scales === mode).map(
    ([key]) => key as NumericLabelConfigField,
  );

/** Per-label ZPL overrides the printer-modal perLabel tabs edit; the store's
 *  `resetPerLabelConfig` clears exactly these back to unset (= printer default,
 *  not emitted). */
export const PER_LABEL_ZPL_FIELDS = fieldsWhere((s) => s.scope === 'perLabel');

/** Fields the import fold scopes to their own ^XA block; the rest is
 *  persistent state a later block may extend. */
export const PER_FORMAT_ZPL_FIELDS = fieldsWhere((s) => s.perFormat === true);

/** Config keys that never reach emitted ZPL. */
export const NON_EMITTING_CONFIG_FIELDS = fieldsWhere((s) => !s.emits);

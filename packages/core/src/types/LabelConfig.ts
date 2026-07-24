import { z } from 'zod';
import { intInRange, makeEnumGuard } from './typeHelpers';

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
 *  O=off. Percent forms 10-90 are not modeled (param-fidelity limit). */
export const BACKFEED_SEQUENCE_VALUES = ['A', 'B', 'N', 'O'] as const;
export type BackfeedSequence = (typeof BACKFEED_SEQUENCE_VALUES)[number];
export const isBackfeedSequence = makeEnumGuard(BACKFEED_SEQUENCE_VALUES);

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
  /** Emit ^FT x,y,1 for right-justified 1D barcodes so the PRINTER anchors the
   *  right edge (variable data stays pinned). Requires firmware V50.14/V60.14+;
   *  older firmware ignores z and would misplace the shifted x, hence opt-in. */
  emit1dZJustify: z.boolean().optional(),
  printQuantity: z.number().optional(),
  /** ^PQ p2: pause every N labels (0 = none). */
  pauseCount: z.number().int().min(0).max(99999999).optional(),
  /** ^PQ p3: replicates of each serialised label. */
  replicates: z.number().int().min(0).max(99999999).optional(),
  /** ^PQ p4: override pause count (cutter behaviour). */
  overridePauseCount: z.enum(['Y', 'N']).optional(),
  mediaMode: z.enum(MEDIA_MODE_VALUES).optional(),
  labelShift: z.number().optional(),
  /** ^LH x; field FOs shifted at export so screen == print. */
  labelHomeX: z.number().int().min(0).optional(),
  /** ^LH y; see labelHomeX. */
  labelHomeY: z.number().int().min(0).optional(),
  /** ^LT y; Zebra -120..+120. */
  labelTop: z.number().int().min(-120).max(120).optional(),
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
  mirror: z.enum(['Y', 'N']).optional(),
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
  backfeedSequence: z.enum(BACKFEED_SEQUENCE_VALUES).optional(),
  /** ^MU b,c; set only when both slots arrived valid. */
  muResampling: muResamplingSchema.optional(),
  /** ^SO2: secondary clock offset (`«clock2:T»` markers resolve through this). */
  secondaryClockOffset: z.preprocess(coerceEmptyOffset, clockOffsetSchema.optional()),
  /** ^SO3: tertiary clock offset (`«clock3:T»` markers resolve through this). */
  tertiaryClockOffset: z.preprocess(coerceEmptyOffset, clockOffsetSchema.optional()),
});

export type LabelConfig = z.infer<typeof labelConfigSchema>;

/** Per-label ZPL overrides the printer-modal perLabel tabs edit; the store's
 *  `resetPerLabelConfig` clears exactly these back to unset (= printer default,
 *  not emitted). Design-time fields (size, dpmm, fonts) are not print overrides.
 *  Lives here so the `keyof LabelConfig` check sits next to the schema, and a
 *  leaf-module home keeps the slice and selectors that read it cycle-free. */
export const PER_LABEL_ZPL_FIELDS = [
  'mediaMode', 'mediaType', 'mediaTracking', 'maxLabelLength',
  'mediaFeedPowerUp', 'mediaFeedHeadClose', 'suppressBackfeed', 'backfeedSequence',
  'printOrientation', 'mirror', 'printSpeed', 'slewSpeed', 'backfeedSpeed',
  'darkness', 'instantDarkness',
  'labelHomeX', 'labelHomeY', 'labelTop', 'labelShift',
  'printQuantity', 'pauseCount', 'replicates', 'overridePauseCount',
] as const satisfies readonly (keyof LabelConfig)[];

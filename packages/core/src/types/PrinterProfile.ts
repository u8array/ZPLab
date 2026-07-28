import { z } from 'zod';
import { YES_NO_VALUES, intInRange, makeEnumGuard } from './typeHelpers';

/** ^ST real-time clock value (HTML5 datetime-local shape). */
export const realtimeClockIsoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/** ^KN printer-name length cap per Zebra spec (16 characters). */
export const PRINTER_NAME_MAX_LEN = 16;

/** ZPL command introducers, positional delimiter, newlines, control codes. */
// String-based class so the no-control-regex rule does not fire.
const SETUP_SCRIPT_UNSAFE_CHARS = '\\^~,\\r\\n\\x00-\\x1f';
export const setupScriptSafeStringRegex = new RegExp(`^[^${SETUP_SCRIPT_UNSAFE_CHARS}]+$`);
/** Like setupScriptSafeStringRegex but accepts empty strings for editor drafts. */
export const setupScriptOptionalSafeStringRegex = new RegExp(`^[^${SETUP_SCRIPT_UNSAFE_CHARS}]*$`);
/** No `g` flag so `.test()` callers don't carry `lastIndex` state. */
export const setupScriptUnsafeCharRegex = new RegExp(`[${SETUP_SCRIPT_UNSAFE_CHARS}]`);
const setupScriptUnsafeCharGlobalRegex = new RegExp(`[${SETUP_SCRIPT_UNSAFE_CHARS}]`, 'g');
/** Strip unsafe chars; UI inputs go through this so paste-with-comma
 *  doesn't trigger silent schema-rollback (frozen-field UX). */
export const stripUnsafeChars = (raw: string): string =>
  raw.replace(setupScriptUnsafeCharGlobalRegex, '');

/** ^KL printer locale; two-letter ISO 639-1 shorthands per Zebra spec. */
export const PRINTER_LOCALE_VALUES = [
  'EN', 'ES', 'FR', 'DE', 'IT', 'NO', 'PT', 'SV', 'DK', 'SP2', 'NL', 'FI', 'JP', 'KR', 'SC', 'TC', 'RU', 'PL', 'CZ', 'RO', 'HU',
] as const;
export type PrinterLocale = (typeof PRINTER_LOCALE_VALUES)[number];
export const isPrinterLocale = makeEnumGuard(PRINTER_LOCALE_VALUES);

/** ^SZ ZPL mode selector. `2` = ZPL II, `1` = legacy. */
export const ZPL_MODE_VALUES = ['1', '2'] as const;
export type ZplMode = (typeof ZPL_MODE_VALUES)[number];
export const isZplMode = makeEnumGuard(ZPL_MODE_VALUES);

/** ^SL: S=Start-Time, T=Time-Now, TOL=Time-Now with tolerance window. */
export const CLOCK_MODE_VALUES = ['S', 'T', 'TOL'] as const;
export type ClockMode = (typeof CLOCK_MODE_VALUES)[number];
export const isClockMode = makeEnumGuard(CLOCK_MODE_VALUES);

/** ^SL tolerance (seconds) when `clockMode === 'TOL'`. */
export const CLOCK_TOLERANCE_RANGE = { min: 1, max: 999 } as const;
/** UX default seeded when the user picks TOL mode. Matches `^SL60,1` spec example. */
export const CLOCK_TOLERANCE_DEFAULT = 60;

/** ^SL clock-language codes. Numeric 1..13 per spec; stored as digit chars. */
export const CLOCK_LANGUAGE_VALUES = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13',
] as const;
export type ClockLanguage = (typeof CLOCK_LANGUAGE_VALUES)[number];
export const isClockLanguage = makeEnumGuard(CLOCK_LANGUAGE_VALUES);

/** ^KD clock-print format. 0=disabled, 1=MM/DD/YY 24h, 2=MM/DD/YY 12h AM/PM, 3=DD/MM/YY 24h. */
export const CLOCK_FORMAT_VALUES = ['0', '1', '2', '3'] as const;
export type ClockFormat = (typeof CLOCK_FORMAT_VALUES)[number];
export const isClockFormat = makeEnumGuard(CLOCK_FORMAT_VALUES);

export const HEAD_TEST_INTERVAL_RANGE = { min: 0, max: 10000 } as const;

/** ^CO b: additional cache memory in KB. */
export const FONT_CACHE_KB_RANGE = { min: 1, max: 9999 } as const;
/** ^CO c: 0 = normal cache buffer, 1 = internal (Asian fonts). */
export const FONT_CACHE_TYPE_VALUES = ['0', '1'] as const;
export const isFontCacheType = makeEnumGuard(FONT_CACHE_TYPE_VALUES);
/** ^MP one-letter modes; E (enable all) clears the protection set. */
export const MODE_PROTECTION_VALUES = ['D', 'P', 'C', 'S', 'W', 'F', 'X', 'M'] as const;
export type ModeProtection = (typeof MODE_PROTECTION_VALUES)[number];
export const isModeProtection = makeEnumGuard(MODE_PROTECTION_VALUES);

/** Only reachable in the UI's Custom mode, where the set is always defined:
 *  [] is the visible "protect nothing" state that emits the explicit ^MPE. */
export function toggleModeProtection(
  current: readonly ModeProtection[] | undefined,
  mode: ModeProtection,
  on: boolean,
): ModeProtection[] {
  const set = new Set(current ?? []);
  if (on) set.add(mode);
  else set.delete(mode);
  return MODE_PROTECTION_VALUES.filter((v) => set.has(v));
}
export const TEAR_OFF_ADJUST_RANGE = { min: -120, max: 120 } as const;

/** ^KP 4-digit; '0000' disables LCD-setup protection. */
export const PRINTER_PASSWORD_REGEX = /^\d{4}$/;

/** ^JU: S=save, R=recall, N=factory net reset, F=factory reset. */
export const CONFIG_UPDATE_VALUES = ['S', 'R', 'N', 'F'] as const;
export type ConfigUpdateAction = (typeof CONFIG_UPDATE_VALUES)[number];
export const isConfigUpdateAction = makeEnumGuard(CONFIG_UPDATE_VALUES);

/** ^MA/^MI alert type. R=head replacement, C=head cleaning per spec. */
export const MAINTENANCE_ALERT_TYPES = ['R', 'C'] as const;
export type MaintenanceAlertType = (typeof MAINTENANCE_ALERT_TYPES)[number];
export const isMaintenanceAlertType = makeEnumGuard(MAINTENANCE_ALERT_TYPES);

/** ^MA print slot: Y=emit warning label, N=skip. */
export const MAINTENANCE_ALERT_PRINT_VALUES = ['Y', 'N'] as const;
export type MaintenanceAlertPrint = (typeof MAINTENANCE_ALERT_PRINT_VALUES)[number];
export const isMaintenanceAlertPrint = makeEnumGuard(MAINTENANCE_ALERT_PRINT_VALUES);

/** ^MA units slot: C=centimeters, I=inches, M=meters. */
export const MAINTENANCE_ALERT_UNITS = ['C', 'I', 'M'] as const;
export type MaintenanceAlertUnit = (typeof MAINTENANCE_ALERT_UNITS)[number];
export const isMaintenanceAlertUnit = makeEnumGuard(MAINTENANCE_ALERT_UNITS);

/** R=150000m (150 km printhead life), C=2000m. Per-type cap in superRefine. */
export const MAINTENANCE_DISTANCE_MAX_BY_TYPE = { R: 150000, C: 2000 } as const;
/** ^MI message length cap from Zebra Quick Reference. */
export const MAINTENANCE_MESSAGE_MAX_LEN = 63;
/** ^FL spec cap (PG p.184): up to 5 active links per base font. */
export const FONT_LINKS_MAX_PER_BASE = 5;
/** ^FL ext/base path length cap (defensive; covers full Zebra device-path forms). */
export const FONT_LINKS_PATH_MAX_LEN = 128;

/** Indexed table 0..16; wire value is the index. */
export const HEAD_CLEANING_INTERVAL_METERS = [
  100, 150, 200, 250, 300, 350, 400, 450,
  500, 550, 600, 650, 700, 750, 800, 850, 900,
] as const;
export type HeadCleaningIntervalMeters = (typeof HEAD_CLEANING_INTERVAL_METERS)[number];
export const isHeadCleaningIntervalMeters = (n: number): n is HeadCleaningIntervalMeters =>
  (HEAD_CLEANING_INTERVAL_METERS as readonly number[]).includes(n);

/** ^JH slots: f=early-warning master, g=cleaning interval; others unmodeled. */
export const JH_SLOT_COUNT = 10;
export const JH_SLOT_F = 5;
export const JH_SLOT_G = 6;

/** Spec example `^MAR,Y,5,1,I`. */
export const MAINTENANCE_ALERT_DEFAULTS = {
  type: 'R',
  print: 'Y',
  threshold: 5,
  frequency: 1,
  units: 'I',
} as const;

/** EEPROM-persistent fields; separated from labelConfig so design files
 *  don't leak per-install values. */
export const printerProfileSchema = z.object({
  reprintAfterError: z.enum(YES_NO_VALUES).optional(),
  headTestInterval: intInRange(HEAD_TEST_INTERVAL_RANGE).optional(),
  tearOffAdjust: intInRange(TEAR_OFF_ADJUST_RANGE).optional(),
  setRealtimeClock: z.string().regex(realtimeClockIsoRegex).optional(),
  /** ^ST live mode: capture wall-clock at export, ignore setRealtimeClock. */
  useCurrentTimeForClock: z.boolean().optional(),
  clockFormat: z.enum(CLOCK_FORMAT_VALUES).optional(),
  clockMode: z.enum(CLOCK_MODE_VALUES).optional(),
  /** ^SL numeric tolerance; cross-field-bound to clockMode === 'TOL'. */
  clockTolerance: intInRange(CLOCK_TOLERANCE_RANGE).optional(),
  clockLanguage: z.enum(CLOCK_LANGUAGE_VALUES).optional(),
  printerLocale: z.enum(PRINTER_LOCALE_VALUES).optional(),
  encodingTable: z.string().min(1).regex(setupScriptSafeStringRegex).optional(),
  zplMode: z.enum(ZPL_MODE_VALUES).optional(),
  printerName: z.string().min(1).max(PRINTER_NAME_MAX_LEN).regex(setupScriptSafeStringRegex).optional(),
  printerDescription: z.string().min(1).regex(setupScriptSafeStringRegex).optional(),
  setPassword: z.string().regex(PRINTER_PASSWORD_REGEX).optional(),
  /** Requires earlyWarningMaintenance==='E' to fire; per-type caps in superRefine. */
  maintenanceAlert: z.object({
    type: z.enum(MAINTENANCE_ALERT_TYPES),
    print: z.enum(YES_NO_VALUES),
    threshold: z.number().int().min(0).max(MAINTENANCE_DISTANCE_MAX_BY_TYPE.R),
    frequency: z.number().int().min(0).max(MAINTENANCE_DISTANCE_MAX_BY_TYPE.R),
    units: z.enum(MAINTENANCE_ALERT_UNITS),
  }).optional(),
  /** ^MI custom message printed when the matching `^MA{type}` fires. */
  maintenanceMessage: z.object({
    type: z.enum(MAINTENANCE_ALERT_TYPES),
    text: z.string().min(1).max(MAINTENANCE_MESSAGE_MAX_LEN).regex(setupScriptSafeStringRegex),
  }).optional(),
  /** ^MW head-cold warning LCD/alert toggle. */
  headColdWarning: z.enum(YES_NO_VALUES).optional(),
  /** ^CO a: character cache on/off (session-scoped DRAM sizing). */
  fontCacheOn: z.enum(YES_NO_VALUES).optional(),
  /** ^CO b: additional cache KB; resizing discards cached characters. */
  fontCacheAddKb: intInRange(FONT_CACHE_KB_RANGE).optional(),
  /** ^CO c: cache type. */
  fontCacheType: z.enum(FONT_CACHE_TYPE_VALUES).optional(),
  /** ^MP: control-panel modes to protect; one command per letter on emit. */
  modeProtection: z.array(z.enum(MODE_PROTECTION_VALUES)).optional(),
  /** True when the set is absolute (stream carried ^MPE, or UI-authored):
   *  emit resets with ^MPE first. Absent = relative additions only. */
  modeProtectionExplicit: z.boolean().optional(),
  /** ^CV barcode validation (session-scoped per spec, not persisted by ^JUS). */
  codeValidation: z.enum(YES_NO_VALUES).optional(),
  /** ^PA advanced text properties (ZPL II PG P1012728 p.299, firmware
   *  V60.14.x+). Four session-scoped 0/1 slots. 0=printer default,
   *  1=feature on. a: show font's missing-glyph box (instead of space).
   *  b: bidi text layout. c: character shaping (joining forms). d:
   *  OpenType table support (GSUB/GPOS). */
  paSlotA: z.boolean().optional(),
  paSlotB: z.boolean().optional(),
  paSlotC: z.boolean().optional(),
  paSlotD: z.boolean().optional(),
  /** ^FL font links (PG p.184, firmware V60.14.x+): `ext` falls back to
   *  `base`. Per-base cap {@link FONT_LINKS_MAX_PER_BASE} stays soft
   *  (printer ignores overflow); empty rows are editor drafts, skipped
   *  on emit. */
  fontLinks: z.array(z.object({
    ext: z.string().max(FONT_LINKS_PATH_MAX_LEN).regex(setupScriptOptionalSafeStringRegex),
    base: z.string().max(FONT_LINKS_PATH_MAX_LEN).regex(setupScriptOptionalSafeStringRegex),
  })).optional(),
  /** Fonts to upload once via `~DY,A,T` ahead of the setup-script block
   *  (analogue to {@link LabelConfig.customFonts} but per-printer). Paths
   *  only; bytes are pulled from the shared fontCache at emit time. */
  setupFonts: z.array(z.object({
    path: z.string().min(1).max(FONT_LINKS_PATH_MAX_LEN).regex(setupScriptSafeStringRegex),
  })).optional(),
  /** ^JH f master gate; without `E` ^MA sits dormant. */
  earlyWarningMaintenance: z.enum(['E', 'D']).optional(),
  /** ^JH g; stored as meters for UX, wire is index into table. */
  headCleaningIntervalMeters: z.number().int().refine(
    isHeadCleaningIntervalMeters,
    `must be one of ${HEAD_CLEANING_INTERVAL_METERS.join(', ')}`,
  ).optional(),
  /** ^JU; emitted last so `S` commit lands after persistent writes. */
  configurationUpdate: z.enum(CONFIG_UPDATE_VALUES).optional(),
}).superRefine((p, ctx) => {
  if (p.clockTolerance !== undefined && p.clockMode !== 'TOL') {
    ctx.addIssue({
      code: 'custom',
      path: ['clockTolerance'],
      message: 'clockTolerance is only valid when clockMode === "TOL"',
    });
  }
  if (p.clockMode === 'TOL' && p.clockTolerance === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['clockTolerance'],
      message: 'clockMode "TOL" requires clockTolerance to be set',
    });
  }
  if (
    p.maintenanceAlert &&
    p.maintenanceMessage &&
    p.maintenanceAlert.type !== p.maintenanceMessage.type
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['maintenanceMessage', 'type'],
      message: 'maintenanceMessage.type must match maintenanceAlert.type',
    });
  }
  if (p.maintenanceAlert) {
    const cap = MAINTENANCE_DISTANCE_MAX_BY_TYPE[p.maintenanceAlert.type];
    if (p.maintenanceAlert.threshold > cap) {
      ctx.addIssue({
        code: 'custom',
        path: ['maintenanceAlert', 'threshold'],
        message: `threshold for type ${p.maintenanceAlert.type} must be ≤ ${cap}`,
      });
    }
    if (p.maintenanceAlert.frequency > cap) {
      ctx.addIssue({
        code: 'custom',
        path: ['maintenanceAlert', 'frequency'],
        message: `frequency for type ${p.maintenanceAlert.type} must be ≤ ${cap}`,
      });
    }
  }
});

export type PrinterProfile = z.infer<typeof printerProfileSchema>;

/** Cascade direction follows whichever side the patch touches:
 *  alert-touched rewrites message.type, message-touched rewrites
 *  alert.type. Both-touched leaves the mismatch to superRefine. */
export function normalizeMaintenanceTypes(
  merged: PrinterProfile,
  patch: Partial<PrinterProfile>,
): PrinterProfile {
  const alert = merged.maintenanceAlert;
  const message = merged.maintenanceMessage;
  if (!alert || !message || alert.type === message.type) return merged;
  const alertTouched = patch.maintenanceAlert?.type !== undefined;
  const messageTouched = patch.maintenanceMessage?.type !== undefined;
  if (alertTouched && !messageTouched) {
    return { ...merged, maintenanceMessage: { ...message, type: alert.type } };
  }
  if (messageTouched && !alertTouched) {
    return { ...merged, maintenanceAlert: { ...alert, type: message.type } };
  }
  return merged;
}

export const PRINTER_PROFILE_FIELDS = Object.keys(
  printerProfileSchema.shape,
) as readonly (keyof PrinterProfile)[];

export type PrinterProfileField = (typeof PRINTER_PROFILE_FIELDS)[number];

export const EMPTY_PRINTER_PROFILE: PrinterProfile = {};

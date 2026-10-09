import {
  LABEL_SHIFT_RANGE,
  LABEL_TOP_RANGE,
  SPEED_RANGE,
  DARKNESS_INSTANT_RANGE,
  isBackfeedPercent,
  isBackfeedSequence,
  isDpmm,
  isMediaFeedMode,
  isMediaMode,
  isMediaTracking,
  isMediaType,
  isPrintOrientation,
  type LabelConfig,
  type MediaFeedMode,
  type MediaMode,
  type MediaTracking,
  type MediaType,
  type PrintOrientation,
} from '../types/LabelConfig';
import {
  PRINTER_NAME_MAX_LEN,
  TEAR_OFF_ADJUST_RANGE,
  setupScriptSafeStringRegex,
  type PrinterProfile,
} from '../types/PrinterProfile';
import { dotsToMm } from './coordinates';
import { sgdValues, type SgdSetting } from './sgd';

type Values = (key: string) => string | undefined;

/** One app field and the SGD keys answering it. `read` answers undefined when the printer's value has no counterpart the app can hold. */
type Mapping<Target extends string, Fields> = {
  [K in keyof Fields]-?: {
    target: Target;
    field: K;
    /** The keys read, the first one naming the row. */
    keys: readonly string[];
    /** The ZPL command the field emits, empty when the field emits none. */
    command: string;
    read: (values: Values) => Fields[K] | undefined;
    /** What the printer does while the field stays unset, as an app value. */
    unsetValue?: Fields[K] | ((values: Values) => Fields[K] | undefined);
  };
}[keyof Fields];

type LabelMapping = Mapping<'label', LabelConfig>;
type ProfileMapping = Mapping<'profile', PrinterProfile>;

export type AdoptionPatch =
  | { target: 'label'; value: Partial<LabelConfig> }
  | { target: 'profile'; value: Partial<PrinterProfile> };

export interface AdoptionRow {
  /** The SGD key the row is named after. */
  key: string;
  command: string;
  field: string;
  /** What the printer answered, verbatim. */
  printerValue: string;
  /** The printer's answer as the app would hold it, empty when the app cannot hold it. */
  adoptedValue: string;
  /** What the app holds, empty when the field is unset. */
  currentValue: string;
  differs: boolean;
  /** Absent when the app has no value for what the printer answered. */
  patch?: AdoptionPatch;
}

export const isAdoptable = (row: AdoptionRow): boolean => row.patch !== undefined;

const number = (raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : undefined;
};

/** The answer as a whole number inside `range`, else undefined, because the printer keeps settings like darkness as decimals and the app holds whole steps. */
function integer(raw: string | undefined, range: { min: number; max: number }): number | undefined {
  const n = number(raw);
  if (n === undefined) return undefined;
  const rounded = Math.round(n);
  return rounded >= range.min && rounded <= range.max ? rounded : undefined;
}

/** The ZD230 firmware answers these settings in words, other models in the spec's letters, so both are read. */
function word<T extends string>(words: Readonly<Record<string, T>>, isValue: (v: string) => v is T) {
  return (raw: string | undefined): T | undefined => {
    if (raw === undefined) return undefined;
    const letter = raw.trim().toUpperCase();
    return isValue(letter) ? letter : words[raw.trim().toLowerCase()];
  };
}

const mediaMode = word<MediaMode>(
  { 'tear off': 'T', 'delayed cut': 'D', 'linerless tear': 'V', kiosk: 'K' },
  isMediaMode,
);
const mediaType = word<MediaType>(
  { 'direct thermal': 'D', 'thermal transfer': 'T', 'thermal trans': 'T' },
  isMediaType,
);
const thermalMode = word<MediaType>({ dt: 'D', tt: 'T' }, isMediaType);
const printOrientation = word<PrintOrientation>({ nor: 'N', inv: 'I' }, isPrintOrientation);
const mediaFeed = word<MediaFeedMode>(
  { feed: 'F', calibrate: 'C', length: 'L', 'no motion': 'N', 'short cal': 'S' },
  isMediaFeedMode,
);
const mediaTracking = word<MediaTracking>(
  { continuous: 'N', auto_detect: 'A', mark: 'M' },
  isMediaTracking,
);
const onOff = (raw: string | undefined): 'Y' | 'N' | undefined => {
  const state = raw?.trim().toLowerCase();
  return state === 'on' ? 'Y' : state === 'off' ? 'N' : undefined;
};
/** An inverted label is the same turn ^PO names, so it answers the orientation row. */
const invertLabel = (raw: string | undefined): PrintOrientation | undefined => {
  const state = raw?.trim().toLowerCase();
  return state === 'on' ? 'I' : state === 'off' ? 'N' : undefined;
};

/** The design density the head resolution implies, undefined for a head the app has no density for. */
function headDpmm(values: Values): number | undefined {
  const dpi = number(values('head.resolution.in_dpi'));
  if (dpi === undefined || dpi <= 0) return undefined;
  const dpmm = Math.round(dpi / 25.4);
  return isDpmm(dpmm) ? dpmm : undefined;
}

/** Dots the printer counts in its own head density, as millimetres. */
function millimetres(values: Values, key: string, range: { min: number; max: number }): number | undefined {
  const dots = integer(values(key), range);
  const dpmm = headDpmm(values);
  return dots === undefined || dpmm === undefined ? undefined : dotsToMm(dots, dpmm);
}

const PRINT_WIDTH_RANGE = { min: 1, max: 32000 } as const;
/** ^LL bounds, which only happen to match the ^ML ones. */
const LABEL_LENGTH_RANGE = { min: 1, max: 32000 } as const;

/** ~TA restores the last saved value, so an unset field already stands at the printer's. */
const tearOff = (v: Values): number | undefined => integer(v('ezpl.tear_off'), TEAR_OFF_ADJUST_RANGE);

/** ^KN is the only way the app renames, so an unset field stands at the printer's own name. */
const printerName = (v: Values): string | undefined => {
  const name = v('device.friendly_name')?.trim() ?? '';
  return name.length <= PRINTER_NAME_MAX_LEN && setupScriptSafeStringRegex.test(name) ? name : undefined;
};

/** ^MN names sensor and media in one letter, so a bar or reflective reading means mark and a gap or transmissive one means gap. */
function sensorTracking(values: Values): MediaTracking | undefined {
  const sense = values('media.sense_mode')?.trim().toLowerCase();
  if (sense !== undefined) return sense === 'bar' ? 'M' : 'Y';
  const sensor = values('device.sensor_select')?.trim().toLowerCase();
  if (sensor === undefined) return undefined;
  return sensor === 'reflective' ? 'M' : 'Y';
}

const LABEL_MAPPINGS: readonly LabelMapping[] = [
  // print.tone is the absolute darkness, so it lands on ~SD and not on the relative ^MD.
  { target: 'label', field: 'instantDarkness', keys: ['print.tone'], command: '~SD', read: (v) => integer(v('print.tone'), DARKNESS_INSTANT_RANGE) },
  { target: 'label', field: 'printSpeed', keys: ['media.speed'], command: '^PR', read: (v) => integer(v('media.speed'), SPEED_RANGE) },
  { target: 'label', field: 'mediaMode', keys: ['media.printmode', 'ezpl.print_mode'], command: '^MM', read: (v) => mediaMode(v('media.printmode') ?? v('ezpl.print_mode')) },
  {
    target: 'label',
    field: 'mediaTracking',
    keys: ['ezpl.media_type', 'media.sense_mode', 'device.sensor_select'],
    command: '^MN',
    read: (v) => {
      const type = v('ezpl.media_type')?.trim().toLowerCase();
      if (type === undefined) return sensorTracking(v);
      // A gap/notch media is the only type whose letter the sensor decides.
      return type === 'gap/notch' ? (sensorTracking(v) ?? 'Y') : mediaTracking(type);
    },
  },
  {
    target: 'label',
    field: 'mediaType',
    keys: ['ezpl.print_method', 'media.thermal_mode'],
    command: '^MT',
    read: (v) => mediaType(v('ezpl.print_method')) ?? thermalMode(v('media.thermal_mode')),
  },
  { target: 'label', field: 'dpmm', keys: ['head.resolution.in_dpi'], command: '', read: headDpmm },
  { target: 'label', field: 'widthMm', keys: ['ezpl.print_width', 'head.resolution.in_dpi'], command: '^PW', read: (v) => millimetres(v, 'ezpl.print_width', PRINT_WIDTH_RANGE) },
  { target: 'label', field: 'heightMm', keys: ['zpl.label_length', 'head.resolution.in_dpi'], command: '^LL', read: (v) => millimetres(v, 'zpl.label_length', LABEL_LENGTH_RANGE) },
  { target: 'label', field: 'labelTop', keys: ['zpl.label_top'], command: '^LT', read: (v) => integer(v('zpl.label_top'), LABEL_TOP_RANGE), unsetValue: 0 },
  { target: 'label', field: 'labelShift', keys: ['zpl.left_position'], command: '^LS', read: (v) => integer(v('zpl.left_position'), LABEL_SHIFT_RANGE), unsetValue: 0 },
  {
    target: 'label',
    field: 'printOrientation',
    keys: ['zpl.print_orientation', 'print.invert_label'],
    command: '^PO',
    read: (v) => printOrientation(v('zpl.print_orientation')) ?? invertLabel(v('print.invert_label')),
    unsetValue: 'N',
  },
  {
    target: 'label',
    field: 'backfeedSequence',
    keys: ['media.backfeed'],
    command: '~JS',
    read: (v) => {
      const raw = v('media.backfeed')?.trim().toUpperCase();
      if (raw === undefined) return undefined;
      if (isBackfeedSequence(raw)) return raw;
      const percent = Number(raw);
      return isBackfeedPercent(percent) ? percent : undefined;
    },
    unsetValue: 'N',
  },
  { target: 'label', field: 'mediaFeedPowerUp', keys: ['ezpl.power_up_action'], command: '^MF', read: (v) => mediaFeed(v('ezpl.power_up_action')), unsetValue: 'C' },
  { target: 'label', field: 'mediaFeedHeadClose', keys: ['ezpl.head_close_action'], command: '^MF', read: (v) => mediaFeed(v('ezpl.head_close_action')), unsetValue: 'C' },
];

const PROFILE_MAPPINGS: readonly ProfileMapping[] = [
  { target: 'profile', field: 'reprintAfterError', keys: ['ezpl.reprint_mode'], command: '^JZ', read: (v) => onOff(v('ezpl.reprint_mode')), unsetValue: 'Y' },
  { target: 'profile', field: 'tearOffAdjust', keys: ['ezpl.tear_off'], command: '~TA', read: tearOff, unsetValue: tearOff },
  { target: 'profile', field: 'printerName', keys: ['device.friendly_name'], command: '^KN', read: printerName, unsetValue: printerName },
  {
    target: 'profile',
    field: 'zplMode',
    keys: ['zpl.zpl_mode'],
    command: '^SZ',
    read: (v) => {
      const mode = v('zpl.zpl_mode')?.trim().toLowerCase();
      return mode === 'zpl ii' ? '2' : mode === 'zpl' ? '1' : undefined;
    },
    unsetValue: '2',
  },
];

const MAPPINGS: readonly (LabelMapping | ProfileMapping)[] = [...LABEL_MAPPINGS, ...PROFILE_MAPPINGS];

const display = (value: unknown): string => (value === undefined ? '' : String(value));

/** One row per setting the dump answers, without a patch when the app cannot hold the value. */
export function adoptionDiff(
  settings: readonly SgdSetting[],
  label: LabelConfig,
  profile: PrinterProfile,
): AdoptionRow[] {
  const values = sgdValues(settings);
  const rows: AdoptionRow[] = [];
  for (const mapping of MAPPINGS) {
    const answered = mapping.keys.find((key) => values(key) !== undefined);
    if (answered === undefined) continue;
    const current = mapping.target === 'label' ? label[mapping.field] : profile[mapping.field];
    const value = mapping.read(values);
    const unset = mapping.unsetValue;
    const unsetValue: unknown = typeof unset === 'function' ? unset(values) : unset;
    const row: AdoptionRow = {
      key: answered,
      command: mapping.command,
      field: mapping.field,
      printerValue: values(answered) ?? '',
      adoptedValue: display(value),
      currentValue: display(current),
      differs: value !== undefined && value !== current && !(current === undefined && value === unsetValue),
    };
    if (value !== undefined) {
      row.patch =
        mapping.target === 'label'
          ? { target: 'label', value: { [mapping.field]: value } as Partial<LabelConfig> }
          : { target: 'profile', value: { [mapping.field]: value } as Partial<PrinterProfile> };
    }
    rows.push(row);
  }
  return rows;
}

/** The chosen rows folded into one patch per target. */
export function adoptionPatches(rows: readonly AdoptionRow[]): { label: Partial<LabelConfig>; profile: Partial<PrinterProfile> } {
  const label: Partial<LabelConfig> = {};
  const profile: Partial<PrinterProfile> = {};
  for (const row of rows) {
    if (row.patch?.target === 'label') Object.assign(label, row.patch.value);
    else if (row.patch?.target === 'profile') Object.assign(profile, row.patch.value);
  }
  return { label, profile };
}

/** Rows a freshly opened dialog ticks: the ones whose value the printer and the app disagree on. */
export const preselectedRows = (rows: readonly AdoptionRow[]): AdoptionRow[] => rows.filter((row) => row.differs && isAdoptable(row));

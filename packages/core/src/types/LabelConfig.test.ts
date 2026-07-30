import { describe, expect, it } from 'vitest';
import {
  LABEL_CONFIG_FIELDS,
  NON_EMITTING_CONFIG_FIELDS,
  PER_FORMAT_ZPL_FIELDS,
  PER_LABEL_ZPL_FIELDS,
  labelConfigSchema,
  scaledLabelConfigFields,
} from './LabelConfig';

const sorted = (xs: readonly string[]) => [...xs].sort();

// A single typo in LABEL_CONFIG_FIELDS would silently drift all four derived lists apart.
describe('LABEL_CONFIG_FIELDS derivations', () => {
  it('covers exactly the schema keys', () => {
    expect(sorted(Object.keys(LABEL_CONFIG_FIELDS))).toEqual(
      sorted(Object.keys(labelConfigSchema.shape)),
    );
  });

  it('derives PER_LABEL_ZPL_FIELDS', () => {
    expect(sorted(PER_LABEL_ZPL_FIELDS)).toEqual(
      sorted([
        'mediaMode', 'mediaType', 'mediaTracking', 'maxLabelLength',
        'mediaFeedPowerUp', 'mediaFeedHeadClose', 'suppressBackfeed', 'backfeedSequence',
        'printOrientation', 'mirror', 'printSpeed', 'slewSpeed', 'backfeedSpeed',
        'darkness', 'instantDarkness',
        'labelHomeX', 'labelHomeY', 'labelTop', 'labelShift',
        'printQuantity', 'pauseCount', 'replicates', 'overridePauseCount',
        'mapClear', 'slewDotRows', 'slewToHome', 'programmablePause',
      ]),
    );
  });

  it('derives PER_FORMAT_ZPL_FIELDS', () => {
    expect(sorted(PER_FORMAT_ZPL_FIELDS)).toEqual(
      sorted([
        'printQuantity', 'pauseCount', 'replicates', 'overridePauseCount',
        'slewDotRows', 'slewToHome', 'programmablePause', 'mapClear', 'jmDensity',
      ]),
    );
  });

  it('derives NON_EMITTING_CONFIG_FIELDS', () => {
    expect(sorted(NON_EMITTING_CONFIG_FIELDS)).toEqual(['safeAreaMm']);
  });

  it('derives the scaled field sets', () => {
    expect(sorted(scaledLabelConfigFields('always'))).toEqual(
      sorted(['labelHomeX', 'labelHomeY', 'defaultFontHeight', 'defaultFontWidth']),
    );
    expect(sorted(scaledLabelConfigFields('jmOnly'))).toEqual(
      sorted(['labelShift', 'labelTop', 'slewDotRows']),
    );
  });
});

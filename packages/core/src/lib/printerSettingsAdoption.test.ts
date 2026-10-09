import { describe, it, expect } from 'vitest';
import type { LabelConfig } from '../types/LabelConfig';
import type { PrinterProfile } from '../types/PrinterProfile';
import { adoptionDiff, adoptionPatches, isAdoptable, preselectedRows } from './printerSettingsAdoption';
import { ZD230_ALLCV_EXCERPT } from './sgd.fixture';
import { parseSgdDump } from './sgd';

const LABEL: LabelConfig = { widthMm: 100, heightMm: 60, dpmm: 8 };

const diff = (dump = ZD230_ALLCV_EXCERPT, label: LabelConfig = LABEL, profile: PrinterProfile = {}) =>
  adoptionDiff(parseSgdDump(dump), label, profile);

const adopted = (field: string, dump?: string) => {
  const row = diff(dump).find((r) => r.field === field);
  const value = row?.patch?.value as Record<string, unknown> | undefined;
  return value?.[field];
};

const ticked = (label: LabelConfig = LABEL, profile: PrinterProfile = {}) =>
  preselectedRows(diff(ZD230_ALLCV_EXCERPT, label, profile)).map((r) => r.field);

describe('adoptionDiff converters', () => {
  it('reads the measured ZD230 configuration into app values', () => {
    expect(adopted('instantDarkness')).toBe(15);
    expect(adopted('printSpeed')).toBe(6);
    expect(adopted('mediaMode')).toBe('T');
    expect(adopted('mediaTracking')).toBe('Y');
    expect(adopted('mediaType')).toBe('D');
    expect(adopted('dpmm')).toBe(8);
    expect(adopted('widthMm')).toBe(101.6);
    expect(adopted('heightMm')).toBe(152.4);
    expect(adopted('labelTop')).toBe(30);
    expect(adopted('labelShift')).toBe(0);
    expect(adopted('printOrientation')).toBe('N');
    expect(adopted('backfeedSequence')).toBe('N');
    expect(adopted('mediaFeedPowerUp')).toBe('N');
    expect(adopted('mediaFeedHeadClose')).toBe('F');
    expect(adopted('reprintAfterError')).toBe('N');
    expect(adopted('tearOffAdjust')).toBe(0);
    expect(adopted('printerName')).toBe('D4J260700032');
    expect(adopted('zplMode')).toBe('2');
  });

  it('reads a thermal transfer print method in both spellings', () => {
    expect(adopted('mediaType', 'ezpl.print_method : thermal trans\n')).toBe('T');
    expect(adopted('mediaType', 'ezpl.print_method : thermal transfer\n')).toBe('T');
  });

  it('reads the thermal mode when the print method is missing', () => {
    expect(adopted('mediaType', 'media.thermal_mode : TT\n')).toBe('T');
    expect(adopted('mediaType', 'media.thermal_mode : DT\n')).toBe('D');
  });

  it('reads a bar-sensed gap media as mark tracking', () => {
    expect(adopted('mediaTracking', 'ezpl.media_type : gap/notch\nmedia.sense_mode : bar\n')).toBe('M');
  });

  it('reads a gap media without a sense mode as gap tracking', () => {
    expect(adopted('mediaTracking', 'ezpl.media_type : gap/notch\n')).toBe('Y');
  });

  it('reads the selected sensor when no sense mode answers', () => {
    expect(adopted('mediaTracking', 'ezpl.media_type : gap/notch\ndevice.sensor_select : reflective\n')).toBe('M');
    expect(adopted('mediaTracking', 'ezpl.media_type : gap/notch\ndevice.sensor_select : transmissive\n')).toBe('Y');
  });

  it('reads a continuous media as continuous tracking', () => {
    expect(adopted('mediaTracking', 'ezpl.media_type : continuous\n')).toBe('N');
  });

  it('reads an auto detecting media as auto tracking', () => {
    expect(adopted('mediaTracking', 'ezpl.media_type : auto_detect\n')).toBe('A');
  });

  it('keeps a continuous media continuous however the sensor is set', () => {
    expect(adopted('mediaTracking', 'ezpl.media_type : continuous\nmedia.sense_mode : bar\n')).toBe('N');
  });

  it('reads a bar sensor without a media type as mark tracking', () => {
    expect(adopted('mediaTracking', 'media.sense_mode : bar\n')).toBe('M');
  });

  it('reads a transmissive sensor without a media type as gap tracking', () => {
    expect(adopted('mediaTracking', 'device.sensor_select : transmissive\n')).toBe('Y');
  });

  it('reads the spec letters other firmware answers with', () => {
    expect(adopted('mediaMode', 'media.printmode : D\n')).toBe('D');
    expect(adopted('mediaType', 'ezpl.print_method : T\n')).toBe('T');
  });

  it('reads a backfeed percent', () => {
    expect(adopted('backfeedSequence', 'media.backfeed : 80\n')).toBe(80);
  });

  it('reads an inverted orientation', () => {
    expect(adopted('printOrientation', 'zpl.print_orientation : inv\n')).toBe('I');
  });

  it('reads an inverted label as the orientation when no orientation answers', () => {
    expect(adopted('printOrientation', 'print.invert_label : on\n')).toBe('I');
    expect(adopted('printOrientation', 'print.invert_label : off\n')).toBe('N');
  });

  it('converts dots in the printer head density, not the label one', () => {
    const at300 = 'ezpl.print_width : 1200\nzpl.label_length : 1800\nhead.resolution.in_dpi : 300\n';
    expect(adopted('widthMm', at300)).toBe(100);
    expect(adopted('heightMm', at300)).toBe(150);
    expect(adopted('dpmm', at300)).toBe(12);
  });
});

describe('adoptionDiff rows', () => {
  it('lists a row only for a setting the printer answered', () => {
    const rows = diff('print.tone : 15.0 , Choices: 0.0-30.0\n');
    expect(rows.map((r) => r.field)).toEqual(['instantDarkness']);
    expect(rows[0]).toMatchObject({ key: 'print.tone', command: '~SD', printerValue: '15.0', currentValue: '', differs: true });
  });

  it('names the printer answer and the value the app would hold', () => {
    const rows = diff('print.tone : 15.0\nezpl.print_width : 813\nhead.resolution.in_dpi : 203\nzpl.zpl_mode : zpl II\n');
    expect(rows.find((r) => r.field === 'instantDarkness')).toMatchObject({ printerValue: '15.0', adoptedValue: '15' });
    expect(rows.find((r) => r.field === 'widthMm')).toMatchObject({ printerValue: '813', adoptedValue: '101.6' });
    expect(rows.find((r) => r.field === 'zplMode')).toMatchObject({ printerValue: 'zpl II', adoptedValue: '2' });
  });

  it('marks a setting the app cannot hold as not adoptable', () => {
    const row = diff('media.printmode : cutter\n')[0];
    expect(row?.field).toBe('mediaMode');
    expect(isAdoptable(row!)).toBe(false);
    expect(row).toMatchObject({ adoptedValue: '', differs: false });
  });

  it('names the key it read when the first one is missing', () => {
    const row = diff('ezpl.print_mode : tear off\n')[0];
    expect(row?.key).toBe('ezpl.print_mode');
    expect(row?.printerValue).toBe('tear off');
  });

  it('says a value the app already holds does not differ', () => {
    const row = diff('zpl.label_top : 30\n', { ...LABEL, labelTop: 30 })[0];
    expect(row).toMatchObject({ currentValue: '30', differs: false });
    expect(isAdoptable(row!)).toBe(true);
  });

  it('says a value an unset field already stands for does not differ', () => {
    expect(diff('zpl.left_position : 0\n')[0]).toMatchObject({ differs: false });
    expect(diff('zpl.label_top : 0\n')[0]).toMatchObject({ differs: false });
    expect(diff('media.backfeed : N\n')[0]).toMatchObject({ differs: false });
    expect(diff('zpl.print_orientation : nor\n')[0]).toMatchObject({ differs: false });
    expect(diff('ezpl.tear_off : 0\n')[0]).toMatchObject({ differs: false });
  });

  it('refuses a printer name no setup script could carry', () => {
    expect(isAdoptable(diff('device.friendly_name : a name with a comma, and more\n')[0]!)).toBe(false);
  });

  it('refuses a head density the app has no setting for', () => {
    expect(isAdoptable(diff('head.resolution.in_dpi : 400\n')[0]!)).toBe(false);
  });
});

describe('adoptionPatches', () => {
  it('folds the chosen rows into one patch per target', () => {
    const rows = diff().filter((r) => r.field === 'printSpeed' || r.field === 'printerName');
    expect(adoptionPatches(rows)).toEqual({ label: { printSpeed: 6 }, profile: { printerName: 'D4J260700032' } });
  });
});

describe('preselectedRows', () => {
  it('ticks the settings the printer and a fresh label disagree on', () => {
    expect(ticked()).toEqual(expect.arrayContaining(['instantDarkness', 'widthMm', 'heightMm', 'labelTop']));
  });

  it('leaves a setting the app already holds unticked', () => {
    const fields = ticked({ ...LABEL, labelTop: 30, printSpeed: 6 });
    expect(fields).not.toContain('labelTop');
    expect(fields).not.toContain('printSpeed');
  });

  it('leaves a row the app cannot hold unticked', () => {
    expect(preselectedRows(diff('media.printmode : cutter\n'))).toEqual([]);
  });

  it('leaves a printer value an unset field already stands for unticked', () => {
    const fields = ticked();
    expect(fields).not.toContain('labelShift');
    expect(fields).not.toContain('printOrientation');
    expect(fields).not.toContain('backfeedSequence');
    expect(fields).not.toContain('tearOffAdjust');
    expect(fields).not.toContain('zplMode');
  });

  it('leaves the serial number the printer carries as a name unticked', () => {
    expect(ticked()).not.toContain('printerName');
  });

  it('ticks a name the profile already holds and the printer spells differently', () => {
    expect(ticked(LABEL, { printerName: 'FRONTDESK' })).toContain('printerName');
  });
});

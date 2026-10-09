import { describe, it, expect } from 'vitest';
import { ZD230_ALLCV_EXCERPT } from './sgd.fixture';
import { SGD_ALL_SETTINGS, parseSgdDump, sgdGetvar, sgdGetvarCommand, sgdValues } from './sgd';

const byKey = (key: string) => parseSgdDump(ZD230_ALLCV_EXCERPT).find((s) => s.key === key);

describe('parseSgdDump', () => {
  it('reads a dump line as key and value without the listed choices', () => {
    expect(byKey('media.sense_mode')).toEqual({ key: 'media.sense_mode', value: 'gap' });
    expect(byKey('head.resolution.in_dpi')).toEqual({ key: 'head.resolution.in_dpi', value: '203' });
    expect(byKey('print.tone')).toEqual({ key: 'print.tone', value: '15.0' });
  });

  it('keeps a value that carries commas or colons', () => {
    expect(byKey('zpl.delimiter')?.value).toBe(', (2C)');
    expect(byKey('card.mac_addr')?.value).toBe('00:00:00:00:00:00');
  });

  it('drops group headers and commands without a value', () => {
    const keys = parseSgdDump(ZD230_ALLCV_EXCERPT).map((s) => s.key);
    expect(keys).not.toContain('head.');
    expect(keys).not.toContain('bluetooth.clear_bonding_cache');
  });

  it('keeps a key the printer answered empty', () => {
    expect(byKey('bluetooth.version')).toEqual({ key: 'bluetooth.version', value: '' });
  });

  it('reads carriage returns and odd spacing', () => {
    expect(parseSgdDump('media.speed:6.0,Choices:4.0-6.0\r\nzpl.label_top  :   30\r\n')).toEqual([
      { key: 'media.speed', value: '6.0' },
      { key: 'zpl.label_top', value: '30' },
    ]);
  });
});

describe('sgdValues', () => {
  it('answers only keys the dump filled', () => {
    const values = sgdValues(parseSgdDump(ZD230_ALLCV_EXCERPT));
    expect(values('ezpl.print_width')).toBe('813');
    expect(values('bluetooth.version')).toBeUndefined();
    expect(values('media.nothing')).toBeUndefined();
  });
});

describe('sgdGetvar', () => {
  it('builds the getvar line the printer reads', () => {
    expect(sgdGetvar(SGD_ALL_SETTINGS)).toBe('! U1 getvar "allcv"\r\n');
  });

  it('names the command without its terminator', () => {
    expect(sgdGetvarCommand(SGD_ALL_SETTINGS)).toBe('! U1 getvar "allcv"');
  });
});

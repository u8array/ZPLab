import { describe, it, expect } from 'vitest';
import {
  formatEan13Hri,
  formatEan8Hri,
  formatUpcaHri,
  formatUpceHri,
  upceData6FromFd,
  formatCode11Hri, formatCode39Hri, formatInterleaved2of5Hri, formatMsiHri,
  formatLogmarsHri,
  formatUpcEanExtensionHri,
} from '@zplab/core/registry/hriFormatters';

describe('HRI formatters', () => {
  describe('formatEan13Hri', () => {
    it('appends check digit to 12-digit input', () => {
      expect(formatEan13Hri('590123412345')).toBe('5901234123457');
    });
    it('pads short input with zeros before computing check digit', () => {
      // "123" padded to "123000000000" → sum=1*1+2*3+3*1=10 → check=0
      expect(formatEan13Hri('123')).toBe('1230000000000');
    });
    it('strips non-digits', () => {
      expect(formatEan13Hri('5-9-0-1-2-3-4-1-2-3-4-5')).toBe('5901234123457');
    });
  });

  describe('formatEan8Hri', () => {
    it('appends check digit to 7-digit input', () => {
      expect(formatEan8Hri('1234567')).toBe('12345670');
    });
  });

  describe('formatUpcaHri', () => {
    it('appends check digit to 11-digit input', () => {
      expect(formatUpcaHri('01234567890')).toBe('012345678905');
    });
  });

  describe('formatUpceHri', () => {
    it('produces 8-char string: 0 + 6 data + check', () => {
      const r = formatUpceHri('012345');
      expect(r).toHaveLength(8);
      expect(r[0]).toBe('0');
      expect(r.slice(1, 7)).toBe('012345');
    });
    it('is idempotent: NS-prefixed content does not accumulate zeros', () => {
      expect(formatUpceHri('0012345')).toBe(formatUpceHri('012345'));
    });
  });

  describe('formatCode11Hri', () => {
    it('appends C+K check digits when checkDigit is off (e=N, two checks)', () => {
      expect(formatCode11Hri('12345', { checkDigit: false })).toBe('1234528');
    });
    it('appends only the C check digit when checkDigit is on (e=Y, one check)', () => {
      expect(formatCode11Hri('12345', { checkDigit: true })).toBe('123452');
    });
    it('defaults to two check digits', () => {
      expect(formatCode11Hri('12345')).toBe('1234528');
    });
  });

  describe('formatCode39Hri', () => {
    it('appends the Mod-43 check char and uppercases like the firmware', () => {
      expect(formatCode39Hri('1234', { checkDigit: true })).toBe('1234A');
      expect(formatCode39Hri('1234', { checkDigit: false })).toBe('1234');
      expect(formatCode39Hri('abc', { checkDigit: true })).toBe('ABCX');
    });
  });

  describe('formatInterleaved2of5Hri', () => {
    it('appends the Mod 10 check and pads an odd total with the firmware 0', () => {
      expect(formatInterleaved2of5Hri('1234', { checkDigit: true })).toBe('012348');
      expect(formatInterleaved2of5Hri('12345', { checkDigit: true })).toBe('123457');
      expect(formatInterleaved2of5Hri('1234', { checkDigit: false })).toBe('1234');
      // The firmware pad applies without a check digit too (bars carry it).
      expect(formatInterleaved2of5Hri('12345', { checkDigit: false })).toBe('012345');
    });
  });

  describe('formatMsiHri', () => {
    it('appends the ^BM check digits only when e2 is set', () => {
      const on = { checkDigit: true, msiHriCheck: true };
      expect(formatMsiHri('12345678', on)).toBe('123456782');
      expect(formatMsiHri('12345678', { ...on, msiCheckMode: 'C' })).toBe('1234567822');
      expect(formatMsiHri('12345678', { ...on, msiCheckMode: 'D' })).toBe('1234567855');
      expect(formatMsiHri('12345678', { checkDigit: true })).toBe('12345678');
      expect(formatMsiHri('12345678', { msiHriCheck: true })).toBe('12345678');
    });
  });

  describe('upceData6FromFd', () => {
    it('keeps the 6 data digits when no number-system prefix', () => {
      expect(upceData6FromFd('012345')).toBe('012345');
    });
    it('strips the leading number-system digit from a 7-digit payload', () => {
      expect(upceData6FromFd('0012345')).toBe('012345');
    });
    it('strips number-system and check digit from an 8-digit payload', () => {
      expect(upceData6FromFd('00123455')).toBe('012345');
    });
  });

  describe('formatLogmarsHri', () => {
    it('appends mod-43 check char for plain text', () => {
      // sum("LOGMARS1") in the charset: L=21,O=24,G=16,M=22,A=10,R=27,S=28,1=1
      // = 21+24+16+22+10+27+28+1 = 149 → 149 % 43 = 20 → "K"
      expect(formatLogmarsHri('LOGMARS1')).toBe('LOGMARS1K');
    });
    it('treats lowercase as uppercase (charset is upper-only)', () => {
      expect(formatLogmarsHri('logmars1')).toBe('logmars1K');
    });
    it('ignores characters not in the LOGMARS charset', () => {
      // The single valid char 'A' (index 10) sums to 10 → check = "A".
      // The '@' contributes nothing.
      expect(formatLogmarsHri('A@')).toBe('A@A');
    });
    it('returns empty-content + first-charset-char on empty input', () => {
      expect(formatLogmarsHri('')).toBe('0');
    });
  });

  describe('formatUpcEanExtensionHri', () => {
    it('keeps 2-digit content as-is', () => {
      expect(formatUpcEanExtensionHri('12')).toBe('12');
    });
    it('pads short 5-digit form with zeros', () => {
      expect(formatUpcEanExtensionHri('51')).toBe('51');
      expect(formatUpcEanExtensionHri('519')).toBe('51900');
    });
    it('preserves 5-digit content', () => {
      expect(formatUpcEanExtensionHri('51999')).toBe('51999');
    });
    it('strips non-digits then routes by length', () => {
      expect(formatUpcEanExtensionHri('5-1-9-9-9')).toBe('51999');
    });
  });
});

import { describe, it, expect } from 'vitest';
import { kbd, shortcutLetter } from './kbd';

/** The test environment's navigator has no userAgent/platform, so isMac
 *  resolves to false. We assert the non-Mac branch here; the Mac branch
 *  is exercised by hand in the browser. */
describe('kbd', () => {
  it('uses Ctrl+ on non-Mac platforms', () => {
    expect(kbd('Z')).toBe('Ctrl+Z');
  });

  it('inserts Shift+ when requested', () => {
    expect(kbd('Z', { shift: true })).toBe('Ctrl+Shift+Z');
  });
});

describe('shortcutLetter', () => {
  it('prefers the printed letter to the position', () => {
    expect(shortcutLetter({ key: 'z', code: 'KeyY' })).toBe('z');
    expect(shortcutLetter({ key: 'Z', code: 'KeyW' })).toBe('z');
  });

  it('falls back to the position when the key is not a Latin letter', () => {
    expect(shortcutLetter({ key: 'я', code: 'KeyZ' })).toBe('z');
    expect(shortcutLetter({ key: '', code: 'KeyG' })).toBe('g');
  });

  it('returns null for a key that is not a letter', () => {
    expect(shortcutLetter({ key: 'PageUp', code: 'PageUp' })).toBeNull();
    expect(shortcutLetter({ key: '1', code: 'Digit1' })).toBeNull();
  });
});

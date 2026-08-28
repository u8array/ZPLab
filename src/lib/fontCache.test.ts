import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getFont,
  getFontFamily,
  getAllFonts,
  loadFontFile,
  loadFontBytes,
  removeFont,
  subscribe,
  fontByteLength,
  MAX_FONT_BYTES,
} from '@zplab/core/lib/fontCache';

function clearCache(): void {
  for (const font of getAllFonts()) {
    removeFont(font.name);
  }
}

function makeFakeFile(name: string): File {
  return new File(['fake-font-data'], name, { type: 'font/truetype' });
}

describe('fontCache', () => {
  beforeEach(() => {
    clearCache();
  });

  // ── getFont ──────────────────────────────────────────────────────────────────

  it('getFont returns undefined for unknown names', () => {
    expect(getFont('UNKNOWN.TTF')).toBeUndefined();
  });

  it('getFont lookup is case-insensitive', async () => {
    await loadFontFile(makeFakeFile('arial.ttf'), 'arial.ttf');
    expect(getFont('ARIAL.TTF')).toBeDefined();
    expect(getFont('arial.ttf')).toBeDefined();
    expect(getFont('Arial.TTF')).toBeDefined();
  });

  // ── loadFontFile ─────────────────────────────────────────────────────────────

  it('registers the FontFace from bytes, never a url() source', async () => {
    // Regression #356; the why lives at registerFontFace's doc header.
    const sources: unknown[] = [];
    const Original = globalThis.FontFace;
    class CapturingFontFace {
      constructor(_family: string, source: unknown) {
        sources.push(source);
      }
      load() {
        return Promise.resolve(this);
      }
    }
    vi.stubGlobal('FontFace', CapturingFontFace);
    try {
      await loadFontFile(makeFakeFile('arial.ttf'), 'ARIAL.TTF');
    } finally {
      vi.stubGlobal('FontFace', Original);
    }
    expect(sources).toHaveLength(1);
    expect(sources[0]).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(sources[0] as ArrayBuffer)).toBe('fake-font-data');
  });

  it('loadFontFile stores font and can be retrieved via getFont', async () => {
    const entry = await loadFontFile(makeFakeFile('arial.ttf'), 'ARIAL.TTF');
    expect(entry.name).toBe('ARIAL.TTF');
    // Data URL is built from the bytes with a deterministic extension MIME.
    expect(entry.dataUrl).toBe('data:font/ttf;base64,ZmFrZS1mb250LWRhdGE=');
    expect(getFont('ARIAL.TTF')).toBe(entry);
  });

  it('loadFontFile tags an .otf with the OpenType MIME, not TrueType', async () => {
    const entry = await loadFontFile(makeFakeFile('helvetica.otf'), 'HELVETICA.OTF');
    expect(entry.dataUrl.startsWith('data:font/otf;base64,')).toBe(true);
  });

  it('loadFontFile rejects and rolls back when the FontFace cannot register', async () => {
    const realFontFace = globalThis.FontFace;
    // Simulate an OTF the engine can't parse: FontFace.load rejects.
    class FailingFontFace {
      load(): Promise<this> { return Promise.reject(new Error('bad font')); }
    }
    Object.defineProperty(globalThis, 'FontFace', { configurable: true, value: FailingFontFace });
    try {
      await expect(loadFontFile(makeFakeFile('broken.otf'), 'BROKEN.OTF')).rejects.toThrow(
        /could not be registered/,
      );
      expect(getFont('BROKEN.OTF')).toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, 'FontFace', { configurable: true, value: realFontFace });
    }
  });

  it('fontByteLength reports the decoded size without a full decode', async () => {
    await loadFontFile(makeFakeFile('arial.ttf'), 'ARIAL.TTF');
    expect(fontByteLength('ARIAL.TTF')).toBe('fake-font-data'.length);
    expect(fontByteLength('MISSING.TTF')).toBeUndefined();
  });

  it('loadFontFile uppercases the printer name', async () => {
    await loadFontFile(makeFakeFile('arial.ttf'), 'arial.ttf');
    expect(getFont('ARIAL.TTF')).toBeDefined();
  });

  it('loadFontFile derives fontFamily from printer name', async () => {
    const entry = await loadFontFile(makeFakeFile('arial.ttf'), 'ARIAL.TTF');
    expect(entry.fontFamily).toBe('zpl-ARIAL');
  });

  it('loadFontFile persists to localStorage', async () => {
    await loadFontFile(makeFakeFile('arial.ttf'), 'ARIAL.TTF');
    const stored = localStorage.getItem('zpl-font-ARIAL.TTF');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!) as { name: string };
    expect(parsed.name).toBe('ARIAL.TTF');
  });

  // ── getFontFamily ─────────────────────────────────────────────────────────────

  it('getFontFamily returns CSS family for a loaded font', async () => {
    await loadFontFile(makeFakeFile('helvetica.otf'), 'HELVETICA.OTF');
    expect(getFontFamily('HELVETICA.OTF')).toBe('zpl-HELVETICA');
  });

  it('getFontFamily returns undefined for unknown names', () => {
    expect(getFontFamily('MISSING.TTF')).toBeUndefined();
  });

  // ── getAllFonts ───────────────────────────────────────────────────────────────

  it('getAllFonts returns all loaded fonts', async () => {
    await loadFontFile(makeFakeFile('a.ttf'), 'A.TTF');
    await loadFontFile(makeFakeFile('b.ttf'), 'B.TTF');
    const names = getAllFonts().map((f) => f.name).sort();
    expect(names).toEqual(['A.TTF', 'B.TTF']);
  });

  it('getAllFonts returns empty array when nothing is loaded', () => {
    expect(getAllFonts()).toHaveLength(0);
  });

  it('drops the cache entry when the engine rejects the bytes', async () => {
    // The why lives at settleRegistration's doc header.
    class RejectingFontFace {
      load() { return Promise.reject(new Error('bad font')); }
    }
    const Original = globalThis.FontFace;
    vi.stubGlobal('FontFace', RejectingFontFace);
    try {
      const entry = await loadFontBytes(new Uint8Array([1, 2, 3]), 'BROKEN.TTF');
      expect(entry.name).toBe('BROKEN.TTF');
      expect(getFontFamily('BROKEN.TTF')).toBeUndefined();
      expect(localStorage.getItem('zplab.font.BROKEN.TTF')).toBeNull();
    } finally {
      vi.stubGlobal('FontFace', Original);
    }
  });

  // ── removeFont ────────────────────────────────────────────────────────────────

  it('removeFont deletes from cache and localStorage', async () => {
    await loadFontFile(makeFakeFile('arial.ttf'), 'ARIAL.TTF');
    expect(getFont('ARIAL.TTF')).toBeDefined();
    removeFont('ARIAL.TTF');
    expect(getFont('ARIAL.TTF')).toBeUndefined();
    expect(localStorage.getItem('zpl-font-ARIAL.TTF')).toBeNull();
  });

  it('removeFont on unknown name does not throw', () => {
    expect(() => removeFont('NONEXISTENT.TTF')).not.toThrow();
  });

  // ── subscribe ─────────────────────────────────────────────────────────────────

  it('subscribe is notified when a font is loaded', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    await loadFontFile(makeFakeFile('arial.ttf'), 'ARIAL.TTF');
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('subscribe is notified when a font is removed', async () => {
    await loadFontFile(makeFakeFile('arial.ttf'), 'ARIAL.TTF');
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    removeFont('ARIAL.TTF');
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('unsubscribe stops notifications', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    unsubscribe();
    await loadFontFile(makeFakeFile('arial.ttf'), 'ARIAL.TTF');
    expect(listener).not.toHaveBeenCalled();
  });

  // ── validation ────────────────────────────────────────────────────────────────

  it('loadFontFile rejects files without a TTF/OTF extension', async () => {
    const file = new File(['x'], 'arial.woff2', { type: 'font/woff2' });
    await expect(loadFontFile(file, 'ARIAL.WOFF2')).rejects.toThrow(/Not a TTF\/OTF font/);
  });

  it('loadFontFile rejects files above the byte cap', async () => {
    const oversized = new File(
      [new Uint8Array(MAX_FONT_BYTES + 1)],
      'big.ttf',
      { type: 'font/ttf' },
    );
    await expect(loadFontFile(oversized, 'BIG.TTF')).rejects.toThrow(/too large/);
  });
});

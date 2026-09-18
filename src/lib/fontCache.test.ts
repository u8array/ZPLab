import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getFont,
  getFontFamily,
  getFontBytes,
  hasFontBytes,
  holdsOtherBytes,
  cachedFontPath,
  isFontFile,
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
    removeFont(cachedFontPath(font));
  }
}

/** Rows as an earlier build persisted them, then a fresh module instance that hydrates them. */
async function bootWithRows(rows: Record<string, object>) {
  for (const [key, row] of Object.entries(rows)) localStorage.setItem(`zpl-font-${key}`, JSON.stringify(row));
  vi.resetModules();
  return import('@zplab/core/lib/fontCache');
}
const LEGACY = { id: 'legacy', name: 'LEGACY.TTF', dataUrl: 'data:font/ttf;base64,AAAA', fontFamily: 'zpl-legacy' };

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
    const entry = await loadFontFile(makeFakeFile('arial.ttf'), 'E:ARIAL.TTF');
    expect(entry.name).toBe('E:ARIAL.TTF');
    // Data URL is built from the bytes with a deterministic extension MIME.
    expect(entry.dataUrl).toBe('data:font/ttf;base64,ZmFrZS1mb250LWRhdGE=');
    expect(getFont('E:ARIAL.TTF')).toBe(entry);
    expect(getFont('ARIAL.TTF')).toBeUndefined();
  });

  it('loadFontFile tags an .otf with the OpenType MIME, not TrueType', async () => {
    const entry = await loadFontFile(makeFakeFile('helvetica.otf'), 'HELVETICA.OTF');
    expect(entry.dataUrl.startsWith('data:font/otf;base64,')).toBe(true);
  });

  it('loadFontFile keeps the bytes when the engine declines the face, so the printer can still get them', async () => {
    const realFontFace = globalThis.FontFace;
    class FailingFontFace {
      load(): Promise<this> { return Promise.reject(new Error('bad font')); }
    }
    Object.defineProperty(globalThis, 'FontFace', { configurable: true, value: FailingFontFace });
    try {
      await loadFontFile(makeFakeFile('broken.otf'), 'E:BROKEN.OTF');
      expect(hasFontBytes('E:BROKEN.OTF')).toBe(true);
      expect(getFontFamily('E:BROKEN.OTF')).toBeUndefined();
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

  it('gives each row its own fontFamily, so two names that differ only in punctuation never share a face', async () => {
    const dash = await loadFontFile(makeFakeFile('a.ttf'), 'E:MY-FONT.TTF');
    const under = await loadFontFile(makeFakeFile('b.ttf'), 'E:MY_FONT.TTF');
    expect(dash.fontFamily).toMatch(/^zpl-[0-9a-f-]+$/);
    expect(dash.fontFamily).not.toBe(under.fontFamily);
  });

  it('keeps the row and its family when the same bytes register again', async () => {
    const first = await loadFontFile(makeFakeFile('arial.ttf'), 'E:ARIAL.TTF');
    const again = await loadFontFile(makeFakeFile('arial.ttf'), 'E:ARIAL.TTF');
    expect(again).toBe(first);
    expect(getAllFonts()).toHaveLength(1);
  });

  it('finds a row from before the key carried a device under E:, the drive the app of that time named', async () => {
    const fresh = await bootWithRows({ 'LEGACY.TTF': LEGACY });
    expect(fresh.cachedFontPath(fresh.getAllFonts()[0]!)).toBe('E:LEGACY.TTF');
    expect(fresh.getFont('E:LEGACY.TTF')?.name).toBe('LEGACY.TTF');
    expect(fresh.getFont('R:LEGACY.TTF')).toBeUndefined();
    fresh.removeFont('E:LEGACY.TTF');
    expect(fresh.getAllFonts()).toHaveLength(0);
  });

  it('lets the first device that writes a legacy file claim its row, keys moved and id kept', async () => {
    const fresh = await bootWithRows({ 'LEGACY.TTF': LEGACY });
    const row = await fresh.loadFontBytes(new Uint8Array([1, 2, 3]), 'R:LEGACY.TTF');
    expect(row.id).toBe('legacy');
    expect(fresh.getAllFonts().map((f) => f.name)).toEqual(['R:LEGACY.TTF']);
    expect(localStorage.getItem('zpl-font-LEGACY.TTF')).toBeNull();
    expect(localStorage.getItem('zpl-font-R:LEGACY.TTF')).not.toBeNull();
    expect(fresh.getFont('E:LEGACY.TTF')).toBeUndefined();
    fresh.removeFont('R:LEGACY.TTF');
  });

  it('announces an adopted row even when its bytes did not change, since its keys moved', async () => {
    const fresh = await bootWithRows({ 'LEGACY.TTF': LEGACY });
    let hits = 0;
    const stop = fresh.subscribe(() => { hits += 1; });
    try {
      fresh.loadFontBytesSync(new Uint8Array([0, 0, 0]), 'E:LEGACY.TTF');
      expect(hits).toBe(1);
      expect(fresh.getAllFonts().map((f) => f.name)).toEqual(['E:LEGACY.TTF']);
      expect(localStorage.getItem('zpl-font-E:LEGACY.TTF')).not.toBeNull();
    } finally {
      stop();
      fresh.removeFont('E:LEGACY.TTF');
    }
  });

  it('drops a bare row a qualified row for the same file has superseded, at hydration', async () => {
    const fresh = await bootWithRows({ 'LEGACY.TTF': LEGACY, 'E:LEGACY.TTF': { id: 'newer', name: 'E:LEGACY.TTF', dataUrl: 'data:font/ttf;base64,AQID', fontFamily: 'zpl-newer' } });
    expect(fresh.getAllFonts().map((f) => f.name)).toEqual(['E:LEGACY.TTF']);
    expect(localStorage.getItem('zpl-font-LEGACY.TTF')).toBeNull();
    fresh.removeFont('E:LEGACY.TTF');
  });

  it('ignores a persisted row that is not in the shape this module writes', async () => {
    const fresh = await bootWithRows({ BROKEN: { dataUrl: 'data:font/ttf;base64,AAAA' }, NUMERIC: { id: 'n', name: 5, dataUrl: 'data:,', fontFamily: 'f' } });
    expect(fresh.getAllFonts()).toHaveLength(0);
  });

  it('takes a TrueType Extension file, whose face the engine may decline, as bytes for ^CW and ~DY', async () => {
    const realFontFace = globalThis.FontFace;
    class FailingFontFace {
      load(): Promise<this> { return Promise.reject(new Error('unsupported')); }
    }
    Object.defineProperty(globalThis, 'FontFace', { configurable: true, value: FailingFontFace });
    try {
      await loadFontFile(makeFakeFile('cjk.tte'), 'E:CJK.TTE');
      expect(hasFontBytes('E:CJK.TTE')).toBe(true);
      expect(getFontFamily('E:CJK.TTE')).toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, 'FontFace', { configurable: true, value: realFontFace });
    }
  });

  it('isFontFile answers the extension and size gates before a byte is read', () => {
    expect(isFontFile(new File(['x'], 'a.otf'))).toBe(true);
    expect(isFontFile(new File(['x'], 'a.txt'))).toBe(false);
    expect(isFontFile(new File([new Uint8Array(MAX_FONT_BYTES + 1)], 'big.ttf'))).toBe(false);
  });

  it('holdsOtherBytes asks the row the path resolves to', async () => {
    await loadFontBytes(new Uint8Array([1, 2, 3]), 'E:HOLD.TTF');
    expect(holdsOtherBytes('e:hold.ttf', new Uint8Array([1, 2, 3]))).toBe(false);
    expect(holdsOtherBytes('E:HOLD.TTF', new Uint8Array([9]))).toBe(true);
    expect(holdsOtherBytes('R:HOLD.TTF', new Uint8Array([9]))).toBe(false);
  });

  it('cachedFontPath names a qualified row as it is', async () => {
    const row = await loadFontBytes(new Uint8Array([1]), 'r:x.ttf');
    expect(cachedFontPath(row)).toBe('R:X.TTF');
  });

  it('never lets a remainder that still names a device stand in for another row', async () => {
    await loadFontFile(makeFakeFile('x.ttf'), 'E:X.TTF');
    expect(getFont('E:E:X.TTF')).toBeUndefined();
    expect(getFont('E:AB:CD.TTF')).toBeUndefined();
    expect(getFont('e:x.ttf')?.name).toBe('E:X.TTF');
  });

  it('files a name without a device under R:, where the printer looks', async () => {
    const entry = await loadFontFile(makeFakeFile('arial.ttf'), 'ARIAL.TTF');
    expect(entry.name).toBe('R:ARIAL.TTF');
  });

  it('loadFontFile persists to localStorage', async () => {
    await loadFontFile(makeFakeFile('arial.ttf'), 'E:ARIAL.TTF');
    const stored = localStorage.getItem('zpl-font-E:ARIAL.TTF');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!) as { name: string };
    expect(parsed.name).toBe('E:ARIAL.TTF');
  });

  // ── getFontFamily ─────────────────────────────────────────────────────────────

  it('getFontFamily returns CSS family for a loaded font', async () => {
    const entry = await loadFontFile(makeFakeFile('helvetica.otf'), 'E:HELVETICA.OTF');
    expect(getFontFamily('E:HELVETICA.OTF')).toBe(entry.fontFamily);
  });

  it('getFontFamily returns undefined for unknown names', () => {
    expect(getFontFamily('MISSING.TTF')).toBeUndefined();
  });

  // ── getAllFonts ───────────────────────────────────────────────────────────────

  it('getAllFonts returns all loaded fonts', async () => {
    await loadFontFile(makeFakeFile('a.ttf'), 'E:A.TTF');
    await loadFontFile(makeFakeFile('b.ttf'), 'E:B.TTF');
    const names = getAllFonts().map((f) => f.name).sort();
    expect(names).toEqual(['E:A.TTF', 'E:B.TTF']);
  });

  it('getAllFonts returns empty array when nothing is loaded', () => {
    expect(getAllFonts()).toHaveLength(0);
  });

  it('keeps the row and the last accepted face when the engine rejects a newer upload', async () => {
    const good = await loadFontBytes(new Uint8Array([1, 2, 3]), 'E:KEEP.TTF');
    expect(getFontFamily('E:KEEP.TTF')).toBe(good.fontFamily);
    class RejectingFontFace {
      load() { return Promise.reject(new Error('bad font')); }
    }
    const Original = globalThis.FontFace;
    vi.stubGlobal('FontFace', RejectingFontFace);
    try {
      await loadFontBytes(new Uint8Array([9, 9, 9]), 'E:KEEP.TTF');
      // Bytes are the newest upload; the face stays the last one the engine accepted.
      expect(getFontBytes('E:KEEP.TTF')).toEqual(new Uint8Array([9, 9, 9]));
      expect(getFontFamily('E:KEEP.TTF')).toBe(good.fontFamily);
      expect(localStorage.getItem('zpl-font-E:KEEP.TTF')).not.toBeNull();
    } finally {
      vi.stubGlobal('FontFace', Original);
    }
  });

  it('lets the latest registration own the face, whatever order the engine resolves them in', async () => {
    const resolvers: (() => void)[] = [];
    class SlowFontFace {
      family: string;
      constructor(family: string) { this.family = family; }
      load() { return new Promise<this>((resolve) => { resolvers.push(() => resolve(this)); }); }
    }
    const Original = globalThis.FontFace;
    vi.stubGlobal('FontFace', SlowFontFace);
    const added: string[] = [];
    const fontsBefore = document.fonts;
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add: (f: { family: string }) => { added.push(f.family); }, delete: () => true } });
    try {
      const first = loadFontBytes(new Uint8Array([1]), 'E:RACE.TTF');
      const second = loadFontBytes(new Uint8Array([2]), 'E:RACE.TTF');
      // The older registration resolves last; it must not overwrite the newer face.
      resolvers[1]!();
      resolvers[0]!();
      await Promise.all([first, second]);
      expect(added).toHaveLength(1);
      expect(getFontBytes('E:RACE.TTF')).toEqual(new Uint8Array([2]));
      expect(getFontFamily('E:RACE.TTF')).toBeDefined();
    } finally {
      vi.stubGlobal('FontFace', Original);
      Object.defineProperty(document, 'fonts', { configurable: true, value: fontsBefore });
    }
  });

  // ── removeFont ────────────────────────────────────────────────────────────────

  it('removeFont deletes from cache and localStorage', async () => {
    await loadFontFile(makeFakeFile('arial.ttf'), 'ARIAL.TTF');
    expect(getFont('ARIAL.TTF')).toBeDefined();
    removeFont('ARIAL.TTF');
    expect(getFont('ARIAL.TTF')).toBeUndefined();
    expect(localStorage.getItem('zpl-font-R:ARIAL.TTF')).toBeNull();
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

  it('loadFontFile rejects files without a font extension', async () => {
    const file = new File(['x'], 'arial.woff2', { type: 'font/woff2' });
    await expect(loadFontFile(file, 'ARIAL.WOFF2')).rejects.toThrow(/Not a TTF\/OTF\/TTE font/);
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

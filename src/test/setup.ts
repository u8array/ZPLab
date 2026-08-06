/**
 * Vitest global setup: stubs browser APIs that are unavailable in Node.js.
 * Runs once per worker before any module is evaluated, so top-level module
 * code in imageCache.ts, labelStore.ts etc. can initialise without crashing.
 */

// ── localStorage ──────────────────────────────────────────────────────────────
const _ls: Record<string, string | undefined> = {};

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    get length() { return Object.keys(_ls).length; },
    key(i: number): string | null { return Object.keys(_ls)[i] ?? null; },
    getItem(key: string): string | null {
      return Object.prototype.hasOwnProperty.call(_ls, key) ? (_ls[key] ?? null) : null;
    },
    setItem(key: string, value: string): void { _ls[key] = value; },
    removeItem(key: string): void { _ls[key] = undefined; },
    clear(): void { for (const k of Object.keys(_ls)) _ls[k] = undefined; },
  } as Storage,
});

// ── FileReader ────────────────────────────────────────────────────────────────

class FakeFileReader {
  result: string | null = null;
  onload: ((event: { target: FakeFileReader }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  readAsDataURL(): void {
    this.result = 'data:font/truetype;base64,AAAA';
    this.onload?.({ target: this });
  }
}

Object.defineProperty(globalThis, 'FileReader', {
  configurable: true,
  value: FakeFileReader,
});

// ── FontFace ──────────────────────────────────────────────────────────────────

class FakeFontFace {
  load(): Promise<this> { return Promise.resolve(this); }
}

Object.defineProperty(globalThis, 'FontFace', {
  configurable: true,
  value: FakeFontFace,
});

// ── ResizeObserver ────────────────────────────────────────────────────────────

// jsdom ships none, and the headless-ui popovers the settings dialog uses
// construct one on open; without it they throw as an unhandled error.
if (typeof globalThis.ResizeObserver === 'undefined') {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class {
      observe(): undefined {
        return undefined;
      }
      unobserve(): undefined {
        return undefined;
      }
      disconnect(): undefined {
        return undefined;
      }
    },
  });
}

// A real DOM (jsdom) is present only for files that opt in via
// `// @vitest-environment jsdom`; the default lane is pure Node. The stubs
// below would clobber jsdom's window/document, so apply them only when no
// real DOM exists.
const hasRealDom =
  typeof window !== 'undefined' && typeof document !== 'undefined' && !!document.body;

if (!hasRealDom) {
  // ── navigator ───────────────────────────────────────────────────────────────
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { language: 'en-US' } as Partial<Navigator>,
  });

  // ── window (matchMedia is read at store init for the initial theme) ────────
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      matchMedia: () => ({
        matches: false,
        addEventListener: () => { /* noop */ },
        removeEventListener: () => { /* noop */ },
      }),
    } as unknown as Window,
  });
} else if (!window.matchMedia) {
  // jsdom lacks matchMedia, still read at store init.
  window.matchMedia = (() => ({
    matches: false,
    addEventListener: () => { /* noop */ },
    removeEventListener: () => { /* noop */ },
  })) as unknown as typeof window.matchMedia;
}

// Canvas stub for the ^GFA parser path.

/** Minimal ImageData stub for canvas operations in Node. */
class FakeImageData {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

function createFakeCanvas() {
  let _width = 0;
  let _height = 0;
  let _imageData: FakeImageData | null = null;

  const ctx = {
    createImageData(w: number, h: number): FakeImageData {
      return new FakeImageData(w, h);
    },
    putImageData(data: FakeImageData): void {
      _imageData = data;
    },
    getImageData(_sx: number, _sy: number, w: number, h: number): FakeImageData {
      return _imageData ?? new FakeImageData(w, h);
    },
    fillRect(): void { /* noop */ },
    // Konva probes the hit canvas (getHitColor) on Shape construction.
    clearRect(): void { /* noop */ },
    drawImage(): void { /* noop */ },
    set fillStyle(_v: string) { /* noop */ },
  };

  return {
    get width() { return _width; },
    set width(v: number) { _width = v; },
    get height() { return _height; },
    set height(v: number) { _height = v; },
    getContext: () => ctx,
    toDataURL: () => 'data:image/png;base64,AAAA',
  };
}

if (!hasRealDom) {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement(tag: string): unknown {
        if (tag === 'canvas') return createFakeCanvas();
        return {};
      },
      fonts: { add() { /* noop */ } } as unknown as FontFaceSet,
    } as Partial<Document>,
  });
}

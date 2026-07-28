import { describe, it, expect } from 'vitest';
import { ObjectRegistry, getEntry } from '@zplab/core/registry';
import type { LabelObjectBase } from '@zplab/core/types/LabelObject';
import { defined } from '../test/helpers';
import { qualityPatch, type DataMatrixProps } from '@zplab/core/registry/datamatrix';

function makeObj<P extends object>(type: string, props: P, overrides?: Partial<LabelObjectBase>): LabelObjectBase & { props: P } {
  return {
    id: 'test-id',
    type,
    x: 100,
    y: 200,
    rotation: 0,
    ...overrides,
    props,
  };
}

// ── text ──────────────────────────────────────────────────────────────────────

describe('text.toZPL', () => {
  const def = defined(ObjectRegistry['text']);

  it('emits ^FO, ^A0, ^FD^FS for basic text', () => {
    const zpl = def.toZPL(makeObj('text', {
      content: 'Hello', fontHeight: 30, fontWidth: 0, rotation: 'N',
    }));
    // obj is at (100, 200), the Konva render position. The emitted ^FO
    // shifts to the ZPL cap-top anchor: for N h=30, dy = 30 * 0.154 = 4.62,
    // rounded to integer dots = 5 ⇒ 200 + 5 = 205.
    expect(zpl).toContain('^FO100,205');
    expect(zpl).toContain('^A0N,30,0');
    expect(zpl).toContain('^FDHello^FS');
  });

  it('uses ^FT when positionType is FT', () => {
    const zpl = def.toZPL(makeObj('text', {
      content: 'Hi', fontHeight: 20, fontWidth: 0, rotation: 'N',
    }, { positionType: 'FT' }));
    // FT shifts to the baseline: for N h=20, dy = 20 * 0.92 = 18.4,
    // rounded to integer dots = 18 ⇒ 200 + 18 = 218.
    expect(zpl).toContain('^FT100,218');
  });

  it('emits a bare ^FR for reverse text (knocks out of a separate box)', () => {
    const zpl = def.toZPL(makeObj('text', {
      content: 'Rev', fontHeight: 30, fontWidth: 0, rotation: 'N', reverse: true,
    }));
    // Spec-true reverse: ^FR before ^FD knocks the glyphs out of whatever is
    // drawn behind the field. No synthesized background box, so the field
    // round-trips with its own anchor; the black box is the user's own object.
    expect(zpl).toContain('^FR^FD');
    expect(zpl).not.toContain('^GB');
    expect(zpl).not.toContain('^LRY');
  });

  it('emits ^FB for field block properties', () => {
    const zpl = def.toZPL(makeObj('text', {
      content: 'Block', fontHeight: 30, fontWidth: 0, rotation: 'N',
      blockWidth: 400, blockLines: 3, blockLineSpacing: 5, blockJustify: 'C',
    }));
    expect(zpl).toContain('^FB400,3,5,C,0');
  });

  it('emits ^FB hanging indent in slot e', () => {
    const zpl = def.toZPL(makeObj('text', {
      content: 'Block', fontHeight: 30, fontWidth: 0, rotation: 'N',
      blockWidth: 400, blockLines: 3, blockLineSpacing: 0, blockJustify: 'L',
      blockHangingIndent: 40,
    }));
    expect(zpl).toContain('^FB400,3,0,L,40');
  });

  it('does not emit ^FB when blockWidth is absent', () => {
    const zpl = def.toZPL(makeObj('text', {
      content: 'No block', fontHeight: 30, fontWidth: 0, rotation: 'N',
    }));
    expect(zpl).not.toContain('^FB');
  });

  it('emits ^A@ with printer font name instead of ^A0', () => {
    const zpl = def.toZPL(makeObj('text', {
      content: 'Custom', fontHeight: 40, fontWidth: 20, rotation: 'N',
      printerFontName: 'ARIAL.TTF',
    }));
    expect(zpl).toContain('^A@N,40,20,E:ARIAL.TTF');
    expect(zpl).not.toContain('^A0');
  });

  it('^A@ preserves rotation', () => {
    const zpl = def.toZPL(makeObj('text', {
      content: 'Rot', fontHeight: 30, fontWidth: 0, rotation: 'R',
      printerFontName: 'HELVETICA.TTF',
    }));
    expect(zpl).toContain('^A@R,30,0,E:HELVETICA.TTF');
  });

  it('emits ^A{fontId} short form when fontId is set', () => {
    const zpl = def.toZPL(makeObj('text', {
      content: 'A', fontHeight: 30, fontWidth: 0, rotation: 'N', fontId: 'M',
    }));
    expect(zpl).toContain('^AMN,30,0');
    expect(zpl).not.toContain('^A0');
    expect(zpl).not.toContain('^A@');
  });

  it('fontId wins over printerFontName when both are set', () => {
    const zpl = def.toZPL(makeObj('text', {
      content: 'A', fontHeight: 30, fontWidth: 0, rotation: 'N',
      fontId: 'M', printerFontName: 'ARIAL.TTF',
    }));
    expect(zpl).toContain('^AMN,30,0');
    expect(zpl).not.toContain('^A@');
  });

  it('uses label.defaultFontId as fallback when no field-level font is set', () => {
    const labelWithDefault: Parameters<typeof def.toZPL>[1] = {
      label: { widthMm: 100, heightMm: 60, dpmm: 8, defaultFontId: 'M' },
    };
    const zpl = def.toZPL(
      makeObj('text', { content: 'A', fontHeight: 30, fontWidth: 0, rotation: 'N' }),
      labelWithDefault,
    );
    expect(zpl).toContain('^AMN,30,0');
    expect(zpl).not.toContain('^A0');
  });

  it('keeps ^A0 fallback when neither field nor label sets a font', () => {
    const zpl = def.toZPL(
      makeObj('text', { content: 'A', fontHeight: 30, fontWidth: 0, rotation: 'N' }),
      { label: { widthMm: 100, heightMm: 60, dpmm: 8 } },
    );
    expect(zpl).toContain('^A0N,30,0');
  });
});

// ── box ───────────────────────────────────────────────────────────────────────

describe('box.toZPL', () => {
  const def = defined(ObjectRegistry['box']);

  it('emits ^GB with correct dimensions for an unfilled box', () => {
    const zpl = def.toZPL(makeObj('box', {
      width: 200, height: 100, thickness: 3, filled: false, color: 'B', rounding: 0,
    }));
    expect(zpl).toContain('^GB200,100,3,B,0');
  });

  it('uses min(w,h) as thickness for a filled box', () => {
    const zpl = def.toZPL(makeObj('box', {
      width: 200, height: 100, thickness: 3, filled: true, color: 'B', rounding: 0,
    }));
    // filled → thickness = min(200, 100) = 100
    expect(zpl).toContain('^GB200,100,100,B,0');
  });

  it('includes rounding parameter', () => {
    const zpl = def.toZPL(makeObj('box', {
      width: 100, height: 100, thickness: 3, filled: false, color: 'B', rounding: 5,
    }));
    expect(zpl).toContain(',5');
  });
});

// ── line ──────────────────────────────────────────────────────────────────────

describe('line.toZPL', () => {
  const def = defined(ObjectRegistry['line']);

  it('emits horizontal ^GB for angle 0', () => {
    const zpl = def.toZPL(makeObj('line', {
      angle: 0, length: 500, thickness: 3, color: 'B',
    }));
    expect(zpl).toContain('^GB500,3,3,B,0');
  });

  it('emits vertical ^GB for angle 90', () => {
    const zpl = def.toZPL(makeObj('line', {
      angle: 90, length: 300, thickness: 5, color: 'B',
    }));
    expect(zpl).toContain('^GB5,300,5,B,0');
  });

  it('emits horizontal ^GB shifted left for angle 180', () => {
    // obj.x=100, angle=180, length=500 → box must start at x=100-500=-400
    const zpl = def.toZPL(makeObj('line', {
      angle: 180, length: 500, thickness: 3, color: 'B',
    }));
    expect(zpl).toContain('^FO-400,200');
    expect(zpl).toContain('^GB500,3,3,B,0');
  });

  it('emits vertical ^GB shifted up for angle 270', () => {
    // obj.y=200, angle=270, length=300 → box must start at y=200-300=-100
    const zpl = def.toZPL(makeObj('line', {
      angle: 270, length: 300, thickness: 5, color: 'B',
    }));
    expect(zpl).toContain('^FO100,-100');
    expect(zpl).toContain('^GB5,300,5,B,0');
  });

  it('emits ^GD for diagonal angles', () => {
    const zpl = def.toZPL(makeObj('line', {
      angle: 45, length: 200, thickness: 3, color: 'B',
    }));
    expect(zpl).toContain('^GD');
  });
});

// ── ellipse ───────────────────────────────────────────────────────────────────

describe('ellipse.toZPL', () => {
  const def = defined(ObjectRegistry['ellipse']);

  it('emits ^GE with correct dimensions for non-square axes', () => {
    const zpl = def.toZPL(makeObj('ellipse', {
      width: 150, height: 100, thickness: 3, filled: false, color: 'B',
    }));
    expect(zpl).toContain('^GE150,100,3,B');
  });

  it('uses min(w,h) as thickness when filled', () => {
    const zpl = def.toZPL(makeObj('ellipse', {
      width: 150, height: 100, thickness: 3, filled: true, color: 'B',
    }));
    expect(zpl).toContain('^GE150,100,100,B');
  });

  it('collapses to ^GC when width equals height', () => {
    const zpl = def.toZPL(makeObj('ellipse', {
      width: 80, height: 80, thickness: 3, filled: false, color: 'B',
    }));
    expect(zpl).toContain('^GC80,3,B');
    expect(zpl).not.toContain('^GE');
  });
});

// ── ellipse (lockAspect) ─────────────────────────────────────────────────────

describe('ellipse with lockAspect (former circle)', () => {
  const def = defined(ObjectRegistry['ellipse']);

  it('keeps width === height via min(sx, sy) on commitTransform', () => {
    const result = def.commitTransform!(
      makeObj('ellipse', {
        width: 100, height: 100, thickness: 3, filled: false, color: 'B', lockAspect: true,
      }),
      { sx: 2, sy: 1.5, snap: (n) => n, nodeHeight: 0, anchor: null },
    );
    expect(result).toEqual({ width: 150, height: 150 });
  });

  it('clamps diameter to at least 1 when scaled to zero', () => {
    const result = def.commitTransform!(
      makeObj('ellipse', {
        width: 100, height: 100, thickness: 3, filled: false, color: 'B', lockAspect: true,
      }),
      { sx: 0, sy: 0, snap: (n) => n, nodeHeight: 0, anchor: null },
    );
    expect(result).toEqual({ width: 1, height: 1 });
  });
});

// ── code128 ───────────────────────────────────────────────────────────────────

describe('code128.toZPL', () => {
  const def = defined(ObjectRegistry['code128']);

  it('emits ^BC and ^FD', () => {
    const zpl = def.toZPL(makeObj('code128', {
      content: 'ABCDEF', height: 100, moduleWidth: 2,
      printInterpretation: true, checkDigit: false, rotation: 'N',
    }));
    expect(zpl).toContain('^BCN,100,Y,N,N');
    expect(zpl).toContain('^FDABCDEF^FS');
  });

  it('emits ^BY when moduleWidth is not 2', () => {
    const zpl = def.toZPL(makeObj('code128', {
      content: '123', height: 100, moduleWidth: 5,
      printInterpretation: true, checkDigit: false, rotation: 'N',
    }));
    expect(zpl).toContain('^BY5');
  });

  it('always emits ^BY to prevent ZPL state leaking to subsequent barcodes', () => {
    const zpl = def.toZPL(makeObj('code128', {
      content: '123', height: 100, moduleWidth: 2,
      printInterpretation: true, checkDigit: false, rotation: 'N',
    }));
    expect(zpl).toContain('^BY2');
  });
});

// ── rotation ──────────────────────────────────────────────────────────────────

describe('barcode rotation in ZPL output', () => {
  type Rot = 'N' | 'R' | 'I' | 'B';
  it.each<[string, string, Rot, Record<string, unknown>]>([
    ['code128',    '^BCR,', 'R', { height: 100, moduleWidth: 2, printInterpretation: true, checkDigit: false }],
    ['code39',     '^B3I,', 'I', { height: 100, moduleWidth: 2, printInterpretation: true, checkDigit: false }],
    ['ean13',      '^BEB,', 'B', { height: 100, moduleWidth: 2, printInterpretation: true }],
    ['datamatrix', '^BXI,', 'I', { dimension: 5, quality: 200, gs1: false }],
    ['pdf417',     '^B7B,', 'B', { rowHeight: 4, securityLevel: 0, columns: 0, moduleWidth: 2 }],
    ['aztec',      '^B0R,', 'R', { magnification: 4, ecLevel: 0 }],
    ['codabar',    '^BKR,', 'R', { height: 100, moduleWidth: 2, printInterpretation: true, checkDigit: false }],
  ])('%s emits orientation in command param', (type, expected, rotation, baseProps) => {
    const def = defined(getEntry(type));
    const content = type === 'ean13' ? '590123412345' : 'X';
    const zpl = def.toZPL(makeObj(type, { content, ...baseProps, rotation }));
    expect(zpl).toContain(expected);
  });

  // ^BQ's orientation slot is decorative (firmware prints normal only), so the
  // emit pins it to N instead of pretending the code can rotate.
  it('qrcode pins the decorative orientation slot to N', () => {
    const def = defined(getEntry('qrcode'));
    const zpl = def.toZPL(makeObj('qrcode', { content: 'X', magnification: 4, errorCorrection: 'Q', model: 2, rotation: 'N' }));
    expect(zpl).toContain('^BQN,');
  });

  // Rotated QR: ^BQ cannot rotate, so the emit switches to a pre-rotated
  // ^GFA graphic plus a sidecar for lossless reimport.
  it('qrcode rotated emits sidecar + ^GFA instead of ^BQ', () => {
    const def = defined(getEntry('qrcode'));
    const zpl = def.toZPL(makeObj('qrcode', { content: 'X', magnification: 4, errorCorrection: 'Q', model: 2, rotation: 'R' }));
    expect(zpl).toContain('^FXZPLLAB:');
    expect(zpl).toContain('^GFA,');
    expect(zpl).not.toContain('^BQ');
  });

  // Canvas, bounds and preflight read obj.y as the ^FT bottom anchor, so the
  // graphic must use fieldPos, not an image-style y+h (one height too low).
  it('qrcode rotated under ^FT keeps the barcode bottom anchor', () => {
    const def = defined(getEntry('qrcode'));
    const zpl = def.toZPL(makeObj(
      'qrcode',
      { content: 'X', magnification: 4, errorCorrection: 'Q', model: 2, rotation: 'R' },
      { positionType: 'FT' },
    ));
    expect(zpl).toContain('^FT100,200');
  });

  // A bound rotated QR must bake the value the preview shows (the variable's
  // default), not the literal marker text.
  it('qrcode rotated bakes the resolved variable value, not the marker', () => {
    const def = defined(getEntry('qrcode'));
    const ctx = {
      label: { widthMm: 100, heightMm: 50, dpmm: 8 },
      variables: [{ id: 'v1', name: 'sku', fnNumber: 1, defaultValue: '12345' }],
    } as unknown as Parameters<typeof def.toZPL>[1];
    const gfaOf = (zpl: string) => zpl.slice(zpl.indexOf('^GFA'));
    const qr = { magnification: 4, errorCorrection: 'Q', model: 2, rotation: 'R' } as const;
    const bound = def.toZPL(makeObj('qrcode', { ...qr, content: '«sku»' }), ctx);
    const literal = def.toZPL(makeObj('qrcode', { ...qr, content: '12345' }), ctx);
    expect(gfaOf(bound)).toBe(gfaOf(literal));
  });

  // Empty must not bake the canvas placeholder (" "); plain ^BQ keeps the
  // payload empty.
  it('qrcode rotated with empty content falls back to plain ^BQ', () => {
    const def = defined(getEntry('qrcode'));
    const zpl = def.toZPL(makeObj('qrcode', { content: '', magnification: 4, errorCorrection: 'Q', model: 2, rotation: 'R' }));
    expect(zpl).toContain('^BQN,');
    expect(zpl).not.toContain('^GFA');
  });

  // Preview and print couple clock2/clock3 to the label's ^SO offsets, so the
  // baked graphic must apply them too.
  it('qrcode rotated applies the label clock offsets to clock markers', () => {
    const def = defined(getEntry('qrcode'));
    const ctxFor = (offset?: { years: number }) => ({
      label: { widthMm: 100, heightMm: 50, dpmm: 8, secondaryClockOffset: offset },
      variables: [],
    }) as unknown as Parameters<typeof def.toZPL>[1];
    const gfaOf = (zpl: string) => zpl.slice(zpl.indexOf('^GFA'));
    const qr = { content: '«clock2:Y»', magnification: 4, errorCorrection: 'Q', model: 2, rotation: 'R' } as const;
    const shifted = def.toZPL(makeObj('qrcode', { ...qr }), ctxFor({ years: 5 }));
    const plain = def.toZPL(makeObj('qrcode', { ...qr }), ctxFor(undefined));
    expect(gfaOf(shifted)).not.toBe(gfaOf(plain));
  });

  // The graphic encoder only produces Model 2, so a rotated Model 1 QR needs
  // the warning.
  it('qrcode rotated model 1 warns that it prints as Model 2', () => {
    const def = defined(getEntry('qrcode'));
    const ctx = { label: { widthMm: 100, heightMm: 50, dpmm: 8 }, unit: 'mm' } as const;
    const kinds = (model: 1 | 2, rotation: 'N' | 'R') =>
      (def.preflight?.(
        makeObj('qrcode', { content: 'X', magnification: 4, errorCorrection: 'Q', model, rotation }),
        ctx,
      ) ?? []).map((f) => f.kind);
    expect(kinds(1, 'R')).toContain('qrRotatedModel2');
    expect(kinds(1, 'N')).not.toContain('qrRotatedModel2');
    expect(kinds(2, 'R')).not.toContain('qrRotatedModel2');
  });

  // The graphic freezes dynamic content, so every per-label marker kind must
  // trip the static warning (clock markers share the «…» form, so they count).
  it('qrcode rotated warns for variable and clock markers, only when rotated', () => {
    const def = defined(getEntry('qrcode'));
    const ctx = { label: { widthMm: 100, heightMm: 50, dpmm: 8 }, unit: 'mm' } as const;
    const warns = (content: string, rotation: 'N' | 'R') =>
      (def.preflight?.(
        makeObj('qrcode', { content, magnification: 4, errorCorrection: 'Q', model: 2, rotation }),
        ctx,
      ) ?? []).some((f) => f.kind === 'qrRotatedStatic');
    expect(warns('«sku»', 'R')).toBe(true);
    expect(warns('«clock:Y»', 'R')).toBe(true);
    expect(warns('«clock:Y»', 'N')).toBe(false);
    expect(warns('static', 'R')).toBe(false);
  });
});

// ── code39 ────────────────────────────────────────────────────────────────────

describe('code39.toZPL', () => {
  const def = defined(ObjectRegistry['code39']);

  it('emits ^B3 barcode command', () => {
    const zpl = def.toZPL(makeObj('code39', {
      content: 'ABC', height: 100, moduleWidth: 2,
      printInterpretation: true, checkDigit: false, rotation: 'N',
    }));
    expect(zpl).toContain('^B3');
    expect(zpl).toContain('^FDABC^FS');
  });
});

// ── qrcode ────────────────────────────────────────────────────────────────────

describe('qrcode.toZPL', () => {
  const def = defined(ObjectRegistry['qrcode']);

  it('emits ^BQ with magnification and ^FD with error correction prefix', () => {
    const zpl = def.toZPL(makeObj('qrcode', {
      content: 'https://example.com', magnification: 6, errorCorrection: 'Q', model: 2, rotation: 'N',
    }));
    expect(zpl).toContain('^BQN,2,6');
    expect(zpl).toContain('^FDQA,https://example.com^FS');
  });

  it('emits the model (^BQ b) so Model 1 is not silently changed to 2', () => {
    const zpl = def.toZPL(makeObj('qrcode', {
      content: 'x', magnification: 4, errorCorrection: 'Q', model: 1, rotation: 'N',
    }));
    expect(zpl).toContain('^BQN,1,4');
  });
});

// ── datamatrix ────────────────────────────────────────────────────────────────

describe('datamatrix.toZPL', () => {
  const def = defined(ObjectRegistry['datamatrix']);

  it('emits ^BX with dimension and quality', () => {
    const zpl = def.toZPL(makeObj('datamatrix', {
      content: 'DM123', dimension: 8, quality: 200, rotation: 'N', gs1: false,
    }));
    expect(zpl).toContain('^BXN,8,200');
    expect(zpl).toContain('^FDDM123^FS');
  });

  it('GS1 mode sets the escape param and FNC1-escaped field data', () => {
    const zpl = def.toZPL(makeObj('datamatrix', {
      content: `010950110153000310ABC123\x1d2112345`,
      dimension: 8, quality: 200, rotation: 'N', gs1: true,
    }));
    expect(zpl).toContain('^BXN,8,200,,,,_');
    expect(zpl).toContain('^FD_1010950110153000310ABC123_12112345^FS');
  });

  it('rectangular emits the a param in position 8', () => {
    const plain = def.toZPL(makeObj('datamatrix', {
      content: 'DM123', dimension: 8, quality: 200, rotation: 'N', gs1: false, aspectRatio: 2,
    }));
    expect(plain).toContain('^BXN,8,200,,,,,2');
    const gs1 = def.toZPL(makeObj('datamatrix', {
      content: '010950110153000310ABC123', dimension: 8, quality: 200, rotation: 'N', gs1: true, aspectRatio: 2,
    }));
    expect(gs1).toContain('^BXN,8,200,,,,_,2');
  });

  it('does not emit the a param below quality 200 (firmware prints square)', () => {
    const zpl = def.toZPL(makeObj('datamatrix', {
      content: 'DM123', dimension: 8, quality: 140, rotation: 'N', gs1: false, aspectRatio: 2,
    }));
    expect(zpl).toContain('^BXN,8,140^FD');
  });

  it('emits non-GS1 content verbatim without declaring g', () => {
    const zpl = def.toZPL(makeObj('datamatrix', {
      content: 'AB_CD', dimension: 8, quality: 200, rotation: 'N', gs1: false,
    }));
    expect(zpl).toContain('^BXN,8,200^FDAB_CD^FS');
  });

  it('emits a forced symbol size in the c/r params, trailing params trimmed', () => {
    const square = def.toZPL(makeObj('datamatrix', {
      content: 'DM123', dimension: 8, quality: 200, rotation: 'N', gs1: false, columns: 22, rows: 22,
    }));
    expect(square).toContain('^BXN,8,200,22,22^FD');
    const rectGs1 = def.toZPL(makeObj('datamatrix', {
      content: '0109501101530003', dimension: 8, quality: 200, rotation: 'N', gs1: true,
      aspectRatio: 2, columns: 18, rows: 8,
    }));
    expect(rectGs1).toContain('^BXN,8,200,18,8,,_,2');
  });
});

describe('datamatrix qualityPatch', () => {
  const base: DataMatrixProps = {
    content: '', dimension: 5, quality: 200, rotation: 'N', gs1: false,
    aspectRatio: 2, columns: 18, rows: 8,
  };

  it('clears symbol size and shape when crossing the ECC-200 boundary', () => {
    expect(qualityPatch(base, 140)).toEqual({
      quality: 140, aspectRatio: undefined, columns: undefined, rows: undefined,
    });
    expect(qualityPatch({ ...base, quality: 140 }, 200)).toEqual({
      quality: 200, aspectRatio: undefined, columns: undefined, rows: undefined,
    });
  });

  it('keeps them within the same tier', () => {
    expect(qualityPatch(base, 200)).toEqual({ quality: 200 });
    expect(qualityPatch({ ...base, quality: 80 }, 140)).toEqual({ quality: 140 });
  });
});

// ── pdf417 ────────────────────────────────────────────────────────────────────

describe('pdf417.toZPL', () => {
  const def = defined(ObjectRegistry['pdf417']);

  it('emits ^B7 with row height, security, and columns', () => {
    const zpl = def.toZPL(makeObj('pdf417', {
      content: 'PDF', rowHeight: 10, securityLevel: 2, columns: 4, moduleWidth: 2, rotation: 'N',
    }));
    expect(zpl).toContain('^B7N,10,2,4,,,');
    expect(zpl).toContain('^FDPDF^FS');
  });

  it('emits ^BY when moduleWidth is not 2', () => {
    const zpl = def.toZPL(makeObj('pdf417', {
      content: 'X', rowHeight: 10, securityLevel: 0, columns: 0, moduleWidth: 3, rotation: 'N',
    }));
    expect(zpl).toContain('^BY3');
  });
});

// ── symbol (^GS) ──────────────────────────────────────────────────────────────

describe('symbol.toZPL', () => {
  const def = defined(ObjectRegistry['symbol']);

  it('emits ^GS with rotation, height, width and ^FD with symbol code', () => {
    const zpl = def.toZPL(makeObj('symbol', {
      symbol: 'A', height: 50, width: 50, rotation: 'N',
    }));
    expect(zpl).toBe('^FO100,200^GSN,50,50^FDA^FS');
  });

  it('round-trips all five canonical codes', () => {
    for (const code of ['A', 'B', 'C', 'D', 'E'] as const) {
      const zpl = def.toZPL(makeObj('symbol', {
        symbol: code, height: 30, width: 30, rotation: 'N',
      }));
      expect(zpl).toContain(`^FD${code}^FS`);
    }
  });

  it('preserves rotation letter in ^GS first parameter', () => {
    for (const rot of ['N', 'R', 'I', 'B'] as const) {
      const zpl = def.toZPL(makeObj('symbol', {
        symbol: 'B', height: 30, width: 30, rotation: rot,
      }));
      expect(zpl).toContain(`^GS${rot},30,30`);
    }
  });
});

// ── serial (text field mode) ───────────────────────────────────────────────────

describe('text.toZPL serial mode', () => {
  const def = defined(ObjectRegistry['text']);
  const serialText = (content: string, zplMode: 'SN' | 'SF') =>
    makeObj('text', {
      content, fontHeight: 30, fontWidth: 0, rotation: 'N', serial: { increment: 1, zplMode },
    });

  it('emits ^SN as the field data (no ^FD) for SN mode', () => {
    const zpl = def.toZPL(serialText('001', 'SN'));
    expect(zpl).toContain('^SN001,1,Y^FS');
    expect(zpl).not.toContain('^FD');
  });

  it('emits ^FD + masked ^SF for SF mode', () => {
    const zpl = def.toZPL(serialText('001', 'SF'));
    // seed '001' → mask 'ddd' (all decimal), increment 1.
    expect(zpl).toContain('^FD001^SFddd,1^FS');
  });

  it('honours label.defaultFontId in the ^A fallback', () => {
    const zpl = def.toZPL(serialText('001', 'SN'), {
      label: { widthMm: 100, heightMm: 60, dpmm: 8, defaultFontId: 'M' },
    });
    expect(zpl).toContain('^AMN,30,0');
    expect(zpl).not.toContain('^A0');
  });

  it('strips ^/~ and other non-charset chars from ZPL-imported content', () => {
    // contentSpec restricts to alphanumerics at input; the serial emit re-applies
    // the filter so ZPL-imported designs can't smuggle ^ (command), ~ (format),
    // or , (parameter separator) into the ^SN start parameter.
    const zpl = def.toZPL(serialText('a^b,c', 'SN'));
    expect(zpl).toContain('^SNabc,1,Y^FS');
  });

  it('builds the ^SF mask from the sanitized seed', () => {
    // 'ab^cd' → 'abcd' (^ stripped); mask all-lowercase-alpha 'aaaa'.
    const zpl = def.toZPL(serialText('ab^cd', 'SF'));
    expect(zpl).toContain('^FDabcd^SFaaaa,1^FS');
  });
});

// ── registry completeness ─────────────────────────────────────────────────────

describe('ObjectRegistry', () => {
  const expectedTypes = [
    'text', 'code128', 'code39', 'ean13', 'upca', 'ean8', 'upce',
    'interleaved2of5', 'code93', 'qrcode', 'datamatrix', 'pdf417',
    'box', 'ellipse', 'line', 'image',
  ];

  it('contains all expected object types', () => {
    for (const type of expectedTypes) {
      expect(getEntry(type)).toBeDefined();
    }
  });

  it('every registered type has a toZPL function', () => {
    for (const [key, def] of Object.entries(ObjectRegistry)) {
      expect(typeof def.toZPL).toBe('function');
      expect(key).toBeTruthy();
    }
  });

  it('every registered type has a valid group', () => {
    const validGroups = new Set(['text', 'code-1d', 'code-2d', 'legacy', 'shape']);
    for (const def of Object.values(ObjectRegistry)) {
      expect(validGroups.has(def.group)).toBe(true);
    }
  });

  // The palette swaps the mnemonic glyph for `zplCmd` in power-user mode; a
  // missing one silently falls back to the glyph, so guard every type has it.
  it('every registered type has a non-empty zplCmd', () => {
    for (const [key, def] of Object.entries(ObjectRegistry)) {
      expect(def.zplCmd, `${key} is missing zplCmd`).toMatch(/^\^[A-Z0-9]{1,2}$/);
    }
  });

  // Without commitTransform or uniformScaleProp the drag is a silent
  // no-op (was the aztec regression). heightLocked types skip the
  // transformer entirely so they're exempt.
  it('every resizable code-2d type can commit a resize', () => {
    for (const [key, def] of Object.entries(ObjectRegistry)) {
      if (def.group !== 'code-2d') continue;
      if (def.heightLocked) continue;
      const hasCommit = !!def.commitTransform || !!def.uniformScaleProp;
      expect(hasCommit, `${key} is missing commitTransform or uniformScaleProp`).toBe(true);
    }
  });

  // The rotation prop's existence IS the rotatability capability (spawn, panel,
  // canvas and emit all key off it). qrcode rotates via a baked ^GFA like image;
  // maxicode stays off (^BD has no orientation slot, MaxiCode is omnidirectional). Belongs
  // here only with a working o=N/R/I/B or a baked graphic emit.
  it('rotation prop membership matches the ZPL orientation capability', () => {
    const rotatable = Object.entries(ObjectRegistry)
      .filter(([, def]) => 'rotation' in (def.defaultProps as object))
      .map(([key]) => key)
      .sort();
    expect(rotatable).toEqual([
      'aztec', 'codabar', 'codablock', 'code11', 'code128', 'code39',
      'code49', 'code93', 'datamatrix', 'ean13', 'ean8', 'gs1databar',
      'image', 'industrial2of5', 'interleaved2of5', 'logmars',
      'micropdf417', 'msi', 'pdf417', 'planet', 'plessey', 'postal',
      'qrcode', 'standard2of5', 'symbol', 'text', 'tlc39',
      'upcEanExtension', 'upca', 'upce',
    ]);
  });
});

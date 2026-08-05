/**
 * Golden round-trip tests: parse → generate → re-parse.
 *
 * These act as regression anchors for the parser/generator pair.
 * They do not test pixel-exact ZPL byte output (which is covered by
 * zplGenerator.test.ts), but verify that the object graph survives a
 * full round-trip without structural loss.
 */
import { describe, it, expect } from 'vitest';
import { generateZPL } from '@zplab/core/lib/zplGenerator';
import type { LabelConfig } from '@zplab/core/types/LabelConfig';
import { props, defined, parseSingle, commandsOf } from './helpers';

const BASE: LabelConfig = { widthMm: 100, heightMm: 60, dpmm: 8 };

function roundtrip(zpl: string, dpmm = 8) {
  const first = parseSingle(zpl, dpmm);
  // BASE provides fallbacks for labels that omit ^PW/^LL; dpmm always wins over any parsed value
  const label: LabelConfig = { ...BASE, ...first.labelConfig, dpmm };
  const regenerated = generateZPL(label, first.objects);
  const second = parseSingle(regenerated, dpmm);
  return { first, second, label, regenerated };
}

// ── ^FT graphic bottom-left anchor round-trip ────────────────────────────────

describe('round-trip — ^FT graphic bottom-left anchor', () => {
  it('preserves the ^FT box anchor (bottom-left) across the round-trip', () => {
    const { first, second, regenerated } = roundtrip('^XA^FT100,200^GB50,40,3,B,0^FS^XZ');
    expect(regenerated).toContain('^FT100,200');
    expect(first.objects[0]?.y).toBe(160); // model top-left = 200 - 40
    expect(second.objects[0]?.y).toBe(first.objects[0]?.y);
    expect(second.objects[0]?.positionType).toBe('FT');
  });

  it('preserves a ^FT horizontal line anchor across the round-trip', () => {
    const { first, second, regenerated } = roundtrip('^XA^FT100,200^GB80,4,4,B,0^FS^XZ');
    expect(regenerated).toContain('^FT100,200');
    expect(second.objects[0]?.y).toBe(first.objects[0]?.y);
  });

  it('preserves a right-justified ^FT,1 box anchor across the round-trip', () => {
    const { first, second, regenerated } = roundtrip('^XA^FT200,200,1^GB50,40,3,B,0^FS^XZ');
    expect(regenerated).toContain('^FT200,200,1');
    expect(first.objects[0]?.fieldJustify).toBe('R');
    expect(second.objects[0]?.x).toBe(first.objects[0]?.x);
    expect(second.objects[0]?.fieldJustify).toBe('R');
  });

  it('preserves a ^FT vertical line anchor across the round-trip', () => {
    const { first, second, regenerated } = roundtrip('^XA^FT100,200^GB4,80,4,B,0^FS^XZ');
    expect(regenerated).toContain('^FT100,200');
    expect(first.objects[0]?.type).toBe('line');
    expect(first.objects[0]?.y).toBe(120); // 200 - 80 (length)
    expect(second.objects[0]?.y).toBe(first.objects[0]?.y);
  });
});

// ── shipping label round-trip ────────────────────────────────────────────────

const SHIPPING_ZPL = `
^XA
^CF0,60
^FO50,50^GB100,100,100^FS
^FO75,75^FR^GB100,100,100^FS
^FO220,50^FDIntershipping, Inc.^FS
^CF0,30
^FO220,115^FD1000 Shipping Lane^FS
^FO50,250^GB700,3,3^FS
^BY5,2,270
^FO100,400^BC^FD12345678^FS
^FO50,700^GB700,250,3^FS
^XZ
`.trim();

describe('round-trip — shipping label', () => {
  it('preserves object count across parse → generate → re-parse', () => {
    const { first, second } = roundtrip(SHIPPING_ZPL);
    expect(second.objects).toHaveLength(first.objects.length);
  });

  it('tripwire: labelConfig keys from first parse survive the round-trip', () => {
    // A pipeline split that runs the labelConfig / printerProfile fold
    // in the wrong order (e.g. across-blocks post-aggregation instead
    // of per-block) would drop keys here. (Second-parse may legitimately
    // GAIN keys: the generator emits ^PW/^LL defaults that the raw ZPL
    // didn't include. Subset-check captures the regression without
    // fighting that asymmetry.)
    const { first, second } = roundtrip(SHIPPING_ZPL);
    const firstKeys = Object.keys(first.labelConfig);
    const secondKeys = new Set(Object.keys(second.labelConfig));
    for (const k of firstKeys) {
      expect(secondKeys.has(k), `key "${k}" dropped during round-trip`).toBe(true);
    }
  });

  it('preserves object types in the same order', () => {
    const { first, second } = roundtrip(SHIPPING_ZPL);
    expect(second.objects.map((o) => o.type)).toEqual(first.objects.map((o) => o.type));
  });

  it('preserves Code 128 content and height', () => {
    const { first, second } = roundtrip(SHIPPING_ZPL);
    const bc1 = first.objects.find((o) => o.type === 'code128');
    const bc2 = second.objects.find((o) => o.type === 'code128');
    expect(bc1).toBeDefined();
    expect(bc2).toBeDefined();
    expect(props(bc2).content).toBe(props(bc1).content);
    expect(props(bc2).height).toBe(props(bc1).height);
    expect(props(bc2).moduleWidth).toBe(props(bc1).moduleWidth);
  });

  it('preserves text content and font height', () => {
    const { first, second } = roundtrip(SHIPPING_ZPL);
    const texts1 = first.objects.filter((o) => o.type === 'text');
    const texts2 = second.objects.filter((o) => o.type === 'text');
    expect(texts2.map((o) => props(o).content)).toEqual(texts1.map((o) => props(o).content));
    expect(texts2.map((o) => props(o).fontHeight)).toEqual(texts1.map((o) => props(o).fontHeight));
  });

  it('preserves box dimensions', () => {
    const { first, second } = roundtrip(SHIPPING_ZPL);
    const boxes1 = first.objects.filter((o) => o.type === 'box');
    const boxes2 = second.objects.filter((o) => o.type === 'box');
    expect(boxes2.map((o) => [props(o).width, props(o).height]))
      .toEqual(boxes1.map((o) => [props(o).width, props(o).height]));
  });
});

// ── QR code label round-trip ─────────────────────────────────────────────────

const QR_LABEL_ZPL = `
^XA
^PW640^LL480
^FO50,50^BQN,2,6^FDQA,https://example.com^FS
^FO50,300^A0N,30,0^FDScan for details^FS
^XZ
`.trim();

describe('round-trip — QR code label', () => {
  it('preserves QR code content and magnification', () => {
    const { first, second } = roundtrip(QR_LABEL_ZPL);
    const qr1 = first.objects.find((o) => o.type === 'qrcode');
    const qr2 = second.objects.find((o) => o.type === 'qrcode');
    expect(qr1).toBeDefined();
    expect(qr2).toBeDefined();
    expect(props(qr2).content).toBe(props(qr1).content);
    expect(props(qr2).magnification).toBe(props(qr1).magnification);
    expect(props(qr2).errorCorrection).toBe(props(qr1).errorCorrection);
  });

  it('preserves label dimensions', () => {
    const { first, second } = roundtrip(QR_LABEL_ZPL);
    expect(second.labelConfig.widthMm).toBe(first.labelConfig.widthMm);
    expect(second.labelConfig.heightMm).toBe(first.labelConfig.heightMm);
  });
});

// ── multi-barcode label round-trip ───────────────────────────────────────────

const MULTICODE_ZPL = `
^XA
^PW800^LL600
^FO10,10^BXN,8,200^FD1234567890^FS
^FO10,100^BEN,60,Y^FD590123412345^FS
^FO10,200^B7N,12,3,5,,,^FDPdf417 content^FS
^FO10,350^GE120,60,4,B^FS
^FO10,430^GC80,4,B^FS
^XZ
`.trim();

describe('round-trip — multi-barcode + shapes label', () => {
  it('preserves all barcode types', () => {
    const { first, second } = roundtrip(MULTICODE_ZPL);
    const types1 = first.objects.map((o) => o.type).sort();
    const types2 = second.objects.map((o) => o.type).sort();
    expect(types2).toEqual(types1);
  });

  it('preserves DataMatrix content and dimension', () => {
    const { first, second } = roundtrip(MULTICODE_ZPL);
    const dm1 = first.objects.find((o) => o.type === 'datamatrix');
    const dm2 = second.objects.find((o) => o.type === 'datamatrix');
    expect(dm1).toBeDefined();
    expect(dm2).toBeDefined();
    expect(props(dm2).content).toBe(props(dm1).content);
    expect(props(dm2).dimension).toBe(props(dm1).dimension);
  });

  it('preserves ellipse dimensions', () => {
    const { first, second } = roundtrip(MULTICODE_ZPL);
    const el1 = first.objects.find((o) => o.type === 'ellipse' && props(o).width !== props(o).height);
    const el2 = second.objects.find((o) => o.type === 'ellipse' && props(o).width !== props(o).height);
    expect(el1).toBeDefined();
    expect(el2).toBeDefined();
    expect(props(el2).width).toBe(props(el1).width);
    expect(props(el2).height).toBe(props(el1).height);
  });
});

// ── GS1 rectangular DataMatrix round-trip ────────────────────────────────────

const GS1_RECT_DM_ZPL = `
^XA
^PW800^LL600
^FO50,50^BXN,4,200,,,,~,2^FD~1010426011945468210FM260693^FS
^XZ
`.trim();

describe('round-trip — GS1 rectangular DataMatrix (^BX g + a params)', () => {
  it('decodes the tilde FNC1 escape and re-emits equivalent GS1 field data', () => {
    const { first, second, regenerated } = roundtrip(GS1_RECT_DM_ZPL);
    const dm1 = defined(first.objects.find((o) => o.type === 'datamatrix'));
    const dm2 = defined(second.objects.find((o) => o.type === 'datamatrix'));
    expect(props(dm1).gs1).toBe(true);
    expect(props(dm1).content).toBe('010426011945468210FM260693');
    expect(props(dm1).aspectRatio).toBe(2);
    // The escape char normalizes to `_` on export; semantically identical.
    expect(regenerated).toContain('^BXN,4,200,,,,_,2^FD_1010426011945468210FM260693^FS');
    expect(props(dm2)).toEqual(props(dm1));
  });

  it('keeps non-GS1 field data verbatim across a round-trip', () => {
    const { first, regenerated } = roundtrip(
      '^XA^PW800^LL600^FO10,10^BXN,8,200^FDABC_DEF^FS^XZ',
    );
    expect(props(defined(first.objects[0])).content).toBe('ABC_DEF');
    expect(props(defined(first.objects[0])).gs1).toBe(false);
    expect(regenerated).toContain('^BXN,8,200^FDABC_DEF^FS');
  });

  it('preserves a forced symbol size and a _d029 GS separator', () => {
    const { first, regenerated } = roundtrip(
      '^XA^FO10,10^BXN,8,200,32,32,,_^FD_1010950110153000310ABC123_d0292112345^FS^XZ',
    );
    const dm = defined(first.objects.find((o) => o.type === 'datamatrix'));
    expect(props(dm).columns).toBe(32);
    expect(props(dm).rows).toBe(32);
    expect(props(dm).content).toBe('010950110153000310ABC123\x1d2112345');
    // Canonical emit: separator as `_1`, size retained.
    expect(regenerated).toContain('^BXN,8,200,32,32,,_^FD_1010950110153000310ABC123_12112345^FS');
  });
});

// ── field-block text round-trip ───────────────────────────────────────────────

const BLOCK_TEXT_ZPL = `
^XA
^PW640^LL400
^FO50,50^A0N,25,0^FB400,3,5,C,0^FDLine one\\&Line two\\&Line three^FS
^XZ
`.trim();

const BLOCK_TEXT_HANGING_INDENT_ZPL = `
^XA
^PW640^LL400
^FO50,50^A0N,25,0^FB400,3,0,L,40^FDLine one\\&Line two\\&Line three^FS
^XZ
`.trim();

const BLOCK_TEXT_FT_ZPL = `
^XA
^PW640^LL400
^FT50,300^A0N,25,0^FB400,3,5,L,0^FDLine one\\&Line two\\&Line three^FS
^XZ
`.trim();

const BLOCK_TEXT_FT_ROTATIONS = ["N", "R", "I", "B"] as const;
const blockTextFtRotZpl = (rot: typeof BLOCK_TEXT_FT_ROTATIONS[number]) => `
^XA
^PW640^LL400
^FT200,200^A0${rot},30,30^FB200,3,5,L,0^FDA\\&B\\&C^FS
^XZ
`.trim();

describe('round-trip — field block text', () => {
  it('preserves block width and justify', () => {
    const { first, second } = roundtrip(BLOCK_TEXT_ZPL);
    const t1 = first.objects.find((o) => o.type === 'text');
    const t2 = second.objects.find((o) => o.type === 'text');
    expect(t1).toBeDefined();
    expect(t2).toBeDefined();
    expect(props(t2).blockWidth).toBe(props(t1).blockWidth);
    expect(props(t2).blockJustify).toBe(props(t1).blockJustify);
    expect(props(t2).blockLines).toBe(props(t1).blockLines);
  });

  it('canvas wrap never leaks into emit: long ^FB line round-trips verbatim', () => {
    // Wrapping is render-only; the stored ^FD must keep its raw single line so
    // emit re-produces it without inserted \& soft-wrap breaks.
    const long = 'The quick brown fox jumps over the lazy dog again and again';
    const { first, regenerated, second } = roundtrip(
      `^XA^PW400^LL400^FO20,20^A0N,30,0^FB300,5,0,L,0^FD${long}^FS^XZ`,
    );
    expect(props(first.objects[0]).content).toBe(long);
    expect(props(second.objects[0]).content).toBe(long);
    expect(regenerated).toContain(`^FD${long}^FS`);
    expect(regenerated).not.toContain('\\&');
  });

  // A reverse ^FB block emits a bare ^FR (spec-true knockout, no synthesized
  // background box), so it must re-import as ONE reverse text and stay idempotent
  // across rotation, justify, hanging indent, line spacing and FT vs FO anchoring
  // without ever growing a ^GB.
  const reverseBlockIsIdempotent = (blockZpl: string) => {
    const base = parseSingle(blockZpl, 8);
    const obj = base.objects.find((o) => o.type === 'text');
    expect(obj).toBeDefined();
    const reversed = {
      ...obj!,
      props: { ...props(obj), reverse: true },
    } as (typeof base.objects)[number];
    const label: LabelConfig = { ...BASE, ...base.labelConfig, dpmm: 8 };
    const emit1 = generateZPL(label, [reversed]);
    const parsed = parseSingle(emit1, 8);
    expect(parsed.objects).toHaveLength(1);
    const out = defined(parsed.objects[0]);
    expect(out.type).toBe('text');
    expect(props(out).reverse).toBe(true);
    const emit2 = generateZPL(label, parsed.objects);
    expect(emit2).toBe(emit1);
    expect(emit1).toContain('^FR');
    expect(emit1).not.toContain('^GB');
  };

  it.each([
    ['FO rotation N', '^XA^PW640^LL400^FO80,80^A0N,30,30^FB200,3,5,L,0^FDA\\&B\\&C^FS^XZ'],
    ['FO rotation R', '^XA^PW640^LL400^FO80,80^A0R,30,30^FB200,3,5,L,0^FDA\\&B\\&C^FS^XZ'],
    ['FO rotation I', '^XA^PW640^LL400^FO80,80^A0I,30,30^FB200,3,5,L,0^FDA\\&B\\&C^FS^XZ'],
    ['FO rotation B', '^XA^PW640^LL400^FO80,80^A0B,30,30^FB200,3,5,L,0^FDA\\&B\\&C^FS^XZ'],
    ['justify C', '^XA^PW640^LL400^FO80,80^A0N,30,30^FB200,3,5,C,0^FDA\\&B\\&C^FS^XZ'],
    ['hanging indent', '^XA^PW640^LL400^FO80,80^A0N,30,30^FB200,3,5,L,40^FDA\\&B\\&C^FS^XZ'],
    ['FT anchor', '^XA^PW640^LL400^FT80,300^A0N,30,30^FB200,3,5,L,0^FDA\\&B\\&C^FS^XZ'],
  ])('reverse + ^FB block round-trips as one reverse text (bare ^FR): %s', (_label, zpl) => {
    reverseBlockIsIdempotent(zpl);
  });

  it('preserves slot e hanging indent', () => {
    const { first, second } = roundtrip(BLOCK_TEXT_HANGING_INDENT_ZPL);
    const t1 = first.objects.find((o) => o.type === 'text');
    const t2 = second.objects.find((o) => o.type === 'text');
    expect(props(t1).blockHangingIndent).toBe(40);
    expect(props(t2).blockHangingIndent).toBe(40);
  });

  it('preserves the ^FT anchor when ^FB shifts the block extent', () => {
    const { first, second } = roundtrip(BLOCK_TEXT_FT_ZPL);
    const t1 = first.objects.find((o) => o.type === 'text');
    const t2 = second.objects.find((o) => o.type === 'text');
    expect(t1).toBeDefined();
    expect(t2).toBeDefined();
    expect(t2!.x).toBe(t1!.x);
    expect(t2!.y).toBe(t1!.y);
    expect(t1!.positionType).toBe('FT');
    expect(t2!.positionType).toBe('FT');
    // ^FT anchors the LAST baseline at y=300; first line's EM-top must
    // sit above the anchor by ~blockExtent + fontHeight (block grows up).
    expect(t1!.y).toBeLessThan(300);
  });

  it.each(BLOCK_TEXT_FT_ROTATIONS)('roundtrips ^FT+^FB at rotation %s', (rot) => {
    const { first, second } = roundtrip(blockTextFtRotZpl(rot));
    const t1 = first.objects.find((o) => o.type === 'text');
    const t2 = second.objects.find((o) => o.type === 'text');
    expect(t1).toBeDefined();
    expect(t2).toBeDefined();
    expect(t2!.x).toBe(t1!.x);
    expect(t2!.y).toBe(t1!.y);
    expect(t1!.positionType).toBe('FT');
  });

  // Anchor (200,200). Block extends in opposite direction of the
  // rotation's reading flow, so the FIRST line EM-top lands on the
  // side away from the anchor: N→above, R→right, I→below, B→left.
  it.each([
    ['N', 'y', 'lt' as const, 200],
    ['R', 'x', 'gt' as const, 200],
    ['I', 'y', 'gt' as const, 200],
    ['B', 'x', 'lt' as const, 200],
  ] as const)('block extent shifts model %s on the %s axis (rotation)', (rot, axis, dir, anchor) => {
    const { first } = roundtrip(blockTextFtRotZpl(rot));
    const t = first.objects.find((o) => o.type === 'text');
    const v = axis === 'x' ? t!.x : t!.y;
    if (dir === 'lt') expect(v).toBeLessThan(anchor);
    else expect(v).toBeGreaterThan(anchor);
  });
});

// ── barcode1d types round-trip ────────────────────────────────────────────────

const BARCODE1D_ZPL = `
^XA
^PW800^LL600
^BY3,2,80
^FO10,10^BUN,80,Y,N,N^FD01234567890^FS
^FO10,120^B8N,60,Y^FD1234567^FS
^FO10,220^B9N,60,Y^FD01234565^FS
^FO10,320^B2N,80,Y,N,N^FD12345678^FS
^FO10,420^BAN,80,Y,N,N^FDABC123^FS
^XZ
`.trim();

describe('round-trip — barcode1d types (UPC-A, EAN-8, UPC-E, I2of5, Code93)', () => {
  it('preserves all five barcode1d types', () => {
    const { first, second } = roundtrip(BARCODE1D_ZPL);
    expect(second.objects.map((o) => o.type)).toEqual(first.objects.map((o) => o.type));
  });

  it('preserves UPC-A content and height', () => {
    const { first, second } = roundtrip(BARCODE1D_ZPL);
    const b1 = first.objects.find((o) => o.type === 'upca');
    const b2 = second.objects.find((o) => o.type === 'upca');
    expect(b1).toBeDefined();
    expect(b2).toBeDefined();
    expect(props(b2).content).toBe(props(b1).content);
    expect(props(b2).height).toBe(props(b1).height);
  });

  it('preserves Code93 content', () => {
    const { first, second } = roundtrip(BARCODE1D_ZPL);
    const b1 = first.objects.find((o) => o.type === 'code93');
    const b2 = second.objects.find((o) => o.type === 'code93');
    expect(b1).toBeDefined();
    expect(b2).toBeDefined();
    expect(props(b2).content).toBe(props(b1).content);
  });

  // The g-param (HRI above) sits right after the interpretation flag.
  it('round-trips the HRI-above g-param (Y) and leaves below as false', () => {
    const above = roundtrip('^XA^BY2^FO10,10^BCN,80,Y,Y,N^FD12345678^FS^XZ');
    expect(props(above.first.objects[0]).printInterpretationAbove).toBe(true);
    expect(props(above.second.objects[0]).printInterpretationAbove).toBe(true);
    const below = roundtrip('^XA^BY2^FO10,10^BCN,80,Y,N,N^FD12345678^FS^XZ');
    expect(props(below.first.objects[0]).printInterpretationAbove).toBe(false);
  });

  // g is meaningless when f is off; a stale above-flag must not emit `,N,Y`.
  it('forces the HRI-above g-param to N when interpretation is off', () => {
    const { first, regenerated } = roundtrip('^XA^BY2^FO10,10^BCN,80,N,Y,N^FD12345678^FS^XZ');
    expect(props(first.objects[0]).printInterpretation).toBe(false);
    expect(props(first.objects[0]).printInterpretationAbove).toBe(true);
    expect(regenerated).not.toContain(',N,Y');
  });

  // EAN/UPC carry the g-param right after the interpretation flag too (^BE).
  it('round-trips the HRI-above g-param for EAN/UPC', () => {
    const { first, second, regenerated } = roundtrip(
      '^XA^BY2^FO10,10^BEN,100,Y,Y^FD590123412345^FS^XZ',
    );
    expect(props(first.objects[0]).printInterpretationAbove).toBe(true);
    expect(props(second.objects[0]).printInterpretationAbove).toBe(true);
    expect(regenerated).toContain(',Y,Y');
  });

  // The remaining 1D family carries g at the same slot; ^BM (msi) parses
  // via a custom handler with g at p[4], so cover one per command shape.
  it.each([
    ['industrial2of5', '^XA^BY2^FO10,10^BIN,80,Y,Y^FD12345678^FS^XZ'],
    ['standard2of5', '^XA^BY2^FO10,10^BJN,80,Y,Y^FD12345678^FS^XZ'],
    ['msi', '^XA^BY2^FO10,10^BMN,A,80,Y,Y^FD12345678^FS^XZ'],
    ['plessey', '^XA^BY2^FO10,10^BPN,N,80,Y,Y^FD12345678^FS^XZ'],
    ['planet', '^XA^BY2^FO10,10^B5N,80,Y,Y^FD12345678901^FS^XZ'],
    ['postal', '^XA^BY2^FO10,10^BZN,80,Y,Y^FD12345^FS^XZ'],
  ])('round-trips the HRI-above g-param for %s', (_type, zpl) => {
    const { first, second, regenerated } = roundtrip(zpl);
    expect(props(first.objects[0]).printInterpretationAbove).toBe(true);
    expect(props(second.objects[0]).printInterpretationAbove).toBe(true);
    expect(regenerated).toContain(',Y,Y');
  });

  // ^B9 ^FD carries the number-system digit; the parser strips it back to the
  // 6 data digits so re-emit re-adds it without drift (idempotent).
  it('preserves UPC-E as the 6 data digits across round-trips', () => {
    const { first, second } = roundtrip(BARCODE1D_ZPL);
    const b1 = first.objects.find((o) => o.type === 'upce');
    const b2 = second.objects.find((o) => o.type === 'upce');
    expect(props(b1).content).toBe('123456');
    expect(props(b2).content).toBe(props(b1).content);
  });
});

// ── label home offset round-trip ──────────────────────────────────────────────

const LH_OFFSET_ZPL = `
^XA
^PW640^LL400
^LH30,20
^FO70,80^A0N,25,0^FDOffset text^FS
^FO170,80^BCN,60,Y,N,N^FD99999^FS
^XZ
`.trim();

describe('round-trip — ^LH label home offset', () => {
  it('bakes the ^LH offset into absolute object positions', () => {
    // After import the LH offset is merged into x/y; objects sit at FO+LH.
    // Text additionally subtracts the ZPL-anchor-to-EM shift so obj.x/y
    // is the Konva render position. For ^A0N h=25 FO: dy = 25 * 0.154 = 3.85.
    const { first } = roundtrip(LH_OFFSET_ZPL);
    const text = first.objects.find((o) => o.type === 'text');
    expect(text?.x).toBeCloseTo(100); // 70 + 30
    expect(text?.y).toBeCloseTo(100 - 3.85); // 80 + 20 - shift
  });

  it('preserves object positions across the round-trip', () => {
    const { first, second } = roundtrip(LH_OFFSET_ZPL);
    expect(second.objects.map((o) => [o.x, o.y])).toEqual(first.objects.map((o) => [o.x, o.y]));
  });
});

// ── MSI barcode ──────────────────────────────────────────────────────────────

describe('round-trip — MSI barcode', () => {
  // ^BMo,e,h,f,g; e: A=no check, B=1 Mod 10 (default), C/D=multi-check.
  it('parses ^BM height from third parameter (new format)', () => {
    const { first } = roundtrip(
      '^XA^PW784^LL264^CI28^BY2^FO0,0^BMN,A,80,Y,N^FD12345678^FS^XZ',
    );
    const obj = first.objects[0];
    expect(obj?.type).toBe('msi');
    expect(props(obj).height).toBe(80);
    expect(props(obj).printInterpretation).toBe(true);
    expect(props(obj).checkDigit).toBe(false);
    expect(props(obj).moduleWidth).toBe(2);
  });

  it('parses ^BM check digit flag correctly (A=none, B/default/invalid=checked)', () => {
    // ZD230-measured: e=A prints one digit narrower than B; an invalid e
    // (the old emitter wrote N) falls back to B, i.e. checked.
    const { first } = roundtrip(
      '^XA^PW400^LL200^BY2^FO0,0^BMN,A,100,N,N^FD12345678^FS^XZ',
    );
    expect(props(first.objects[0]).checkDigit).toBe(false);
    expect(props(first.objects[0]).printInterpretation).toBe(false);
    for (const zpl of [
      '^XA^BY2^FO0,0^BMN,B,100,N,N^FD12345678^FS^XZ',
      '^XA^BY2^FO0,0^BMN,,100,N,N^FD12345678^FS^XZ',
      '^XA^BY2^FO0,0^BMN,N,100,N,N^FD12345678^FS^XZ',
    ]) {
      expect(props(roundtrip(zpl).first.objects[0]).checkDigit, zpl).toBe(true);
    }
  });

  it('keeps the PRINTED semantics of main-era ^BM wire (inverted emitter)', () => {
    // main wrote e=A for its checked flag and an invalid e=N for unchecked;
    // the ZD230 printed A without and N with a check digit regardless. The
    // import mirrors the print: A stays byte-stable, N re-emits as the
    // equivalent B.
    const a = roundtrip('^XA^BY2^FO0,0^BMN,A,100,N,N^FD12345678^FS^XZ');
    expect(props(a.first.objects[0]).checkDigit).toBe(false);
    expect(a.regenerated).toContain('^BMN,A,');
    const n = roundtrip('^XA^BY2^FO0,0^BMN,N,100,N,N^FD12345678^FS^XZ');
    expect(props(n.first.objects[0]).checkDigit).toBe(true);
    expect(n.regenerated).toContain('^BMN,B,');
  });

  it('round-trips the multi-check ^BM modes C/D and e2=Y byte-stable', () => {
    const c = roundtrip('^XA^BY2^FO0,0^BMN,C,100,N,N^FD12345678^FS^XZ');
    expect(props(c.first.objects[0]).msiCheckMode).toBe('C');
    expect(c.regenerated).toContain('^BMN,C,100,N,N');
    const e2 = roundtrip('^XA^BY2^FO0,0^BMN,B,100,Y,N,Y^FD12345678^FS^XZ');
    expect(props(e2.first.objects[0]).msiHriCheck).toBe(true);
    expect(e2.regenerated).toContain('^BMN,B,100,Y,N,Y');
    // No partial finding: the wire round-trips byte-stable.
    for (const r of [c, e2]) {
      expect(r.first.findings.some((f) => f.kind === 'partial' && f.command === '^BM')).toBe(false);
    }
    // A plain design keeps the 5-param wire (no trailing e2 slot).
    const clean = roundtrip('^XA^BY2^FO0,0^BMN,B,100,Y,N,N^FD12345678^FS^XZ');
    expect(clean.regenerated).toContain('^BMN,B,100,Y,N^FD');
  });

  it('emits e=B for checked and e=A for unchecked MSI', () => {
    const { regenerated } = roundtrip('^XA^BY2^FO0,0^BMN,B,100,N,N^FD12345678^FS^XZ');
    expect(regenerated).toContain('^BMN,B,');
    const off = roundtrip('^XA^BY2^FO0,0^BMN,A,100,N,N^FD12345678^FS^XZ');
    expect(off.regenerated).toContain('^BMN,A,');
  });

  it('survives a full round-trip without changing height or check', () => {
    const { first, second } = roundtrip(
      '^XA^PW784^LL264^CI28^BY2^FO0,0^BMN,A,80,Y,N^FD12345678^FS^XZ',
    );
    expect(props(second.objects[0]).height).toBe(props(first.objects[0]).height);
    expect(props(second.objects[0]).checkDigit).toBe(props(first.objects[0]).checkDigit);
  });

  it('generates ^BY with ratio 2 to match bwip-js 2:1 MSI encoding', () => {
    // MSI standard uses 2:1 wide:narrow ratio; bwip-js hardcodes this.
    // ZPL ^BY defaults to 3:1, so we must emit ^BY{mw},2 to keep Labelary in sync.
    const { regenerated } = roundtrip(
      '^XA^PW784^LL264^CI28^BY2^FO0,0^BMN,N,80,Y,N^FD12345678^FS^XZ',
    );
    expect(regenerated).toContain('^BY2,2');
  });
});

// ── ^FD content with commas ───────────────────────────────────────────────────

describe('round-trip — comma in ^FD content', () => {
  it('preserves commas inside field data (tokenizer splits only on ^ and ~)', () => {
    const { first, second } = roundtrip(
      '^XA^PW640^LL400^FO0,0^A0N,30,0^FDHello, World, 2024^FS^XZ',
    );
    expect(props(first.objects[0]).content).toBe('Hello, World, 2024');
    expect(props(second.objects[0]).content).toBe(props(first.objects[0]).content);
  });
});

// ── real-world Zebra Designer header commands ─────────────────────────────────

// ── text rotation × positionType byte-exact round-trip ─────────────────────
//
// Regression guard for the model-vs-ZPL coordinate split: obj.x/y is the
// Konva render position (EM-top-left); the ZPL emit / parse pair adds /
// subtracts a rotation- and positionType-dependent offset. If those two
// functions drift apart, the rendered Konva position no longer matches
// the printed ZPL anchor for rotated text, invisibly, until preview /
// print catches it. This loops every rotation × {FO, FT} combination at
// realistic fontHeights and asserts the original ZPL bytes survive a
// parse → generate cycle.

describe('round-trip — text rotation × positionType preservation', () => {
  for (const pos of ['FO', 'FT'] as const) {
    for (const rot of ['N', 'R', 'I', 'B'] as const) {
      for (const fontHeight of [20, 30, 50, 87]) {
        it(`preserves ^${pos} x,y for rotation ${rot} h=${fontHeight}`, () => {
          const inputZpl =
            `^XA^${pos}123,456^A0${rot},${fontHeight},0^FDHello^FS^XZ`;
          const { regenerated } = roundtrip(inputZpl);
          // The emitted ZPL must contain the same ^FO/^FT coordinates and
          // ^A0 declaration as the input; anything else means the
          // model↔ZPL shift drifted between parser and generator.
          expect(regenerated).toContain(`^${pos}123,456`);
          expect(regenerated).toContain(`^A0${rot},${fontHeight},0`);
        });
      }
    }
  }

  // Device fonts (A-H) substitute a different face on the canvas, which would
  // change inkWidth and thus the FO/I and FO/B rotation anchor shift. The
  // emit/parse path must stay PrintLab-based (no canvas substitution), so a
  // rotated ^AB / ^AH field round-trips byte-exact regardless of the substitute.
  for (const font of ['B', 'H'] as const) {
    for (const rot of ['I', 'B'] as const) {
      it(`device font ^A${font}${rot} round-trips byte-exact (no canvas-metric leak)`, () => {
        const inputZpl = `^XA^FO123,456^A${font}${rot},30,0^FDHELLO^FS^XZ`;
        const { regenerated } = roundtrip(inputZpl);
        expect(regenerated).toContain('^FO123,456');
        expect(regenerated).toContain(`^A${font}${rot},30,0`);
      });
    }
  }

  it('preserves coordinates through two parse-generate cycles', () => {
    const inputZpl =
      '^XA^FT100,200^A0R,30,0^FDA^FS^FO50,80^A0I,40,0^FDB^FS^XZ';
    const { regenerated, second } = roundtrip(inputZpl);
    // Second-pass parse of the regenerated ZPL must produce the same
    // objects (obj.x/y unchanged) as the first.
    const { first } = roundtrip(inputZpl);
    expect(second.objects.map((o) => [o.x, o.y])).toEqual(
      first.objects.map((o) => [o.x, o.y]),
    );
    expect(regenerated).toContain('^FT100,200');
    expect(regenerated).toContain('^FO50,80');
  });
});

describe('parseZPL — real-world structural commands are silently ignored', () => {
  // Labels produced by Zebra Designer / ZPL II tools commonly begin with a
  // block of printer configuration commands that carry no canvas-design info.
  // They must NOT pollute the unknown findings.
  const ZEBRA_HEADER_ZPL = [
    '^XA',
    '^CI28',          // UTF-8 encoding
    '^PR5',           // print rate
    '^MMT',           // media mode tear-off
    '^MNY',           // media handling
    '^MTT',           // media type
    '^JMA',           // applicator / configuration recall
    '^XF',            // genuinely unknown – will test it IS in unknown
    '^PW600',
    '^LL400',
    '^FO50,50^A0N,30,0^FDReal Label^FS',
    '^XZ',
  ].join('');

  it('does not flag ^CI, ^PR, ^MN, ^JM, ^MT as unknown', () => {
    const parsed = parseSingle(ZEBRA_HEADER_ZPL, 8);
    const noiseInUnknown = commandsOf(parsed, 'unknown').filter(
      (s) => /^\^(CI|PR|MN|JM|MT|JA)/.test(s),
    );
    expect(noiseInUnknown).toHaveLength(0);
  });

  it('still parses design objects correctly after the header block', () => {
    const { objects } = parseSingle(ZEBRA_HEADER_ZPL, 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('text');
    expect(props(objects[0]).content).toBe('Real Label');
  });

  it('genuinely unknown commands still surface as unknown findings', () => {
    const parsed = parseSingle(ZEBRA_HEADER_ZPL, 8);
    expect(commandsOf(parsed, 'unknown').some((s) => s.startsWith('^XF'))).toBe(true);
  });
});

// ── opaque ^GF pass-through ──────────────────────────────────────────────────

/** CRC-16/XMODEM, matching the parser's :Z64: wrapper check, so the corrupt
 *  payload passes wrapper validation and fails only at inflate. */
function crc16(s: string): string {
  let crc = 0;
  for (const ch of s) {
    crc ^= ch.charCodeAt(0) << 8;
    for (let j = 0; j < 8; j++)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).padStart(4, '0').toUpperCase();
}

describe('round-trip — label geometry sidecar', () => {
  it('recovers dpmm + exact mm even when re-parsed at a different dpmm', () => {
    const label: LabelConfig = { widthMm: 57, heightMm: 32, dpmm: 12 };
    const zpl = generateZPL(label, []);
    expect(zpl).toContain('^FXZPLLAB:');
    // Re-parse at the wrong external dpmm: ^PW/^LL alone would give 85.5×48mm
    // at 8dpmm, but the sidecar restores the authored geometry exactly.
    const parsed = parseSingle(zpl, 8);
    expect(parsed.labelConfig.dpmm).toBe(12);
    expect(parsed.labelConfig.widthMm).toBe(57);
    expect(parsed.labelConfig.heightMm).toBe(32);
  });
});

describe('round-trip — opaque ^GF pass-through', () => {
  // Valid wrapper + matching CRC but garbage deflate bytes: we can't decode it,
  // so the command is preserved verbatim instead of dropped.
  const b64 = btoa('not a real zlib stream');
  const field = `:Z64:${b64}:${crc16(b64)}`;
  const ZPL = `^XA^FO40,60^GFC,4,16,2,${field}^FS^XZ`;

  it('re-emits the undecodable ^GF verbatim and survives re-parse', () => {
    const { first, second, regenerated } = roundtrip(ZPL);
    expect(first.objects).toHaveLength(1);
    expect(props(first.objects[0]).rawGf).toBe(`^GFC,4,16,2,${field}`);
    expect(regenerated).toContain(`^GFC,4,16,2,${field}`);
    // Idempotent: same opaque image at the same origin after a full round-trip.
    expect(second.objects).toHaveLength(1);
    expect(props(second.objects[0]).rawGf).toBe(`^GFC,4,16,2,${field}`);
    expect(defined(second.objects[0]).x).toBe(40);
    expect(defined(second.objects[0]).y).toBe(60);
  });
});

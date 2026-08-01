import { describe, it, expect, beforeAll } from 'vitest';
import { zlibSync } from 'fflate';
import { parseZPL, BY_CONSUMING_BARCODE_TYPES } from '@zplab/core/lib/zplParser';
import { formatLabelMetaComment } from '@zplab/core/lib/zplLabelMeta';
import { ObjectRegistry } from '@zplab/core/registry';
import { props, serialOf, parseSingle, commandsOf } from '../test/helpers';

// Drift guard for the bare-^BY hazard set. Every 1D and postal barcode emits a
// ^BY on regen, so it must be classified ^BY-consuming; a forgotten new one
// would silently let a neighbour's ^BY leak. 2D mag-codes must stay excluded.
describe('BY_CONSUMING_BARCODE_TYPES drift guard', () => {
  it('includes every code-1d and legacy type', () => {
    for (const [type, entry] of Object.entries(ObjectRegistry)) {
      if (entry.group === 'code-1d' || entry.group === 'legacy') {
        expect(BY_CONSUMING_BARCODE_TYPES.has(type), `${type} (${entry.group})`).toBe(true);
      }
    }
  });

  it('excludes 2D mag-codes and includes the ^BY-using stacked 2D codes', () => {
    for (const t of ['qrcode', 'datamatrix', 'aztec', 'maxicode']) {
      expect(BY_CONSUMING_BARCODE_TYPES.has(t), t).toBe(false);
    }
    for (const t of ['pdf417', 'micropdf417', 'codablock', 'tlc39']) {
      expect(BY_CONSUMING_BARCODE_TYPES.has(t), t).toBe(true);
    }
  });

  it('lists only real registry leaf types', () => {
    for (const t of BY_CONSUMING_BARCODE_TYPES) {
      expect(Object.prototype.hasOwnProperty.call(ObjectRegistry, t), t).toBe(true);
    }
  });
});

/** CRC-16/XMODEM; same variant used by the parser to validate
 *  :B64:/:Z64: wrappers (poly 0x1021, init 0x0000). Duplicated here so
 *  tests can build valid CRC values without exporting the parser's
 *  internal helper. */
function testCrc16(s: string): string {
  let crc = 0;
  for (const ch of s) {
    crc ^= ch.charCodeAt(0) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).padStart(4, '0').toUpperCase();
}

function makeZ64Field(bytes: Uint8Array): string {
  const deflated = zlibSync(bytes);
  let bin = '';
  for (const b of deflated) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  return `:Z64:${b64}:${testCrc16(b64)}`;
}

// ── label config ──────────────────────────────────────────────────────────────

describe('parseZPL — label config', () => {
  it('parses ^PW and ^LL into mm dimensions at 8 dpmm', () => {
    const { labelConfig } = parseSingle('^XA^PW800^LL600^XZ', 8);
    expect(labelConfig.widthMm).toBe(100);   // 800 dots / 8 dpmm
    expect(labelConfig.heightMm).toBe(75);   // 600 dots / 8 dpmm
  });

  it('ignores ^PW / ^LL with zero value', () => {
    const { labelConfig } = parseSingle('^XA^PW0^LL0^XZ', 8);
    expect(labelConfig.widthMm).toBeUndefined();
    expect(labelConfig.heightMm).toBeUndefined();
  });

  it('parses ^PQ print quantity', () => {
    const { labelConfig } = parseSingle('^XA^PQ3^XZ', 8);
    expect(labelConfig.printQuantity).toBe(3);
  });

  it('ignores ^PQ with 0', () => {
    const { labelConfig } = parseSingle('^XA^PQ0^XZ', 8);
    expect(labelConfig.printQuantity).toBeUndefined();
  });
});

describe('parseZPL — ^MU units of measure', () => {
  it('^MUI rescales following ^GB coords from inches to dots at 8 dpmm', () => {
    // 1 inch @ 8 dpmm = 8 * 25.4 = 203.2 dots, rounded to 203
    const { objects } = parseSingle('^XA^MUI^FO1,2^GB1,1,0.1^FS^XZ', 8);
    const [obj] = objects;
    expect(obj?.x).toBe(203);
    expect(obj?.y).toBe(406);
  });

  it('^MUM rescales following ^GB coords from mm to dots at 8 dpmm', () => {
    // 10 mm @ 8 dpmm = 80 dots
    const { objects } = parseSingle('^XA^MUM^FO10,20^GB10,10,1^FS^XZ', 8);
    const [obj] = objects;
    expect(obj?.x).toBe(80);
    expect(obj?.y).toBe(160);
  });

  it('^MUD leaves ^GB coords unchanged (dots-canonical, default)', () => {
    const { objects } = parseSingle('^XA^MUD^FO100,200^GB50,50,2^FS^XZ', 8);
    const [obj] = objects;
    expect(obj?.x).toBe(100);
    expect(obj?.y).toBe(200);
  });

  it('^MU carries across ^XA per spec (field-by-field until overridden)', () => {
    // Spec: "^MU carries over from field to field until a new mode is
    // entered." Single-pass parse carries it across ^XA blocks too.
    const r = parseZPL(
      '^XA^MUI^FO1,1^GB1,1,1^FS^XZ^XA^FO1,1^GB1,1,1^FS^XZ',
      8,
    );
    expect(r.pages[0]?.objects[0]?.x).toBe(203);
    expect(r.pages[1]?.objects[0]?.x).toBe(203);
  });

  it('^MU b,c slots persist as a pair on labelConfig for re-emit', () => {
    const { labelConfig } = parseSingle('^XA^MUD,150,300^XZ', 8);
    expect(labelConfig.muResampling).toEqual({ formatDpi: 150, outputDpi: 300 });
  });

  it('^MU with out-of-spec dpi values surfaces as partial finding', () => {
    const { labelConfig, findings } = parseSingle('^XA^MUD,77,999^XZ', 8);
    expect(labelConfig.muResampling).toBeUndefined();
    expect(commandsOf({ findings }, 'partial')).toContain('^MU');
  });

  it('^MU,150,300 with a-slot omitted resets unit to D and persists the pair', () => {
    const { labelConfig, objects } = parseSingle(
      '^XA^MU,150,300^FO100,100^GB10,10,1^FS^XZ',
      8,
    );
    expect(labelConfig.muResampling).toEqual({ formatDpi: 150, outputDpi: 300 });
    // a-slot defaulted to D so coords stay unscaled
    expect(objects[0]?.x).toBe(100);
  });

  it('invalid ^MU a-slot surfaces as partial finding without dropping prior unit', () => {
    // ^MUI sets unitScale to inches; a follow-up ^MUX must not silently
    // downgrade subsequent coords to dots.
    const { objects, findings } = parseSingle(
      '^XA^MUI^FO1,1^GB1,1,1^FS^MUX^FO1,1^GB1,1,1^FS^XZ',
      8,
    );
    expect(commandsOf({ findings }, 'partial')).toContain('^MU');
    expect(objects[0]?.x).toBe(203);
    expect(objects[1]?.x).toBe(203);
  });

  it('half-set ^MU dpi pair is rejected as partial (both-or-neither invariant)', () => {
    const { labelConfig, findings } = parseSingle('^XA^MUD,200^XZ', 8);
    expect(labelConfig.muResampling).toBeUndefined();
    expect(commandsOf({ findings }, 'partial')).toContain('^MU');
  });

  it('round-trip: ^MUD,b,c parses + generates back symmetrically', () => {
    const original = '^XA^MUD,200,600^PW600^LL400^CI28^XZ';
    const { labelConfig } = parseSingle(original, 8);
    expect(labelConfig.muResampling).toEqual({ formatDpi: 200, outputDpi: 600 });
  });

  it('^MUI also rescales dynamic ^A{font} dims (the wildcard-dispatch path)', () => {
    // 0.5 inch font height @ 8 dpmm = 101.6 → 102 dots
    const { objects } = parseSingle('^XA^MUI^FO0,0^A1N,0.5,0.5^FDX^FS^XZ', 8);
    expect(props(objects[0]).fontHeight).toBe(102);
    expect(props(objects[0]).fontWidth).toBe(102);
  });

  it('^MUI admits fractional inch values (the whole point of I-mode)', () => {
    // 0.5 inch @ 8 dpmm = 0.5 * 8 * 25.4 = 101.6 dots, rounded to 102
    const { objects } = parseSingle('^XA^MUI^FO0.5,0.25^GB1,1,0.05^FS^XZ', 8);
    const [box] = objects;
    expect(box?.x).toBe(102);
    expect(box?.y).toBe(51);
    expect(props(box).width).toBe(203);
    expect(props(box).thickness).toBe(10); // 0.05 in = 10.16 dots → 10
  });

  it('^MUI also rescales ^GB dimensions and ^PW/^LL', () => {
    const { labelConfig, objects } = parseSingle(
      '^XA^MUI^PW4^LL3^FO0,0^GB1,2,0.05^FS^XZ',
      8,
    );
    expect(labelConfig.widthMm).toBeCloseTo(101.6, 0); // 4 in = 812.8 dots / 8 = 101.6 mm
    expect(labelConfig.heightMm).toBeCloseTo(76.2, 0);
    const box = objects[0];
    expect(box?.type).toBe('box');
    // 1 in width = 203 dots, 2 in height = 406, 0.05 in thickness = 10 dots
    expect(props(box).width).toBe(203);
    expect(props(box).height).toBe(406);
  });
});

// ── text ──────────────────────────────────────────────────────────────────────

describe('parseZPL — text via ^A0', () => {
  it('creates a text object from an explicit ^A0 command', () => {
    const { objects } = parseSingle('^XA^FO10,20^A0N,30,0^FDHello^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    const [obj] = objects;
    expect(obj?.type).toBe('text');
    // obj.x/y is the Konva render position (EM-top-left); the parsed ^FO
    // gives the ZPL cap-top anchor. For N/h=30 they differ by
    // (0.234 - 0.08) * 30 = 4.62 dots in Y.
    expect(obj?.x).toBeCloseTo(10);
    expect(obj?.y).toBeCloseTo(20 - 4.62);
    expect(props(obj).content).toBe('Hello');
    expect(props(obj).fontHeight).toBe(30);
    expect(props(obj).rotation).toBe('N');
  });

  it('parses rotation from ^A0', () => {
    const { objects } = parseSingle('^XA^FO0,0^A0R,20,0^FDTilt^FS^XZ', 8);
    expect(props(objects[0]).rotation).toBe('R');
  });
});

describe('parseZPL — text via ^CF (implicit field)', () => {
  it('creates text from ^CF + ^FD without an explicit ^A', () => {
    const { objects } = parseSingle('^XA^CF0,60^FO50,50^FDIntershipping, Inc.^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    const [obj] = objects;
    expect(obj?.type).toBe('text');
    expect(props(obj).content).toBe('Intershipping, Inc.');
    expect(props(obj).fontHeight).toBe(60);
  });

  it('updates fontHeight when ^CF changes between fields', () => {
    const zpl = '^XA^CF0,60^FO0,0^FDFirst^FS^CF0,30^FO0,50^FDSecond^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(2);
    expect(props(objects[0]).fontHeight).toBe(60);
    expect(props(objects[1]).fontHeight).toBe(30);
  });

  it('uses ^CFA font command (non-zero font name) to set height', () => {
    // ^CFA,30 → cmd='CF', rest='A,30' → height=30
    const { objects } = parseSingle('^XA^CFA,30^FO0,0^FDText^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(props(objects[0]).fontHeight).toBe(30);
  });
});

describe('parseZPL — text field position', () => {
  it('records positionType FO for ^FO fields', () => {
    const { objects } = parseSingle('^XA^FO10,20^A0N,30,0^FDHi^FS^XZ', 8);
    expect(objects[0]?.positionType).toBe('FO');
  });

  it('records positionType FT for ^FT fields', () => {
    const { objects } = parseSingle('^XA^FT10,20^A0N,30,0^FDHi^FS^XZ', 8);
    expect(objects[0]?.positionType).toBe('FT');
  });
});

describe('parseZPL — ^FT graphic box/line bottom-left anchor', () => {
  // Spec p.205: a ^FT graphic origin is the bottom-left corner; the model stores
  // the top-left, so it lifts by the box height. ^FO is the top-left verbatim.
  it('lifts a ^FT box by its height to the top-left', () => {
    const { objects } = parseSingle('^XA^FT100,200^GB50,40,3,B,0^FS^XZ', 8);
    expect(objects[0]?.type).toBe('box');
    expect(objects[0]?.positionType).toBe('FT');
    expect(objects[0]?.x).toBe(100);
    expect(objects[0]?.y).toBe(160); // 200 - 40
  });

  it('keeps a ^FO box at the top-left', () => {
    const { objects } = parseSingle('^XA^FO100,200^GB50,40,3,B,0^FS^XZ', 8);
    expect(objects[0]?.positionType).toBe('FO');
    expect(objects[0]?.y).toBe(200);
  });

  it('lifts a ^FT horizontal line by its thickness', () => {
    const { objects } = parseSingle('^XA^FT100,200^GB80,4,4,B,0^FS^XZ', 8);
    expect(objects[0]?.type).toBe('line');
    expect(objects[0]?.positionType).toBe('FT');
    expect(objects[0]?.y).toBe(196); // 200 - 4 (thickness)
  });

  it('anchors a right-justified ^FT,1 box at the bottom-right corner', () => {
    const { objects } = parseSingle('^XA^FT200,200,1^GB50,40,3,B,0^FS^XZ', 8);
    expect(objects[0]?.fieldJustify).toBe('R');
    expect(objects[0]?.x).toBe(150); // 200 - 50 (width)
    expect(objects[0]?.y).toBe(160); // 200 - 40 (height)
  });

  it('treats z=2 (auto) like left: bottom-left anchor, no R justify', () => {
    // Only z=1 (right) is modelled; z=2 (auto, bidirectional) narrows to left.
    const { objects } = parseSingle('^XA^FT200,200,2^GB50,40,3,B,0^FS^XZ', 8);
    expect(objects[0]?.fieldJustify).toBeUndefined();
    expect(objects[0]?.x).toBe(200); // left edge, not shifted by width
    expect(objects[0]?.y).toBe(160); // 200 - 40 (bottom-left lift)
  });
});

describe('parseZPL — ^LH label home offset', () => {
  it('adds ^LH offset to all field positions', () => {
    const { objects } = parseSingle('^XA^LH20,10^FO30,40^A0N,30,0^FDText^FS^XZ', 8);
    // obj.x = (^FO.x + ^LH.x) - zplAnchorDelta.x; obj.y similar.
    // For FO/N h=30: dx=0, dy=4.62.
    expect(objects[0]?.x).toBeCloseTo(50);  // 30 + 20
    expect(objects[0]?.y).toBeCloseTo(50 - 4.62);  // 40 + 10 - shift
  });
});

// ── ^FR field reverse ─────────────────────────────────────────────────────────

describe('parseZPL — ^FR field reverse', () => {
  it('sets reverse on a text field when ^FR precedes ^FD', () => {
    const { objects } = parseSingle('^XA^FO0,0^FR^A0N,30,0^FDReversed^FS^XZ', 8);
    expect(props(objects[0]).reverse).toBe(true);
  });

  it('does not set reverse without ^FR', () => {
    const { objects } = parseSingle('^XA^FO0,0^A0N,30,0^FDNormal^FS^XZ', 8);
    expect(props(objects[0]).reverse).toBeFalsy();
  });

  it('keeps an unrelated filled box + ^FR text at a different anchor as two objects', () => {
    // Anchor mismatch ⇒ no collapse. Hand-written ZPL where a black box
    // and an ^FR text happen to coexist must round-trip unchanged.
    const { objects } = parseSingle(
      '^XA^FO10,10^GB60,30,60,B,0^FS^FO200,200^A0N,30,0^FR^FDHi^FS^XZ',
      8,
    );
    expect(objects).toHaveLength(2);
    expect(objects[0]?.type).toBe('box');
    expect(objects[1]?.type).toBe('text');
    expect(props(objects[1]).reverse).toBe(true);
  });
});

// ── shapes ────────────────────────────────────────────────────────────────────

describe('parseZPL — ^GB box', () => {
  it('creates an unfilled box when thickness < min dimension', () => {
    const { objects } = parseSingle('^XA^FO10,20^GB200,100,3,B,0^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    const [obj] = objects;
    expect(obj?.type).toBe('box');
    expect(obj?.x).toBe(10);
    expect(obj?.y).toBe(20);
    expect(props(obj).width).toBe(200);
    expect(props(obj).height).toBe(100);
    expect(props(obj).thickness).toBe(3);
    expect(props(obj).filled).toBe(false);
    expect(props(obj).color).toBe('B');
    expect(props(obj).rounding).toBe(0);
  });

  it('creates a filled box when thickness equals the smallest dimension', () => {
    const { objects } = parseSingle('^XA^FO0,0^GB100,100,100^FS^XZ', 8);
    expect(objects[0]?.type).toBe('box');
    expect(props(objects[0]).filled).toBe(true);
  });

  it('creates a box with rounding', () => {
    const { objects } = parseSingle('^XA^FO0,0^GB100,50,3,B,5^FS^XZ', 8);
    expect(props(objects[0]).rounding).toBe(5);
  });
});

describe('parseZPL — ^GB line', () => {
  it('creates a horizontal line when height equals thickness', () => {
    const { objects } = parseSingle('^XA^FO50,100^GB700,3,3^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    const [obj] = objects;
    expect(obj?.type).toBe('line');
    expect(props(obj).angle).toBe(0);
    expect(props(obj).length).toBe(700);
    expect(props(obj).thickness).toBe(3);
  });

  it('creates a vertical line when width equals thickness', () => {
    const { objects } = parseSingle('^XA^FO100,50^GB3,250,3^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    const [obj] = objects;
    expect(obj?.type).toBe('line');
    expect(props(obj).angle).toBe(90);
    expect(props(obj).length).toBe(250);
  });
});

// ── barcodes ──────────────────────────────────────────────────────────────────

describe('parseZPL — ^BC Code 128', () => {
  it('creates a code128 object from ^BC^FD', () => {
    const { objects } = parseSingle('^XA^FO100,50^BCN,200,Y,N,N^FD12345678^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    const [obj] = objects;
    expect(obj?.type).toBe('code128');
    expect(props(obj).content).toBe('12345678');
    expect(props(obj).height).toBe(200);
    expect(props(obj).printInterpretation).toBe(true);
    expect(props(obj).checkDigit).toBe(false);
  });

  it('inherits height from ^BY when ^BC has no explicit height', () => {
    const { objects } = parseSingle('^XA^BY5,2,270^FO100,50^BC^FD12345678^FS^XZ', 8);
    expect(props(objects[0]).height).toBe(270);
    expect(props(objects[0]).moduleWidth).toBe(5);
  });

  it('keeps barcodes on later blocks after a page reset (live field state)', () => {
    // resetFormatScopedState reassigns s.field at each page close; ^B* handlers
    // must read the live field, not a destructured alias from before the reset,
    // or blocks after the first render as bare text.
    const r = parseZPL(
      '^XA^FO10,10^BY2^BCN,100,N,N,N^FD123^FS^XZ^XA^FO20,20^BY2^BCN,80,N,N,N^FD456^FS^XZ',
      8,
    );
    expect(r.pages[0]?.objects[0]?.type).toBe('code128');
    expect(r.pages[1]?.objects[0]?.type).toBe('code128');
  });
});

describe('parseZPL — ^BR GS1 Databar', () => {
  it('reads ^BR p[2] as the gs1databar magnification, not byModuleWidth', () => {
    // ^BY4 sets dot-typed module width 4; ^BR p[2]=6 is the multiplier.
    // Pre-refactor both wrote into byModuleWidth so the 4 was clobbered.
    const { objects } = parseSingle(
      '^XA^BY4,2,100^FO0,0^BRN,1,6,2,100^FD0112345678901^FS^XZ',
      8,
    );
    const obj = objects[0];
    expect(obj?.type).toBe('gs1databar');
    expect(props(obj).magnification).toBe(6);
  });

  it('falls back to ^BY moduleWidth when ^BR omits the magnification slot', () => {
    const { objects } = parseSingle(
      '^XA^BY3,2,100^FO0,0^BRN,1^FD0112345678901^FS^XZ',
      8,
    );
    expect(props(objects[0]).magnification).toBe(3);
  });
});

// ── ^FX comment ───────────────────────────────────────────────────────────────

describe('parseZPL — ^FX comment', () => {
  it('does not produce objects or skips for ^FX lines', () => {
    const parsed = parseSingle(
      '^XA^FX This is a comment^FO10,20^A0N,30,0^FDText^FS^XZ',
      8,
    );
    const skipped = [...commandsOf(parsed, 'browserLimit'), ...commandsOf(parsed, 'unknown')];
    expect(parsed.objects).toHaveLength(1);
    expect(skipped.some((s) => s.startsWith('^FX'))).toBe(false);
  });

  it('attaches a single ^FX to the next object as comment', () => {
    const { objects } = parseSingle(
      '^XA^FXTop section^FO10,20^A0N,30,0^FDText^FS^XZ',
      8,
    );
    expect(objects[0]?.comment).toBe('Top section');
  });

  it('joins consecutive ^FX lines with a newline', () => {
    const { objects } = parseSingle(
      '^XA^FXLine 1^FXLine 2^FO10,20^A0N,30,0^FDText^FS^XZ',
      8,
    );
    expect(objects[0]?.comment).toBe('Line 1\nLine 2');
  });

  it('does not bleed comments across ^XA boundaries', () => {
    const r = parseZPL(
      '^XA^FXOnly first^XZ^XA^FO10,20^A0N,30,0^FDText^FS^XZ',
      8,
    );
    expect(r.pages[1]?.objects[0]?.comment).toBeUndefined();
  });

  it('does not reattach a consumed comment to a later object', () => {
    const { objects } = parseSingle(
      '^XA^FXOnly first^FO10,20^A0N,30,0^FDFirst^FS^FO10,60^A0N,30,0^FDSecond^FS^XZ',
      8,
    );
    expect(objects[0]?.comment).toBe('Only first');
    expect(objects[1]?.comment).toBeUndefined();
  });
});

// ── barcode rotation ──────────────────────────────────────────────────────────

describe('parseZPL — barcode rotation', () => {
  it.each([
    ['^XA^BY2^FO0,0^BCR,100,Y,N,N^FD123^FS^XZ', 'R'],
    ['^XA^BY2^FO0,0^BCI,100,Y,N,N^FD123^FS^XZ', 'I'],
    ['^XA^BY2^FO0,0^BCB,100,Y,N,N^FD123^FS^XZ', 'B'],
    ['^XA^FO0,0^BXB,5,200^FDX^FS^XZ', 'B'],
    ['^XA^FO0,0^B7I,4,0,0,,,^FDX^FS^XZ', 'I'],
    ['^XA^FO0,0^B0R,4,N,N,N,N^FDX^FS^XZ', 'R'],
  ])('reads orientation from %s', (zpl, expected) => {
    const { objects } = parseSingle(zpl, 8);
    expect((props(objects[0]) as { rotation?: string }).rotation).toBe(expected);
  });

  // ^BQ's orientation slot is a firmware no-op; the parser pins it to N (a
  // rotated QR arrives as ^GFA + sidecar instead).
  it('canonicalizes the decorative ^BQ orientation slot to N', () => {
    const { objects } = parseSingle('^XA^FO0,0^BQR,2,4^FDQA,X^FS^XZ', 8);
    const obj = objects[0];
    expect((props(obj) as { rotation?: string }).rotation).toBe('N');
  });

  // The generator prefixes obj.comment as its own ^FX line; the sidecar must
  // still be found (and the user comment kept) or the QR degrades to an image.
  it('keeps a rotated QR and its comment when a user comment precedes the sidecar', () => {
    const def = ObjectRegistry['qrcode'];
    const body = def!.toZPL({
      id: 'q', type: 'qrcode', x: 40, y: 60, rotation: 0,
      props: { content: 'X', magnification: 4, errorCorrection: 'Q', model: 2, rotation: 'R' },
    } as never);
    const { objects } = parseSingle(`^XA^FXmy note
${body}^XZ`, 8);
    expect(objects[0]?.type).toBe('qrcode');
    expect(objects[0]?.comment).toBe('my note');
  });

  // Emit and reimport share the barcode anchor convention, so a ^FT rotated
  // QR must round-trip its raw anchor (no ftTopLeft/height re-mapping).
  it('round-trips a rotated QR under ^FT without anchor drift', () => {
    const def = ObjectRegistry['qrcode'];
    const body = def!.toZPL({
      id: 'q', type: 'qrcode', x: 40, y: 160, rotation: 0, positionType: 'FT',
      props: { content: 'X', magnification: 4, errorCorrection: 'Q', model: 2, rotation: 'R' },
    } as never);
    const { objects } = parseSingle(`^XA${body}^XZ`, 8);
    expect(objects[0]?.type).toBe('qrcode');
    expect(objects[0]?.positionType).toBe('FT');
    expect(objects[0]?.x).toBe(40);
    expect(objects[0]?.y).toBe(160);
  });

  it('reconstructs a rotated QR from the graphic sidecar', () => {
    const def = ObjectRegistry['qrcode'];
    const body = def!.toZPL({
      id: 'q', type: 'qrcode', x: 40, y: 60, rotation: 0,
      props: { content: 'https://x.de', magnification: 5, errorCorrection: 'M', model: 2, rotation: 'B' },
    } as never);
    const { objects } = parseSingle(`^XA${body}^XZ`, 8);
    expect(objects).toHaveLength(1);
    const obj = objects[0];
    expect(obj?.type).toBe('qrcode');
    expect(obj?.x).toBe(40);
    expect(obj?.y).toBe(60);
    expect(props(obj)).toMatchObject({
      content: 'https://x.de', magnification: 5, errorCorrection: 'M', model: 2, rotation: 'B',
    });
  });

  it('defaults to N when orientation is missing or unrecognised', () => {
    const { objects } = parseSingle('^XA^BY2^FO0,0^BC,100,Y,N,N^FD123^FS^XZ', 8);
    expect((props(objects[0]) as { rotation?: string }).rotation).toBe('N');
  });
});

// ── ^FH hex encoding ──────────────────────────────────────────────────────────

describe('parseZPL — ^FH hex escape', () => {
  it('decodes hex-escaped characters in field data', () => {
    // _41 = hex 41 = 'A'
    const { objects } = parseSingle('^XA^FH_^FO0,0^A0N,30,0^FD_41BC^FS^XZ', 8);
    expect(props(objects[0]).content).toBe('ABC');
  });

  it('keeps a ^FH-encoded GS as the GS1 separator instead of a control chip', () => {
    // GS1-128 with a hex-escaped separator between variable AIs: the raw GS
    // must reach the GS1 normalisation, not be chip-tokenised away.
    const { objects } = parseSingle(
      '^XA^FO0,0^BY2^BCN,100,Y,N,N,D^FH_^FD010401234567890110AB_1D21XY^FS^XZ', 8,
    );
    const content = props(objects[0]).content as string;
    expect(content).not.toContain('ctrl:');
    expect(content).toContain('10AB\x1D21XY');
  });

  it('chip-tokenises a ^FH control byte on a non-GS1 code128', () => {
    const { objects } = parseSingle('^XA^FO0,0^BY2^BCN,100,Y,N,N^FH_^FDAB_09CD^FS^XZ', 8);
    expect(props(objects[0]).content).toBe('AB«ctrl:TAB»CD');
  });

  it('chip-tokenises Code 128 subset invocations (the form the printer encodes)', () => {
    // ZD230-verified payload: >9 Start Code A plus Subset A value pairs.
    const { objects } = parseSingle(
      '^XA^FO0,0^BY2^BCN,100,Y,N,N^FD>933347335367774373893923940^FS^XZ', 8,
    );
    expect(props(objects[0]).content)
      .toBe('AB«ctrl:TAB»CD«ctrl:CR»«ctrl:LF»EF«ctrl:GS»«ctrl:FS»GH');
  });

  it('decodes a Subset B start with a mid-field switch to A', () => {
    const { objects } = parseSingle('^XA^FO0,0^BY2^BCN,100,Y,N,N^FD>:ab>7733536^FS^XZ', 8);
    expect(props(objects[0]).content).toBe('ab«ctrl:TAB»CD');
  });

  it('keeps a stream whose >6/>7 mean FNC 4 verbatim', () => {
    // Table 2 is direction-dependent: >6 out of Subset B and >7 out of Subset A
    // are FNC 4, not switches. Adopting them dropped a symbol on re-export.
    for (const fd of ['>:AB>6CD>773', '>93334>773']) {
      const { objects } = parseSingle(`^XA^FO0,0^BY2^BCN,100,Y,N,N^FD${fd}^FS^XZ`, 8);
      expect(props(objects[0]).content, fd).toBe(fd);
    }
  });

  it('keeps an escape stream that carries no control byte verbatim', () => {
    // Nothing to chip means nothing to fix; the payload must re-export byte-exact.
    const { objects } = parseSingle('^XA^FO0,0^BY2^BCN,100,Y,N,N^FD>:CODE128^FS^XZ', 8);
    expect(props(objects[0]).content).toBe('>:CODE128');
  });

  it('decodes UTF-8 multibyte escapes (German umlauts)', () => {
    // _C3_A4 = ä, _C3_B6 = ö, _C3_BC = ü
    const { objects } = parseSingle('^XA^FH_^FO0,0^A0N,30,0^FD_C3_A4_C3_B6_C3_BC^FS^XZ', 8);
    expect(props(objects[0]).content).toBe('äöü');
  });

  it('decodes UTF-8 multibyte escapes (Nordic)', () => {
    // _C3_A6 = æ, _C3_B8 = ø, _C3_A5 = å
    const { objects } = parseSingle('^XA^FH_^FO0,0^A0N,30,0^FD_C3_A6_C3_B8_C3_A5^FS^XZ', 8);
    expect(props(objects[0]).content).toBe('æøå');
  });

  it('decodes 3-byte UTF-8 escapes (Euro sign)', () => {
    // _E2_82_AC = €
    const { objects } = parseSingle('^XA^FH_^FO0,0^A0N,30,0^FD_E2_82_AC^FS^XZ', 8);
    expect(props(objects[0]).content).toBe('€');
  });

  it('decodes mixed ASCII and UTF-8 escapes in one field', () => {
    // _48 = H, _69 = i, then ä
    const { objects } = parseSingle('^XA^FH_^FO0,0^A0N,30,0^FD_48_69 _C3_A4^FS^XZ', 8);
    expect(props(objects[0]).content).toBe('Hi ä');
  });

  it('replaces invalid UTF-8 byte sequences with U+FFFD', () => {
    // _C3 alone is a truncated 2-byte sequence
    const { objects } = parseSingle('^XA^FH_^FO0,0^A0N,30,0^FD_C3^FS^XZ', 8);
    expect(props(objects[0]).content).toBe('�');
  });

  it('decodes ^CI27 (Windows-1252) single-byte escapes', () => {
    // _E4 = 0xE4 = ä in CP1252 (in UTF-8 this would be invalid → U+FFFD)
    const { objects } = parseSingle('^XA^CI27^FH_^FO0,0^A0N,30,0^FD_E4_F6_FC^FS^XZ', 8);
    expect(props(objects[0]).content).toBe('äöü');
  });

  it('switches encoding mid-label on ^CI', () => {
    // first field UTF-8 (default), second field CP1252
    const zpl =
      '^XA^FH_^FO0,0^A0N,30,0^FD_C3_A4^FS' +
      '^CI27^FH_^FO0,50^A0N,30,0^FD_E4^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    expect(props(objects[0]).content).toBe('ä');
    expect(props(objects[1]).content).toBe('ä');
  });

  it('reports unsupported ^CI N as partial import', () => {
    // ^CI50 is not a real Zebra encoding; falls back to UTF-8 default
    const { findings } = parseSingle('^XA^CI50^FH_^FO0,0^A0N,30,0^FDx^FS^XZ', 8);
    expect(commandsOf({ findings }, 'partial')).toContain('^CI50');
  });

  it('resets decoder to UTF-8 default on unsupported ^CI', () => {
    // After ^CI27 sets CP1252, an unknown ^CI50 must fall back to UTF-8
    // (not keep CP1252) so behaviour is predictable.
    const zpl =
      '^XA^CI27^FH_^FO0,0^A0N,30,0^FD_E4^FS' +
      '^CI50^FH_^FO0,50^A0N,30,0^FD_C3_A4^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    expect(props(objects[0]).content).toBe('ä');  // CP1252
    expect(props(objects[1]).content).toBe('ä');  // UTF-8 (after reset)
  });
});

// ── ^FB field block ───────────────────────────────────────────────────────────

describe('parseZPL — ^FB field block', () => {
  it('creates a text object with block properties', () => {
    const { objects } = parseSingle(
      '^XA^FO10,20^A0N,30,0^FB400,3,5,C,0^FDMulti-line text^FS^XZ',
      8,
    );
    expect(objects).toHaveLength(1);
    expect(props(objects[0]).blockWidth).toBe(400);
    expect(props(objects[0]).blockLines).toBe(3);
    expect(props(objects[0]).blockLineSpacing).toBe(5);
    expect(props(objects[0]).blockJustify).toBe('C');
  });

  it('reads ^FB slot e as hanging indent', () => {
    const { objects } = parseSingle(
      '^XA^FO10,20^A0N,30,0^FB400,3,0,L,40^FDMulti-line text^FS^XZ',
      8,
    );
    expect(props(objects[0]).blockHangingIndent).toBe(40);
  });

  it('clamps negative ^FB hanging indent to 0 (matches Labelary)', () => {
    const { objects } = parseSingle(
      '^XA^FO10,20^A0N,30,0^FB400,3,0,L,-40^FDx^FS^XZ',
      8,
    );
    expect(props(objects[0]).blockHangingIndent).toBeUndefined();
  });


  it('resets ^FB state after use (next text has no block)', () => {
    const zpl = '^XA^FO0,0^A0N,30,0^FB400,2,0,L,0^FDFirst^FS^FO0,100^A0N,30,0^FDSecond^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(2);
    expect(props(objects[0]).blockWidth).toBe(400);
    expect(props(objects[1]).blockWidth).toBeUndefined();
  });

  it('^FB without ^A creates text using ^CF defaults', () => {
    const { objects } = parseSingle('^XA^CF0,25^FO0,0^FB300,2,0,R,0^FDBlock text^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(props(objects[0]).fontHeight).toBe(25);
    expect(props(objects[0]).blockWidth).toBe(300);
    expect(props(objects[0]).blockJustify).toBe('R');
  });
});

// ── ^TB text block ────────────────────────────────────────────────────────────

describe('parseZPL — ^TB text block', () => {
  it('creates a native text-block object (width + clip height, no line count)', () => {
    const { objects } = parseSingle('^XA^CF0,30^FO0,0^TBN,400,120^FDText block^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(props(objects[0]).content).toBe('Text block');
    expect(props(objects[0]).textMode).toBe('tb');
    expect(props(objects[0]).blockWidth).toBe(400);
    expect(props(objects[0]).blockHeight).toBe(120);
    expect(props(objects[0]).blockLines).toBeUndefined();
  });

  it('decodes the <<> escape to a literal <', () => {
    const { objects } = parseSingle('^XA^A0N,30^FO0,0^TBN,400,60^FDA<<>B^FS^XZ', 8);
    expect(props(objects[0]).content).toBe('A<B');
  });

  it('keeps a bare ^TB as a text block (width clamped, not dropped)', () => {
    const { objects } = parseSingle('^XA^A0N,30^FO0,0^TBN^FDx^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(props(objects[0]).textMode).toBe('tb');
    expect(props(objects[0]).blockWidth).toBe(1);
  });

  it('a ^TB+barcode malformed field does not tb-decode the bound default', () => {
    // ^TB sets fieldType=text, then ^BC flips it to a barcode; the bound
    // default must stay raw (match the barcode content), not tb-decoded.
    const { objects, variables } = parseSingle(
      '^XA^FO10,10^TBN,200,50^BCN,100,Y,N^FN1^FD<<>HELLO^FS^XZ',
      8,
    );
    expect(objects[0]?.type).toBe('code128');
    // Field links via marker; the raw (non-tb-decoded) default lives on the var.
    expect(props(objects[0]).content).toBe('«field_1»');
    expect(variables[0]?.defaultValue).toBe('<<>HELLO');
  });
});

// ── ^FP field-direction modifier ──────────────────────────────────────────────

describe('parseZPL — ^FP vertical / reverse text', () => {
  const baseField = '^XA^FO50,50^A0N,30,30';

  it('parses ^FPV as vertical direction', () => {
    const { objects } = parseSingle(`${baseField}^FPV^FDABC^FS^XZ`, 8);
    expect(objects).toHaveLength(1);
    expect(props(objects[0]).fpDirection).toBe('V');
    expect(props(objects[0]).fpCharGap).toBeUndefined();
  });

  it('parses ^FPR as reverse direction', () => {
    const { objects } = parseSingle(`${baseField}^FPR^FDABC^FS^XZ`, 8);
    expect(props(objects[0]).fpDirection).toBe('R');
  });

  it('parses inter-character gap', () => {
    const { objects } = parseSingle(`${baseField}^FPV,5^FDABC^FS^XZ`, 8);
    expect(props(objects[0]).fpDirection).toBe('V');
    expect(props(objects[0]).fpCharGap).toBe(5);
  });

  it('defaults direction to H when only gap is given (^FP,5)', () => {
    const { objects } = parseSingle(`${baseField}^FP,5^FDABC^FS^XZ`, 8);
    // H is omitted on emit by leaving fpDirection undefined; gap survives.
    expect(props(objects[0]).fpDirection).toBeUndefined();
    expect(props(objects[0]).fpCharGap).toBe(5);
  });

  it('falls back to H for unknown direction letters', () => {
    const { objects } = parseSingle(`${baseField}^FPX^FDABC^FS^XZ`, 8);
    expect(props(objects[0]).fpDirection).toBeUndefined();
  });

  it('does not leak ^FP across ^FS into the next field', () => {
    const zpl =
      `${baseField}^FPV,3^FDFirst^FS` +
      `^FO50,150^A0N,30,30^FDSecond^FS^XZ`;
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(2);
    expect(props(objects[0]).fpDirection).toBe('V');
    expect(props(objects[0]).fpCharGap).toBe(3);
    expect(props(objects[1]).fpDirection).toBeUndefined();
    expect(props(objects[1]).fpCharGap).toBeUndefined();
  });

});

// ── additional barcode types ──────────────────────────────────────────────────

describe('parseZPL — ^B3 Code 39', () => {
  it('creates a code39 object', () => {
    const { objects } = parseSingle('^XA^FO0,0^B3N,N,100,Y,N^FDABC^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('code39');
    expect(props(objects[0]).content).toBe('ABC');
    expect(props(objects[0]).height).toBe(100);
    expect(props(objects[0]).printInterpretation).toBe(true);
  });
});

describe('parseZPL — ^BQ QR Code', () => {
  it('creates a qrcode object with error correction and content', () => {
    const { objects } = parseSingle('^XA^FO0,0^BQN,2,6^FDQA,https://example.com^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('qrcode');
    expect(props(objects[0]).content).toBe('https://example.com');
    expect(props(objects[0]).magnification).toBe(6);
    expect(props(objects[0]).errorCorrection).toBe('Q');
    expect(props(objects[0]).model).toBe(2);
  });

  it('preserves Model 1 from ^BQ b (round-trip, no silent change to 2)', () => {
    const { objects } = parseSingle('^XA^FO0,0^BQN,1,4^FDQA,X^FS^XZ', 8);
    expect(props(objects[0]).model).toBe(1);
  });

  it('falls back to Model 2 for a missing/invalid ^BQ b', () => {
    const { objects } = parseSingle('^XA^FO0,0^BQN,,4^FDQA,X^FS^XZ', 8);
    expect(props(objects[0]).model).toBe(2);
  });
});

describe('parseZPL — ^BX DataMatrix', () => {
  it('creates a datamatrix object', () => {
    const { objects } = parseSingle('^XA^FO0,0^BXN,8,200^FD1234567890^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('datamatrix');
    expect(props(objects[0]).content).toBe('1234567890');
    expect(props(objects[0]).dimension).toBe(8);
    expect(props(objects[0]).quality).toBe(200);
    expect(props(objects[0]).gs1).toBe(false);
  });

  it('reads GS1 mode from the escape param and decodes FNC1 separators', () => {
    const { objects } = parseSingle(
      '^XA^FO0,0^BXN,8,200,,,,_^FD_1010950110153000310ABC123_12112345^FS^XZ',
      8,
    );
    expect(objects[0]?.type).toBe('datamatrix');
    expect(props(objects[0]).gs1).toBe(true);
    expect(props(objects[0]).content).toBe('010950110153000310ABC123\x1d2112345');
  });

  it('does not treat the escape param as GS1 below quality 200', () => {
    const { objects } = parseSingle('^XA^FO0,0^BXN,8,140,,,,_^FD_1010950110153000310^FS^XZ', 8);
    expect(props(objects[0]).gs1).toBe(false);
    expect(props(objects[0]).content).toBe('_1010950110153000310');
  });

  it('keeps non-GS1 field data verbatim (no leading FNC1, g set)', () => {
    const { objects } = parseSingle('^XA^FO0,0^BXN,8,200,,,,_^FDABC_DEF^FS^XZ', 8);
    expect(props(objects[0]).gs1).toBe(false);
    expect(props(objects[0]).content).toBe('ABC_DEF');
  });

  it('keeps ~dNNN escapes in field data (tilde before a letter that is no immediate command)', () => {
    const { objects, findings } = parseSingle(
      '^XA^FO10,10^BXN,8,200,,,,~^FD~1010950110153000310ABC123~d0292112345^FS^XZ',
      8,
    );
    expect(commandsOf({ findings }, 'unknown')).toEqual([]);
    expect(props(objects[0]).gs1).toBe(true);
    expect(props(objects[0]).content).toBe('010950110153000310ABC123\x1d2112345');
  });

  it('still ends field data at a real immediate command (~JA is intercepted by firmware)', () => {
    const { objects } = parseSingle('^XA^FO0,0^BXN,8,200^FDAB~JACD^FS^XZ', 8);
    expect(props(objects[0]).content).toBe('AB');
  });

  it('reads a tilde escape char and the rectangular a param', () => {
    // Production label: g=~ (the historic firmware default escape char), a=2.
    // The tilde inside ^FD must survive tokenization, not start a command.
    const { objects } = parseSingle(
      '^XA^FO50,50^BXN,4,200,,,,~,2^FD~1010426011945468210FM260693^FS^XZ',
      8,
    );
    expect(objects[0]?.type).toBe('datamatrix');
    expect(props(objects[0]).gs1).toBe(true);
    expect(props(objects[0]).content).toBe('010426011945468210FM260693');
    expect(props(objects[0]).dimension).toBe(4);
    expect(props(objects[0]).aspectRatio).toBe(2);
  });

  it('ignores the a param below quality 200 (firmware prints square)', () => {
    const { objects } = parseSingle('^XA^FO0,0^BXN,8,140,,,,,2^FDX^FS^XZ', 8);
    expect(props(objects[0]).aspectRatio).toBeUndefined();
  });

  it('reads a forced symbol size from the c/r params', () => {
    const { objects } = parseSingle('^XA^FO0,0^BXN,8,200,22,22^FDX^FS^XZ', 8);
    expect(props(objects[0]).columns).toBe(22);
    expect(props(objects[0]).rows).toBe(22);
  });

  it('drops a forced c/r below quality 200 (invalid there; preview auto-sizes)', () => {
    const { objects } = parseSingle('^XA^FO0,0^BXN,8,140,22,22^FDX^FS^XZ', 8);
    expect(props(objects[0]).columns).toBeUndefined();
    expect(props(objects[0]).rows).toBeUndefined();
  });

  it('derives the rectangular shape from a forced DMRE pair without the a param', () => {
    const { objects } = parseSingle('^XA^FO0,0^BXN,8,200,18,8^FDX^FS^XZ', 8);
    expect(props(objects[0]).columns).toBe(18);
    expect(props(objects[0]).rows).toBe(8);
    expect(props(objects[0]).aspectRatio).toBe(2);
  });

  it('a forced square pair overrides a stray a=2', () => {
    const { objects } = parseSingle('^XA^FO0,0^BXN,8,200,22,22,,,2^FDX^FS^XZ', 8);
    expect(props(objects[0]).aspectRatio).toBeUndefined();
  });

  it('accepts quality 100 (convolution ECC)', () => {
    const { objects } = parseSingle('^XA^FO0,0^BXN,8,100^FDX^FS^XZ', 8);
    expect(props(objects[0]).quality).toBe(100);
  });
});

describe('parseZPL — ^BU UPC-A', () => {
  it('creates a upca object', () => {
    const { objects } = parseSingle('^XA^FO0,0^BUN,80,Y,N,N^FD01234567890^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('upca');
    expect(props(objects[0]).content).toBe('01234567890');
    expect(props(objects[0]).height).toBe(80);
  });
});

describe('parseZPL — ^B8 EAN-8', () => {
  it('creates an ean8 object', () => {
    const { objects } = parseSingle('^XA^FO0,0^B8N,80,Y^FD12345670^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('ean8');
  });
});

describe('parseZPL — ^B9 UPC-E', () => {
  it('creates a upce object', () => {
    const { objects } = parseSingle('^XA^FO0,0^B9N,80,Y^FD01234565^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('upce');
  });
});

describe('parseZPL — ^B2 Interleaved 2 of 5', () => {
  it('creates an interleaved2of5 object', () => {
    const { objects } = parseSingle('^XA^FO0,0^B2N,100,Y,N,Y^FD12345678^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('interleaved2of5');
    expect(props(objects[0]).checkDigit).toBe(true);
  });
});

describe('parseZPL — ^BA Code 93', () => {
  it('creates a code93 object', () => {
    const { objects } = parseSingle('^XA^FO0,0^BAN,100,Y,N,N^FDABC123^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('code93');
  });
});

describe('parseZPL — ^B7 PDF417', () => {
  it('creates a pdf417 object', () => {
    const { objects } = parseSingle('^XA^FO0,0^B7N,15,3,5,,,^FDTest Data^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('pdf417');
    expect(props(objects[0]).content).toBe('Test Data');
    expect(props(objects[0]).rowHeight).toBe(15);
    expect(props(objects[0]).securityLevel).toBe(3);
    expect(props(objects[0]).columns).toBe(5);
  });
});

describe('parseZPL — ^BE EAN-13', () => {
  it('creates an ean13 object', () => {
    const { objects } = parseSingle('^XA^FO0,0^BEN,100,Y^FD5901234123457^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('ean13');
    expect(props(objects[0]).content).toBe('5901234123457');
  });
});

// ── additional shape types ────────────────────────────────────────────────────

describe('parseZPL — ^GE ellipse', () => {
  it('creates an unfilled ellipse', () => {
    const { objects } = parseSingle('^XA^FO0,0^GE200,100,3,B^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('ellipse');
    expect(props(objects[0]).width).toBe(200);
    expect(props(objects[0]).height).toBe(100);
    expect(props(objects[0]).filled).toBe(false);
  });

  it('detects a filled ellipse when thickness >= min dimension', () => {
    const { objects } = parseSingle('^XA^FO0,0^GE100,80,80,B^FS^XZ', 8);
    expect(props(objects[0]).filled).toBe(true);
  });

  it('preserves the original thickness on filled ^GE (lossless round-trip)', () => {
    const { objects } = parseSingle('^XA^FO0,0^GE100,80,80,B^FS^XZ', 8);
    expect(props(objects[0]).thickness).toBe(80);
  });
});

describe('parseZPL — ^GS graphic symbol', () => {
  it('creates a symbol object with code, dims and rotation', () => {
    const { objects } = parseSingle('^XA^FO30,40^GSR,50,60^FDC^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('symbol');
    expect(props(objects[0]).symbol).toBe('C');
    expect(props(objects[0]).height).toBe(50);
    expect(props(objects[0]).width).toBe(60);
    expect(props(objects[0]).rotation).toBe('R');
  });

  it('falls back to "B" (©) when ^FD payload is not a known code', () => {
    const { objects } = parseSingle('^XA^FO0,0^GSN,30,30^FDZ^FS^XZ', 8);
    expect(props(objects[0]).symbol).toBe('B');
  });

  it('defaults width to height when ^GS width omitted', () => {
    const { objects } = parseSingle('^XA^FO0,0^GSN,40^FDA^FS^XZ', 8);
    expect(props(objects[0]).height).toBe(40);
    expect(props(objects[0]).width).toBe(40);
  });

  it('does not leak symbol state into a following ^FD when ^GS has no payload', () => {
    // Bare ^GS without ^FD is malformed but seen in the wild; the
    // parser must NOT treat the next unrelated ^FD (here: a plain
    // text field) as the symbol payload.
    const { objects } = parseSingle(
      '^XA^FO0,0^GSN,40,40^FS^FO100,100^A0N,30,30^FDhello^FS^XZ',
      8,
    );
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('text');
    expect(props(objects[0]).content).toBe('hello');
  });

  it('round-trips through registry.toZPL for every code + rotation', () => {
    for (const code of ['A','B','C','D','E'] as const) {
      for (const rot of ['N','R','I','B'] as const) {
        const zpl = `^XA^FO10,20^GS${rot},40,40^FD${code}^FS^XZ`;
        const { objects } = parseSingle(zpl, 8);
        expect(props(objects[0]).symbol).toBe(code);
        expect(props(objects[0]).rotation).toBe(rot);
      }
    }
  });
});

describe('parseZPL — ^GC circle', () => {
  it('creates an ellipse with equal width and height from ^GC', () => {
    const { objects } = parseSingle('^XA^FO0,0^GC100,3,B^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('ellipse');
    expect(props(objects[0]).width).toBe(100);
    expect(props(objects[0]).height).toBe(100);
    expect(props(objects[0]).filled).toBe(false);
    expect(props(objects[0]).lockAspect).toBe(true);
  });

  it('creates a filled circle when thickness >= diameter', () => {
    const { objects } = parseSingle('^XA^FO0,0^GC50,50,B^FS^XZ', 8);
    expect(props(objects[0]).filled).toBe(true);
  });

  it('preserves the original thickness on filled ^GC (lossless round-trip)', () => {
    const { objects } = parseSingle('^XA^FO0,0^GC50,50,B^FS^XZ', 8);
    expect(props(objects[0]).thickness).toBe(50);
  });
});

describe('parseZPL — ^GD diagonal line', () => {
  it('creates a line object from a diagonal ^GD command', () => {
    const { objects } = parseSingle('^XA^FO10,20^GD200,100,3,B,L^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('line');
    expect(props(objects[0]).thickness).toBe(3);
    expect(props(objects[0]).color).toBe('B');
    // Length should be ~sqrt(200²+100²) ≈ 224
    const len = props(objects[0]).length as number;
    expect(len).toBeGreaterThan(220);
    expect(len).toBeLessThan(225);
  });
});

// ── ^GFA graphic field ────────────────────────────────────────────────────────

describe('parseZPL — ^GFA graphic field', () => {
  it('creates an image object from a ^GFA command with uncompressed hex', () => {
    // 1 byte per row, 2 rows → 2 bytes total, simple hex data
    const hexData = 'FF00';
    const { objects } = parseSingle(`^XA^FO0,0^GFA,2,2,1,${hexData}^FS^XZ`, 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('image');
    expect(props(objects[0]).widthDots).toBe(8); // 1 byte per row Ã— 8 bits
    expect(props(objects[0])._gfaCache).toContain('^GFA,');
  });

  it('imports a :B64:-wrapped ^GFA payload as an image (CRC valid)', () => {
    // 8 bytes = [0,0,0,0xFF,0xFF,0,0,0] → base64 "AAAA//8AAAA="
    // CRC-16/CCITT-FALSE over "AAAA//8AAAA=" = 0xDFF8
    const { objects, findings } = parseSingle(
      '^XA^FO0,0^GFA,8,8,1,:B64:AAAA//8AAAA=:DFF8^FS^XZ',
      8,
    );
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('image');
    expect(props(objects[0]).widthDots).toBe(8);
    expect(commandsOf({ findings }, 'partial')).not.toContain('^GF');
  });

  it('still renders a :B64: payload with mismatched CRC but flags as partial', () => {
    const { objects, findings } = parseSingle(
      '^XA^FO0,0^GFA,8,8,1,:B64:AAAA//8AAAA=:0000^FS^XZ',
      8,
    );
    expect(objects).toHaveLength(1);
    expect(commandsOf({ findings }, 'partial')).toContain('^GF');
  });

  it('accepts :B64: wrapper on ^GFB and ^GFC (no raw-binary path needed)', () => {
    for (const fmt of ['B', 'C'] as const) {
      const { objects } = parseSingle(
        `^XA^FO0,0^GF${fmt},8,8,1,:B64:AAAA//8AAAA=:DFF8^FS^XZ`,
        8,
      );
      expect(objects).toHaveLength(1);
      expect(objects[0]?.type).toBe('image');
    }
  });

  it('tolerates embedded whitespace inside a :B64: base64 payload', () => {
    // ZPL generators often line-break long base64 blocks every N chars.
    // Labelary accepts this; we should too.
    const zpl =
      '^XA^FO0,0^GFA,8,8,1,:B64:AAAA\n//8AAAA=:DFF8^FS^XZ';
    const { objects, findings } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(commandsOf({ findings }, 'partial')).not.toContain('^GF');
  });

  it('tolerates trailing whitespace on wrapped GF payloads', () => {
    // Real-world ZPL is often line-broken between commands; the tokenizer
    // preserves the trailing newline on the field body, so the regex needs
    // to accommodate that.
    const zplWithNewline =
      '^XA\n^FO0,0\n^GFA,8,8,1,:B64:AAAA//8AAAA=:DFF8\n^FS\n^XZ';
    const { objects, findings } = parseSingle(zplWithNewline, 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('image');
    expect(commandsOf({ findings }, 'browserLimit')).toHaveLength(0);
  });

  it('imports a :Z64:-wrapped ^GFC payload by inflating zlib data', () => {
    // 8 bytes = [0,0,0,0xFF,0xFF,0,0,0] → zlib-compressed → base64 → CRC.
    const bytes = new Uint8Array([0, 0, 0, 0xff, 0xff, 0, 0, 0]);
    const field = makeZ64Field(bytes);
    const { objects, findings } = parseSingle(
      `^XA^FO0,0^GFC,8,8,1,${field}^FS^XZ`,
      8,
    );
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('image');
    expect(props(objects[0]).widthDots).toBe(8);
    expect(commandsOf({ findings }, 'partial')).not.toContain('^GF');
  });

  it('preserves an undecodable :Z64: ^GF verbatim, sizing height from c not b', () => {
    // Valid base64, matching CRC, but garbage bytes that fflate rejects as a
    // deflate stream → can't decode, so preserve the command verbatim instead
    // of dropping it. b=4 (compressed stream length) is deliberately smaller
    // than c=16 (uncompressed field count); height must come from c/d, not b/d.
    const b64 = btoa('not a valid zlib stream');
    const field = `:Z64:${b64}:${testCrc16(b64)}`;
    const { objects, findings } = parseSingle(
      `^XA^FO0,0^GFC,4,16,2,${field}^FS^XZ`,
      8,
    );
    expect(objects).toHaveLength(1);
    const p = props(objects[0]);
    expect(p.widthDots).toBe(16); // d=2 → 2*8
    expect(p.heightDots).toBe(8); // c/d = 16/2, not b/d = 4/2
    expect(p.rawGf).toBe(`^GFC,4,16,2,${field}`);
    expect(commandsOf({ findings }, 'partial')).toContain('^GF');
    expect(commandsOf({ findings }, 'browserLimit')).toHaveLength(0);
  });

  it('falls back to a square when an opaque ^GF c is under one full row (height would floor to 0)', () => {
    // c=1 < d=2 -> floor(1/2)=0; the placeholder must stay grabbable, so height
    // falls back to the square width (d*8) instead of a 0-dot sliver.
    const b64 = btoa('not a valid zlib stream');
    const field = `:Z64:${b64}:${testCrc16(b64)}`;
    const { objects } = parseSingle(`^XA^FO0,0^GFC,4,1,2,${field}^FS^XZ`, 8);
    expect(objects).toHaveLength(1);
    const p = props(objects[0]);
    expect(p.widthDots).toBe(16);
    expect(p.heightDots).toBe(16);
  });

  it('normalizes the opaque ^GF header delimiter so a ^CD source survives re-parse', () => {
    // ^CD; switches the delimiter to ';'. The generator never re-emits ^CD, so
    // the preserved header is rebuilt with commas to round-trip a second time.
    const b64 = btoa('not a real zlib stream');
    const field = `:Z64:${b64}:${testCrc16(b64)}`;
    const { objects } = parseSingle(`^XA^FO0,0^CD;^GFC;4;16;2;${field}^FS^XZ`, 8);
    expect(objects).toHaveLength(1);
    expect(props(objects[0]).rawGf).toBe(`^GFC,4,16,2,${field}`);
  });

  it('creates an image object from compressed ^GFA data', () => {
    // G=1 repeat → "GF" = repeat 'F' once, basically just 'F'
    // bytesPerRow=1, so we need 2 nibbles per row
    // "GF" = 1Ã—F = "F" → only one nibble, padded to "F0"
    // Two rows: "GF,GF" should give us 2 rows → totalBytes=2
    const { objects } = parseSingle('^XA^FO0,0^GFA,2,2,1,FF,:^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('image');
  });
});

// ── ^FX label metadata sidecar ────────────────────────────────────────────────

describe('parseZPL — ^FX label metadata sidecar', () => {
  it('recovers dpmm/width/height from the leading sidecar, overriding ^PW/^LL', () => {
    const zpl = `^XA${formatLabelMetaComment({ dpmm: 12, widthMm: 57, heightMm: 32 })}^PW800^LL600^FO0,0^A0N,30,0^FDx^FS^XZ`;
    // External dpmm 8 is deliberately wrong; the sidecar must win.
    const { labelConfig } = parseSingle(zpl, 8);
    expect(labelConfig.dpmm).toBe(12);
    expect(labelConfig.widthMm).toBe(57);
    expect(labelConfig.heightMm).toBe(32);
  });

  it('does not attach the sidecar as the next object comment', () => {
    const zpl = `^XA${formatLabelMetaComment({ dpmm: 8, widthMm: 100, heightMm: 60 })}^FO0,0^A0N,30,0^FDx^FS^XZ`;
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.comment).toBeUndefined();
  });

  it('ignores a sidecar that appears after an object (non-leading slot)', () => {
    const zpl = `^XA^FO0,0^A0N,30,0^FDx^FS${formatLabelMetaComment({ dpmm: 24, widthMm: 20, heightMm: 20 })}^FO0,50^A0N,30,0^FDy^FS^XZ`;
    const { labelConfig, objects } = parseSingle(zpl, 8);
    expect(labelConfig.dpmm).not.toBe(24);
    expect(props(objects[1]).content).toBe('y');
  });

  it('keeps a foreign ^FX as a normal object comment', () => {
    const { objects } = parseSingle('^XA^FXserial run 42^FO0,0^A0N,30,0^FDx^FS^XZ', 8);
    expect(objects[0]?.comment).toBe('serial run 42');
  });
});

// ── ~DY graphic upload + ^XG recall ──────────────────────────────────────────

describe('parseZPL — ~DY + ^XG graphic upload/recall', () => {
  // 1 byte per row × 4 rows → pattern [0x00, 0xFF, 0xFF, 0x00] (horizontal stripe).
  const HEX = '00FFFF00';
  const PATH = 'R:LOGO';

  it('registers a ~DY graphic upload and ^XG instantiates it as an image', () => {
    const zpl =
      `~DY${PATH},A,G,4,1,${HEX}\n` +
      `^XA^FO50,80^XG${PATH}.GRF,1,1^FS^XZ`;
    const { objects, findings } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('image');
    expect(props(objects[0]).widthDots).toBe(8);
    expect(props(objects[0]).storedAs).toEqual({ device: 'R', name: 'LOGO', embedInZpl: true });
    expect(objects[0]?.x).toBe(50);
    expect(objects[0]?.y).toBe(80);
    expect(commandsOf({ findings }, 'browserLimit')).toHaveLength(0);
  });

  it('resolves ^XG even when the .GRF suffix is omitted', () => {
    // Labelary accepts `^XGR:LOGO,1,1` for an upload stored as
    // `R:LOGO.GRF`; the map lookup must normalise both forms.
    const zpl =
      `~DYR:LOGO,A,G,4,1,00FFFF00\n` +
      `^XA^FO50,80^XGR:LOGO,1,1^FS^XZ`;
    const { objects, findings } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(props(objects[0]).storedAs).toEqual({ device: 'R', name: 'LOGO', embedInZpl: true });
    expect(commandsOf({ findings }, 'browserLimit')).toHaveLength(0);
  });

  it('^XG without a preceding ~DY imports as recall-only image', () => {
    // Admin pre-loaded the file on the printer; we just emit the ^XG
    // reference without ~DY bytes. Object is created so the user can
    // position/edit it; embedInZpl=false stops the emitter from
    // re-uploading bytes we never received.
    const zpl = `^XA^FO0,0^XGR:MISSING.GRF,1,1^FS^XZ`;
    const { objects, findings } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(props(objects[0]).storedAs).toEqual({
      device: 'R', name: 'MISSING', embedInZpl: false,
    });
    expect(commandsOf({ findings }, 'partial')).toContain('^XG');
  });

  it('accepts :Z64:-wrapped graphic payloads in ~DY (format C)', () => {
    const bytes = new Uint8Array([0, 0xff, 0xff, 0]);
    const field = makeZ64Field(bytes);
    const zpl =
      `~DY${PATH},C,G,4,1,${field}\n` +
      `^XA^FO0,0^XG${PATH}.GRF,1,1^FS^XZ`;
    const { objects, findings } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(props(objects[0]).storedAs).toEqual({ device: 'R', name: 'LOGO', embedInZpl: true });
    expect(commandsOf({ findings }, 'partial')).not.toContain('~DY');
  });
});

// ── ^LR label reverse ─────────────────────────────────────────────────────────

describe('parseZPL — ^LR label reverse', () => {
  it('sets reverse on text when ^LRY is active', () => {
    const { objects } = parseSingle('^XA^LRY^FO0,0^A0N,30,0^FDReversed^FS^LRN^XZ', 8);
    expect(props(objects[0]).reverse).toBe(true);
  });

  it('disables reverse after ^LRN', () => {
    const zpl = '^XA^LRY^FO0,0^A0N,30,0^FDFirst^FS^LRN^FO0,50^A0N,30,0^FDSecond^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    expect(props(objects[0]).reverse).toBe(true);
    expect(props(objects[1]).reverse).toBeFalsy();
  });
});

// ── ^FW field default rotation ────────────────────────────────────────────────

describe('parseZPL — ^FW field default rotation', () => {
  it('applies default rotation to implicit text fields', () => {
    const { objects } = parseSingle('^XA^FWR^CF0,30^FO0,0^FDRotated^FS^XZ', 8);
    expect(props(objects[0]).rotation).toBe('R');
  });
});

// ── ^MM media mode and ^LS label shift ────────────────────────────────────────

describe('parseZPL — ^MM and ^LS', () => {
  it('parses media mode', () => {
    const { labelConfig } = parseSingle('^XA^MMT^XZ', 8);
    expect(labelConfig.mediaMode).toBe('T');
  });

  it('parses label shift', () => {
    const { labelConfig } = parseSingle('^XA^LS10^XZ', 8);
    expect(labelConfig.labelShift).toBe(10);
  });
});

describe('parseZPL — printer params', () => {
  it('parses ^PR print speed within range', () => {
    const { labelConfig } = parseSingle('^XA^PR6^XZ', 8);
    expect(labelConfig.printSpeed).toBe(6);
  });

  it('ignores ^PR with out-of-range value', () => {
    const { labelConfig } = parseSingle('^XA^PR1^XZ', 8);
    expect(labelConfig.printSpeed).toBeUndefined();
  });

  it('parses ^PR with slew and backfeed', () => {
    const { labelConfig } = parseSingle('^XA^PR6,8,4^XZ', 8);
    expect(labelConfig.printSpeed).toBe(6);
    expect(labelConfig.slewSpeed).toBe(8);
    expect(labelConfig.backfeedSpeed).toBe(4);
  });

  it('parses extended ^PQ params', () => {
    const { labelConfig } = parseSingle('^XA^PQ5,2,3,Y^XZ', 8);
    expect(labelConfig.printQuantity).toBe(5);
    expect(labelConfig.pauseCount).toBe(2);
    expect(labelConfig.replicates).toBe(3);
    expect(labelConfig.overridePauseCount).toBe('Y');
  });

  it('parses ^BD maxicode; nonexistent ^BV stays an unknown token', () => {
    // ^BDm,n,t (spec p106): mode is the FIRST param.
    const bd = parseSingle('^XA^FO10,10^BD5,1,1^FDx^FS^XZ', 8);
    expect(props(bd.objects[0]).mode).toBe(5);
    // ^BV is not a ZPL command; it must not fabricate a maxicode object.
    const bv = parseSingle('^XA^FO10,10^BVN,3,1,1^FDx^FS^XZ', 8);
    expect(bv.objects.some((o) => 'props' in o && (o.props as { mode?: number }).mode === 3)).toBe(false);
    expect(commandsOf(bv, 'unknown').some((c) => c.startsWith('^BV'))).toBe(true);
  });

  it('parses ^PM mirror', () => {
    expect(parseZPL('^XA^PMY^XZ', 8).labelConfig.mirror).toBe('Y');
    expect(parseZPL('^XA^PMN^XZ', 8).labelConfig.mirror).toBe('N');
  });

  it('parses ^MC, ^PF, ^PH and ^PP into the label config', () => {
    const { labelConfig } = parseZPL('^XA^MCN^PF120^PH^PP^XZ', 8);
    expect(labelConfig.mapClear).toBe('N');
    expect(labelConfig.slewDotRows).toBe(120);
    expect(labelConfig.slewToHome).toBe(true);
    expect(labelConfig.programmablePause).toBe(true);
  });

  it('drops an out-of-range ^PF instead of clamping into the model', () => {
    expect(parseZPL('^XA^PF33000^XZ', 8).labelConfig.slewDotRows).toBeUndefined();
  });

  it('routes ~PH/~PP as device actions without touching the model', () => {
    const r = parseSingle('~PH~PP^XA^XZ', 8);
    expect(r.labelConfig.slewToHome).toBeUndefined();
    expect(r.labelConfig.programmablePause).toBeUndefined();
    expect(commandsOf(r, 'deviceAction')).toContain('~PH');
    expect(commandsOf(r, 'deviceAction')).toContain('~PP');
    // Flagged once, not additionally surfaced as unrecognised.
    expect(commandsOf(r, 'unknown')).toEqual([]);
  });

  it('parses ^CO into the printer profile with per-slot validation', () => {
    const { printerProfile } = parseZPL('^XA^COY,78,1^XZ', 8);
    expect(printerProfile.fontCacheOn).toBe('Y');
    expect(printerProfile.fontCacheAddKb).toBe(78);
    expect(printerProfile.fontCacheType).toBe('1');
    // Out-of-range KB slot is dropped, valid slots still land.
    const partial = parseZPL('^XA^CON,0,0^XZ', 8).printerProfile;
    expect(partial.fontCacheOn).toBe('N');
    expect(partial.fontCacheAddKb).toBeUndefined();
  });

  it('accumulates ^MP modes and lets ^MPE reset the set', () => {
    expect(parseZPL('^XA^MPD^MPC^MPD^XZ', 8).printerProfile.modeProtection).toEqual(['D', 'C']);
    expect(parseZPL('^XA^MPD^MPE^XZ', 8).printerProfile.modeProtection).toEqual([]);
  });

  it('parses ^CF width into defaultFontWidth', () => {
    const { labelConfig } = parseSingle('^XA^CFA,30,20^XZ', 8);
    expect(labelConfig.defaultFontId).toBe('A');
    expect(labelConfig.defaultFontHeight).toBe(30);
    expect(labelConfig.defaultFontWidth).toBe(20);
  });

  it('parses ^CW mapping and pins ^A{alias} as the field-level fontId', () => {
    // The ^CW mapping lives in labelConfig.customFonts; the text field
    // only carries the alias char so re-emitting produces the same
    // short ^A{id} form. printerFontName remains undefined; that field
    // is for the long ^A@,…E:NAME.TTF form, not for alias-based refs.
    const { labelConfig, objects } = parseSingle(
      '^XA^CWM,E:ARIAL.TTF^FO10,10^AMN,30,0^FDHi^FS^XZ',
      8,
    );
    expect(labelConfig.customFonts).toEqual([
      { alias: 'M', path: 'E:ARIAL.TTF' },
    ]);
    expect(objects).toHaveLength(1);
    expect(props(objects[0]).fontId).toBe('M');
    expect(props(objects[0]).printerFontName).toBeUndefined();
  });

  it('drops fontId for ^A{id} matching the active ^CF (default semantics)', () => {
    // ^CFM then ^AMN repeats the default font. The model says
    // "field uses the label default" by leaving fontId undefined, and
    // the generator's default-fallback branch restores the ^AM emit.
    const { objects } = parseSingle(
      '^XA^CFM,30,0^FO10,10^AMN,30,0^FDHi^FS^XZ',
      8,
    );
    expect(props(objects[0]).fontId).toBeUndefined();
    expect(props(objects[0]).printerFontName).toBeUndefined();
  });

  it('ignores invalid ^CW arguments', () => {
    const { labelConfig } = parseSingle('^XA^CW,^XZ', 8);
    expect(labelConfig.customFonts).toBeUndefined();
  });

  it('upserts ^CW by alias, keeping the last mapping per alias', () => {
    // Two ^CW lines for the same alias: the second should overwrite
    // the first in customFonts, matching the runtime fontAliases.set
    // last-wins semantics.
    const { labelConfig } = parseSingle(
      '^XA^CWM,E:OLD.TTF^CWM,E:NEW.TTF^XZ',
      8,
    );
    expect(labelConfig.customFonts).toEqual([
      { alias: 'M', path: 'E:NEW.TTF' },
    ]);
  });

  it('keeps separate ^CW mappings that share a path but use different aliases', () => {
    const { labelConfig } = parseSingle(
      '^XA^CWM,E:FOO.TTF^CWN,E:FOO.TTF^XZ',
      8,
    );
    expect(labelConfig.customFonts).toEqual([
      { alias: 'M', path: 'E:FOO.TTF' },
      { alias: 'N', path: 'E:FOO.TTF' },
    ]);
  });

  it('parses ~SD instant darkness', () => {
    expect(parseZPL('~SD07^XA^XZ', 8).labelConfig.instantDarkness).toBe(7);
    expect(parseZPL('~SD30^XA^XZ', 8).labelConfig.instantDarkness).toBe(30);
  });

  it('parses ~JS backfeed sequence including percent forms', () => {
    expect(parseZPL('~JSA^XA^XZ', 8).labelConfig.backfeedSequence).toBe('A');
    expect(parseZPL('~JSO^XA^XZ', 8).labelConfig.backfeedSequence).toBe('O');
    expect(parseZPL('~JS40^XA^XZ', 8).labelConfig.backfeedSequence).toBe(40);
    // Printer rounds to the nearest ten (~JS55 -> 60, p276); mirror that.
    expect(parseZPL('~JS55^XA^XZ', 8).labelConfig.backfeedSequence).toBe(60);
    // Out of range or garbage: dropped, never clamped in.
    expect(parseZPL('~JS95^XA^XZ', 8).labelConfig.backfeedSequence).toBeUndefined();
    expect(parseZPL('~JSX^XA^XZ', 8).labelConfig.backfeedSequence).toBeUndefined();
  });

  it('parses ^MD darkness including 0', () => {
    expect(parseZPL('^XA^MD0^XZ', 8).labelConfig.darkness).toBe(0);
    expect(parseZPL('^XA^MD15^XZ', 8).labelConfig.darkness).toBe(15);
    expect(parseZPL('^XA^MD-10^XZ', 8).labelConfig.darkness).toBe(-10);
  });

  it('ignores ^MD outside the supported range', () => {
    const { labelConfig } = parseSingle('^XA^MD99^XZ', 8);
    expect(labelConfig.darkness).toBeUndefined();
  });

  it('parses ^MT media type', () => {
    expect(parseZPL('^XA^MTT^XZ', 8).labelConfig.mediaType).toBe('T');
    expect(parseZPL('^XA^MTD^XZ', 8).labelConfig.mediaType).toBe('D');
  });

  it('parses ^PO print orientation', () => {
    expect(parseZPL('^XA^PON^XZ', 8).labelConfig.printOrientation).toBe('N');
    expect(parseZPL('^XA^POI^XZ', 8).labelConfig.printOrientation).toBe('I');
  });

  it('parses ^CF into defaultFontId and defaultFontHeight', () => {
    const { labelConfig } = parseSingle('^XA^CF0,40^XZ', 8);
    expect(labelConfig.defaultFontId).toBe('0');
    expect(labelConfig.defaultFontHeight).toBe(40);
  });
});

// ── edge cases ────────────────────────────────────────────────────────────────

describe('parseZPL — edge cases', () => {
  it('returns empty results for empty ZPL', () => {
    const parsed = parseSingle('', 8);
    const skipped = [...commandsOf(parsed, 'browserLimit'), ...commandsOf(parsed, 'unknown')];
    expect(parsed.objects).toHaveLength(0);
    expect(skipped).toHaveLength(0);
  });

  it('handles ^XA^XZ (empty label)', () => {
    const parsed = parseSingle('^XA^XZ', 8);
    const skipped = [...commandsOf(parsed, 'browserLimit'), ...commandsOf(parsed, 'unknown')];
    expect(parsed.objects).toHaveLength(0);
    expect(skipped).toHaveLength(0);
  });

  it('handles multiple ^FO without ^FD (bare origins are benign)', () => {
    const { objects } = parseSingle('^XA^FO10,20^FO30,40^A0N,30,0^FDText^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    // FO/N h=30 → obj.y = 40 - 4.62.
    expect(objects[0]?.x).toBeCloseTo(30);
    expect(objects[0]?.y).toBeCloseTo(40 - 4.62);
  });

  it('supports different dpmm values (12 dpmm / 300 DPI)', () => {
    const { labelConfig } = parseSingle('^XA^PW1200^LL600^XZ', 12);
    expect(labelConfig.widthMm).toBe(100);
    expect(labelConfig.heightMm).toBe(50);
  });
});

// ── integration: the example shipping label ───────────────────────────────────

const EXAMPLE_ZPL = `
^XA

^FX Top section with logo, name and address.
^CF0,60
^FO50,50^GB100,100,100^FS
^FO75,75^FR^GB100,100,100^FS
^FO93,93^GB40,40,40^FS
^FO220,50^FDIntershipping, Inc.^FS
^CF0,30
^FO220,115^FD1000 Shipping Lane^FS
^FO220,155^FDShelbyville TN 38102^FS
^FO220,195^FDUnited States (USA)^FS
^FO50,250^GB700,3,3^FS

^FX Second section with recipient address and permit information.
^CFA,30
^FO50,300^FDJohn Doe^FS
^FO50,340^FD100 Main Street^FS
^FO50,380^FDSpringfield TN 39021^FS
^FO50,420^FDUnited States (USA)^FS
^CFA,15
^FO600,300^GB150,150,3^FS
^FO638,340^FDPermit^FS
^FO638,390^FD123456^FS
^FO50,500^GB700,3,3^FS

^FX Third section with bar code.
^BY5,2,270
^FO100,550^BC^FD12345678^FS

^FX Fourth section (the two boxes on the bottom).
^FO50,900^GB700,250,3^FS
^FO400,900^GB3,250,3^FS
^CF0,40
^FO100,960^FDCtr. X34B-1^FS
^FO100,1010^FDREF1 F00B47^FS
^FO100,1060^FDREF2 BL4H8^FS
^CF0,190
^FO470,955^FDCA^FS

^XZ
`.trim();

describe('parseZPL — example shipping label (integration)', () => {
  let objects: ReturnType<typeof parseSingle>['objects'];
  let skipped: string[];

  beforeAll(() => {
    const result = parseSingle(EXAMPLE_ZPL, 8);
    objects = result.objects;
    skipped = [...commandsOf(result, 'browserLimit'), ...commandsOf(result, 'unknown')];
  });

  it('produces exactly 23 objects', () => {
    expect(objects).toHaveLength(23);
  });

  it('produces 14 text objects', () => {
    expect(objects.filter((o) => o.type === 'text')).toHaveLength(14);
  });

  it('produces 5 box objects', () => {
    expect(objects.filter((o) => o.type === 'box')).toHaveLength(5);
  });

  it('produces 3 line objects', () => {
    expect(objects.filter((o) => o.type === 'line')).toHaveLength(3);
  });

  it('produces 1 code128 barcode', () => {
    expect(objects.filter((o) => o.type === 'code128')).toHaveLength(1);
  });

  it('has no skipped commands', () => {
    expect(skipped).toHaveLength(0);
  });

  it('parses the header text with fontHeight 60 (from ^CF0,60)', () => {
    const textObjs = objects.filter((o) => o.type === 'text');
    expect(props(textObjs[0]).content).toBe('Intershipping, Inc.');
    expect(props(textObjs[0]).fontHeight).toBe(60);
  });

  it('parses subsequent text with fontHeight 30 (after ^CF0,30)', () => {
    const textObjs = objects.filter((o) => o.type === 'text');
    expect(props(textObjs[1]).fontHeight).toBe(30);
    expect(props(textObjs[1]).content).toBe('1000 Shipping Lane');
  });

  it('parses the Code 128 barcode with height from ^BY', () => {
    const barcode = objects.find((o) => o.type === 'code128');
    expect(barcode).toBeDefined();
    expect(props(barcode).content).toBe('12345678');
    expect(props(barcode).height).toBe(270);
    expect(props(barcode).moduleWidth).toBe(5);
  });

  it('parses the logo filled boxes at the correct positions', () => {
    const boxes = objects.filter((o) => o.type === 'box');
    expect(props(boxes[0]).filled).toBe(true);
    expect(boxes[0]?.x).toBe(50);
    expect(boxes[0]?.y).toBe(50);
  });

  it('marks the second logo box as reversed (^FR)', () => {
    const boxes = objects.filter((o) => o.type === 'box');
    expect(props(boxes[1]).reverse).toBe(true);
  });

  it('parses the permit box as unfilled', () => {
    const boxes = objects.filter((o) => o.type === 'box');
    // permit box: ^FO600,300^GB150,150,3, thickness=3 < min(150,150) → unfilled
    const permitBox = boxes.find((b) => b.x === 600 && b.y === 300);
    expect(permitBox).toBeDefined();
    expect(props(permitBox).filled).toBe(false);
    expect(props(permitBox).width).toBe(150);
    expect(props(permitBox).height).toBe(150);
  });

  it('parses the bottom container box', () => {
    const bottomBox = objects.find((o) => o.type === 'box' && o.y === 900);
    expect(bottomBox).toBeDefined();
    expect(props(bottomBox).width).toBe(700);
    expect(props(bottomBox).height).toBe(250);
  });

  it('parses "CA" text with fontHeight 190', () => {
    const ca = objects.find((o) => o.type === 'text' && props(o).content === 'CA');
    expect(ca).toBeDefined();
    expect(props(ca).fontHeight).toBe(190);
  });
});

// ── ^SN serialization (appears AFTER ^FD) ─────────────────────────────────────

describe('parseZPL — ^SN serialization', () => {
  it('marks a text field serial when ^SN follows ^FD', () => {
    const { objects } = parseSingle('^XA^FO10,20^A0N,30,0^FD001^FS\n^SN001,1,Y^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('text');
    expect(props(objects[0]).content).toBe('001');
    expect(serialOf(objects[0])?.increment).toBe(1);
    expect(serialOf(objects[0])?.zplMode).toBe('SN');
  });

  it('picks up increment from ^SN parameters', () => {
    const { objects } = parseSingle('^XA^FO0,0^A0N,25,0^FD100^FS\n^SN100,5,Y^XZ', 8);
    expect(serialOf(objects[0])?.increment).toBe(5);
    expect(props(objects[0]).fontHeight).toBe(25);
  });

  it('preserves font rotation from ^A0', () => {
    const { objects } = parseSingle('^XA^FO0,0^A0R,30,0^FD001^FS\n^SN001,1,Y^XZ', 8);
    expect(props(objects[0]).rotation).toBe('R');
  });
});

// ── ^SF serialization (^SFa,b mask + increment, after ^FD) ────────────────────

describe('parseZPL — ^SF serialization', () => {
  it('marks a text field serial from ^FD + ^SF', () => {
    const { objects } = parseSingle('^XA^FO0,0^A0N,30,0^FD001^SFddd,1^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('text');
    expect(props(objects[0]).content).toBe('001');
    expect(serialOf(objects[0])?.increment).toBe(1);
    expect(serialOf(objects[0])?.zplMode).toBe('SF');
  });

  it('picks up the increment from the ^SF increment string (b param)', () => {
    const { objects } = parseSingle('^XA^FO0,0^A0N,30,0^FD100^SFddd,3^FS^XZ', 8);
    expect(serialOf(objects[0])?.increment).toBe(3);
  });

  it('serializes a barcode field but does not leak to a sibling', () => {
    const zpl =
      '^XA^FO10,10^BCN,100,Y,N,N^FD123^SF%%%,1^FS^FO50,50^A0N,30,0^FDtext^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(2);
    expect(objects[0]?.type).toBe('code128');
    expect(serialOf(objects[0])?.zplMode).toBe('SF');
    expect(objects[1]?.type).toBe('text');
    expect(serialOf(objects[1])).toBeUndefined();
  });

  it('does not leak snPending across a bare ^SF^FS', () => {
    const zpl = '^XA^SF%%%,1^FS^FO10,10^A0N,30,0^FDtext^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('text');
  });

  it('preserves snPending when ^SF appears before ^FO', () => {
    const zpl = '^XA^SFddd,3^FO10,10^A0N,30,0^FD001^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('text');
    expect(serialOf(objects[0])?.increment).toBe(3);
  });

  it('does not leak snPending to a sibling field inside the same ^FS block', () => {
    const zpl =
      '^XA^SFddd,3^FO10,10^A0N,30,0^FD001^FO20,20^A0N,30,0^FD002^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(2);
    expect(serialOf(objects[0])?.increment).toBe(3);
    expect(serialOf(objects[1])).toBeUndefined();
  });
});

// ── serial XOR variable binding (contradictory ^FN + ^SN/^SF) ─────────────────

describe('parseZPL — serial wins over a coexisting ^FN binding', () => {
  it('in-field ^SF after ^FN resolves to serial, not bound', () => {
    const { objects } = parseSingle('^XA^FO10,10^A0N,30,0^FN1^FD001^SFddd,1^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(serialOf(objects[0])?.zplMode).toBe('SF');
    // Serial keeps the literal seed, not a variable marker.
    expect(props(objects[0]).content).toBe('001');
  });

  it('does not attach serial to a 2D field whose emitter ignores ^SN/^SF', () => {
    const { objects } = parseSingle('^XA^FO10,10^BQN,2,5^FDQA,0001^SN0001,1,Y^FS^XZ', 8);
    expect(objects[0]?.type).toBe('qrcode');
    expect(serialOf(objects[0])).toBeUndefined();
  });

  it('post-^FS ^SN on a single-bound 1D field replaces the marker with a literal seed', () => {
    const { objects } = parseSingle('^XA^FO10,10^BCN,100,Y,N,N^FN1^FD123^FS\n^SN123,1,Y^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(serialOf(objects[0])?.zplMode).toBe('SN');
    // Not «field_1»: serialFieldData would otherwise filter it to "field1".
    expect(props(objects[0]).content).toBe('123');
  });

  it('post-^FS ^SN on a literal 1D barcode adopts the ^SN start as the seed', () => {
    // The ^FD payload (123) differs from the ^SN start (999); ^SN governs, and
    // the emitter re-emits the seed from content, so a stale 123 would rewrite
    // the ZPL on export.
    const { objects } = parseSingle('^XA^FO10,10^BCN,100,Y,N,N^FD123^FS\n^SN999,1,Y^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(serialOf(objects[0])?.zplMode).toBe('SN');
    expect(props(objects[0]).content).toBe('999');
  });

  it('post-^FS ^SN with an empty start keeps the field ^FD as the seed', () => {
    const { objects } = parseSingle('^XA^FO10,10^BCN,100,Y,N,N^FD123^FS\n^SN,1,Y^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(serialOf(objects[0])?.zplMode).toBe('SN');
    expect(props(objects[0]).content).toBe('123');
  });

  it('in-field ^SN start value overrides a prior ^FD', () => {
    // ^FD123^SN999: ^SN's explicit start (999) is the seed, not the ^FD (123).
    const { objects } = parseSingle('^XA^FO10,10^A0N,30,0^FD123^SN999,1,Y^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(serialOf(objects[0])?.zplMode).toBe('SN');
    expect(props(objects[0]).content).toBe('999');
  });

  it('in-field ^SN with empty start keeps the ^FD as the seed', () => {
    const { objects } = parseSingle('^XA^FO10,10^A0N,30,0^FD123^SN,1,Y^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(serialOf(objects[0])?.zplMode).toBe('SN');
    expect(props(objects[0]).content).toBe('123');
  });

  it('keeps the ^FN binding on a non-serialisable 2D field that also declares ^SN', () => {
    // QR's emitter ignores ^SN; the variable link must survive instead of the
    // field collapsing to a literal seed (silent binding loss).
    const { objects, variables } = parseSingle('^XA^FO10,10^BQN,2,5^FN1^FDHELLO^SN001,1,Y^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('qrcode');
    expect(props(objects[0]).content).toBe('«field_1»');
    expect(serialOf(objects[0])).toBeUndefined();
    expect(variables.find((v) => v.fnNumber === 1)?.defaultValue).toBe('HELLO');
  });

  it('post-^FS ^SN on a previously ^FN-bound field clears the binding', () => {
    const { objects } = parseSingle('^XA^FO10,10^A0N,30,0^FN1^FD001^FS\n^SN001,1,Y^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(serialOf(objects[0])?.zplMode).toBe('SN');
    expect(props(objects[0]).content).toBe('001');
  });

  it('in-field serial on an ^FN field creates no orphan variable', () => {
    const { variables } = parseSingle('^XA^FO10,10^A0N,30,0^FN1^FD001^SN001,1,Y^FS^XZ', 8);
    expect(variables).toHaveLength(0);
  });

  it('a shared slot still gets its variable from the non-serial sibling', () => {
    const { objects, variables } = parseSingle(
      '^XA^FO10,10^A0N,30,0^FN1^FD001^SN001,1,Y^FS^FO10,60^A0N,30,0^FN1^FDABC^FS^XZ', 8);
    expect(variables).toHaveLength(1);
    expect(serialOf(objects[0])?.zplMode).toBe('SN');
    expect(props(objects[1]).content).toBe('«field_1»');
  });

  it('post-^FS ^SN removes the variable its stripped binding orphaned', () => {
    const { variables } = parseSingle('^XA^FO10,10^A0N,30,0^FN1^FD001^FS\n^SN001,1,Y^XZ', 8);
    expect(variables).toHaveLength(0);
  });

  it('post-^FS ^SN keeps a variable a sibling field still references', () => {
    const { objects, variables } = parseSingle(
      '^XA^FO10,10^A0N,30,0^FN1^FD001^FS^FO10,60^A0N,30,0^FN1^FDABC^FS\n^SN001,1,Y^XZ', 8);
    expect(variables).toHaveLength(1);
    expect(props(objects[0]).content).toBe('«field_1»');
    expect(props(objects[1]).content).toBe('001');
  });

  it('post-^FS ^SN keeps a bare-declared variable', () => {
    const { variables } = parseSingle(
      '^XA^FN1^FDdecl^FS^FO10,10^A0N,30,0^FN1^FD001^FS\n^SN001,1,Y^XZ', 8);
    expect(variables).toHaveLength(1);
  });

  it('in-field serial keeps the slot default for a later embed', () => {
    // Same shared-slot rule as the post-^FS path: the embed must see the
    // serial seed as default, not a freshly created empty variable.
    const { objects, variables } = parseSingle(
      '^XA^FO10,10^A0N,30,0^FN1^SN001,1,Y^FS^FO10,60^A0N,30,0^FE#^FDlot #1#^FS^XZ', 8);
    expect(variables).toHaveLength(1);
    expect(variables[0]?.defaultValue).toBe('001');
    expect(props(objects[1]).content).toBe('lot «field_1»');
  });

  it('post-^FS ^SN keeps the variable when a later embed references the slot', () => {
    // The slot is shared (spec p.200): a later #1# must reuse the original
    // variable and its default, not a freshly created empty one.
    const { objects, variables } = parseSingle(
      '^XA^FO10,10^A0N,30,0^FN1^FD001^FS\n^SN001,1,Y\n^FO10,60^A0N,30,0^FE#^FDlot #1#^FS^XZ', 8);
    expect(variables).toHaveLength(1);
    expect(variables[0]?.defaultValue).toBe('001');
    expect(props(objects[1]).content).toBe('lot «field_1»');
  });
});

// ── ^FE/^FC field scoping ────────────────────────────────────────────────────

describe('parseZPL — ^FE/^FC arm only the next ^FD (spec p.191/p.1614)', () => {
  it('^FE does not leak onto later fields (no phantom variable)', () => {
    // Spec p.191: "if a ^FE does not immediately precede a ^FD, there is no
    // field concatenation character active for that ^FD". Firmware prints the
    // second field's @2@ literally; decoding it would mint a phantom fn2.
    const { objects, variables } = parseSingle(
      '^XA^FN1^FDval^FS^FE@^FO10,10^A0N,30,30^FD@1@^FS^FO10,60^A0N,30,30^FD@2@^FS^XZ', 8);
    expect(props(objects[0]).content).toBe('«field_1»');
    expect(props(objects[1]).content).toBe('@2@');
    expect(variables).toHaveLength(1);
  });

  it('bare #n# without ^FE stays literal', () => {
    const { objects, variables } = parseSingle(
      '^XA^FN1^FDval^FS^FO10,10^A0N,30,30^FD#1#^FS^XZ', 8);
    expect(props(objects[0]).content).toBe('#1#');
    expect(variables).toHaveLength(1);
  });

  it('^FE without a parameter arms the default #', () => {
    const { objects } = parseSingle(
      '^XA^FN1^FDval^FS^FE^FO10,10^A0N,30,30^FD#1#^FS^XZ', 8);
    expect(props(objects[0]).content).toBe('«field_1»');
  });

  it('^FC does not leak onto later fields (%d stays literal)', () => {
    // Spec p.1614: without a preceding ^FC "the characters %H would print as
    // text on the label".
    const { objects } = parseSingle(
      '^XA^FC%^FO10,10^A0N,30,30^FD%d^FS^FO10,60^A0N,30,30^FD%d^FS^XZ', 8);
    expect(props(objects[0]).content).toBe('«clock:d»');
    expect(props(objects[1]).content).toBe('%d');
  });

  it('bare %d without ^FC stays literal', () => {
    const { objects } = parseSingle(
      '^XA^FO10,10^A0N,30,30^FD%d^FS^XZ', 8);
    expect(props(objects[0]).content).toBe('%d');
  });

  it('a ^FE after the ^FD does not retroactively decode it', () => {
    const { objects, variables } = parseSingle(
      '^XA^FN1^FDval^FS^FO10,10^A0N,30,30^FD@1@^FE@^FS^XZ', 8);
    expect(props(objects[0]).content).toBe('@1@');
    expect(variables).toHaveLength(1);
  });

  it('a ^FC after the ^FD does not retroactively decode it', () => {
    const { objects } = parseSingle(
      '^XA^FO10,10^A0N,30,30^FD%d^FC%^FS^XZ', 8);
    expect(props(objects[0]).content).toBe('%d');
  });

  it('arming does not carry across ^FS (deliberate: cross-^FS carry is unverified)', () => {
    // Spec wording is per-field; whether firmware carries an unconsumed arm
    // past ^FS is unverified. Parse literal (no phantom decode); the overlay
    // marks the block regen-hostile so the raw bytes replay verbatim.
    const { objects } = parseSingle(
      '^XA^FC%^FS^FO10,10^A0N,30,30^FD%d^FS^XZ', 8);
    expect(props(objects[0]).content).toBe('%d');
  });
});

// ── prefix-junk tolerance (ZebraDesigner driver preamble) ────────────────────

describe('parseZPL — prefix char followed by another prefix', () => {
  it('discards the incomplete first prefix like firmware does', () => {
    // ZebraDesigner's `CT~~CD,` preamble: the first `~` is immediately
    // followed by another `~` and must be dropped, not read as command `~C`.
    const { objects, findings } = parseSingle(
      'CT~~CD,~CC^~CT~^XA^FO10,20^A0N,30,0^FDHi^FS^XZ', 8);
    expect(commandsOf({ findings }, 'unknown')).toEqual([]);
    expect(objects).toHaveLength(1);
    expect(props(objects[0]).content).toBe('Hi');
  });

  it('resyncs when a prefix char sits at the second command-name position', () => {
    // A lone `~` before a newline must not swallow the following ^XA.
    const { objects, findings } = parseSingle(
      '~\n^XA^FO10,20^A0N,30,0^FDHi^FS^XZ', 8);
    expect(commandsOf({ findings }, 'unknown')).toEqual([]);
    expect(objects).toHaveLength(1);
    expect(props(objects[0]).content).toBe('Hi');
  });

  it('does not resync on an alphanumeric ^CC prefix that is a valid name char', () => {
    // With ^CCA, `AA0N` is prefix A + command A0; resyncing there would
    // shred every command whose name contains the remapped prefix.
    const { objects, findings } = parseSingle(
      '^XA^CCAAFO10,20AA0N,30,0AFDHiAFSAXZ', 8);
    expect(commandsOf({ findings }, 'unknown')).toEqual([]);
    expect(objects).toHaveLength(1);
    expect(props(objects[0]).content).toBe('Hi');
  });
});

// ── ^FV field variable (data-equivalent of ^FD, spec p.207) ──────────────────

describe('parseZPL — ^FV field variable', () => {
  it('imports ^FV like ^FD for a plain text field', () => {
    const { objects } = parseSingle('^XA^FO10,20^A0N,30,0^FVHello^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('text');
    expect(props(objects[0]).content).toBe('Hello');
  });

  it('binds ^FN + ^FV like ^FN + ^FD', () => {
    const { objects, variables } = parseSingle('^XA^FO10,10^A0N,30,0^FN1^FVHELLO^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(props(objects[0]).content).toBe('«field_1»');
    expect(variables.find((v) => v.fnNumber === 1)?.defaultValue).toBe('HELLO');
  });

  it('ignores an empty ^FV per spec', () => {
    const { objects } = parseSingle('^XA^FO10,20^A0N,30,0^FV^FS^XZ', 8);
    expect(objects).toHaveLength(0);
  });

  it('feeds a bare ^FN declaration through ^FV', () => {
    const { variables } = parseSingle('^XA^FN1^FV001^FS^XZ', 8);
    expect(variables.find((v) => v.fnNumber === 1)?.defaultValue).toBe('001');
  });

  it('a bare ^FN^FD^FS with empty data still declares the variable', () => {
    const { variables } = parseSingle('^XA^FN1^FD^FS^XZ', 8);
    expect(variables).toHaveLength(1);
    expect(variables[0]?.defaultValue).toBe('');
  });

  it('a bare ^FN^FV^FS with empty data declares nothing', () => {
    const { variables } = parseSingle('^XA^FN1^FV^FS^XZ', 8);
    expect(variables).toHaveLength(0);
  });
});

// ── pending per-field state lifetime at ^FS boundary ─────────────────────────

describe('parseZPL — pending field state cleared at ^FS', () => {
  it('does not leak pendingPrinterFontName from a bare ^A@^FS', () => {
    const zpl =
      '^XA^A@N,30,0,E:CUSTOM.FNT^FS^FO10,10^A0N,30,0^FDplain^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('text');
    expect(props(objects[0]).printerFontName).toBeUndefined();
  });

  it('does not leak pendingFontId from a bare ^A0^FS into a later ^A@ field', () => {
    const zpl =
      '^XA^CF1,30,0^A0N,30,0^FS^FO10,10^A@N,30,0,E:CUSTOM.FNT^FDx^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('text');
    expect(props(objects[0]).fontId).toBeUndefined();
  });

  it('does not leak ^FN slot from a bare ^FN^FS into the next field', () => {
    const zpl =
      '^XA^FN1^FS^FO10,10^A0N,30,0^FDhello^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    // The bare ^FN1^FS slot must not bleed onto the next field's content.
    expect(props(objects[0]).content).toBe('hello');
  });

  it('does not leak frActive from a bare ^FR^FS into a fieldless next text', () => {
    const zpl =
      '^XA^FO10,10^FR^FS^A0N,30,0^FDplain^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('text');
    expect(props(objects[0]).reverse).toBeFalsy();
  });

  it('does not leak ^FB defaults from a bare ^FB^FS into the next text field', () => {
    const zpl =
      '^XA^FB200^FS^FO10,10^A0N,30,0^FDplain^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('text');
    expect(props(objects[0]).blockWidth).toBeUndefined();
  });

  it('does not leak bcCheck from a checked barcode into the next non-checked barcode', () => {
    const zpl =
      '^XA^FO10,10^BCN,100,Y,N,Y^FD123^FS^FO50,50^BIN,100,Y,N^FD12345^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(2);
    expect(objects[0]?.type).toBe('code128');
    expect(props(objects[0]).checkDigit).toBe(true);
    expect(objects[1]?.type).toBe('industrial2of5');
    expect(props(objects[1]).checkDigit).toBe(false);
  });

  it('applies ^FR set before ^FO to the next formatted field (spec)', () => {
    const zpl = '^XA^FR^FO10,10^A0N,30,0^FDreversed^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('text');
    expect(props(objects[0]).reverse).toBe(true);
  });
});

// ── ~ commands (tilde) ────────────────────────────────────────────────────────

describe('parseZPL — ~ tilde commands', () => {
  it('tokenizes ~DG as a known command (skipped)', () => {
    const parsed = parseSingle('^XA~DGR:LOGO.GRF,1024,10,FF^XZ', 8);
    const skipped = [...commandsOf(parsed, 'browserLimit'), ...commandsOf(parsed, 'unknown')];
    expect(skipped.some((s) => s.startsWith('~DG'))).toBe(true);
  });

  it('does not create objects for ~DG', () => {
    const { objects } = parseSingle('^XA~DGR:LOGO.GRF,1024,10,FF^XZ', 8);
    expect(objects).toHaveLength(0);
  });

  it('handles mixed ^ and ~ commands', () => {
    const parsed = parseSingle('^XA~DGR:TEST.GRF,10,1,FF^FO10,20^A0N,30,0^FDHello^FS^XZ', 8);
    const skipped = [...commandsOf(parsed, 'browserLimit'), ...commandsOf(parsed, 'unknown')];
    expect(parsed.objects).toHaveLength(1);
    expect(parsed.objects[0]?.type).toBe('text');
    expect(skipped.some((s) => s.startsWith('~DG'))).toBe(true);
  });
});

// ── ^CC / ^CT / ^CD change command-prefix chars ──────────────────────────────

describe('parseZPL — change caret / tilde / delimiter (^CC ^CT ^CD)', () => {
  it('^CC switches the command prefix; following commands use the new char', () => {
    const zpl = '^XA^CCYYFO10,10YA0N,30,0YFDhelloYFSYXZ';
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('text');
    expect(props(objects[0]).content).toBe('hello');
  });

  it('~CC is a synonym of ^CC', () => {
    const zpl = '^XA~CCYYFO10,10YA0N,30,0YFDhelloYFSYXZ';
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('text');
  });

  it('^CT switches the tilde prefix without affecting ^ commands', () => {
    const zpl = '^XA^CT!^FO10,10^A0N,30,0^FDhello^FS!DGR:LOGO.GRF,10,1,FF^XZ';
    const { objects, findings } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(commandsOf({ findings }, 'browserLimit').some((s) => s.startsWith('~DG'))).toBe(true);
  });

  it('^CD switches the parameter delimiter', () => {
    const zpl = '^XA^CD;^FO10;10^A0N;30;0^FDhello^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.x).toBe(10);
    expect(props(objects[0]).fontHeight).toBe(30);
    expect(props(objects[0]).content).toBe('hello');
  });

  it('~CD is a synonym of ^CD', () => {
    const zpl = '^XA~CD;^FO10;10^A0N;30;0^FDhello^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    expect(objects[0]?.x).toBe(10);
    expect(props(objects[0]).fontHeight).toBe(30);
  });

  it('combined ^CC + ^CD: both prefix and delimiter swap', () => {
    const zpl = '^XA^CD;^CCYYFO10;10YA0N;30;0YFDhelloYFSYXZ';
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.x).toBe(10);
    expect(props(objects[0]).fontHeight).toBe(30);
  });

  it('^CC persists across an ^XA boundary within the same parse', () => {
    const zpl =
      '^XA^CCYYXZYXAYFO10,10YA0N,30,0YFDhelloYFSYXZ';
    const objects = parseZPL(zpl, 8).pages.flatMap((pg) => pg.objects);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('text');
  });

  it('^CC^ resets the caret prefix back to ^', () => {
    const zpl = '^XA^CCYYFO10,10YA0N,30,0YFDfirstYFSYCC^^FO50,50^A0N,30,0^FDsecond^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(2);
    expect(props(objects[0]).content).toBe('first');
    expect(props(objects[1]).content).toBe('second');
  });

  it('^CC always consumes the next char as its argument (even if it is ^)', () => {
    // Spec: ^CC reads exactly one arg char. With `^CC^FO...`, the ^ of
    // ^FO is consumed as the (no-op) argument; the FO that follows is
    // no longer a command, so its position is lost.
    const zpl = '^XA^CC^FO10,10^A0N,30,0^FDhello^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(props(objects[0]).content).toBe('hello');
    expect(objects[0]?.x).toBe(0);
  });

  it('^CD also affects ^GF parameter parsing', () => {
    // ^GFA;total;total;bpr;data uses the mutated delimiter for the four
    // params; a wrong split would push the command into browserLimit.
    const zpl = '^XA^CD;^FO10;10^GFA;6;6;3;111111111111^FS^XZ';
    const { objects, findings } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('image');
    expect(commandsOf({ findings }, 'browserLimit').some((s) => s.startsWith('^GF'))).toBe(false);
  });

  it('rejects ^CC / ^CT / ^CD args that would collapse role boundaries', () => {
    // ^CC~ would make caret == tilde (tokenizer cannot distinguish);
    // ^CD^ would make delimiter == caret (param-split eats command chars).
    // Invalid args land in partialCmds and the prefix stays unchanged.
    const zpl = '^XA^CC~^CD^^FO10,10^A0N,30,0^FDhello^FS^XZ';
    const { objects, findings } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(props(objects[0]).content).toBe('hello');
    expect(commandsOf({ findings }, 'partial')).toContain('^CC');
    expect(commandsOf({ findings }, 'partial')).toContain('^CD');
  });

  it('rejects ^CC / ^CT / ^CD args that are space or non-printable', () => {
    // Space/control chars cannot serve as prefixes and would silently
    // break the subsequent stream; reject them up front.
    const zpl = '^XA^CC ^CT\t^FO10,10^A0N,30,0^FDhello^FS^XZ';
    const { objects, findings } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(props(objects[0]).content).toBe('hello');
    expect(commandsOf({ findings }, 'partial')).toContain('^CC');
    expect(commandsOf({ findings }, 'partial')).toContain('^CT');
  });
});

// ── ^BT TLC39 ─────────────────────────────────────────────────────────────────

describe('parseZPL — ^BT TLC39', () => {
  it('parses ^BT with full param set into a tlc39 object', () => {
    const zpl = '^XA^FO50,50^BTN,3,3,60,5,3^FD123456,ABC^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('tlc39');
    const p = props(objects[0]);
    expect(p.content).toBe('123456,ABC');
    expect(p.moduleWidth).toBe(3);
    expect(p.height).toBe(60);
    expect(p.microPdfRowHeight).toBe(5);
    expect(p.microPdfRows).toBe(3);
    expect(p.rotation).toBe('N');
  });

  it('falls back to ^BY moduleWidth when ^BT w1 is empty', () => {
    const zpl = '^XA^FO0,0^BY5^BTN,,3,40,4,4^FD123456,X^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    expect(props(objects[0]).moduleWidth).toBe(5);
  });

  it('preserves microPdfRows mid-range', () => {
    const zpl = '^XA^FO0,0^BTN,2,3,40,4,6^FD123456,X^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    expect(props(objects[0]).microPdfRows).toBe(6);
  });

  it('accepts microPdfRows=1 and =10 (^BT spec bounds)', () => {
    const z1 = parseSingle('^XA^FO0,0^BTN,2,3,40,4,1^FD123456,X^FS^XZ', 8).objects;
    expect(props(z1[0]).microPdfRows).toBe(1);
    const z10 = parseSingle('^XA^FO0,0^BTN,2,3,40,4,10^FD123456,X^FS^XZ', 8).objects;
    expect(props(z10[0]).microPdfRows).toBe(10);
  });

  it('rejects microPdfRows outside ^BT spec range (-1, 0, 11, 20) and falls back to default 4', () => {
    for (const v of [-1, 0, 11, 20]) {
      const zpl = `^XA^FO0,0^BTN,2,3,40,4,${v}^FD123456,X^FS^XZ`;
      const { objects } = parseSingle(zpl, 8);
      expect(props(objects[0]).microPdfRows, `rows=${v}`).toBe(4);
    }
  });

  it('drops non-canonical r1 on round-trip (re-emits as 2)', async () => {
    const { ObjectRegistry } = await import('@zplab/core/registry');
    const { objects } = parseSingle('^XA^FO0,0^BTN,2,3,40,4,4^FD123,X^FS^XZ', 8);
    const emitted = ObjectRegistry.tlc39.toZPL(objects[0] as never);
    expect(emitted).toContain('^BTN,2,2,40,4,4');
  });

  it('round-trips ^BT without serial (no MicroPDF block, no trailing comma)', async () => {
    const { ObjectRegistry } = await import('@zplab/core/registry');
    const original = '^XA^FO10,20^BY2^BTN,2,2,40,4,4^FD123456^FS^XZ';
    const { objects } = parseSingle(original, 8);
    expect(objects[0]?.type).toBe('tlc39');
    expect(props(objects[0]).content).toBe('123456');
    const emitted = ObjectRegistry.tlc39.toZPL(objects[0] as never);
    expect(emitted).toMatch(/\^FD123456\^FS/);
    const { objects: round2 } = parseSingle(`^XA${emitted}^XZ`, 8);
    expect(props(round2[0]).content).toBe('123456');
  });

  it('round-trips ^BT via parse → toZPL → parse', async () => {
    const { ObjectRegistry } = await import('@zplab/core/registry');
    const original = '^XA^FO50,60^BY3^BTN,3,2,80,5,8^FD654321,ABCDEF^FS^XZ';
    const { objects } = parseSingle(original, 8);
    expect(objects).toHaveLength(1);
    const emitted = ObjectRegistry.tlc39.toZPL(objects[0] as never);
    expect(emitted).toContain('^BTN,3,2,80,5,8');
    expect(emitted).toContain('^FD654321,ABCDEF');
    const { objects: round2 } = parseSingle(`^XA${emitted}^XZ`, 8);
    expect(round2[0]?.type).toBe('tlc39');
    expect(props(round2[0])).toMatchObject(props(objects[0]));
  });
});

describe('snapTlc39MicroPdfRows', () => {
  it('snaps in-range requests up to the nearest valid {4,6,8,10}', async () => {
    const { snapTlc39MicroPdfRows } = await import('../components/Canvas/bwipHelpers');
    expect(snapTlc39MicroPdfRows(1)).toBe(4);
    expect(snapTlc39MicroPdfRows(4)).toBe(4);
    expect(snapTlc39MicroPdfRows(5)).toBe(6);
    expect(snapTlc39MicroPdfRows(7)).toBe(8);
    expect(snapTlc39MicroPdfRows(9)).toBe(10);
    expect(snapTlc39MicroPdfRows(10)).toBe(10);
  });

  it('clamps above-range to the highest valid count', async () => {
    const { snapTlc39MicroPdfRows } = await import('../components/Canvas/bwipHelpers');
    expect(snapTlc39MicroPdfRows(99)).toBe(10);
  });
});

describe('splitTlc39Content', () => {
  it('splits on first comma; ECI before, serial after', async () => {
    const { splitTlc39Content } = await import('../components/Canvas/bwipHelpers');
    expect(splitTlc39Content('123456,ABC123')).toEqual({ eci: '123456', serial: 'ABC123' });
  });

  it('strips a leading S data identifier from the serial', async () => {
    const { splitTlc39Content } = await import('../components/Canvas/bwipHelpers');
    expect(splitTlc39Content('123456,SXYZ789')).toEqual({ eci: '123456', serial: 'XYZ789' });
  });

  it('returns empty serial when no comma is present', async () => {
    const { splitTlc39Content } = await import('../components/Canvas/bwipHelpers');
    expect(splitTlc39Content('123456')).toEqual({ eci: '123456', serial: '' });
  });
});

// ── ^IM image reference ───────────────────────────────────────────────────────

describe('parseZPL — ^IM image reference', () => {
  it('adds ^IM to skipped (cannot load printer images)', () => {
    const parsed = parseSingle('^XA^FO0,0^IMR:LOGO.GRF^FS^XZ', 8);
    const skipped = [...commandsOf(parsed, 'browserLimit'), ...commandsOf(parsed, 'unknown')];
    expect(parsed.objects).toHaveLength(0);
    expect(skipped.some((s) => s.startsWith('^IM'))).toBe(true);
  });
});

// ── \\& line break in ^FB ─────────────────────────────────────────────────────

describe('parseZPL — \\& line break in ^FB', () => {
  it('decodes \\& as newline in field block text', () => {
    const { objects } = parseSingle('^XA^FO0,0^A0N,30,0^FB400,3,0,L,0^FDLine 1\\&Line 2\\&Line 3^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(props(objects[0]).content).toBe('Line 1\nLine 2\nLine 3');
  });

  it('does not decode \\& outside of ^FB blocks', () => {
    const { objects } = parseSingle('^XA^FO0,0^A0N,30,0^FDNo\\&Break^FS^XZ', 8);
    expect(props(objects[0]).content).toBe('No\\&Break');
  });
});

// ── ^A@ TrueType font fallback ───────────────────────────────────────────────

describe('parseZPL — ^A@ TrueType font fallback', () => {
  it('imports ^A@ as text with specified height instead of skipping', () => {
    const parsed = parseSingle('^XA^FO10,20^A@N,40,30,E:ARIAL.TTF^FDTrueType^FS^XZ', 8);
    const skipped = [...commandsOf(parsed, 'browserLimit'), ...commandsOf(parsed, 'unknown')];
    expect(parsed.objects).toHaveLength(1);
    expect(parsed.objects[0]?.type).toBe('text');
    expect(props(parsed.objects[0]).content).toBe('TrueType');
    expect(props(parsed.objects[0]).fontHeight).toBe(40);
    // Should NOT be in skipped list
    expect(skipped.some((s) => s.startsWith('^A@'))).toBe(false);
  });

  it('falls back to ^CF defaults when ^A@ has no height', () => {
    const { objects } = parseSingle('^XA^CF0,50^FO0,0^A@N,0,0,E:FONT.TTF^FDFallback^FS^XZ', 8);
    expect(props(objects[0]).fontHeight).toBe(50);
  });
});

// ── import findings ──────────────────────────────────────────────────────────

describe('parseZPL — partial findings', () => {
  it('records ^A@ as partial (font face not imported)', () => {
    const { findings } = parseSingle('^XA^FO0,0^A@N,30,0,E:ARIAL.TTF^FDText^FS^XZ', 8);
    expect(commandsOf({ findings }, 'partial')).toContain('^A@');
  });

  it('deduplicates ^A@ entries when used multiple times', () => {
    const zpl = '^XA^FO0,0^A@N,30,0,E:A.TTF^FDFirst^FS^FO0,50^A@N,30,0,E:B.TTF^FDSecond^FS^XZ';
    const { findings } = parseSingle(zpl, 8);
    expect(commandsOf({ findings }, 'partial').filter((e) => e === '^A@')).toHaveLength(1);
  });

  it('does not flag built-in ^A{letter} fonts (A-H) as partial', () => {
    // ^AB references the built-in Zebra font B; the parser pins it on
    // the field as fontId="B" and the generator re-emits the short
    // form, so the import is lossless and stays out of partial.
    const { findings } = parseSingle('^XA^FO0,0^ABN,30,0^FDText^FS^XZ', 8);
    expect(commandsOf({ findings }, 'partial').some((e) => e.startsWith('^A'))).toBe(false);
  });

  it('flags ^A{alias} as partial when the alias has no ^CW mapping', () => {
    // ^AM without a preceding ^CWM is a dangling reference: the model
    // captures fontId="M" so editing stays lossless, but we surface a
    // partial-import warning because the rendered output will fall
    // back to font 0 on the printer.
    const { findings } = parseSingle('^XA^FO0,0^AMN,30,0^FDText^FS^XZ', 8);
    expect(commandsOf({ findings }, 'partial').some((e) => e.startsWith('^A'))).toBe(true);
  });

  it('does not flag fully-supported ^A0 as partial', () => {
    const { findings } = parseSingle('^XA^FO0,0^A0N,30,0^FDText^FS^XZ', 8);
    expect(commandsOf({ findings }, 'partial')).toHaveLength(0);
  });
});

describe('parseZPL — browserLimit findings', () => {
  it('records ^IM as browserLimit', () => {
    const { findings } = parseSingle('^XA^FO0,0^IMR:LOGO.GRF^FS^XZ', 8);
    expect(commandsOf({ findings }, 'browserLimit').some((s) => s.startsWith('^IM'))).toBe(true);
  });

  it('records ~DG as browserLimit', () => {
    const { findings } = parseSingle('^XA~DGR:LOGO.GRF,1024,10,FF^XZ', 8);
    expect(commandsOf({ findings }, 'browserLimit').some((s) => s.startsWith('~DG'))).toBe(true);
  });
});

describe('parseZPL — unknown findings', () => {
  it('records unrecognised commands as unknown', () => {
    const { findings } = parseSingle('^XA^XX99^FO0,0^A0N,30,0^FDText^FS^XZ', 8);
    expect(commandsOf({ findings }, 'unknown').some((s) => s.startsWith('^XX'))).toBe(true);
  });

  it('also keeps unknown commands in skipped for backward compatibility', () => {
    const parsed = parseSingle('^XA^XX99^FO0,0^A0N,30,0^FDText^FS^XZ', 8);
    const skipped = [...commandsOf(parsed, 'browserLimit'), ...commandsOf(parsed, 'unknown')];
    expect(skipped.some((s) => s.startsWith('^XX'))).toBe(true);
    expect(commandsOf(parsed, 'unknown').some((s) => s.startsWith('^XX'))).toBe(true);
  });

  it('surfaces unknown/browserLimit tokens without a trailing newline', () => {
    const parsed = parseSingle('^XA\n^XX99\n^IMR:LOGO.GRF\n^XZ', 8);
    const skipped = [...commandsOf(parsed, 'browserLimit'), ...commandsOf(parsed, 'unknown')];
    expect(commandsOf(parsed, 'unknown')).toContain('^XX99');
    expect(commandsOf(parsed, 'browserLimit')).toContain('^IMR:LOGO.GRF');
    for (const s of [...commandsOf(parsed, 'unknown'), ...commandsOf(parsed, 'browserLimit'), ...skipped]) {
      expect(s).toBe(s.trimEnd());
    }
  });

  it('keeps the source prefix on unknown tilde commands', () => {
    const { findings } = parseSingle('^XA\n~QQ1,2\n^XZ', 8);
    expect(commandsOf({ findings }, 'unknown')).toContain('~QQ1,2');
  });

  it('does not bake a line break into a truncated ~DY summary token', () => {
    // Short malformed ~DY: rest ended with \n before the appended ellipsis,
    // where the push-site trim cannot reach.
    const { findings } = parseSingle('^XA\n~DYR:X,Q,G,10,2,ZZ\n^XZ', 8);
    expect(commandsOf({ findings }, 'browserLimit')).toContain('~DYR:X,Q,G,10,2,ZZ…');
  });

  it('preserves an undecodable ^GFB format as an opaque verbatim image', () => {
    const { objects, findings } = parseSingle('^XA^FO0,0^GFB,32,32,4,AABBCCDD^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('image');
    expect(props(objects[0]).rawGf).toBe('^GFB,32,32,4,AABBCCDD');
    expect(commandsOf({ findings }, 'partial')).toContain('^GF');
    expect(commandsOf({ findings }, 'browserLimit').some((s) => s.startsWith('^GF'))).toBe(false);
    expect(commandsOf({ findings }, 'unknown').some((s) => s.startsWith('^GF'))).toBe(false);
  });

  it('returns empty importReport for a fully supported label', () => {
    const { findings } = parseSingle('^XA^PW800^LL600^FO50,50^A0N,30,0^FDHello^FS^XZ', 8);
    expect(commandsOf({ findings }, 'partial')).toHaveLength(0);
    expect(commandsOf({ findings }, 'browserLimit')).toHaveLength(0);
    expect(commandsOf({ findings }, 'unknown')).toHaveLength(0);
    expect(findings).toHaveLength(0);
  });
});

describe('parseZPL: page findings', () => {
  it('emits one finding per kind with the page index stamped', () => {
    const zpl = '^XA^FO0,0^A@N,30,0,E:ARIAL.TTF^FDText^FS^IMR:LOGO.GRF^XX99^XZ';
    const { findings } = parseSingle(zpl, 8);
    const kinds = findings.map((f) => f.kind);
    expect(kinds).toContain('partial');
    expect(kinds).toContain('browserLimit');
    expect(kinds).toContain('unknown');
    expect(findings.every((f) => f.pageIndex === 0)).toBe(true);
    // Tripwire: findings emit in source order. A pipeline split that
    // collects unknowns / browser-limits in a separate pass would
    // reorder these. Order: ^A@ (L1 partial) → ^IM (L1 browserLimit) →
    // ^XX (L1 unknown).
    expect(findings.map((f) => f.command)).toEqual([
      '^A@', '^IMR:LOGO.GRF', '^XX99',
    ]);
  });

  it('partial findings are deduplicated by command code', () => {
    // Two ^A@ uses → one partial finding for "^A@".
    const zpl = '^XA^FO0,0^A@N,30,0,E:A.TTF^FDFirst^FS^FO0,50^A@N,30,0,E:B.TTF^FDSecond^FS^XZ';
    const { findings } = parseSingle(zpl, 8);
    const partialFindings = findings.filter((f) => f.kind === 'partial');
    expect(partialFindings).toHaveLength(1);
    expect(partialFindings[0]?.command).toBe('^A@');
  });
});

// ── ^FO 3rd parameter (justification) ─────────────────────────────────────────

describe('parseZPL — ^FO with justification parameter', () => {
  it('parses ^FO with a 3rd parameter without errors', () => {
    const { objects } = parseSingle('^XA^FO100,200,1^A0N,30,0^FDJustified^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.x).toBeCloseTo(100);
    expect(objects[0]?.y).toBeCloseTo(200 - 4.62);
    expect(props(objects[0]).content).toBe('Justified');
  });
});

describe('^FN / template variables', () => {
  it('creates a Variable for each distinct ^FN and binds the field', () => {
    const zpl = '^XA^FO10,20^A0N,30,30^FN1^FDDefault^FS^XZ';
    const { objects, variables } = parseSingle(zpl);
    expect(variables).toHaveLength(1);
    expect(variables[0]?.fnNumber).toBe(1);
    expect(variables[0]?.defaultValue).toBe('Default');
    expect(variables[0]?.name).toBe('field_1');
    // New model: the field links to the variable via a single content marker.
    expect(props(objects[0]).content).toBe('«field_1»');
  });

  it('derives the Variable name from a preceding ^FX comment', () => {
    const zpl = '^XA^FXField: Customer Name^FO10,20^A0N,30,30^FN1^FDJohn^FS^XZ';
    const { variables } = parseSingle(zpl);
    expect(variables[0]?.name).toBe('Customer_Name');
  });

  it('falls back to field_<fn> when the ^FX comment is a marker-unsafe name', () => {
    // `clock:Y` would render as a clock chip; `»` breaks the «name» marker.
    expect(parseSingle('^XA^FXField: clock:Y^FO10,20^A0N,30,30^FN1^FDx^FS^XZ').variables[0]?.name).toBe('field_1');
    expect(parseSingle('^XA^FXField: sku»oops^FO10,20^A0N,30,30^FN2^FDx^FS^XZ').variables[0]?.name).toBe('field_2');
  });

  it('reuses the same Variable when multiple fields share an fnNumber', () => {
    const zpl =
      '^XA' +
      '^FO10,20^A0N,30,30^FN1^FDA^FS' +
      '^FO10,60^A0N,30,30^FN1^FDA^FS' +
      '^XZ';
    const { objects, variables } = parseSingle(zpl);
    expect(variables).toHaveLength(1);
    const [a, b] = objects;
    // Both fields reference the shared variable by the same content marker.
    expect(props(a).content).toBe('«field_1»');
    expect(props(b).content).toBe('«field_1»');
  });

  it('ignores out-of-range ^FN numbers and records a partial finding', () => {
    const zpl = '^XA^FO10,20^A0N,30,30^FN0^FDIgnored^FS^XZ';
    const { variables, objects, findings } = parseSingle(zpl);
    expect(variables).toHaveLength(0);
    // Out-of-range ^FN is ignored: no marker, content stays the literal ^FD.
    expect(props(objects[0]).content).toBe('Ignored');
    expect(commandsOf({ findings }, 'partial')).toContain('^FN');
  });
});

// ── lossyEdit finding (overlay exists but is regen-unsafe) ────────────────────

describe('parseZPL — lossyEdit finding for regen-unsafe blocks', () => {
  it('flags a block with a standalone ^FN declaration', () => {
    const zpl = '^XA^FN1^FDdefault^FS^FO10,10^A0N,30,0^FDx^FS^XZ';
    const { findings } = parseSingle(zpl, 8, { captureOverlay: true });
    const f = findings.find((x) => x.kind === 'lossyEdit');
    expect(f).toBeDefined();
    expect(f?.command).toContain('^FN');
  });

  it('does not flag a clean, regen-safe block', () => {
    const zpl = '^XA^FO10,10^A0N,30,0^FDx^FS^XZ';
    const { findings } = parseSingle(zpl, 8, { captureOverlay: true });
    expect(findings.some((x) => x.kind === 'lossyEdit')).toBe(false);
  });

  it('flags a verbatim ^BC stream whose re-emit the plain escape rewrites', () => {
    // `A>B` is kept verbatim (lossy on the printer), but regen emits `A>0B`.
    const zpl = '^XA^FO10,10^BY2^BCN,100,Y,N,N^FDA>B^FS^XZ';
    const { findings } = parseSingle(zpl, 8, { captureOverlay: true });
    const f = findings.find((x) => x.kind === 'lossyEdit');
    expect(f?.command).toContain('re-escapes');
    // Adopted (`A>0B`) and verbatim-stable (`>:AB>8CD`) streams stay clean.
    for (const fd of ['A>0B', '>:AB>8CD']) {
      const clean = parseSingle(`^XA^FO10,10^BY2^BCN,100,Y,N,N^FD${fd}^FS^XZ`, 8, { captureOverlay: true });
      expect(clean.findings.some((x) => x.kind === 'lossyEdit')).toBe(false);
    }
  });

  it('flags ^FH-imported control bytes on a ^BC (regen re-emits invocations)', () => {
    // ^FH-imported control bytes regenerate as invocations, changing bytes
    // and symbol, so the page cannot claim byte-exact regen.
    for (const fd of ['A_09B', 'A_01B']) {
      const zpl = `^XA^FO10,10^BY2^BCN,100,Y,N,N^FH_^FD${fd}^FS^XZ`;
      const { findings } = parseSingle(zpl, 8, { captureOverlay: true });
      expect(findings.some((x) => x.kind === 'lossyEdit'), fd).toBe(true);
    }
    // The invocation form itself is adopted and re-emits identically: clean.
    const clean = parseSingle('^XA^FO10,10^BY2^BCN,100,Y,N,N^FD>9337334^FS^XZ', 8, { captureOverlay: true });
    expect(clean.findings.some((x) => x.kind === 'lossyEdit')).toBe(false);
  });
});

// ── ^FT graphic anchor (bottom corner, spec p.205) ───────────────────────────

describe('parseZPL — ^FT graphic anchors lift to model top-left', () => {
  it('^FT ^GE ellipse: bottom-left lifts by height', () => {
    const { objects } = parseSingle('^XA^FT50,150^GE100,80,3,B^FS^XZ', 8);
    expect(objects[0]?.type).toBe('ellipse');
    expect(objects[0]?.positionType).toBe('FT');
    expect(objects[0]?.x).toBe(50);
    expect(objects[0]?.y).toBe(70); // 150 - height 80
    expect(props(objects[0]).width).toBe(100);
  });

  it('^FT,1 ^GE ellipse: bottom-right lifts by height and shifts left by width', () => {
    const { objects } = parseSingle('^XA^FT150,150,1^GE100,80,3,B^FS^XZ', 8);
    expect(objects[0]?.positionType).toBe('FT');
    expect(objects[0]?.fieldJustify).toBe('R');
    expect(objects[0]?.x).toBe(50); // 150 - width 100
    expect(objects[0]?.y).toBe(70); // 150 - height 80
  });

  it('^FT ^GC circle: lifts by the diameter', () => {
    const { objects } = parseSingle('^XA^FT60,160^GC100,3,B^FS^XZ', 8);
    expect(objects[0]?.type).toBe('ellipse');
    expect(objects[0]?.positionType).toBe('FT');
    expect(objects[0]?.x).toBe(60);
    expect(objects[0]?.y).toBe(60); // 160 - diameter 100
  });

  it('^FT ^GD diagonal line: lifts the bounding box, recovers the start point', () => {
    const { objects } = parseSingle('^XA^FT10,110^GD80,60,3,B,L^FS^XZ', 8);
    expect(objects[0]?.type).toBe('line');
    expect(objects[0]?.positionType).toBe('FT');
    expect(objects[0]?.x).toBe(10);
    expect(objects[0]?.y).toBe(50); // box top = 110 - height 60
    expect(props(objects[0]).length).toBe(100); // sqrt(80^2 + 60^2)
  });
});

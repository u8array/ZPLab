import { describe, it, expect } from 'vitest';
import { zlibSync } from 'fflate';
import { generateZPL, generateMultiPageZPL, generateBatchZpl } from '@zplab/core/lib/zplGenerator';
import { parseZPL } from '@zplab/core/lib/zplParser';
import type { LabelConfig } from '@zplab/core/types/LabelConfig';
import type { GroupObject, LabelObject } from '@zplab/core/types/Group';
import { defined, parseSingle, props, serialOf } from '../test/helpers';
import { NON_EMITTING_CONFIG_KEYS } from '../store/labelStore.internals';
import { putImage } from '@zplab/core/lib/imageCache';

const BASE_LABEL: LabelConfig = {
  widthMm: 100,
  heightMm: 50,
  dpmm: 8,
};

describe('NON_EMITTING_CONFIG_KEYS tripwire', () => {
  // A config key wrongly listed as non-emitting would skip the overlay drop and
  // export stale config. Lock the membership and prove each member is invariant.
  it('contains only safeAreaMm', () => {
    expect([...NON_EMITTING_CONFIG_KEYS]).toEqual(['safeAreaMm']);
  });

  it('changing safeAreaMm does not change generated ZPL', () => {
    const objs = [
      { id: 'a', type: 'text', x: 10, y: 10, rotation: 0,
        props: { content: 'Hi', fontHeight: 30, fontWidth: 0, rotation: 'N', reverse: false } },
    ] as unknown as LabelObject[];
    expect(generateZPL({ ...BASE_LABEL, safeAreaMm: 7 }, objs)).toBe(generateZPL(BASE_LABEL, objs));
  });
});

describe('generateZPL — structure', () => {
  it('wraps output in ^XA and ^XZ', () => {
    const zpl = generateZPL(BASE_LABEL, []);
    expect(zpl.startsWith('^XA')).toBe(true);
    expect(zpl.endsWith('^XZ')).toBe(true);
  });

  it('emits ^PW and ^LL for the label dimensions', () => {
    const zpl = generateZPL(BASE_LABEL, []);
    expect(zpl).toContain('^PW800');
    expect(zpl).toContain('^LL400');
  });

  it('emits ^CI28 (UTF-8 encoding)', () => {
    const zpl = generateZPL(BASE_LABEL, []);
    expect(zpl).toContain('^CI28');
  });

  it('does not emit ^PQ when printQuantity is absent', () => {
    const zpl = generateZPL(BASE_LABEL, []);
    expect(zpl).not.toContain('^PQ');
  });

  it('does not emit ^PQ for quantity 1', () => {
    const zpl = generateZPL({ ...BASE_LABEL, printQuantity: 1 }, []);
    expect(zpl).not.toContain('^PQ');
  });

  it('emits ^PQ when printQuantity > 1', () => {
    const zpl = generateZPL({ ...BASE_LABEL, printQuantity: 3 }, []);
    expect(zpl).toContain('^PQ3');
  });

  it('emits ^MM media mode when set', () => {
    const zpl = generateZPL({ ...BASE_LABEL, mediaMode: 'T' }, []);
    expect(zpl).toContain('^MMT');
  });

  it('emits ^LS label shift when set', () => {
    const zpl = generateZPL({ ...BASE_LABEL, labelShift: 5 }, []);
    expect(zpl).toContain('^LS5');
  });

  it('does not emit ^MU when muResampling is unset', () => {
    const zpl = generateZPL(BASE_LABEL, []);
    expect(zpl).not.toContain('^MU');
  });

  it('emits ^MUD,b,c when muResampling is set', () => {
    const zpl = generateZPL(
      { ...BASE_LABEL, muResampling: { formatDpi: 150, outputDpi: 300 } },
      [],
    );
    expect(zpl).toContain('^MUD,150,300');
  });

  it('emits ^MU directly after ^XA so the printer sees the resampling header first', () => {
    const zpl = generateZPL(
      { ...BASE_LABEL, muResampling: { formatDpi: 200, outputDpi: 600 } },
      [],
    );
    const xaIdx = zpl.indexOf('^XA');
    const muIdx = zpl.indexOf('^MUD');
    const pwIdx = zpl.indexOf('^PW');
    expect(xaIdx).toBeGreaterThanOrEqual(0);
    expect(muIdx).toBeGreaterThan(xaIdx);
    expect(muIdx).toBeLessThan(pwIdx);
  });

  it('reverse text round-trips: bare ^FR, no synthesized ^GB', () => {
    // Spec-true reverse: the generator emits ^FR (no background box), so the
    // text round-trips to a single reverse text with its anchor intact. The
    // black background, if any, is the user's own ^GB object.
    const objs = [
      { id: 'r', type: 'text', x: 50, y: 50, rotation: 0,
        props: { content: 'Hi', fontHeight: 30, fontWidth: 0, rotation: 'N', reverse: true } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    const zpl = generateZPL(BASE_LABEL, objs);
    expect(zpl).not.toContain('^GB');
    expect(zpl).toContain('^FR^FD');
    expect(zpl).not.toContain('^LRY');
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('text');
    expect(props(objects[0]).reverse).toBe(true);
    expect(props(objects[0]).content).toBe('Hi');
  });

  it.each(['N', 'R', 'I', 'B'])('rotated reverse text round-trips for %s (bare ^FR, no box)', (rot) => {
    // Reverse text emits a bare ^FR with no background, so it round-trips to
    // ONE object for every rotation and position type, anchor preserved.
    for (const positionType of ['FO', 'FT'] as const) {
      const objs = [
        { id: 'r', type: 'text', x: 60, y: 60, rotation: 0, positionType,
          props: { content: 'Hi', fontHeight: 30, fontWidth: 0, rotation: rot, reverse: true } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any;
      const { objects } = parseSingle(generateZPL(BASE_LABEL, objs), 8);
      expect(objects, `${positionType}/${rot}`).toHaveLength(1);
      expect(objects[0]?.type).toBe('text');
      expect(props(objects[0]).reverse).toBe(true);
      expect(props(objects[0]).rotation).toBe(rot);
    }
  });

  it('third-party rotated ^GB+^FR at the bare text anchor stays a separate box', () => {
    // A rotated reverse where the ^GB sits at the same anchor as the ^FR text
    // genuinely prints beside the text (the box does not overlap rotated text),
    // so it must NOT collapse into a faked overlap; it stays box + reverse text.
    const { objects } = parseSingle(
      '^XA^FT100,200^GB30,80,30,B,0^FS^FT100,200^A0R,30,0^FR^FDHi^FS^XZ',
      8,
    );
    expect(objects.length).toBe(2);
  });

  it('serial text round-trips: emit ^SN/^SF, parse restores text+serial prop', () => {
    // Serial is a text field mode (props.serial), not a distinct type. ^SN's
    // start value IS the field data (no ^FD, spec-conform); the parser restores
    // a plain text object carrying the serial prop.
    const objs = [
      { id: 's', type: 'text', x: 10, y: 20, rotation: 0,
        props: { content: '001', fontHeight: 30, fontWidth: 0, rotation: 'N',
          serial: { increment: 5, zplMode: 'SN' } } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    const zpl = generateZPL(BASE_LABEL, objs);
    expect(zpl).toContain('^SN001,5,Y^FS');
    expect(zpl).not.toContain('^FD'); // ^SN carries the data itself
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('text');
    expect(props(objects[0]).content).toBe('001');
    expect(serialOf(objects[0])?.increment).toBe(5);
    expect(serialOf(objects[0])?.zplMode).toBe('SN');
  });

  it('serial ^SF emits a ^FD plus a per-character mask + increment', () => {
    const objs = [
      { id: 's', type: 'text', x: 0, y: 0, rotation: 0,
        props: { content: 'AB42', fontHeight: 30, fontWidth: 0, rotation: 'N',
          serial: { increment: 1, zplMode: 'SF' } } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    const zpl = generateZPL(BASE_LABEL, objs);
    // mask: A,B → 'AA' (upper alpha), 4,2 → 'dd' (decimal); increment 1.
    expect(zpl).toContain('^FDAB42^SFAAdd,1^FS');
    const { objects } = parseSingle(zpl, 8);
    expect(props(objects[0]).content).toBe('AB42');
    expect(serialOf(objects[0])?.increment).toBe(1);
    expect(serialOf(objects[0])?.zplMode).toBe('SF');
  });

  it('serial barcode round-trips: ^SN provides the serialized barcode data', () => {
    const objs = [
      { id: 'b', type: 'code128', x: 10, y: 20, rotation: 0,
        props: { content: '001', height: 100, moduleWidth: 2,
          printInterpretation: true, checkDigit: false, rotation: 'N',
          serial: { increment: 5, zplMode: 'SN' } } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    const zpl = generateZPL(BASE_LABEL, objs);
    expect(zpl).toContain('^SN001,5,Y^FS');
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('code128');
    expect(serialOf(objects[0])?.increment).toBe(5);
    expect(serialOf(objects[0])?.zplMode).toBe('SN');
  });

  it('serial UPC-E applies the same fdContent (NS prefix) as a non-serial UPC-E', () => {
    const baseProps = { content: '012345', height: 100, moduleWidth: 2,
      printInterpretation: false, checkDigit: false, rotation: 'N' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mk = (extra: object): any[] => [{ id: 'u', type: 'upce', x: 0, y: 0, rotation: 0, props: { ...baseProps, ...extra } }];
    const fd = generateZPL(BASE_LABEL, mk({})).match(/\^FD([0-9]*)\^FS/)?.[1];
    const sn = generateZPL(BASE_LABEL, mk({ serial: { increment: 1, zplMode: 'SN' } }))
      .match(/\^SN([0-9]*),/)?.[1];
    expect(fd).toBeTruthy();
    expect(sn).toBe(fd); // serial seed carries the same transformed payload
  });

  it('a blank UPC-E emits an empty field, not a fabricated 0000000 barcode', () => {
    const obj = [{ id: 'u', type: 'upce', x: 0, y: 0, rotation: 0,
      props: { content: '', height: 100, moduleWidth: 2, printInterpretation: false, checkDigit: false, rotation: 'N' } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    const zpl = generateZPL(BASE_LABEL, obj);
    expect(zpl).toContain('^FD^FS');
    expect(zpl).not.toContain('^FD0000000^FS');
  });

  it('serial with an empty seed survives round-trip (field not dropped)', () => {
    const objs = [
      { id: 's', type: 'text', x: 0, y: 0, rotation: 0,
        props: { content: '', fontHeight: 30, fontWidth: 0, rotation: 'N',
          serial: { increment: 1, zplMode: 'SN' } } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    const zpl = generateZPL(BASE_LABEL, objs);
    expect(zpl).toContain('^SN,1,Y^FS');
    const { objects } = parseSingle(zpl, 8);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('text');
    expect(serialOf(objects[0])?.zplMode).toBe('SN');
  });

  it('omits objects with includeInExport=false', () => {
    const objs = [
      { id: 'a', type: 'text', x: 10, y: 10, rotation: 0, props: { content: 'KEEP', fontHeight: 30, fontWidth: 0, rotation: 'N', reverse: false } },
      { id: 'b', type: 'text', x: 20, y: 20, rotation: 0, includeInExport: false, props: { content: 'DROP', fontHeight: 30, fontWidth: 0, rotation: 'N', reverse: false } },
    // Casting around the registry's discriminated union; the generator only
    // reads obj.type / obj.includeInExport / obj.comment, the shape per type
    // is exercised by registry tests.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    const zpl = generateZPL(BASE_LABEL, objs);
    expect(zpl).toContain('KEEP');
    expect(zpl).not.toContain('DROP');
  });
});

describe('generateZPL — printer params', () => {
  it('emits ^PR when printSpeed is set', () => {
    const zpl = generateZPL({ ...BASE_LABEL, printSpeed: 6 }, []);
    expect(zpl).toContain('^PR6');
  });

  it('omits ^PR when printSpeed is absent', () => {
    expect(generateZPL(BASE_LABEL, [])).not.toContain('^PR');
  });

  it('emits ^MD for darkness boundaries including 0', () => {
    expect(generateZPL({ ...BASE_LABEL, darkness: 0 }, [])).toContain('^MD0');
    expect(generateZPL({ ...BASE_LABEL, darkness: 30 }, [])).toContain('^MD30');
    expect(generateZPL({ ...BASE_LABEL, darkness: -30 }, [])).toContain('^MD-30');
  });

  it('omits ^MD when darkness is absent', () => {
    expect(generateZPL(BASE_LABEL, [])).not.toContain('^MD');
  });

  it('emits ^MT for thermal transfer and direct thermal', () => {
    expect(generateZPL({ ...BASE_LABEL, mediaType: 'T' }, [])).toContain('^MTT');
    expect(generateZPL({ ...BASE_LABEL, mediaType: 'D' }, [])).toContain('^MTD');
  });

  it('emits ^PO for both orientations when explicitly set', () => {
    expect(generateZPL({ ...BASE_LABEL, printOrientation: 'I' }, [])).toContain('^POI');
    expect(generateZPL({ ...BASE_LABEL, printOrientation: 'N' }, [])).toContain('^PON');
  });

  it('omits ^PO when print orientation is absent', () => {
    expect(generateZPL(BASE_LABEL, [])).not.toContain('^PO');
  });

  const boxAt = (x: number, y: number): LabelObject => ({
    id: '1',
    type: 'box',
    x,
    y,
    rotation: 0,
    props: { width: 50, height: 20, thickness: 1, filled: false, color: 'B', rounding: 0 },
  });

  it('emits ^LH and shifts field FOs to compensate', () => {
    const zpl = generateZPL(
      { ...BASE_LABEL, labelHomeX: 20, labelHomeY: 10 },
      [boxAt(50, 80)],
    );
    expect(zpl).toContain('^LH20,10');
    expect(zpl).toContain('^FO30,70');
  });

  it('emits ^LT and shifts field Y to compensate', () => {
    const zpl = generateZPL({ ...BASE_LABEL, labelTop: 15 }, [boxAt(50, 80)]);
    expect(zpl).toContain('^LT15');
    expect(zpl).toContain('^FO50,65');
  });

  it('drops fields whose offset-adjusted origin would be negative', () => {
    // Clamping would silently relocate the box into the visible area,
    // breaking WYSIWYG; emitting negative ^FO is undefined per ZPL spec
    // and printer-dependent. The conservative choice is to omit the
    // field, analogous to a layer outside the artboard in a design tool.
    const zpl = generateZPL(
      { ...BASE_LABEL, labelHomeX: 30, labelHomeY: 20 },
      [boxAt(10, 5)],
    );
    expect(zpl).not.toContain('^GB');
    expect(zpl).not.toContain('^FO');
  });

  it('drops a field when only one axis would go negative', () => {
    // labelHomeY exceeds obj.y → y < 0 alone is enough to drop the leaf.
    const zpl = generateZPL(
      { ...BASE_LABEL, labelHomeX: 0, labelHomeY: 50 },
      [boxAt(100, 10)],
    );
    expect(zpl).not.toContain('^GB');
  });

  const ftBox = (y: number, height: number): LabelObject => ({
    id: 'ft', type: 'box', x: 0, y, rotation: 0, positionType: 'FT',
    props: { width: 50, height, thickness: 3, filled: false, color: 'B', rounding: 0 },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  it('keeps an ^FT graphic whose top-left dips negative but anchor stays valid', () => {
    // ^FT anchors at the bottom-left: top-left 80 - home 100 = -20, but the
    // emitted ^FT (top-left + height 40) lands at y=20, a valid field.
    const zpl = generateZPL({ ...BASE_LABEL, labelHomeY: 100 }, [ftBox(80, 40)]);
    expect(zpl).toContain('^FT0,20^GB50,40,');
  });

  it('still drops an ^FT graphic whose emitted anchor would be negative', () => {
    // anchor y = top-left 20 + height 40 - home 100 = -40 → off-label, dropped.
    const zpl = generateZPL({ ...BASE_LABEL, labelHomeY: 100 }, [ftBox(20, 40)]);
    expect(zpl).not.toContain('^GB');
  });

  it('keeps a right-justified ^FT image using its byte-padded ^GF width', () => {
    // widthDots 121 emits at 128 (byte boundary); right anchor x = 0 + 128 -
    // home 125 = 3 (valid). The unpadded 121 would read -4 and wrongly drop it.
    const ftImage: LabelObject = {
      id: 'im', type: 'image', x: 0, y: 100, rotation: 0, positionType: 'FT', fieldJustify: 'R',
      props: { imageId: '', widthDots: 121, heightDots: 60, threshold: 128,
        storedAs: { device: 'R', name: 'LOGO', embedInZpl: false } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const zpl = generateZPL({ ...BASE_LABEL, labelHomeX: 125 }, [ftImage]);
    expect(zpl).toContain('^FT3,160,1'); // x 0+128-125=3, y 100+60
    expect(zpl).toContain('^XG');
  });

  it('keeps a cached ^FT image using its aspect height, not a stale heightDots', () => {
    putImage({ id: 'imgC', name: 'c', dataUrl: 'data:,', width: 100, height: 200 });
    const ftImage: LabelObject = {
      id: 'imc', type: 'image', x: 0, y: 10, rotation: 0, positionType: 'FT',
      props: { imageId: 'imgC', widthDots: 120, heightDots: 10, threshold: 128, _gfaCache: '^GFA1,1,1,00' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    // aspect height = round(120 * 200/100) = 240; anchor y = 10 + 240 - home 200 = 50
    // (valid). The stale heightDots 10 would read 10 + 10 - 200 = -180 and wrongly drop.
    const zpl = generateZPL({ ...BASE_LABEL, labelHomeY: 200 }, [ftImage]);
    expect(zpl).toContain('^FT0,50');
    expect(zpl).toContain('^GFA'); // kept, not dropped
  });

  it('drops only the clipped children of a group, keeping the rest', () => {
    const group: GroupObject = {
      id: 'g1',
      type: 'group',
      x: 0,
      y: 0,
      rotation: 0,
      children: [boxAt(10, 5), boxAt(100, 100)],
    };
    const zpl = generateZPL(
      { ...BASE_LABEL, labelHomeX: 30, labelHomeY: 20 },
      [group],
    );
    // First child clips out, second survives at shifted FO.
    expect(zpl).toContain('^FO70,80');
    expect(zpl.match(/\^FO/g)?.length).toBe(1);
  });

  it('emits ^CF with width as third positional param', () => {
    expect(
      generateZPL(
        { ...BASE_LABEL, defaultFontId: 'A', defaultFontHeight: 30, defaultFontWidth: 20 },
        [],
      ),
    ).toContain('^CFA,30,20');
  });

  it('emits ^CF with empty middle slot when only id + width are set', () => {
    expect(
      generateZPL(
        { ...BASE_LABEL, defaultFontId: 'A', defaultFontWidth: 20 },
        [],
      ),
    ).toContain('^CFA,,20');
  });

  it('emits ^CF with two empty slots when only width is set', () => {
    expect(
      generateZPL({ ...BASE_LABEL, defaultFontWidth: 20 }, []),
    ).toContain('^CF,,20');
  });

  it('trims trailing empty ^CF slots', () => {
    const zpl = generateZPL({ ...BASE_LABEL, defaultFontId: 'A' }, []);
    expect(zpl).toContain('^CFA');
    expect(zpl).not.toContain('^CFA,');
  });

  it('emits one ^CW per custom font mapping', () => {
    const zpl = generateZPL(
      {
        ...BASE_LABEL,
        customFonts: [
          { alias: 'M', path: 'E:ARIAL.TTF' },
          { alias: 'B', path: 'E:BOLD.TTF' },
        ],
      },
      [],
    );
    expect(zpl).toContain('^CWM,E:ARIAL.TTF');
    expect(zpl).toContain('^CWB,E:BOLD.TTF');
  });

  it('omits ^CW when customFonts is absent or empty', () => {
    expect(generateZPL(BASE_LABEL, [])).not.toContain('^CW');
    expect(
      generateZPL({ ...BASE_LABEL, customFonts: [] }, []),
    ).not.toContain('^CW');
  });

  it('emits ~DY before ^XA when embedInZpl is true and bytes are cached', async () => {
    const { loadFontBytes, removeFont } = await import('@zplab/core/lib/fontCache');
    // Tiny fake TTF; content does not need to be valid for the emit
    // path to pick up the bytes; the formatter just hex-encodes them.
    const bytes = new Uint8Array([0x00, 0x01, 0xff, 0xab]);
    await loadFontBytes(bytes, 'EMBED.TTF');
    try {
      const zpl = generateZPL(
        {
          ...BASE_LABEL,
          customFonts: [
            {
              alias: 'M',
              path: 'E:EMBED.TTF',
              previewFontName: 'EMBED.TTF',
              embedInZpl: true,
            },
          ],
        },
        [],
      );
      const dyIdx = zpl.indexOf('~DY');
      const xaIdx = zpl.indexOf('^XA');
      expect(dyIdx).toBeGreaterThanOrEqual(0);
      expect(dyIdx).toBeLessThan(xaIdx);
      // ~DYE:EMBED,A,T,4,,0001FFAB: stem strips the extension, ext code
      // is T (TTF), bytes count is the original length, hex is uppercase.
      expect(zpl).toContain('~DYE:EMBED,A,T,4,,0001FFAB');
    } finally {
      removeFont('EMBED.TTF');
    }
  });

  it('skips ~DY when embedInZpl is false', () => {
    const zpl = generateZPL(
      {
        ...BASE_LABEL,
        customFonts: [
          { alias: 'M', path: 'E:X.TTF', previewFontName: 'X.TTF' },
        ],
      },
      [],
    );
    expect(zpl).not.toContain('~DY');
  });

  it('round-trips embedInZpl: ~DY emit → ~DY parse preserves the flag', async () => {
    const { loadFontBytes, removeFont } = await import('@zplab/core/lib/fontCache');
    const bytes = new Uint8Array([0xab, 0xcd, 0xef, 0x12]);
    await loadFontBytes(bytes, 'ROUND.TTF');
    try {
      const zpl = generateZPL(
        {
          ...BASE_LABEL,
          customFonts: [
            {
              alias: 'M',
              path: 'E:ROUND.TTF',
              previewFontName: 'ROUND.TTF',
              embedInZpl: true,
            },
          ],
        },
        [],
      );
      const { labelConfig } = parseSingle(zpl, 8);
      const m = labelConfig.customFonts?.[0];
      expect(m?.alias).toBe('M');
      expect(m?.path).toBe('E:ROUND.TTF');
      expect(m?.embedInZpl).toBe(true);
      expect(m?.previewFontName).toBe('ROUND.TTF');
    } finally {
      removeFont('ROUND.TTF');
    }
  });

  it('skips ~DY when bytes are not cached', () => {
    const zpl = generateZPL(
      {
        ...BASE_LABEL,
        customFonts: [
          {
            alias: 'M',
            path: 'E:MISSING.TTF',
            previewFontName: 'MISSING.TTF',
            embedInZpl: true,
          },
        ],
      },
      [],
    );
    expect(zpl).not.toContain('~DY');
  });

  it('skips ^CW entries with empty alias or path', () => {
    const zpl = generateZPL(
      {
        ...BASE_LABEL,
        customFonts: [
          { alias: '', path: 'E:ORPHAN.TTF' },
          { alias: 'A', path: '' },
          { alias: 'B', path: 'E:OK.TTF' },
        ],
      },
      [],
    );
    expect(zpl).not.toContain('^CW,');
    expect(zpl).not.toContain('^CWA,\n');
    expect(zpl).toContain('^CWB,E:OK.TTF');
  });

  it.each(['N', 'R', 'I', 'B'] as const)(
    'rewrites ^A@%s to ^A{alias} when a matching ^CW mapping exists',
    (rotation) => {
      const text: LabelObject = {
        id: 't1',
        type: 'text',
        x: 10,
        y: 10,
        rotation: 0,
        props: {
          content: 'hi',
          rotation,
          fontHeight: 30,
          fontWidth: 0,
          printerFontName: 'ARIAL.TTF',
        },
      };
      const zpl = generateZPL(
        {
          ...BASE_LABEL,
          customFonts: [{ alias: 'M', path: 'E:ARIAL.TTF' }],
        },
        [text],
      );
      expect(zpl).toContain('^CWM,E:ARIAL.TTF');
      expect(zpl).toContain(`^AM${rotation},30,0`);
      expect(zpl).not.toContain(`^A@${rotation},30,0,E:ARIAL.TTF`);
    },
  );

  it('rewrites ^A@ refs across any drive prefix the path uses', () => {
    // The path is whatever the customFonts entry stores. Even if our
    // text emit only ever writes E:, an imported label could carry
    // R: / A: / B: paths that still need to be matched on re-emit.
    const rRef = '^XA^FO0,0^A@N,30,0,R:FOO.TTF^FDhi^FS^XZ';
    const aliasByPath: Record<string, string> = { 'R:FOO.TTF': 'Q' };
    const rewritten = rRef.replace(
      /\^A@([NIRB]),(\d+),(\d+),([A-Z]:[^^\n]+?)(?=\^|\n|$)/g,
      (full, rot, h, w, path) => {
        const alias = aliasByPath[path];
        return alias ? `^A${alias}${rot},${h},${w}` : full;
      },
    );
    expect(rewritten).toContain('^AQN,30,0');
    expect(rewritten).not.toContain('^A@N,30,0,R:FOO.TTF');
  });

  it('leaves ^A@ verbose when no matching ^CW alias is defined', () => {
    const text: LabelObject = {
      id: 't1',
      type: 'text',
      x: 10,
      y: 10,
      rotation: 0,
      props: {
        content: 'hi',
        rotation: 'N',
        fontHeight: 30,
        fontWidth: 0,
        printerFontName: 'ORPHAN.TTF',
      },
    };
    const zpl = generateZPL(
      {
        ...BASE_LABEL,
        customFonts: [{ alias: 'M', path: 'E:OTHER.TTF' }],
      },
      [text],
    );
    expect(zpl).toContain('^A@N,30,0,E:ORPHAN.TTF');
    expect(zpl).not.toContain('^AMN,30,0');
  });

  it('emits ^PM when mirror is set', () => {
    expect(generateZPL({ ...BASE_LABEL, mirror: 'Y' }, [])).toContain('^PMY');
    expect(generateZPL({ ...BASE_LABEL, mirror: 'N' }, [])).toContain('^PMN');
    expect(generateZPL(BASE_LABEL, [])).not.toContain('^PM');
  });

  it('emits ~SD before ^XA with zero-padded value', () => {
    const zpl = generateZPL({ ...BASE_LABEL, instantDarkness: 7 }, []);
    expect(zpl.startsWith('~SD07\n^XA')).toBe(true);
    expect(generateZPL({ ...BASE_LABEL, instantDarkness: 30 }, []))
      .toContain('~SD30');
  });

  it('emits ~JS before ^XA for backfeed sequence', () => {
    const zpl = generateZPL({ ...BASE_LABEL, backfeedSequence: 'B' }, []);
    expect(zpl).toContain('~JSB');
    expect(zpl.indexOf('~JSB')).toBeLessThan(zpl.indexOf('^XA'));
  });

  it('emits ~JS percent form and round-trips it', () => {
    const zpl = generateZPL({ ...BASE_LABEL, backfeedSequence: 40 }, []);
    expect(zpl).toContain('~JS40');
    expect(parseZPL(zpl, 8).labelConfig.backfeedSequence).toBe(40);
  });

  it('emits ^PR when only slew or backfeed is set (printSpeed undefined)', () => {
    expect(generateZPL({ ...BASE_LABEL, slewSpeed: 8 }, [])).toContain('^PR8');
    // backfeed-only: ZPL has no positional skip, so slew slot repeats the
    // (defaulted) print speed. Documented asymmetry; see roundtrip test.
    expect(
      generateZPL({ ...BASE_LABEL, backfeedSpeed: 4 }, []),
    ).toContain('^PR4,4,4');
  });

  it('emits ^PR with slew and backfeed when set', () => {
    expect(
      generateZPL({ ...BASE_LABEL, printSpeed: 6, slewSpeed: 8 }, []),
    ).toContain('^PR6,8');
    // backfeed without slew → slew defaults to printSpeed so position is
    // preserved.
    expect(
      generateZPL({ ...BASE_LABEL, printSpeed: 6, backfeedSpeed: 4 }, []),
    ).toContain('^PR6,6,4');
    expect(
      generateZPL(
        { ...BASE_LABEL, printSpeed: 6, slewSpeed: 8, backfeedSpeed: 4 },
        [],
      ),
    ).toContain('^PR6,8,4');
  });

  it('^PR backfeed-only does not roundtrip cleanly (slew gets populated)', () => {
    // Documented asymmetry: ZPL has no positional skip, so on emit the slew
    // slot is filled with the print speed. On reparse, slewSpeed becomes
    // defined even though it was undefined in the source. If this is ever
    // changed to a normaliser-on-input approach, update both the generator
    // and this test.
    const original: LabelConfig = {
      ...BASE_LABEL,
      printSpeed: 6,
      backfeedSpeed: 4,
    };
    const zpl = generateZPL(original, []);
    const { labelConfig } = parseSingle(zpl, 8);
    expect(labelConfig.printSpeed).toBe(6);
    expect(labelConfig.slewSpeed).toBe(6);
    expect(labelConfig.backfeedSpeed).toBe(4);
  });

  it('emits ^PQ with extended params when any are set', () => {
    expect(
      generateZPL({ ...BASE_LABEL, printQuantity: 5, pauseCount: 2 }, []),
    ).toContain('^PQ5,2,0,N');
    expect(
      generateZPL(
        { ...BASE_LABEL, printQuantity: 1, replicates: 3 },
        [],
      ),
    ).toContain('^PQ1,0,3,N');
    expect(
      generateZPL({ ...BASE_LABEL, overridePauseCount: 'Y' }, []),
    ).toContain('^PQ1,0,0,Y');
  });

  it('emits ^CF when both defaultFontId and defaultFontHeight are set', () => {
    const zpl = generateZPL(
      { ...BASE_LABEL, defaultFontId: '0', defaultFontHeight: 30 },
      [],
    );
    expect(zpl).toContain('^CF0,30');
  });

  it('emits ^CF{id} when only defaultFontId is set', () => {
    const zpl = generateZPL({ ...BASE_LABEL, defaultFontId: '0' }, []);
    expect(zpl).toContain('^CF0');
    expect(zpl).not.toContain('^CF0,');
  });

  it('emits ^CF,{height} when only defaultFontHeight is set', () => {
    expect(generateZPL({ ...BASE_LABEL, defaultFontHeight: 30 }, []))
      .toContain('^CF,30');
  });

  it('omits ^CF when neither defaultFont field is set', () => {
    expect(generateZPL(BASE_LABEL, [])).not.toContain('^CF');
  });

  it('emits printer params in canonical header order before ^LS', () => {
    const zpl = generateZPL(
      {
        ...BASE_LABEL,
        mediaMode: 'T',
        mediaType: 'T',
        printSpeed: 6,
        darkness: 10,
        printOrientation: 'I',
        defaultFontId: '0',
        defaultFontHeight: 30,
        labelShift: 5,
      },
      [],
    );
    const idx = (cmd: string) => zpl.indexOf(cmd);
    expect(idx('^MMT')).toBeLessThan(idx('^MTT'));
    expect(idx('^MTT')).toBeLessThan(idx('^PR6'));
    expect(idx('^PR6')).toBeLessThan(idx('^MD10'));
    expect(idx('^MD10')).toBeLessThan(idx('^POI'));
    // Geometry offsets (^LH/^LT/^LS) group before the default font (^CF)
    // so the header reads media → printer params → geometry → font.
    expect(idx('^POI')).toBeLessThan(idx('^LS5'));
    expect(idx('^LS5')).toBeLessThan(idx('^CF0,30'));
  });
});

describe('generateZPL — text object', () => {
  it('emits ^FO, ^A0 and ^FD for a text object', () => {
    const { objects } = parseSingle('^XA^FO10,20^A0N,30,0^FDHello^FS^XZ', 8);
    const zpl = generateZPL(BASE_LABEL, objects);
    expect(zpl).toContain('^FO10,20');
    expect(zpl).toContain('^A0N,30,0');
    expect(zpl).toContain('^FDHello^FS');
  });
});

describe('generateZPL — ^FP field-direction modifier', () => {
  it('omits ^FP for the default horizontal layout', () => {
    const { objects } = parseSingle('^XA^FO10,20^A0N,30,0^FDHello^FS^XZ', 8);
    expect(generateZPL(BASE_LABEL, objects)).not.toContain('^FP');
  });

  it('emits ^FPV,0 for vertical text', () => {
    const { objects } = parseSingle('^XA^FO10,20^A0N,30,30^FPV^FDABC^FS^XZ', 8);
    const zpl = generateZPL(BASE_LABEL, objects);
    expect(zpl).toContain('^FPV,0');
    expect(zpl.indexOf('^FPV')).toBeLessThan(zpl.indexOf('^A0'));
  });

  it('emits gap on horizontal layout when only ^FP,g was set', () => {
    const { objects } = parseSingle('^XA^FO10,20^A0N,30,30^FP,4^FDABC^FS^XZ', 8);
    const zpl = generateZPL(BASE_LABEL, objects);
    expect(zpl).toContain('^FPH,4');
  });

  it('round-trips ^FPV,2 through parser + generator', () => {
    const original = '^XA^FO50,50^A0N,30,30^FPV,2^FDABC^FS^XZ';
    const { objects } = parseSingle(original, 8);
    const zpl = generateZPL(BASE_LABEL, objects);
    expect(zpl).toContain('^FPV,2');
    expect(zpl).toContain('^FDABC');
  });
});

describe('generateZPL — ^TB text block', () => {
  it('emits ^TB{rot},{w},{h} for a text-block object', () => {
    const { objects } = parseSingle('^XA^A0N,30^FO0,0^TBN,400,120^FDText block^FS^XZ', 8);
    const zpl = generateZPL(BASE_LABEL, objects);
    expect(zpl).toContain('^TBN,400,120');
    expect(zpl).not.toContain('^FB');
  });

  it('round-trips ^TB (native, no lossy collapse to ^FB)', () => {
    const original = '^XA^A0N,30^FO0,0^TBN,400,120^FDText block^FS^XZ';
    const { objects } = parseSingle(original, 8);
    const zpl = generateZPL(BASE_LABEL, objects);
    const { objects: reparsed } = parseSingle(zpl, 8);
    expect(props(reparsed[0]).textMode).toBe('tb');
    expect(props(reparsed[0]).blockWidth).toBe(400);
    expect(props(reparsed[0]).blockHeight).toBe(120);
    expect(props(reparsed[0]).content).toBe('Text block');
  });

  it('round-trips an FT-anchored ^TB position (extent uses blockHeight)', () => {
    const original = '^XA^A0N,30^FT400,150^TBN,300,90^FDsample^FS^XZ';
    const a = parseSingle(original, 8);
    const z = generateZPL(BASE_LABEL, a.objects);
    const b = parseSingle(z, 8);
    expect(props(b.objects[0]).blockHeight).toBe(90);
    // Position must survive the FT extent round-trip unchanged.
    expect(b.objects[0]?.x).toBe(a.objects[0]?.x);
    expect(b.objects[0]?.y).toBe(a.objects[0]?.y);
    expect(z).toContain('^FT400,150');
  });

  it('does not re-escape a ^TB clock token when content forces the < time char', () => {
    // A literal `{` makes the clock time-char fall to `<`; the substituted
    // token must survive, not get re-escaped to `<<>` (post-substitution
    // encoding regression).
    const obj: LabelObject = {
      id: 't', type: 'text', x: 0, y: 0, rotation: 0,
      props: { content: '«clock:H»{', fontHeight: 30, fontWidth: 0, rotation: 'N', textMode: 'tb', blockWidth: 300, blockHeight: 60 },
    };
    const zpl = generateZPL(BASE_LABEL, [obj]);
    expect(zpl).toContain('^FC');
    expect(zpl).not.toContain('<<>H');
  });

  it('round-trips ^TBR (R-rotation anchor path)', () => {
    const original = '^XA^A0R,30^FO100,40^TBR,200,90^FDrotated block sample^FS^XZ';
    const a = parseSingle(original, 8);
    const z = generateZPL(BASE_LABEL, a.objects);
    const b = parseSingle(z, 8);
    expect(props(b.objects[0]).textMode).toBe('tb');
    expect(props(b.objects[0]).blockHeight).toBe(90);
    expect(props(b.objects[0]).rotation).toBe('R');
    expect(b.objects[0]?.x).toBe(a.objects[0]?.x);
    expect(b.objects[0]?.y).toBe(a.objects[0]?.y);
  });

  it('escapes < in a bound variable default for ^TB (no field-swallow)', () => {
    const variable = { id: 'v1', name: 'n', fnNumber: 4, defaultValue: 'a<b' };
    const obj: LabelObject = {
      id: 't', type: 'text', x: 0, y: 0, rotation: 0,
      props: { content: '«n»', fontHeight: 30, fontWidth: 0, rotation: 'N', textMode: 'tb', blockWidth: 300, blockHeight: 60 },
    };
    const zpl = generateZPL(BASE_LABEL, [obj], [variable]);
    expect(zpl).toContain('^FN4');
    expect(zpl).toContain('a<<>b');
    expect(zpl).not.toContain('^FDa<b');
    // Round-trip: parser must decode the bound default back to the plain value
    // (not the encoded form) so re-emit is byte-identical (no drift).
    const reparsed = parseSingle(zpl, 8);
    expect(defined(reparsed.variables[0]).defaultValue).toBe('a<b');
    expect(generateZPL(BASE_LABEL, reparsed.objects, reparsed.variables)).toBe(zpl);
  });

  // Byte-stability guard for the variableId->content refactor (plan stages 1-4):
  // single-bind emits an inline ^FN, a template field uses ^FE embeds, and the
  // header declares only the template-only fns (single-bind fn1 is deduped out).
  // This exact string must survive each stage that reworks emit/parse.
  it('GOLDEN: single-bind inline + template embeds with deduped header', () => {
    const vars = [
      { id: 'v1', name: 'sku', fnNumber: 1, defaultValue: 'DEF' },
      { id: 'v2', name: 'lot', fnNumber: 7, defaultValue: 'L7' },
    ];
    const single = {
      id: 'a', type: 'text', x: 10, y: 10, rotation: 0,
      props: { content: '«sku»', fontHeight: 30, fontWidth: 0, rotation: 'N' },
    } as unknown as LabelObject;
    const template = {
      id: 'b', type: 'text', x: 10, y: 50, rotation: 0,
      props: { content: '«sku»-«lot»', fontHeight: 30, fontWidth: 0, rotation: 'N' },
    } as unknown as LabelObject;
    const zpl = generateZPL(BASE_LABEL, [single, template], vars);
    expect(zpl).toMatchInlineSnapshot(`
      "^XA
      ^FXZPLLAB:{"dpmm":8,"wMm":100,"hMm":50}^FS
      ^PW800
      ^LL400
      ^CI28
      ^FN7^FDL7^FS
      ^FO10,15^A0N,30,0^FN1^FDDEF^FS
      ^FO10,55^A0N,30,0^FE#^FD#1#-#7#^FS
      ^XZ"
    `);
  });

  it('single-marker content emits inline ^FN once, never also in header', () => {
    const vars = [{ id: 'v1', name: 'sku', fnNumber: 1, defaultValue: 'DEF' }];
    const byContent = {
      id: 'a', type: 'text', x: 10, y: 10, rotation: 0,
      props: { content: '«sku»', fontHeight: 30, fontWidth: 0, rotation: 'N' },
    } as unknown as LabelObject;
    const out = generateZPL(BASE_LABEL, [byContent], vars);
    expect(out).toContain('^FN1^FDDEF^FS');
    expect(out.match(/\^FN1/g)?.length).toBe(1); // inline only, never also in header
  });

  // ZD230-verified (2026-07-10, ^IS/^HY firmware renders): without a ^FE
  // immediately before the ^FD, #n# embeds print LITERALLY even for the
  // default char (spec p.191); same for ^FC clock tokens (spec p.189).
  it('arms ^FE directly before a template ^FD, even for the default char', () => {
    const vars = [
      { id: 'v1', name: 'sku', fnNumber: 1, defaultValue: 'DEF' },
      { id: 'v2', name: 'lot', fnNumber: 7, defaultValue: 'L7' },
    ];
    const template = {
      id: 'b', type: 'text', x: 10, y: 50, rotation: 0,
      props: { content: '«sku»-«lot»', fontHeight: 30, fontWidth: 0, rotation: 'N' },
    } as unknown as LabelObject;
    const zpl = generateZPL(BASE_LABEL, [template], vars);
    expect(zpl).toContain('^FE#^FD#1#-#7#^FS');
  });

  it('arms ^FC directly before a clock ^FD, even for default chars', () => {
    const obj = {
      id: 'c', type: 'text', x: 10, y: 10, rotation: 0,
      props: { content: '«clock:Y»', fontHeight: 30, fontWidth: 0, rotation: 'N' },
    } as unknown as LabelObject;
    const zpl = generateZPL(BASE_LABEL, [obj]);
    expect(zpl).toMatch(/\^FC%,\{,#\^FD%Y\^FS/);
  });

  it('arms ^FC then ^FE when a field mixes clock tokens and embeds', () => {
    // Order is firmware-verified: ^FC%^FE#^FD expands both (check 07 field 1).
    const vars = [{ id: 'v1', name: 'sku', fnNumber: 1, defaultValue: 'DEF' }];
    const obj = {
      id: 'm', type: 'text', x: 10, y: 10, rotation: 0,
      props: { content: '«sku» «clock:Y»', fontHeight: 30, fontWidth: 0, rotation: 'N' },
    } as unknown as LabelObject;
    const zpl = generateZPL(BASE_LABEL, [obj], vars);
    expect(zpl).toMatch(/\^FC%,\{,#\^FE#\^FD#1# %Y\^FS/);
  });

  it('round-trips a reverse ^TB (bare ^FR, no box, even h < fontHeight)', () => {
    for (const blockHeight of [90, 5]) {
      const obj: LabelObject = {
        id: 't', type: 'text', x: 10, y: 10, rotation: 0,
        props: { content: 'rev', fontHeight: 30, fontWidth: 0, rotation: 'N', reverse: true, textMode: 'tb', blockWidth: 200, blockHeight },
      };
      const zpl = generateZPL(BASE_LABEL, [obj]);
      const { objects } = parseSingle(zpl, 8);
      // ^FR + ^TB emits no background box, so it re-imports as ONE reverse text.
      expect(objects).toHaveLength(1);
      expect(objects[0]?.type).toBe('text');
      expect(props(objects[0]).reverse).toBe(true);
      expect(props(objects[0]).textMode).toBe('tb');
      expect(props(objects[0]).blockHeight).toBe(blockHeight);
    }
  });

  it('round-trips a literal < through the <<> escape', () => {
    const obj = {
      id: 't1', type: 'text' as const, x: 0, y: 0, rotation: 0,
      props: { content: 'A<B', fontHeight: 30, fontWidth: 0, rotation: 'N' as const, textMode: 'tb' as const, blockWidth: 300, blockHeight: 60 },
    };
    const zpl = generateZPL(BASE_LABEL, [obj as unknown as LabelObject]);
    expect(zpl).toContain('^FDA<<>B');
    const { objects } = parseSingle(zpl, 8);
    expect(props(objects[0]).content).toBe('A<B');
  });
});

describe('generateZPL — box object', () => {
  it('emits ^GB for a box object', () => {
    const { objects } = parseSingle('^XA^FO10,20^GB200,100,3,B,0^FS^XZ', 8);
    const zpl = generateZPL(BASE_LABEL, objects);
    expect(zpl).toContain('^GB200,100,3,B,0');
  });
});

describe('generateZPL — line object', () => {
  it('emits a horizontal ^GB line', () => {
    const { objects } = parseSingle('^XA^FO0,0^GB700,3,3^FS^XZ', 8);
    const zpl = generateZPL(BASE_LABEL, objects);
    expect(zpl).toContain('^GB700,3,3');
  });
});

describe('generateZPL — ~DY graphic upload + ^XG recall', () => {
  it('round-trips a ~DY+^XG label: parse → generate emits both back', () => {
    const HEX = '00FFFF00';
    const zpl =
      `~DYR:LOGO,A,G,4,1,${HEX}\n` +
      `^XA^FO50,80^XGR:LOGO.GRF,1,1^FS^XZ`;
    const parsed = parseSingle(zpl, 8);
    const out = generateZPL(BASE_LABEL, parsed.objects);
    // ~DY must precede ^XA so the printer has the file before ^XG references it.
    const dyAt = out.indexOf('~DYR:LOGO,A,G,4,1,');
    const xaAt = out.indexOf('^XA');
    const xgAt = out.indexOf('^XGR:LOGO.GRF,1,1');
    expect(dyAt).toBeGreaterThan(-1);
    expect(xaAt).toBeGreaterThan(dyAt);
    expect(xgAt).toBeGreaterThan(xaAt);
  });

  it('preserves the source format letter (A/B/C) on round-trip', () => {
    // A `~DY,C,G,...,:Z64:...` upload must NOT re-export as `~DY,A,G,...`:
    // Zebra firmware rejects format A with a :Z64: payload. The shared
    // cache uses ^GF{format} so the format letter survives both the GF
    // and DY round-trip paths.
    const bytes = new Uint8Array([0, 0xff, 0xff, 0]);
    const deflated = zlibSync(bytes);
    let bin = '';
    for (const b of deflated) bin += String.fromCharCode(b);
    const b64 = btoa(bin);
    function crc(s: string): string {
      let c = 0;
      for (const ch of s) {
        c ^= ch.charCodeAt(0) << 8;
        for (let j = 0; j < 8; j++)
          c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
      }
      return c.toString(16).padStart(4, '0').toUpperCase();
    }
    const zpl =
      `~DYR:CLOGO,C,G,4,1,:Z64:${b64}:${crc(b64)}\n` +
      `^XA^FO0,0^XGR:CLOGO.GRF,1,1^FS^XZ`;
    const parsed = parseSingle(zpl, 8);
    const out = generateZPL(BASE_LABEL, parsed.objects);
    expect(out).toContain('~DYR:CLOGO,C,G,');
    expect(out).not.toContain('~DYR:CLOGO,A,G,');
  });

  it('deduplicates the ~DY preamble when the same upload is referenced twice', () => {
    const HEX = '00FFFF00';
    const zpl =
      `~DYR:LOGO,A,G,4,1,${HEX}\n` +
      `^XA^FO10,10^XGR:LOGO.GRF,1,1^FS^FO10,200^XGR:LOGO.GRF,1,1^FS^XZ`;
    const parsed = parseSingle(zpl, 8);
    const out = generateZPL(BASE_LABEL, parsed.objects);
    const dyMatches = out.match(/~DYR:LOGO,/g) ?? [];
    const xgMatches = out.match(/\^XGR:LOGO\.GRF/g) ?? [];
    expect(dyMatches).toHaveLength(1);
    expect(xgMatches).toHaveLength(2);
  });
});

describe('generateZPL — code128 object', () => {
  it('emits ^BC and ^FD for a Code 128 barcode', () => {
    const { objects } = parseSingle('^XA^FO100,50^BCN,200,Y,N,N^FD12345678^FS^XZ', 8);
    const zpl = generateZPL(BASE_LABEL, objects);
    expect(zpl).toContain('^BC');
    expect(zpl).toContain('^FD12345678^FS');
  });
});

describe('generateMultiPageZPL', () => {
  it('emits one ^XA…^XZ block per page', () => {
    const zpl = generateMultiPageZPL(BASE_LABEL, [{ objects: [] }, { objects: [] }]);
    const matches = zpl.match(/\^XA/g) ?? [];
    expect(matches.length).toBe(2);
    expect(zpl.match(/\^XZ/g)?.length).toBe(2);
  });

  it('returns a single ^XA…^XZ block for a single page', () => {
    const zpl = generateMultiPageZPL(BASE_LABEL, [{ objects: [] }]);
    expect(zpl.match(/\^XA/g)?.length).toBe(1);
    expect(zpl.startsWith('^XA')).toBe(true);
    expect(zpl.endsWith('^XZ')).toBe(true);
  });

  it('returns an empty string when given an empty page list', () => {
    expect(generateMultiPageZPL(BASE_LABEL, [])).toBe('');
  });

  it('preserves per-page objects', () => {
    const { objects: page1 } = parseSingle('^XA^FO10,20^A0N,30,0^FDOne^FS^XZ', 8);
    const { objects: page2 } = parseSingle('^XA^FO50,60^A0N,30,0^FDTwo^FS^XZ', 8);
    const zpl = generateMultiPageZPL(BASE_LABEL, [{ objects: page1 }, { objects: page2 }]);
    expect(zpl).toContain('^FDOne^FS');
    expect(zpl).toContain('^FDTwo^FS');
  });
});

describe('generateZPL — parse/generate roundtrip', () => {
  it('preserves object count through a roundtrip', () => {
    const original = parseSingle('^XA^FO10,20^A0N,30,0^FDHello^FS^FO10,60^GB200,5,5^FS^XZ', 8);
    const regenerated = generateZPL(BASE_LABEL, original.objects);
    const reparsed = parseSingle(regenerated, 8);
    expect(reparsed.objects).toHaveLength(original.objects.length);
  });

  it('round-trips ^MU muResampling pair through parser + generator', () => {
    const label = { ...BASE_LABEL, muResampling: { formatDpi: 200, outputDpi: 600 } as const };
    const regenerated = generateZPL(label, []);
    expect(regenerated).toContain('^MUD,200,600');
    const reparsed = parseSingle(regenerated, 8);
    expect(reparsed.labelConfig.muResampling).toEqual({ formatDpi: 200, outputDpi: 600 });
  });

  it('emits gs1databar magnification into both ^BY and ^BR slots', () => {
    const objs = [{
      id: 'g1', type: 'gs1databar', x: 0, y: 0, rotation: 0,
      props: { content: '0112345678901', magnification: 5, symbology: 1 as const, rotation: 'N' as const },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }] as any;
    const zpl = generateZPL(BASE_LABEL, objs);
    expect(zpl).toContain('^BY5');
    expect(zpl).toContain('^BRN,1,5,2,');
    const reparsed = parseSingle(zpl, 8);
    expect(props(reparsed.objects[0]).magnification).toBe(5);
  });

  it('preserves text content through a roundtrip', () => {
    const original = parseSingle('^XA^FO10,20^A0N,30,0^FDHello World^FS^XZ', 8);
    const regenerated = generateZPL(BASE_LABEL, original.objects);
    const reparsed = parseSingle(regenerated, 8);
    const textObj = defined(reparsed.objects.find((o) => o.type === 'text'));
    expect(props(textObj).content).toBe('Hello World');
  });

  it('preserves barcode content and height through a roundtrip', () => {
    const original = parseSingle('^XA^FO50,50^BCN,150,Y,N,N^FD987654^FS^XZ', 8);
    const regenerated = generateZPL(BASE_LABEL, original.objects);
    const reparsed = parseSingle(regenerated, 8);
    const barcode = defined(reparsed.objects.find((o) => o.type === 'code128'));
    expect(props(barcode).content).toBe('987654');
    expect(props(barcode).height).toBe(150);
  });

  it('round-trips a ^BS UPC/EAN extension (5-digit)', () => {
    const original = parseSingle('^XA^FO10,10^BSN,80,Y^FD54321^FS^XZ', 8);
    const regenerated = generateZPL(BASE_LABEL, original.objects);
    const reparsed = parseSingle(regenerated, 8);
    const ext = defined(reparsed.objects.find((o) => o.type === 'upcEanExtension'));
    expect(props(ext).content).toBe('54321');
    expect(props(ext).height).toBe(80);
    expect(props(ext).printInterpretation).toBe(true);
  });

  it('round-trips a ^BS UPC/EAN extension (2-digit)', () => {
    const original = parseSingle('^XA^FO10,10^BSN,50,N^FD42^FS^XZ', 8);
    const regenerated = generateZPL(BASE_LABEL, original.objects);
    const reparsed = parseSingle(regenerated, 8);
    const ext = defined(reparsed.objects.find((o) => o.type === 'upcEanExtension'));
    expect(props(ext).content).toBe('42');
    expect(props(ext).printInterpretation).toBe(false);
  });

  it('round-trips ^BS rotation and moduleWidth (via ^BY)', () => {
    const original = parseSingle('^XA^BY3^FO10,10^BSR,80,Y^FD12345^FS^XZ', 8);
    const regenerated = generateZPL(BASE_LABEL, original.objects);
    const reparsed = parseSingle(regenerated, 8);
    const ext = defined(reparsed.objects.find((o) => o.type === 'upcEanExtension'));
    expect(props(ext).rotation).toBe('R');
    expect(props(ext).moduleWidth).toBe(3);
  });

  it('round-trips a ^B4 Code 49 with default mode A', () => {
    const original = parseSingle('^XA^FO10,10^B4N,20,Y,A^FDCODE49^FS^XZ', 8);
    const regenerated = generateZPL(BASE_LABEL, original.objects);
    const reparsed = parseSingle(regenerated, 8);
    const bc = defined(reparsed.objects.find((o) => o.type === 'code49'));
    expect(props(bc).content).toBe('CODE49');
    expect(props(bc).height).toBe(20);
    expect(props(bc).printInterpretation).toBe(true);
    expect(props(bc).mode).toBe('A');
  });

  it('round-trips ^B4 explicit mode + rotation + moduleWidth', () => {
    const original = parseSingle('^XA^BY3^FO10,10^B4R,30,N,2^FD12345^FS^XZ', 8);
    const regenerated = generateZPL(BASE_LABEL, original.objects);
    const reparsed = parseSingle(regenerated, 8);
    const bc = defined(reparsed.objects.find((o) => o.type === 'code49'));
    expect(props(bc).rotation).toBe('R');
    expect(props(bc).moduleWidth).toBe(3);
    expect(props(bc).mode).toBe('2');
    expect(props(bc).printInterpretation).toBe(false);
  });

  it('falls back to mode A when ^B4 receives an unknown mode', () => {
    const r = parseSingle('^XA^FO10,10^B4N,20,Y,X^FDCODE49^FS^XZ', 8);
    const bc = defined(r.objects.find((o) => o.type === 'code49'));
    expect(props(bc).mode).toBe('A');
  });

  it('parses ^FE inline FN embeds into «name» markers + auto-creates variables', () => {
    // The templated field references FN2 and FN3 inline; the parser
    // auto-creates the Variables when they don't already exist (same
    // bootstrap convention as the single-bind ^FN path).
    const r = parseSingle(
      '^XA^FO50,50^A0N,30,30^FE#^FD#2# and then #3#^FS^XZ',
      8,
    );
    expect(r.variables.map((v) => ({ fn: v.fnNumber, n: v.name })).sort((a, b) => a.fn - b.fn))
      .toEqual([
        { fn: 2, n: 'field_2' },
        { fn: 3, n: 'field_3' },
      ]);
    const text = defined(r.objects.find((o) => o.type === 'text'));
    expect(props(text).content).toBe('«field_2» and then «field_3»');
  });

  it('respects a custom ^FE embed character', () => {
    // ^FE@ redefines the embed delimiter, so `@1@` reads as the FN1
    // embed and the literal `#` survives untouched in the output.
    const r = parseSingle(
      '^XA^FE@^FO50,50^A0N,30,30^FDItem #@1@^FS^XZ',
      8,
    );
    const text = defined(r.objects.find((o) => o.type === 'text'));
    expect(props(text).content).toBe('Item #«field_1»');
  });

  it('round-trips a label that uses ^FE inline embeds', () => {
    const src = '^XA^FO50,50^A0N,30,30^FE#^FD#1#-#2#^FS^XZ';
    const original = parseSingle(src, 8);
    const regenerated = generateZPL(BASE_LABEL, original.objects, original.variables);
    const reparsed = parseSingle(regenerated, 8);
    const text = defined(reparsed.objects.find((o) => o.type === 'text'));
    expect(props(text).content).toBe('«field_1»-«field_2»');
    expect(reparsed.variables.map((v) => v.fnNumber).sort()).toEqual([1, 2]);
  });

  it('parses ^FD clock tokens into «clock:T» markers', () => {
    const r = parseSingle('^XA^FO50,50^A0N,30,30^FC%^FDDate %d/%m/%Y^FS^XZ', 8);
    const text = defined(r.objects.find((o) => o.type === 'text'));
    expect(props(text).content).toBe('Date «clock:d»/«clock:m»/«clock:Y»');
  });

  it('respects a custom ^FC clock char on parse', () => {
    const r = parseSingle('^XA^FC@^FO50,50^A0N,30,30^FDDate @d/@m/@Y^FS^XZ', 8);
    const text = defined(r.objects.find((o) => o.type === 'text'));
    expect(props(text).content).toBe('Date «clock:d»/«clock:m»/«clock:Y»');
  });

  it('round-trips a label with clock tokens (default chars)', () => {
    const src = '^XA^FO50,50^A0N,30,30^FC%^FD%d/%m/%Y %H:%M^FS^XZ';
    const original = parseSingle(src, 8);
    const regenerated = generateZPL(BASE_LABEL, original.objects);
    const reparsed = parseSingle(regenerated, 8);
    const text = defined(reparsed.objects.find((o) => o.type === 'text'));
    expect(props(text).content).toBe('«clock:d»/«clock:m»/«clock:Y» «clock:H»:«clock:M»');
    // ^FC must arm each clock field even for default chars (ZD230: %Y prints
    // literally without it), riding directly on the ^FD.
    expect(regenerated).toMatch(/\^FC%,\{,#\^FD/);
  });

  it('resets ^FC and ^FE state between sibling ^XA blocks', () => {
    // Two back-to-back labels: first overrides ^FC/^FE chars, second
    // uses defaults. Without an XA reset, the second label would
    // parse with the leaked chars and misinterpret default tokens.
    const r = parseZPL(
      '^XA^FC@^FE!^FO50,50^A0N,30,30^FD@d !1!^FS^XZ' +
      '^XA^FC^FE^FO50,50^A0N,30,30^FD%d #1#^FS^XZ',
      8,
    );
    // Second page arms with bare ^FC/^FE, so it decodes with the DEFAULT
    // chars; with the leak the parser would keep `@` and leave `%d` literal.
    const texts = r.pages.flatMap((p) => p.objects).filter((o) => o.type === 'text');
    expect(texts.length).toBeGreaterThanOrEqual(2);
    expect(props(defined(texts[1])).content).toContain('«clock:d»');
  });

  it('emits ^FC<alt> when payload contains a literal %', () => {
    const src = '^XA^FO50,50^A0N,30,30^FC%^FD100% match %Y^FS^XZ';
    const original = parseSingle(src, 8);
    const regenerated = generateZPL(BASE_LABEL, original.objects);
    expect(regenerated).toMatch(/\^FC\$/);
  });

  // Per-field ^FE/^FC arming (firmware scoping) must not desync the parser's
  // block-state model: a non-default delimiter also rides in the header so a
  // literal before the first armed field round-trips instead of mis-decoding.
  it('round-trips a literal #n# before a template field (non-default embed char)', () => {
    const vars = [{ id: 'v1', name: 'sku', fnNumber: 1, defaultValue: 'A#B' }];
    const literal = { id: 'a', type: 'text', x: 10, y: 10, rotation: 0,
      props: { content: 'lane #1# here', fontHeight: 30, fontWidth: 0, rotation: 'N' } } as unknown as LabelObject;
    const template = { id: 'b', type: 'text', x: 10, y: 50, rotation: 0,
      props: { content: '«sku» end', fontHeight: 30, fontWidth: 0, rotation: 'N' } } as unknown as LabelObject;
    const zpl = generateZPL(BASE_LABEL, [literal, template], vars);
    const back = parseSingle(zpl, 8);
    expect(props(defined(back.objects[0])).content).toBe('lane #1# here');
  });

  it('round-trips a literal %Y before a clock field (non-default clock char)', () => {
    const literal = { id: 'a', type: 'text', x: 10, y: 10, rotation: 0,
      props: { content: 'year %Y now', fontHeight: 30, fontWidth: 0, rotation: 'N' } } as unknown as LabelObject;
    const clock = { id: 'b', type: 'text', x: 10, y: 50, rotation: 0,
      props: { content: '«clock:Y» 100% done', fontHeight: 30, fontWidth: 0, rotation: 'N' } } as unknown as LabelObject;
    const zpl = generateZPL(BASE_LABEL, [literal, clock]);
    const back = parseSingle(zpl, 8);
    expect(props(defined(back.objects[0])).content).toBe('year %Y now');
  });

  it('round-trips ^SO2 offsets via labelConfig.secondaryClockOffset', () => {
    const src = '^XA^SO2,1,0,0,0,0,0^FO10,10^A0N,30,30^FC%,{,#^FD{Y-{m^FS^XZ';
    const r = parseSingle(src, 8);
    expect(r.labelConfig.secondaryClockOffset).toEqual({ months: 1 });
    const regenerated = generateZPL({ ...BASE_LABEL, ...r.labelConfig }, r.objects);
    expect(regenerated).toMatch(/\^SO2,1,0,0,0,0,0/);
    expect(regenerated).toMatch(/\{Y-\{m/);
  });

  it('round-trips ^SO3 offsets independently of ^SO2', () => {
    const src = '^XA^SO3,0,0,1,0,0,0^FO10,10^A0N,30,30^FC%,{,#^FD#Y^FS^XZ';
    const r = parseSingle(src, 8);
    expect(r.labelConfig.tertiaryClockOffset).toEqual({ years: 1 });
    expect(r.labelConfig.secondaryClockOffset).toBeUndefined();
    const regenerated = generateZPL({ ...BASE_LABEL, ...r.labelConfig }, r.objects);
    expect(regenerated).toMatch(/\^SO3,0,0,1,0,0,0/);
    expect(regenerated).not.toMatch(/\^SO2/);
  });

  it('drops the ^SO command for an all-zero offset on emit', () => {
    const regenerated = generateZPL(
      { ...BASE_LABEL, secondaryClockOffset: { months: 0, days: 0, years: 0 } },
      [],
    );
    expect(regenerated).not.toMatch(/\^SO/);
  });

  it('parses ^SO2 with all-zero values as a no-op (no offset stored)', () => {
    const r = parseSingle('^XA^SO2,0,0,0,0,0,0^FO10,10^A0N,30,30^FD{Y^FS^XZ', 8);
    expect(r.labelConfig.secondaryClockOffset).toBeUndefined();
  });

  it('rejects ^SO with clock# not in {2,3}', () => {
    const r = parseSingle('^XA^SO1,1,0,0,0,0,0^FO10,10^A0N,30,30^FDx^FS^XZ', 8);
    expect(r.labelConfig.secondaryClockOffset).toBeUndefined();
    expect(r.labelConfig.tertiaryClockOffset).toBeUndefined();
  });

  it('emits ^FE<alt> when payload contains a literal #', () => {
    // Pre-build state via the parser so variable ids are real.
    const r = parseSingle('^XA^FN1^FDfoo^FS^XZ', 8);
    const v = defined(r.variables[0]);
    const generated = generateZPL(BASE_LABEL, [
      {
        id: 'a',
        type: 'text',
        x: 10,
        y: 10,
        rotation: 0,
        props: {
          content: 'Item #«' + v.name + '»',
          fontHeight: 20,
          fontWidth: 0,
          rotation: 'N',
        },
      } as LabelObject,
    ], r.variables);
    // '#' is in the payload literal, so generator must switch to '@'.
    expect(generated).toMatch(/\^FE@/);
    expect(generated).toMatch(/\^FDItem #@1@\^FS/);
  });

  it('GS1 DataMatrix keeps the leading FNC1 for a single-marker (single-bind) field', () => {
    const variable = { id: 'v1', name: 'gtin', fnNumber: 5, defaultValue: '0109501101530003' };
    const obj: LabelObject = {
      id: 'd',
      type: 'datamatrix',
      x: 10,
      y: 10,
      rotation: 0,
      props: { content: '«gtin»', dimension: 8, quality: 200, rotation: 'N', gs1: true },
    };
    const zpl = generateZPL(BASE_LABEL, [obj], [variable]);
    // Content == one known marker is single-bind: inline ^FN with the FNC1 (_1)
    // prefixed default, not a template embed.
    expect(zpl).toContain('^FN5^FD_10109501101530003^FS');
  });

  it('UPC-E single-bind emits the ^FN default through fdContent (NS-prefixed)', () => {
    const variable = { id: 'v1', name: 'upc', fnNumber: 3, defaultValue: '654321' };
    const obj: LabelObject = {
      id: 'u',
      type: 'upce',
      x: 10,
      y: 10,
      props: {
        content: '«upc»',
        height: 100,
        moduleWidth: 2,
        printInterpretation: true,
        printInterpretationAbove: false,
        checkDigit: false,
        rotation: 'N',
      },
    } as unknown as LabelObject;
    const zpl = generateZPL(BASE_LABEL, [obj], [variable]);
    // The default value is compacted + NS-prefixed (fdContent), not emitted raw.
    expect(zpl).toContain('^FN3^FD0654321');
    expect(zpl).not.toContain('^FN3^FD654321^FS');
  });

  it('UPC-E template field preserves the embed (fdContent skipped, not digit-extracted)', () => {
    const variable = { id: 'v1', name: 'upc', fnNumber: 2, defaultValue: '123456' };
    const obj: LabelObject = {
      id: 'u',
      type: 'upce',
      x: 10,
      y: 10,
      props: {
        content: 'x«upc»', // literal + marker => template, not single-bind
        height: 100, moduleWidth: 2,
        printInterpretation: true, printInterpretationAbove: false, checkDigit: false, rotation: 'N',
      },
    } as unknown as LabelObject;
    const zpl = generateZPL(BASE_LABEL, [obj], [variable]);
    // The embed survives; the digit-only transform must not collapse it.
    expect(zpl).toMatch(/\^FDx#2#/);
  });

  it('single-bind default containing a marker is emitted literally (export == preview, ^FN kept)', () => {
    // outer is single-bound; its default literally contains «inner». Export must
    // NOT expand «inner» to an embed, and must keep outer's own ^FN.
    const outer = { id: 'v1', name: 'outer', fnNumber: 1, defaultValue: '«inner»' };
    const inner = { id: 'v2', name: 'inner', fnNumber: 7, defaultValue: 'L7' };
    const obj: LabelObject = {
      id: 't',
      type: 'text',
      x: 10,
      y: 10,
      props: { content: '«outer»', fontHeight: 30, fontWidth: 0, rotation: 'N' },
    } as unknown as LabelObject;
    const zpl = generateZPL(BASE_LABEL, [obj], [outer, inner]);
    expect(zpl).toContain('^FN1^FD«inner»');
    // inner's marker must not be resolved into an embed for this field.
    expect(zpl).not.toMatch(/\^FD#7#/);
  });

  it('QR single-bind keeps the {ec}A, prefix on the ^FN default', () => {
    const variable = { id: 'v1', name: 'url', fnNumber: 4, defaultValue: 'https://x.io' };
    const obj: LabelObject = {
      id: 'q',
      type: 'qrcode',
      x: 10,
      y: 10,
      props: { content: '«url»', magnification: 4, errorCorrection: 'Q', rotation: 'N' },
    } as unknown as LabelObject;
    const zpl = generateZPL(BASE_LABEL, [obj], [variable]);
    // Prefix composes with the binding; the default is not emitted raw.
    expect(zpl).toContain('^FN4^FDQA,https://x.io');
    expect(zpl).not.toContain('^FN4^FDhttps://x.io');
  });

  it('does not leak ^B4 mode from one symbol to the next', () => {
    // Two B4 fields back-to-back: first explicit mode=3, second omits
    // the mode parameter. The second must default to 'A' even though
    // the parser variable still holds '3' from the previous handler
    // run; the handler resets it on each B4 via the `?? "A"` fallback.
    const r = parseSingle(
      '^XA^FO10,10^B4N,20,Y,3^FDONE^FS^FO10,200^B4N,20,Y^FDTWO^FS^XZ',
      8,
    );
    const codes = r.objects.filter((o) => o.type === 'code49');
    expect(codes).toHaveLength(2);
    expect(props(codes[0]!).mode).toBe('3');
    expect(props(codes[1]!).mode).toBe('A');
  });

  it('preserves printer params through generate -> parse', () => {
    const label: LabelConfig = {
      ...BASE_LABEL,
      printSpeed: 8,
      darkness: 0,
      mediaType: 'D',
      printOrientation: 'I',
      defaultFontId: '0',
      defaultFontHeight: 30,
    };
    const regenerated = generateZPL(label, []);
    const { labelConfig } = parseSingle(regenerated, BASE_LABEL.dpmm);
    expect(labelConfig.printSpeed).toBe(8);
    expect(labelConfig.darkness).toBe(0);
    expect(labelConfig.mediaType).toBe('D');
    expect(labelConfig.printOrientation).toBe('I');
    expect(labelConfig.defaultFontId).toBe('0');
    expect(labelConfig.defaultFontHeight).toBe(30);
  });

  it('preserves partial ^CF (id only) through generate -> parse', () => {
    const regenerated = generateZPL({ ...BASE_LABEL, defaultFontId: 'A' }, []);
    const { labelConfig } = parseSingle(regenerated, BASE_LABEL.dpmm);
    expect(labelConfig.defaultFontId).toBe('A');
    expect(labelConfig.defaultFontHeight).toBeUndefined();
  });

  it('preserves partial ^CF (height only) through generate -> parse', () => {
    const regenerated = generateZPL({ ...BASE_LABEL, defaultFontHeight: 25 }, []);
    const { labelConfig } = parseSingle(regenerated, BASE_LABEL.dpmm);
    expect(labelConfig.defaultFontId).toBeUndefined();
    expect(labelConfig.defaultFontHeight).toBe(25);
  });
});

// ── groups ────────────────────────────────────────────────────────────────────

function textLeaf(id: string, content: string): LabelObject {
  return {
    id,
    type: 'text',
    x: 0,
    y: 0,
    rotation: 0,
    props: { content, fontHeight: 20, fontWidth: 0, font: '0', interpretation: false },
  } as unknown as LabelObject;
}

function group(id: string, children: LabelObject[], extras: Partial<GroupObject> = {}): GroupObject {
  return { id, type: 'group', x: 0, y: 0, rotation: 0, children, ...extras };
}

describe('generateZPL — groups', () => {
  it('emits a grouped leaf identically to an ungrouped one', () => {
    const leaf = textLeaf('a', 'Hi');
    const flat = generateZPL(BASE_LABEL, [leaf]);
    const wrapped = generateZPL(BASE_LABEL, [group('g', [leaf])]);
    expect(wrapped).toBe(flat);
  });

  it('skips the whole subtree when the group is excluded from export', () => {
    const leaf = textLeaf('a', 'Hi');
    const zpl = generateZPL(BASE_LABEL, [group('g', [leaf], { includeInExport: false })]);
    expect(zpl).not.toContain('Hi');
  });

  it('still respects per-leaf includeInExport inside an included group', () => {
    const visible = textLeaf('a', 'Visible');
    const hidden = { ...textLeaf('b', 'Hidden'), includeInExport: false } as LabelObject;
    const zpl = generateZPL(BASE_LABEL, [group('g', [visible, hidden])]);
    expect(zpl).toContain('Visible');
    expect(zpl).not.toContain('Hidden');
  });
});

describe('generateZPL — variable bindings', () => {
  const variable = {
    id: 'var-1',
    name: 'sku',
    fnNumber: 7,
    defaultValue: 'ABC-123',
  };

  const textObj = {
    id: 'obj-1',
    type: 'text',
    x: 50,
    y: 50,
    rotation: 0,
    props: {
      content: '«sku»',
      fontHeight: 30,
      fontWidth: 0,
      rotation: 'N',
    },
  } as unknown as LabelObject;

  it('emits ^FN{n} before the field and uses the variable default as ^FD payload', () => {
    const zpl = generateZPL(BASE_LABEL, [textObj], [variable]);
    expect(zpl).toContain('^FN7^FDABC-123^FS');
    // Single-bind: the marker is resolved to ^FN, not emitted literally.
    expect(zpl).not.toContain('«sku»');
  });

  it('emits the marker literally when no variables are supplied', () => {
    const zpl = generateZPL(BASE_LABEL, [textObj]);
    expect(zpl).toContain('«sku»');
    expect(zpl).not.toContain('^FN');
  });

  it('emits the marker literally when no variable matches the name (orphan)', () => {
    const zpl = generateZPL(BASE_LABEL, [textObj], [
      { ...variable, name: 'other' },
    ]);
    expect(zpl).toContain('«sku»');
    expect(zpl).not.toContain('^FN');
  });

  it('round-trips a bound text field through parse → variables stay consistent', () => {
    const out = generateZPL(BASE_LABEL, [textObj], [variable]);
    const { variables, objects } = parseSingle(out);
    expect(variables).toHaveLength(1);
    expect(variables[0]?.fnNumber).toBe(7);
    expect(variables[0]?.defaultValue).toBe('ABC-123');
    // New model: the field references the variable by its content marker. ZPL
    // carries only the ^FN number, so the name re-derives to field_7 on import.
    expect(props(objects[0]).content).toBe(`«${variables[0]?.name}»`);
  });

  it('parses ^FN single-bind to a content marker and re-emits inline byte-stable', () => {
    const { objects, variables } = parseSingle('^XA^FO10,20^A0N,30,30^FN5^FDABC^FS^XZ');
    expect(props(objects[0]).content).toBe('«field_5»');
    expect(variables[0]?.fnNumber).toBe(5);
    expect(variables[0]?.defaultValue).toBe('ABC');
    const out = generateZPL(BASE_LABEL, objects, variables);
    expect(out).toContain('^FN5^FDABC^FS');
    expect(out.match(/\^FN5/g)?.length).toBe(1); // inline only, no header dup
  });
});

describe('generateBatchZpl', () => {
  const baseLabel: LabelConfig = { widthMm: 50, heightMm: 30, dpmm: 8 };
  // Single-bind field: content is the variable's lone marker.
  const textObj = (markerName: string): LabelObject =>
    ({
      id: `obj-${markerName}`,
      type: 'text',
      x: 10,
      y: 10,
      rotation: 0,
      props: { content: `«${markerName}»`, fontHeight: 30, fontWidth: 0, rotation: 'N' },
    }) as unknown as LabelObject;

  it('emits ^DFR template + one ^XFR recall block per row', () => {
    const variables = [
      { id: 'v1', name: 'sku', fnNumber: 1, defaultValue: 'DEF' },
    ];
    const objects = [textObj('sku')];
    const dataset = {
      headers: ['sku'],
      rows: [['A1'], ['B2'], ['C3']],
    };
    const mapping = { bindings: { v1: 'sku' } };

    const result = generateBatchZpl(baseLabel, objects, variables, dataset, mapping);

    // Template stored exactly once
    expect((result.match(/\^DFR:LBL\.ZPL/g) || []).length).toBe(1);
    // Recall block per row
    expect((result.match(/\^XFR:LBL\.ZPL/g) || []).length).toBe(3);
    // Each row's value present as ^FN override
    expect(result).toContain('^FN1^FDA1^FS');
    expect(result).toContain('^FN1^FDB2^FS');
    expect(result).toContain('^FN1^FDC3^FS');
  });

  it('skips variables that are not in the mapping', () => {
    const variables = [
      { id: 'v1', name: 'sku', fnNumber: 1, defaultValue: '' },
      { id: 'v2', name: 'qty', fnNumber: 2, defaultValue: '' },
    ];
    const objects = [textObj('sku'), textObj('qty')];
    const dataset = { headers: ['sku'], rows: [['A1']] };
    const mapping = { bindings: { v1: 'sku' } };

    const result = generateBatchZpl(baseLabel, objects, variables, dataset, mapping);
    // Only the recall blocks should carry overrides; isolate them so the
    // template body's own ^FN slots don't pollute the assertion.
    const recall = result.split('^XFR:LBL.ZPL').slice(1).join('^XFR:LBL.ZPL');
    expect(recall).toContain('^FN1^FDA1^FS');
    expect(recall).not.toMatch(/\^FN2\^FD/);
  });

  it('skips orphan bindings (header missing from dataset)', () => {
    const variables = [
      { id: 'v1', name: 'sku', fnNumber: 1, defaultValue: '' },
    ];
    const objects = [textObj('sku')];
    const dataset = { headers: ['qty'], rows: [['10']] };
    const mapping = { bindings: { v1: 'sku' } };

    const result = generateBatchZpl(baseLabel, objects, variables, dataset, mapping);
    expect(result).toContain('^XFR:LBL.ZPL');
    const recall = result.split('^XFR:LBL.ZPL').slice(1).join('^XFR:LBL.ZPL');
    expect(recall).not.toMatch(/\^FN1\^FD/);
  });

  it('emits empty cells as empty ^FD payload (deliberate blank)', () => {
    const variables = [
      { id: 'v1', name: 'note', fnNumber: 1, defaultValue: 'fallback' },
    ];
    const objects = [textObj('note')];
    const dataset = { headers: ['note'], rows: [['']] };
    const mapping = { bindings: { v1: 'note' } };

    const result = generateBatchZpl(baseLabel, objects, variables, dataset, mapping);
    expect(result).toContain('^FN1^FD^FS');
  });

  it('injects ^DFR even when ~DY/~SD preamble lines precede ^XA', () => {
    const variables = [{ id: 'v1', name: 'sku', fnNumber: 1, defaultValue: '' }];
    const objects = [textObj('sku')];
    const dataset = { headers: ['sku'], rows: [['A1']] };
    const mapping = { bindings: { v1: 'sku' } };
    // instantDarkness adds a `~SD` preamble line before ^XA; a start-
    // anchored regex would silently skip the inject.
    const labelWithPreamble: LabelConfig = { ...baseLabel, instantDarkness: 5 };
    const result = generateBatchZpl(
      labelWithPreamble, objects, variables, dataset, mapping,
    );
    expect(result).toContain('~SD05');
    // ^DFR must still be present immediately inside the ^XA block.
    expect(result).toMatch(/\^XA\n\^DFR:LBL\.ZPL/);
  });

  it('re-escapes raw control bytes from an imported ^FH field on model re-emit', () => {
    // Text has no control-key chips, so the decoded raw byte stays in content;
    // regeneration must escape it again or the byte ships raw.
    const { objects } = parseSingle('^XA^FH_^FO0,0^A0N,30,0^FDAB_09CD^FS^XZ', 8);
    expect(props(defined(objects[0])).content).toBe('AB\tCD');
    const out = generateZPL(baseLabel, objects);
    expect(out).toContain('^FH_');
    expect(out).toContain('AB_09CD');
    expect(out).not.toContain('AB\tCD');
  });

  it('imports ^FH control bytes as chips on control-capable barcodes and re-emits them', () => {
    const { objects } = parseSingle('^XA^FO0,0^BY2^BCN,100,Y,N,N^FH_^FDAB_09CD^FS^XZ', 8);
    expect(props(defined(objects[0])).content).toBe('AB«ctrl:TAB»CD');
    // ^FH is only how the byte arrived; ^BC re-emits it as subset invocations.
    const out = generateZPL(baseLabel, objects);
    expect(out).toContain('^FD>93334733536^FS');
    expect(out).not.toContain('^FH_');
  });

  const code128Chip = (content: string): LabelObject[] => [{
    id: 'b1', type: 'code128', x: 0, y: 0, rotation: 0,
    props: { content, height: 100, moduleWidth: 2, printInterpretation: true, printInterpretationAbove: false, checkDigit: false, rotation: 'N' },
  }] as unknown as LabelObject[];

  it('emits a control-key chip as a Code 128 subset invocation, not ^FH hex', () => {
    // ^FH hex reaches the printer but ^BC drops every C0 byte from the symbol
    // (ZD230-verified, pixel-identical to no chip at all).
    const out = generateZPL(baseLabel, code128Chip('A«ctrl:GS»B«ctrl:CR»'));
    expect(out).toContain('^FD>933933477^FS');
    expect(out).not.toContain('^FH_');
    expect(out).not.toContain('_1D');
    expect(out).not.toContain('«ctrl:');
  });

  it('round-trips a chip-bearing code128 byte-identically', () => {
    const out = generateZPL(baseLabel, code128Chip('AB«ctrl:TAB»cd«ctrl:CR»EF'));
    const { objects } = parseSingle(out, 8);
    expect(props(defined(objects[0])).content).toBe('AB«ctrl:TAB»cd«ctrl:CR»EF');
    expect(generateZPL(baseLabel, objects)).toBe(out);
  });

  it('encodes a raw control byte the same way as a chip', () => {
    // Gate is the resolved payload, not the chip marker: an imported byte the
    // catalogue does not cover reaches the symbol only in invocation form.
    expect(generateZPL(baseLabel, code128Chip('AB\tCD'))).toContain('^FD>93334733536^FS');
    const out = generateZPL(baseLabel, code128Chip('A\x01B'));
    expect(out).toContain('^FD>9336534^FS');
    expect(out).not.toContain('^FH_');
  });

  it('adopts an invocation stream with an uncatalogued C0 byte (byte-identical re-emit)', () => {
    const { objects } = parseSingle('^XA^FO0,0^BY2^BCN,100,Y,N,N^FD>9336534^FS^XZ', 8);
    expect(props(defined(objects[0])).content).toBe('A\x01B');
    expect(generateZPL(baseLabel, objects)).toContain('^FD>9336534^FS');
  });

  it('encodes chip payloads with >/^ from UNescaped bytes (no double escape)', () => {
    // Chips-only content takes the invocation plan; pre-escaping it would
    // push the escape's own characters into the symbol as data.
    const out = generateZPL(baseLabel, code128Chip('A>B«ctrl:TAB»'));
    expect(out).toContain('^FD>933303473^FS');
    const { objects } = parseSingle(out, 8);
    expect(props(defined(objects[0])).content).toBe('A>B«ctrl:TAB»');
    expect(generateZPL(baseLabel, objects)).toBe(out);
  });

  it('picks ^FC chars against the ESCAPED payload (escape injects < and =)', () => {
    // `^` escapes to `><`; with `{` in the payload, a pre-escape scan would
    // pick '<' as the time char and re-import `<Y` as a clock-2 token.
    const out = generateZPL(baseLabel, code128Chip('{^Y«clock:m»'));
    expect(out).not.toContain('^FC%,<');
    const { objects } = parseSingle(out, 8);
    expect(props(defined(objects[0])).content).toBe('{^Y«clock:m»');
    expect(generateZPL(baseLabel, objects)).toBe(out);
  });

  it('lets a chips-only payload keep the embed-char pick free', () => {
    // The chips-only field emits as an invocation, never arms ^FE, so its
    // literals must not push the pick into exhaustion for real templates.
    const variables = [{ id: 'v1', name: 'sku', fnNumber: 1, defaultValue: 'V' }];
    const textLeaf = {
      id: 't1', type: 'text', x: 0, y: 0, rotation: 0,
      props: { content: 'L «sku» R', fontHeight: 30, fontWidth: 0, rotation: 'N' },
    } as unknown as LabelObject;
    const out = generateZPL(baseLabel, [...code128Chip('#@|%&?!«ctrl:TAB»'), textLeaf], variables);
    expect(out).toContain('^FE');
  });

  it('keeps binding for a variable whose name carries ^ (span-limited escape)', () => {
    const variables = [{ id: 'v1', name: 'x^y', fnNumber: 1, defaultValue: 'V' }];
    const out = generateZPL(baseLabel, code128Chip('a«x^y»b'), variables);
    expect(out).toContain('^FDa#1#b^FS');
  });

  it('escapes a literal > before a clock token, even when the date char is =', () => {
    // %$*+ in the payload force '=' as the ^FC date char; a post-token escape
    // would read `>=` as an invocation literal and drop the `>0`, so the
    // printer would merge the > into the substituted date.
    const out = generateZPL(baseLabel, code128Chip('%$*+A>«clock:Y»'));
    expect(out).toContain('^FC=');
    expect(out).toContain('%$*+A>0=Y^FS');
    const { objects } = parseSingle(out, 8);
    expect(props(defined(objects[0])).content).toBe('%$*+A>«clock:Y»');
    expect(generateZPL(baseLabel, objects)).toBe(out);
  });

  it('escapes a literal > before an embed reference and round-trips it', () => {
    const variables = [{ id: 'v1', name: 'sku', fnNumber: 1, defaultValue: '5B' }];
    const out = generateZPL(baseLabel, code128Chip('A>«sku»X'), variables);
    expect(out).toContain('^FDA>0#1#X^FS');
    const r = parseSingle(out, 8);
    // Parser names the unnamed slot field_1; the escape must still reverse.
    expect(props(defined(r.objects[0])).content).toBe('A>«field_1»X');
    expect(generateZPL(baseLabel, r.objects, r.variables)).toBe(out);
  });

  it('emits a chip-bearing template ^FN default with chips as literal text', () => {
    // Lockstep pin for the generator half of the templateValue pair: the
    // header ships chip markers literally (only >^~ escape), the parser's
    // normalize gate reverses in the same marker-preserving domain.
    const variables = [{ id: 'v1', name: 'sku', fnNumber: 1, defaultValue: 'A«ctrl:TAB»B^C' }];
    const out = generateZPL(baseLabel, code128Chip('X«sku»Y'), variables);
    expect(out).toContain('^FN1^FDA«ctrl:TAB»B><C^FS');
  });

  it('reverses ^FN-default escapes in the chip-PRESERVING domain', () => {
    // The adoption gate must compare marker text against marker text: a
    // whole-field (chip-resolving) comparison never matches a chipified
    // default and the escape form leaks into the model.
    for (const dv of ['Ä^B«ctrl:TAB»', 'A>>«ctrl:TAB»']) {
      const variables = [{ id: 'v1', name: 'sku', fnNumber: 1, defaultValue: dv }];
      const out = generateZPL(baseLabel, code128Chip('«sku»'), variables);
      const r = parseSingle(out, 8);
      expect(defined(r.variables[0]).defaultValue, dv).toBe(dv);
      expect(generateZPL(baseLabel, r.objects, r.variables)).toBe(out);
    }
  });

  it('leaves a shared-slot ^FN default verbatim on import (exclusivity decides)', () => {
    // flushField must not decode the default: only the page-close pass knows
    // the slot is shared, where the raw emit makes `>0AB` the true bytes.
    const zpl = '^XA^FO10,10^BY2^BCN,100,Y,N,N^FN1^FD>0AB^FS^FO10,60^A0N,30,0^FE#^FDL #1# R^FS^XZ';
    const r = parseSingle(zpl, 8);
    expect(defined(r.variables[0]).defaultValue).toBe('>0AB');
  });

  it('does not flag lossyEdit for a shared-slot default that re-emits raw', () => {
    const zpl = '^XA^FO10,10^BY2^BCN,100,Y,N,N^FN1^FDX>Y^FS^FO10,60^A0N,30,0^FE#^FDL #1# R^FS^XZ';
    const { findings } = parseSingle(zpl, 8, { captureOverlay: true });
    expect(findings.some((f) => f.kind === 'lossyEdit')).toBe(false);
  });

  it('flags lossyEdit for an exclusive ^FH control-byte default (regen emits invocations)', () => {
    const zpl = '^XA^FO10,10^BY2^BCN,100,Y,N,N^FN1^FH_^FDA_09B^FS^XZ';
    const { findings } = parseSingle(zpl, 8, { captureOverlay: true });
    expect(findings.some((f) => f.kind === 'lossyEdit')).toBe(true);
  });

  it('keeps > escapes inside marker bodies intact on import', () => {
    // The non-span decoder must not run on marker-bearing payloads: a `>0`
    // inside a variable NAME is body text, not an escape.
    const zpl = '^XA^FX Field: a>0b^FS^FN1^FDD^FS^FO10,10^BY2^BCN,50,N,N,N^FE#^FD#1#X^FS^XZ';
    const r = parseSingle(zpl, 8);
    expect(props(defined(r.objects[0])).content).toBe('«a>0b»X');
  });

  it('normalizes a bare ^FN invocation default for a pure lone-bind consumer', () => {
    // The lone-bind emit re-encodes the bytes to the same stream, so the
    // default adopts (chips included) instead of reading as unsafe `>` text.
    const zpl = '^XA^FN1^FD>9337334^FS^FO0,0^BY2^BCN,100,Y,N,N^FE#^FD#1#^FS^XZ';
    const r = parseSingle(zpl, 8);
    expect(defined(r.variables[0]).defaultValue).toBe('A«ctrl:TAB»B');
    expect(generateZPL(baseLabel, r.objects, r.variables)).toContain('^FD>9337334^FS');
  });

  it('escapes a literal > and round-trips it', () => {
    // Bare `>` opens an invocation code, so the firmware swallowed `>B`
    // (Labelary-measured: 92 dots instead of 136).
    const out = generateZPL(baseLabel, code128Chip('A>B'));
    expect(out).toContain('^FDA>0B^FS');
    const { objects } = parseSingle(out, 8);
    expect(props(defined(objects[0])).content).toBe('A>B');
    expect(generateZPL(baseLabel, objects)).toBe(out);
  });

  it('escapes ^ and ~ as invocation literals and round-trips them', () => {
    // The ^FH hex form (_5E/_7E) is silently dropped from the symbol
    // (ZD230-measured 136 dots, HRI ABC); ></>= encode losslessly (180 dots).
    const out = generateZPL(baseLabel, code128Chip('A^B~C'));
    expect(out).toContain('^FDA><B>=C^FS');
    expect(out).not.toContain('_5E');
    const { objects } = parseSingle(out, 8);
    expect(props(defined(objects[0])).content).toBe('A^B~C');
    expect(generateZPL(baseLabel, objects)).toBe(out);
  });

  it('re-emits an unmodelled invocation stream verbatim', () => {
    const zpl = '^XA^FO0,0^BY2^BCN,100,Y,N,N^FD>:AB>8CD^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    expect(props(defined(objects[0])).content).toBe('>:AB>8CD');
    expect(generateZPL(baseLabel, objects)).toContain('^FD>:AB>8CD^FS');
  });

  it('emits a single-bind default with control bytes as a subset invocation', () => {
    // The bound default is the whole ^FD, so the invocation form applies;
    // the ^FH hex fdField would otherwise use is dropped from the symbol (ZD230).
    const variables = [{ id: 'v1', name: 'sku', fnNumber: 1, defaultValue: 'A«ctrl:TAB»B' }];
    const out = generateZPL(baseLabel, code128Chip('«sku»'), variables);
    expect(out).toContain('^FN1^FD>9337334^FS');
    expect(out).not.toContain('^FH_');
    const r = parseSingle(out, 8);
    expect(generateZPL(baseLabel, r.objects, r.variables)).toBe(out);
  });

  it('falls back to resolved bytes, not chip marker text, when the plan fails', () => {
    // Ä fits no subset, so the invocation plan bails; the ^FH fallback must
    // carry the byte, never the internal «ctrl:» grammar.
    const variables = [{ id: 'v1', name: 'sku', fnNumber: 1, defaultValue: 'Ä«ctrl:TAB»B' }];
    const out = generateZPL(baseLabel, code128Chip('«sku»'), variables);
    expect(out).toContain('_09');
    expect(out).not.toContain('«ctrl:');
  });

  it('emits a shared-slot single-bind default raw (escape would corrupt co-consumers)', () => {
    const variables = [{ id: 'v1', name: 'sku', fnNumber: 1, defaultValue: 'X>Y^Z' }];
    const textLeaf = {
      id: 't1', type: 'text', x: 0, y: 0, rotation: 0,
      props: { content: 'A«sku»B', fontHeight: 30, fontWidth: 0, rotation: 'N' },
    } as unknown as LabelObject;
    const out = generateZPL(baseLabel, [...code128Chip('«sku»'), textLeaf], variables);
    // The firmware substitutes ONE value everywhere; an escaped default would
    // print `X>0Y><Z` through the text field, so the slot emits raw (mode-D
    // precedent) and preflight owns the barcode-side warning.
    expect(out).not.toContain('>0Y');
    expect(out).toContain('X>Y_5EZ');
  });

  it('emits a batch row value with control bytes as a subset invocation', () => {
    const variables = [{ id: 'v1', name: 'sku', fnNumber: 1, defaultValue: 'X' }];
    const objects = code128Chip('«sku»');
    const dataset = { headers: ['sku'], rows: [['A\tB']] };
    const mapping = { bindings: { v1: 'sku' } };
    const result = generateBatchZpl(baseLabel, objects, variables, dataset, mapping);
    const recall = result.split('^XFR:LBL.ZPL').slice(1).join('');
    expect(recall).toContain('^FN1^FD>9337334^FS');
    expect(recall).not.toContain('^FH_');
  });

  it('emits a GS1 field as mode-D data even when a legacy model carries serial', () => {
    // The alnum seed filter would eat the >8 FNC1 and merge AI values; a
    // legacy gs1+serial object must print its GS1 payload, not a seed.
    const gs = String.fromCharCode(0x1d);
    const leaf = {
      id: 'g', type: 'code128', x: 0, y: 0, rotation: 0,
      props: { content: `10LOT42${gs}21SER7`, height: 100, moduleWidth: 2,
               printInterpretation: false, printInterpretationAbove: false,
               checkDigit: false, rotation: 'N', gs1: true,
               serial: { increment: 1, zplMode: 'SN' } },
    } as unknown as LabelObject;
    const out = generateZPL(baseLabel, [leaf]);
    expect(out).toContain('^FD(10)LOT42>8(21)SER7^FS');
    expect(out).not.toContain('^SN');
  });

  it('keeps a compacted Subset C stream verbatim (adoption would widen the symbol)', () => {
    const zpl = '^XA^FO0,0^BY2^BCN,100,Y,N,N^FD>;12345678>773^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    expect(props(defined(objects[0])).content).toBe('>;12345678>773');
    expect(generateZPL(baseLabel, objects)).toContain('^FD>;12345678>773^FS');
  });

  it('escapes >/^/~ in a plain-^BC-exclusive ^FN default and reverses on import', () => {
    // The default substitutes into the ^BC ^FD; unescaped, `>Y` collapses and
    // ^/~ ride the ^FH hex the firmware drops from the symbol.
    const variables = [{ id: 'v1', name: 'sku', fnNumber: 1, defaultValue: 'X>Y^Z' }];
    const out = generateZPL(baseLabel, code128Chip('A«sku»B'), variables);
    expect(out).toContain('^FN1^FDX>0Y><Z^FS');
    const r = parseSingle(out, 8);
    expect(defined(r.variables[0]).defaultValue).toBe('X>Y^Z');
    expect(generateZPL(baseLabel, r.objects, r.variables)).toBe(out);
  });

  it('keeps the ^FH path for a chip inside a template payload', () => {
    // ^FE embed tokens are substituted after the barcode data is parsed, so the
    // subset form cannot wrap them; the field stays on the (lossy) hex escape.
    const variables = [{ id: 'v1', name: 'sku', fnNumber: 1, defaultValue: 'X' }];
    const out = generateZPL(baseLabel, code128Chip('A«sku»B«ctrl:TAB»'), variables);
    expect(out).toContain('^FH_');
    expect(out).toContain('_09');
  });

  it('resolves chips on every controlChars-capable 2D emitter', () => {
    const cases: [string, Record<string, unknown>][] = [
      ['qrcode', { magnification: 4, errorCorrection: 'Q', model: 2, rotation: 'N' }],
      ['datamatrix', { dimension: 5, quality: 200, rotation: 'N', gs1: false }],
      ['pdf417', { rotation: 'N' }],
      ['micropdf417', { rotation: 'N' }],
      ['aztec', { rotation: 'N' }],
    ];
    for (const [type, extra] of cases) {
      const objects = [{
        id: 'x', type, x: 0, y: 0, rotation: 0,
        props: { content: 'A«ctrl:TAB»B', ...extra },
      }] as unknown as LabelObject[];
      const out = generateZPL(baseLabel, objects);
      expect(out, type).toContain('_09');
      expect(out, type).not.toContain('«ctrl:');
    }
  });

  it('keeps a stray chip literal on a type that cannot encode control bytes', () => {
    // Import/paste can smuggle a chip onto EAN content; the emitter must not
    // turn it into a raw byte the symbology cannot carry.
    const objects = [{
      id: 'e1', type: 'ean13', x: 0, y: 0, rotation: 0,
      props: { content: '123«ctrl:TAB»', height: 100, moduleWidth: 2, printInterpretation: true, printInterpretationAbove: false, checkDigit: false, rotation: 'N' },
    }] as unknown as LabelObject[];
    const out = generateZPL(baseLabel, objects);
    expect(out).not.toContain('_09');
    expect(out).toContain('«ctrl:TAB»');
  });

  it('hex-escapes ^ and ~ in CSV cell values via ^FH', () => {
    const variables = [{ id: 'v1', name: 'name', fnNumber: 1, defaultValue: '' }];
    const objects = [textObj('name')];
    const dataset = { headers: ['name'], rows: [['A^B~C Corp']] };
    const mapping = { bindings: { v1: 'name' } };
    const result = generateBatchZpl(baseLabel, objects, variables, dataset, mapping);
    const recall = result.split('^XFR:LBL.ZPL').slice(1).join('^XFR:LBL.ZPL');
    // Raw ^ or ~ in the value must not appear in the recall payload;
    // they would terminate the field early on the printer.
    expect(recall).toContain('^FH_');
    expect(recall).not.toContain('A^B~C Corp');
  });

  it('zero rows yields template-only output (no recall blocks)', () => {
    const variables = [{ id: 'v1', name: 'sku', fnNumber: 1, defaultValue: '' }];
    const objects = [textObj('sku')];
    const dataset = { headers: ['sku'], rows: [] };
    const mapping = { bindings: { v1: 'sku' } };

    const result = generateBatchZpl(baseLabel, objects, variables, dataset, mapping);
    expect(result).toContain('^DFR:LBL.ZPL');
    expect(result).not.toContain('^XFR:LBL.ZPL');
  });

  it('applies the QR {ec}A, transform to each CSV override (not raw)', () => {
    const variables = [{ id: 'v1', name: 'url', fnNumber: 1, defaultValue: 'https://d' }];
    const qr = {
      id: 'q', type: 'qrcode', x: 10, y: 10,
      props: { content: '«url»', magnification: 4, errorCorrection: 'Q', rotation: 'N' },
    } as unknown as LabelObject;
    const dataset = { headers: ['url'], rows: [['https://row']] };
    const result = generateBatchZpl(baseLabel, [qr], variables, dataset, { bindings: { v1: 'url' } });
    const recall = result.split('^XFR:LBL.ZPL').slice(1).join('^XFR:LBL.ZPL');
    expect(recall).toContain('^FN1^FDQA,https://row');
    expect(recall).not.toContain('^FN1^FDhttps://row');
  });

  it('applies the UPC-E compaction transform to each CSV override', () => {
    const variables = [{ id: 'v1', name: 'upc', fnNumber: 1, defaultValue: '123456' }];
    const upceObj = {
      id: 'u', type: 'upce', x: 10, y: 10,
      props: {
        content: '«upc»', height: 100, moduleWidth: 2,
        printInterpretation: true, printInterpretationAbove: false, checkDigit: false, rotation: 'N',
      },
    } as unknown as LabelObject;
    const dataset = { headers: ['upc'], rows: [['654321']] };
    const result = generateBatchZpl(baseLabel, [upceObj], variables, dataset, { bindings: { v1: 'upc' } });
    const recall = result.split('^XFR:LBL.ZPL').slice(1).join('^XFR:LBL.ZPL');
    // NS-prefixed + compacted, not the raw row value.
    expect(recall).toContain('^FN1^FD0654321');
    expect(recall).not.toContain('^FN1^FD654321^FS');
  });
});

describe('generateZPL — ^FT graphic anchors (bottom corner, spec p.205)', () => {
  const mk = (type: string, props: object, extra: object = {}) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [{ id: 'g', type, x: 50, y: 70, rotation: 0, positionType: 'FT', props, ...extra }] as any;

  it('ellipse ^GE: ^FT anchors bottom-left (y + height)', () => {
    const zpl = generateZPL(BASE_LABEL, mk('ellipse',
      { width: 100, height: 80, thickness: 3, filled: false, color: 'B' }));
    expect(zpl).toContain('^FT50,150^GE100,80,3,B^FS'); // 70 + 80
    expect(parseSingle(zpl, 8).objects[0]?.positionType).toBe('FT');
  });

  it('ellipse ^GE right-justified: ^FT,1 anchors bottom-right', () => {
    const zpl = generateZPL(BASE_LABEL, mk('ellipse',
      { width: 100, height: 80, thickness: 3, filled: false, color: 'B' },
      { fieldJustify: 'R' }));
    expect(zpl).toContain('^FT150,150,1^GE100,80,3,B^FS'); // 50+100, 70+80
  });

  it('circle ^GC: ^FT lifts by the diameter', () => {
    const zpl = generateZPL(BASE_LABEL, mk('ellipse',
      { width: 100, height: 100, thickness: 3, filled: false, color: 'B', lockAspect: true }));
    expect(zpl).toContain('^FT50,170^GC100,3,B^FS'); // 70 + 100
  });

  it('image ^GF/^XG: ^FT lifts by heightDots', () => {
    const zpl = generateZPL(BASE_LABEL, mk('image',
      { imageId: '', widthDots: 120, heightDots: 60, threshold: 128,
        storedAs: { device: 'R', name: 'LOGO', embedInZpl: false } }));
    expect(zpl).toContain('^FT50,130^XGR:LOGO.GRF,1,1^FS'); // 70 + 60
  });

  it('diagonal line ^GD: ^FT anchors the bounding box bottom-left', () => {
    // 3-4-5 at start (50,70): dx 80, dy 60 → box top-left (50,70), h 60.
    const zpl = generateZPL(BASE_LABEL, mk('line',
      { angle: Math.round((Math.atan2(60, 80) * 180) / Math.PI), length: 100, thickness: 3, color: 'B' }));
    expect(zpl).toMatch(/\^FT50,130\^GD80,60,3,B,L\^FS/); // 70 + 60
  });

  it('round-trips a ^FT ellipse byte-stably through parse → emit', () => {
    const { objects } = parseSingle('^XA^FT50,150^GE100,80,3,B^FS^XZ', 8);
    expect(generateZPL(BASE_LABEL, objects)).toContain('^FT50,150^GE100,80,3,B^FS');
  });

  it('cached image ^FT: anchor height follows the natural aspect, not stale heightDots', () => {
    // Resize keeps only widthDots in sync; a cached image's true height is
    // widthDots x natural-aspect. The ^FT anchor must use that, not heightDots.
    putImage({ id: 'imgA', name: 'a', dataUrl: 'data:,', width: 100, height: 50 });
    const zpl = generateZPL(BASE_LABEL, mk('image',
      { imageId: 'imgA', widthDots: 120, heightDots: 999, threshold: 128, _gfaCache: '^GFA1,1,1,00' }));
    expect(zpl).toContain('^FT50,130'); // 70 + round(120 * 50/100) = 70 + 60
    expect(zpl).not.toContain('^FT50,1069'); // not 70 + stale 999
  });

  it('cached image ^FT: a 0-width (malformed) cache falls back, no Infinity anchor', () => {
    // A malformed 0-width decode would make widthDots*(h/0) Infinity; the emit
    // path must fall back to heightDots like the render path does.
    putImage({ id: 'imgZero', name: 'z', dataUrl: 'data:,', width: 0, height: 50 });
    const zpl = generateZPL(BASE_LABEL, mk('image',
      { imageId: 'imgZero', widthDots: 120, heightDots: 80, threshold: 128, _gfaCache: '^GFA1,1,1,00' }));
    expect(zpl).toContain('^FT50,150'); // 70 + heightDots 80
    expect(zpl).not.toContain('Infinity');
    expect(zpl).not.toContain('NaN');
  });

  it('cached image ^FT: a wide/short image that rounds to 0 rows anchors at 1 dot', () => {
    // round(8 * 30/1000) = 0, but the emitted ^GF is still 1 row tall, so the
    // ^FT bottom anchor must clamp to 1 to agree with the bitmap.
    putImage({ id: 'imgWide', name: 'w', dataUrl: 'data:,', width: 1000, height: 30 });
    const zpl = generateZPL(BASE_LABEL, mk('image',
      { imageId: 'imgWide', widthDots: 8, threshold: 128, _gfaCache: '^GFA1,1,1,00' }));
    expect(zpl).toContain('^FT50,71'); // 70 + max(1, round(8 * 30/1000)) = 71
    expect(zpl).not.toContain('^FT50,70'); // not 70 + 0
  });

  it('keeps a hand-authored ^FT reverse box + ^FR text as two FT objects and round-trips them', () => {
    // Spec-true reverse: the filled ^FT ^GB stays its own box and the ^FR text
    // stays a separate reverse text; neither is collapsed or rewritten to ^FO,
    // so the foreign label round-trips with box, text, and position type intact.
    const src =
      '^XA^FT145,172^GB246,44,44,B,0^FS^FT145,172^A0N,44,34^FR^FDPESO LIQUIDO^FS^XZ';
    const { objects } = parseSingle(src, 8);
    expect(objects).toHaveLength(2);
    const [bar, text] = objects;
    // ^GB246,44,44 (thickness == height) is a filled horizontal bar = line.
    expect(bar?.type).toBe('line');
    expect(bar?.positionType).toBe('FT');
    expect(text?.type).toBe('text');
    expect(text?.positionType).toBe('FT');
    expect(props(text).reverse).toBe(true);
    // Re-emit preserves both FT anchors and the ^FR, no silent ^FO rewrite.
    const out = generateZPL(BASE_LABEL, objects);
    expect(out).toContain('^FT145,172^GB246,44,44,B,0^FS');
    expect(out).toContain('^FR^FD');
    expect(out).not.toContain('^FO');
  });

  it('cached image right-justified ^FT: anchor x uses the byte-padded ^GF width', () => {
    // ^GF rows pad to a byte boundary: widthDots 121 prints (and re-parses) as
    // 128, so the ^FT,1 x must key off 128, not 121, or the round-trip drifts.
    putImage({ id: 'imgB', name: 'b', dataUrl: 'data:,', width: 121, height: 60 });
    const zpl = generateZPL(BASE_LABEL, mk('image',
      { imageId: 'imgB', widthDots: 121, threshold: 128, _gfaCache: '^GFA1,1,1,00' },
      { fieldJustify: 'R' }));
    expect(zpl).toContain('^FT178,130,1'); // x 50 + ceil(121/8)*8 = 178; y 70 + 60
    expect(zpl).not.toContain('^FT171'); // not 50 + raw 121
  });
});

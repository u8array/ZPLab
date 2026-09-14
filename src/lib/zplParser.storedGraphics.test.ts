import { describe, it, expect } from 'vitest';
import { generateMultiPageZPL, generateZPL } from '@zplab/core/lib/zplGenerator';
import { importZplText } from '@zplab/core/lib/zplImportService';
import { blockOverlaySchema, type OverlaySegment } from '@zplab/core/lib/zplOverlay/overlay';
import type { LabelConfig } from '@zplab/core/types/LabelConfig';
import { commandsOf, defined, findingsOf, makeZ64Field, parseSingle, props } from '../test/helpers';

// 1 byte per row × 4 rows → horizontal stripe [0x00, 0xFF, 0xFF, 0x00].
const HEX = '00FFFF00';
const DG = `~DGR:LOGO.GRF,4,1,${HEX}`;
const DY = `~DYR:LOGO,A,G,4,1,${HEX}`;
const STORED = { device: 'R', name: 'LOGO', embedInZpl: true };
const STORED_IM = { ...STORED, recall: 'IM' };
const LABEL: LabelConfig = { widthMm: 100, heightMm: 50, dpmm: 8 };

const uploadSegments = (p: { overlay?: { segments: readonly OverlaySegment[] } }) =>
  (p.overlay?.segments ?? []).flatMap((seg) => (seg.kind === 'upload' ? [seg] : []));
const uploadKeys = (p: { overlay?: { segments: readonly OverlaySegment[] } }) => uploadSegments(p).map((seg) => seg.key);

const image = (extra: object) => [{
  id: 'i', type: 'image', x: 10, y: 20, rotation: 0,
  props: { imageId: '', widthDots: 120, heightDots: 60, threshold: 128, ...extra },
}] as never;

describe('parseZPL — ~DY + ^XG graphic upload/recall', () => {
  it('registers a ~DY graphic upload and ^XG instantiates it as an image', () => {
    const { objects, findings } = parseSingle(`${DY}\n^XA^FO50,80^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
    expect(objects.map((o) => [o.type, o.x, o.y])).toEqual([['image', 50, 80]]);
    expect(props(objects[0]).widthDots).toBe(8);
    expect(props(objects[0]).storedAs).toEqual(STORED);
    expect(findings).toEqual([]);
  });

  it('resolves ^XG even when the .GRF suffix is omitted', () => {
    // Labelary accepts `^XGR:LOGO,1,1` for an upload stored as `R:LOGO.GRF`.
    const { objects, findings } = parseSingle(`${DY}\n^XA^FO50,80^XGR:LOGO,1,1^FS^XZ`, 8);
    expect(props(objects[0]).storedAs).toEqual(STORED);
    expect(findings).toEqual([]);
  });

  it('^XG without a preceding ~DY imports as recall-only image', () => {
    const { objects, findings } = parseSingle('^XA^FO0,0^XGR:MISSING.GRF,1,1^FS^XZ', 8);
    expect(objects).toHaveLength(1);
    expect(props(objects[0]).storedAs).toEqual({ device: 'R', name: 'MISSING', embedInZpl: false });
    expect(commandsOf({ findings }, 'partial')).toContain('^XG');
  });

  it('accepts :Z64:-wrapped graphic payloads in ~DY (format C)', () => {
    const field = makeZ64Field(new Uint8Array([0, 0xff, 0xff, 0]));
    const { objects, findings } = parseSingle(`~DYR:LOGO,C,G,4,1,${field}\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
    expect(objects).toHaveLength(1);
    expect(props(objects[0]).storedAs).toEqual(STORED);
    expect(commandsOf({ findings }, 'partial')).not.toContain('~DY');
  });
});

describe('parseZPL — ~DG download graphic', () => {
  it('registers the upload so ^XG instantiates it', () => {
    const { objects, findings } = parseSingle(`${DG}\n^XA^FO50,80^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
    expect(objects.map((o) => o.type)).toEqual(['image']);
    expect(props(objects[0]).widthDots).toBe(8);
    expect(props(objects[0]).storedAs).toEqual(STORED);
    expect(findings).toEqual([]);
  });

  it('registers an upload placed inside the format', () => {
    const { objects, findings } = parseSingle(`^XA${DG}^FO50,80^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
    expect(objects.map((o) => o.type)).toEqual(['image']);
    expect(findings).toEqual([]);
  });

  it('stores every upload as .GRF, whatever extension the path names', () => {
    // Names carry no periods, so .GRF replaces the extension (spec p.175).
    const { objects, findings } = parseSingle(`~DGR:LOGO.PNG,4,1,${HEX}\n^XA^FO50,80^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
    expect(props(objects[0]).widthDots).toBe(8);
    expect(findings).toEqual([]);
  });

  it('surfaces a broken header as browserLimit with the payload truncated', () => {
    const { objects, findings } = parseSingle(`^XA~DGR:LOGO.GRF,4,${'F'.repeat(300)}^XZ`, 8);
    expect(objects).toEqual([]);
    const [token] = commandsOf({ findings }, 'browserLimit');
    expect(token?.startsWith('~DGR:LOGO.GRF')).toBe(true);
    expect(defined(token).length).toBeLessThan(100);
  });

  it('reports a short broken header as written', () => {
    const { findings } = parseSingle('^XA~DGR:LOGO.GRF,4^XZ', 8);
    expect(commandsOf({ findings }, 'browserLimit')).toEqual(['~DGR:LOGO.GRF,4']);
  });

  it('rejects an upload without a byte count', () => {
    for (const zpl of ['^XA~DGR:LOGO.GRF,,1,00FFFF00^XZ', '^XA~DGR:LOGO.GRF,0,1,00FFFF00^XZ', '^XA~DYR:LOGO,A,G,x,1,00FFFF00^XZ']) {
      const { findings } = parseSingle(`${zpl.slice(0, -3)}^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
      expect(findings.map((f) => f.kind).sort()).toEqual(['browserLimit', 'partial']);
    }
  });

  it('reports a payload shorter than its declared total as partial', () => {
    const { objects, findings } = parseSingle(`~DGR:LOGO.GRF,8,1,${HEX}\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
    expect(props(objects[0]).heightDots).toBe(4);
    expect(commandsOf({ findings }, 'partial')).toEqual(['~DG']);
  });

  it('ignores payload bytes past the declared total, which spec p.215 keeps apart from the stream length', () => {
    const { objects, findings } = parseSingle(`~DGR:LOGO.GRF,2,1,${HEX}\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
    expect(props(objects[0]).heightDots).toBe(2);
    expect(findings).toEqual([]);
  });

  it('flags an inline ^GF shorter than its declared total the same way', () => {
    const { objects, findings } = parseSingle('^XA^FO0,0^GFA,8,8,1,00FFFF00^FS^XZ', 8);
    expect(props(objects[0]).heightDots).toBe(4);
    expect(findings.map((f) => [f.kind, f.command, f.loss])).toEqual([['partial', '^GF', 'shortPayload']]);
  });

  it('sizes a ^GF by its bitmap count, not by the bytes transmitted', () => {
    // A compressed :Z64: field has b far below c (spec p.215).
    const field = makeZ64Field(new Uint8Array(16).fill(0xff));
    const { objects, findings } = parseSingle(`^XA^FO0,0^GFC,26,16,2,${field}^FS^XZ`, 8);
    expect(props(objects[0]).heightDots).toBe(8);
    expect(findings).toEqual([]);
    const hex = parseSingle(`^XA^FO0,0^GFA,4,16,2,${'F'.repeat(32)}^FS^XZ`, 8);
    expect(props(hex.objects[0]).heightDots).toBe(8);
  });

  it('rewrites a short wrapped payload to the rows it painted and keeps its wire count', () => {
    const field = makeZ64Field(new Uint8Array([0xff, 0xff, 0xff]));
    const { objects } = parseSingle(`^XA^FO0,0^GFC,26,16,2,${field}^FS^XZ`, 8);
    expect(props(objects[0]).heightDots).toBe(1);
    expect(String(props(objects[0])._gfaCache).startsWith('^GFC,26,2,2,')).toBe(true);
  });

  it('carries the short-payload cause on an upload as well', () => {
    const { findings } = parseSingle(`~DGR:LOGO.GRF,8,1,${HEX}\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
    expect(findings.map((f) => [f.command, f.loss])).toEqual([['~DG', 'shortPayload']]);
  });

});

describe('generateMultiPageZPL — upload ledger', () => {
  it('re-ships a short upload from the model instead of replaying it, untouched or edited', () => {
    const zpl = `~DGR:LOGO.GRF,8,1,${HEX}\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    expect(generateMultiPageZPL(LABEL, imported.pages)).toBe(`~DYR:LOGO,A,G,4,1,${HEX}\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`);
    const page = defined(imported.pages[0]);
    const moved = { ...page, objects: [{ ...defined(page.objects[0]), x: 10, dirty: true }] };
    const out = generateMultiPageZPL(LABEL, [moved]);
    expect(out).toContain(`~DYR:LOGO,A,G,4,1,${HEX}\n^XA`);
    expect(out).not.toContain(',8,1,');
  });

  it("gives the preamble upload the page's own separator, so a CRLF page stays CRLF", () => {
    const zpl = '^XA\r\n^FO0,0^GFA,4,4,1,00FFFF00^FS\r\n^FO0,50^GB10,10,1^FS\r\n^XZ';
    const imported = importZplText(zpl, 8);
    const page = defined(imported.pages[0]);
    const [gf, box] = page.objects;
    const stored = { ...defined(gf), dirty: true, props: { ...props(gf), storedAs: { device: 'R', name: 'GFX0001' } } };
    const out = generateMultiPageZPL(LABEL, [{ ...page, objects: [stored as never, defined(box)] }]);
    expect(out.startsWith(`~DYR:GFX0001,A,G,4,1,${HEX}\r\n^XA\r\n`)).toBe(true);
  });

  it('makes a short inline ^GF regenerate the page on the first edit', () => {
    const zpl = '^XA^FO0,0^GFA,8,8,1,00FFFF00^FS^FO0,50^GB10,10,1^FS^XZ';
    const imported = importZplText(zpl, 8);
    expect(imported.pages[0]?.overlay?.regenSafe).toBe(false);
    expect(generateMultiPageZPL(LABEL, imported.pages)).toBe(zpl);
    const page = defined(imported.pages[0]);
    const [gf, box] = page.objects;
    const moved = { ...page, objects: [defined(gf), { ...defined(box), x: 20, dirty: true }] };
    expect(generateMultiPageZPL(LABEL, [moved])).toContain('^GFA,4,4,1,');
  });

  it('treats deleting a neighbour as the first edit too, for the inline ^GF and the upload alike', () => {
    const gf = importZplText('^XA^FO0,0^GFA,8,8,1,00FFFF00^FS^FO0,50^GB10,10,1^FS^XZ', 8);
    const gfPage = defined(gf.pages[0]);
    const gfOut = generateMultiPageZPL(LABEL, [{ ...gfPage, objects: gfPage.objects.slice(0, 1) }]);
    expect(gfOut).toContain('^GFA,4,4,1,');
    expect(gfOut).not.toContain('^GB');
    const up = importZplText(`~DGR:LOGO.GRF,8,1,${HEX}
^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^FO0,50^GB10,10,1^FS^XZ`, 8);
    const upPage = defined(up.pages[0]);
    const upOut = generateMultiPageZPL(LABEL, [{ ...upPage, objects: upPage.objects.slice(0, 1) }]);
    expect(upOut).toContain(`~DYR:LOGO,A,G,4,1,${HEX}`);
    expect(upOut).not.toContain(',8,1,');
  });

  it('reads an out-of-range magnification as 1 but still reports it', () => {
    const { objects, findings } = parseSingle(`${DG}\n^XA^FO50,80^XGR:LOGO.GRF,11,0^FS^XZ`, 8);
    expect(props(objects[0]).storedAs).toEqual(STORED);
    expect(findings.map((f) => f.loss)).toEqual(['recallMagnification']);
  });

  it('drops an upload between two blocks when its recall on the next block goes', () => {
    const zpl = `^XA^FO0,0^GB10,10,1^FS^XZ\n${DG}\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    expect(generateMultiPageZPL(LABEL, imported.pages)).toBe(zpl);
    const [first, second] = imported.pages;
    const out = generateMultiPageZPL(LABEL, [defined(first), { ...defined(second), objects: [] }]);
    expect(out).not.toMatch(/~D[GY]/);
    expect(out).toContain('^GB');
  });

  it('stops shipping the upload once the object no longer embeds it', () => {
    const imported = importZplText(`${DG}\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
    const page = defined(imported.pages[0]);
    const img = defined(page.objects[0]);
    const recallOnly = { ...img, dirty: true, props: { ...props(img), storedAs: { ...(props(img).storedAs as object), embedInZpl: false } } };
    const out = generateMultiPageZPL(LABEL, [{ ...page, objects: [recallOnly as never] }]);
    expect(out).not.toMatch(/~D[GY]/);
    expect(out).toContain('^XGR:LOGO.GRF,1,1');
  });

  it('drops both raw uploads with the stale carrier and re-ships only the key still recalled', () => {
    const zpl = `^XA^FO0,0^GB10,10,1^FS^XZ\n${DG}\n~DGR:SEAL.GRF,4,1,${HEX}\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^FO0,50^XGR:SEAL.GRF,1,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    expect(generateMultiPageZPL(LABEL, imported.pages)).toBe(zpl);
    const [first, second] = imported.pages;
    const out = generateMultiPageZPL(LABEL, [defined(first), { ...defined(second), objects: defined(second).objects.slice(0, 1) }]);
    expect(out.match(/~D[GY]R:LOGO/g)).toHaveLength(1);
    expect(out).not.toContain('SEAL');
    expect(out).toContain('^XGR:LOGO.GRF,1,1');
  });

  it('ships the upload once when the carrying page regenerates and the recall page is edited', () => {
    const zpl = `^XA^FO0,0^GB10,10,1^FS^XZ\n${DG}\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    const [first, second] = imported.pages;
    // The upload between the blocks folds into the first page's tail, so only that page carries it.
    expect(imported.pages.map(uploadKeys)).toEqual([['R:LOGO.GRF'], []]);
    const img = defined(defined(second).objects[0]);
    const out = generateMultiPageZPL(LABEL, [defined(first), { ...defined(second), objects: [{ ...img, x: 10, dirty: true }] }]);
    expect(out.match(/~D[GY]R:LOGO/g)).toHaveLength(1);
  });

  it('replays the carrier on an edit elsewhere while its upload is still what the model ships', () => {
    const zpl = `^XA^FO0,0^GB10,10,1^FS^XZ\n^XA${DG}^FX keep^FS^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    expect(imported.pages.map(uploadKeys)).toEqual([[], ['R:LOGO.GRF']]);
    expect(generateMultiPageZPL(LABEL, imported.pages)).toBe(zpl);
    const [first, second] = imported.pages;
    const box = defined(defined(first).objects[0]);
    const out = generateMultiPageZPL(LABEL, [{ ...defined(first), objects: [{ ...box, x: 20, dirty: true }] }, defined(second)]);
    expect(out.endsWith(`^XA${DG}^FX keep^FS^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`)).toBe(true);
    expect(out).not.toContain('~DY');
  });

  it('keeps unrelated device commands on an untouched carrier when another page is edited', () => {
    const zpl = `${DG}\n^XA^IDR:OTHER.GRF^FS^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ\n^XA^FO0,0^GB10,10,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    const [first, second] = imported.pages;
    const box = defined(defined(second).objects[0]);
    const out = generateMultiPageZPL(LABEL, [defined(first), { ...defined(second), objects: [{ ...box, x: 20, dirty: true }] }]);
    expect(out.startsWith(`${DG}\n^XA^IDR:OTHER.GRF^FS^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ\n`)).toBe(true);
    expect(out).not.toContain('~DY');
  });

  it('regenerates the carrier once the image it uploads changed on another page', () => {
    const zpl = `^XA${DG}^FO0,0^GB10,10,1^FS^XZ\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    const [first, second] = imported.pages;
    const img = defined(defined(second).objects[0]);
    const changed = { ...img, dirty: true, props: { ...props(img), _gfaCache: '^GFA,4,4,1,FF0000FF' } };
    const out = generateMultiPageZPL(LABEL, [defined(first), { ...defined(second), objects: [changed as never] }]);
    expect(out).not.toContain(HEX);
    expect(out.match(/~DYR:LOGO,A,G,4,1,FF0000FF/g)).toHaveLength(1);
    expect(out.indexOf('~DYR:LOGO')).toBeLessThan(out.indexOf('^XGR:LOGO'));
  });

  it('ships each recall its own bytes once one key names two uploads and anything is edited', () => {
    const zpl = [
      `^XA${DG}^FO0,50^GB10,10,1^FS^XZ`,
      '^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ',
      '^XA~DGR:LOGO.GRF,4,1,FF0000FF^FO0,60^GB10,10,1^FS^XZ',
      '^XA^FO0,10^XGR:LOGO.GRF,1,1^FS^XZ',
    ].join('\n');
    const imported = importZplText(zpl, 8);
    expect(generateMultiPageZPL(LABEL, imported.pages)).toBe(zpl);
    const [p1, p2, p3, p4] = imported.pages;
    const box = defined(defined(p3).objects[0]);
    for (const edited of [
      [defined(p1), defined(p2), { ...defined(p3), objects: [{ ...box, x: 20, dirty: true }] }, defined(p4)],
      [defined(p1), defined(p2), { ...defined(p3), overlay: undefined }, defined(p4)],
    ]) {
      const out = generateMultiPageZPL(LABEL, edited);
      expect(out).not.toContain('~DG');
      expect(out).toContain(`~DYR:LOGO,A,G,4,1,${HEX}\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`);
      expect(out).toContain('~DYR:LOGO,A,G,4,1,FF0000FF\n^XA^FO0,10^XGR:LOGO.GRF,1,1^FS^XZ');
      expect(out.match(/~D[GY]R:LOGO/g)).toHaveLength(2);
    }
  });

  it('re-ships the key when the density pass regenerates a head-less carrier', () => {
    const zpl = `^XA${DG}^FO0,50^GB10,10,1^FS^XZ\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^FO0,50^GB10,10,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    const [first, second] = imported.pages;
    const { head: _head, ...headless } = defined(defined(first).overlay);
    const box = defined(defined(second).objects[1]);
    const out = generateMultiPageZPL({ ...LABEL, jmDensity: 'B' }, [
      { ...defined(first), overlay: headless },
      { ...defined(second), objects: [defined(defined(second).objects[0]), { ...box, x: 20, dirty: true }] },
    ]);
    expect(out.match(/~D[GY]R:LOGO/g)).toHaveLength(1);
    expect(out.indexOf('~DYR:LOGO')).toBeLessThan(out.indexOf('^XGR:LOGO'));
  });

  it('drops the raw upload once the recalling object on another page stops embedding it', () => {
    const zpl = `^XA${DG}^FO0,50^GB10,10,1^FS^XZ\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    const [first, second] = imported.pages;
    const img = defined(defined(second).objects[0]);
    const recallOnly = { ...img, dirty: true, props: { ...props(img), storedAs: { ...(props(img).storedAs as object), embedInZpl: false } } };
    const out = generateMultiPageZPL(LABEL, [defined(first), { ...defined(second), objects: [recallOnly as never] }]);
    expect(out).not.toMatch(/~D[GY]/);
    expect(out).toContain('^XGR:LOGO.GRF,1,1');
  });

  it('does not let a reference to another file hold an upload it never recalls', () => {
    const zpl = `${DG}\n^XA^FO0,0^IMR:LOGO.PNG^FS^FO0,50^GB10,10,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    const page = defined(imported.pages[0]);
    const box = defined(page.objects[1]);
    const out = generateMultiPageZPL(LABEL, [{ ...page, objects: [defined(page.objects[0]), { ...box, x: 20, dirty: true }] }]);
    expect(out).not.toMatch(/~D[GY]/);
    expect(out).toContain('^IMR:LOGO.PNG');
  });

  it('re-ships the upload when a z-order change alone regenerates the carrier', () => {
    const zpl = `^XA${DG}^FO0,0^GB10,10,1^FS^FO0,50^GB20,20,1^FS^XZ\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    const [first, second] = imported.pages;
    const [a, b] = defined(first).objects;
    const out = generateMultiPageZPL(LABEL, [{ ...defined(first), objects: [defined(b), defined(a)] }, defined(second)]);
    expect(out.match(/~D[GY]R:LOGO/g)).toHaveLength(1);
    expect(out.indexOf('~DYR:LOGO')).toBeLessThan(out.indexOf('^XGR:LOGO'));
  });

  it('sends the upload back to the model when a recall-only reference to it moves', () => {
    // The source recalled the file before uploading it, so the import already left it recall-only.
    const zpl = `^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ\n${DG}\n^XA^FO0,0^GB10,10,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    const [first, second] = imported.pages;
    const img = defined(defined(first).objects[0]);
    expect(props(img).storedAs).toMatchObject({ embedInZpl: false });
    const out = generateMultiPageZPL(LABEL, [{ ...defined(first), objects: [{ ...img, x: 20, dirty: true }] }, defined(second)]);
    expect(out).not.toMatch(/~D[GY]/);
    expect(out).toContain('^XGR:LOGO.GRF,1,1');
  });

  it('lets a recall-only reference share a key with a shipping one without unsettling the upload', () => {
    const zpl = `^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ\n${DG}\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^FO0,50^GB10,10,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    const [first, second] = imported.pages;
    const box = defined(defined(second).objects[1]);
    const out = generateMultiPageZPL(LABEL, [defined(first), { ...defined(second), objects: [defined(defined(second).objects[0]), { ...box, x: 20, dirty: true }] }]);
    expect(out).toContain(DG);
    expect(out).not.toContain('~DY');
  });

  it('never replays a short upload, whatever else the export changes', () => {
    const zpl = `~DGR:LOGO.GRF,8,1,${HEX}\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ\n^XA^FO0,0^GB10,10,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    const denser = generateMultiPageZPL({ ...LABEL, jmDensity: 'B' }, imported.pages);
    expect(denser).toContain('^JMB');
    expect(denser).not.toContain(',8,1,');
    expect(denser.startsWith(`~DYR:LOGO,A,G,4,1,${HEX}\n^XA`)).toBe(true);
    const [first, second] = imported.pages;
    const box = defined(defined(second).objects[0]);
    const out = generateMultiPageZPL(LABEL, [defined(first), { ...defined(second), objects: [{ ...box, x: 20, dirty: true }] }]);
    expect(out).not.toContain(',8,1,');
    expect(out.startsWith(`~DYR:LOGO,A,G,4,1,${HEX}\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`)).toBe(true);
  });

  it('drops only the upload bytes when the image changes, the rest of the carrier replays', () => {
    const zpl = `${DG}\n^XA^IDR:OTHER.GRF^FS^FX keep^FS^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    const page = defined(imported.pages[0]);
    const img = defined(page.objects[0]);
    const changed = { ...img, dirty: true, props: { ...props(img), _gfaCache: '^GFA,4,4,1,FF0000FF' } };
    const out = generateMultiPageZPL(LABEL, [{ ...page, objects: [changed as never] }]);
    expect(out.startsWith('~DYR:LOGO,A,G,4,1,FF0000FF\n^XA^IDR:OTHER.GRF^FS^FX keep^FS')).toBe(true);
    expect(out).not.toContain(HEX);
  });

  it('ships a dropped upload once ahead of the first recall page, not before every one', () => {
    const zpl = `${DG}\n^XA^FO0,0^GB10,10,1^FS^XZ\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    const [p1, p2, p3] = imported.pages;
    const img = defined(defined(p2).objects[0]);
    const out = generateMultiPageZPL(LABEL, [defined(p1), { ...defined(p2), objects: [{ ...img, x: 20, dirty: true }] }, defined(p3)]);
    expect(out.match(/~D[GY]R:LOGO/g)).toHaveLength(1);
    expect(out.indexOf('~DYR:LOGO')).toBeLessThan(out.indexOf('^XGR:LOGO'));
  });

  it('keeps the page overlay when the upload sits inside a field, and marks the page regen-hostile', () => {
    const zpl = `^XA^FO0,0~DGR:X.GRF,4,1,${HEX}^GFA,4,4,1,${HEX}^FS^FO0,50^XGR:X.GRF,1,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    const page = defined(imported.pages[0]);
    expect(page.overlay).toBeDefined();
    expect(page.overlay?.regenSafe).toBe(false);
    expect(generateMultiPageZPL(LABEL, imported.pages)).toBe(zpl);
  });

  it('ends a counted payload segment at its declared byte and a hex one at the next command', () => {
    const binary = importZplText('~DYR:BIN,B,G,4,1,abcd\n^XA^FO0,0^XGR:BIN.GRF,1,1^FS^XZ', 8);
    expect(uploadSegments(defined(binary.pages[0])).map((seg) => seg.text)).toEqual(['~DYR:BIN,B,G,4,1,abcd']);
    const hex = importZplText(`${DG}\n\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
    expect(uploadSegments(defined(hex.pages[0])).map((seg) => seg.text)).toEqual([`${DG}\n\n`]);
    expect(generateMultiPageZPL(LABEL, hex.pages)).toBe(`${DG}\n\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`);
  });

  it('re-ships an upload the density pass regenerated away, even with nothing edited', () => {
    const zpl = `^XA^FO0,0^GB10,10,1^FS^XZ\n${DG}\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    const [first, second] = imported.pages;
    const { head: _head, ...headless } = defined(defined(first).overlay);
    const out = generateMultiPageZPL({ ...LABEL, jmDensity: 'B' }, [{ ...defined(first), overlay: headless }, defined(second)]);
    expect(out).toContain('^JMB');
    expect(out.match(/~D[GY]R:LOGO/g)).toHaveLength(1);
    expect(out.indexOf('~DYR:LOGO')).toBeLessThan(out.indexOf('^XGR:LOGO'));
  });

  it('keeps a trailing space byte of a counted binary payload as data', () => {
    const zpl = '~DYR:BIN,B,G,4,1,abc \n^XA^FO0,0^XGR:BIN.GRF,1,1^FS^XZ';
    const imported = importZplText(zpl, 8);
    expect(imported.report.findings).toEqual([]);
    const page = defined(imported.pages[0]);
    expect(props(defined(page.objects[0])).storedAs).toMatchObject({ name: 'BIN', embedInZpl: true });
    expect(uploadSegments(page).map((seg) => seg.text)).toEqual(['~DYR:BIN,B,G,4,1,abc ']);
    expect(generateMultiPageZPL(LABEL, imported.pages)).toBe(zpl);
  });

  it('keeps an upload that only an earlier, recall-only reference names', () => {
    const zpl = `^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ\n${DG}\n^XA^FO0,50^GB10,10,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    expect(generateMultiPageZPL(LABEL, imported.pages)).toBe(zpl);
    const [first, second] = imported.pages;
    const box = defined(defined(second).objects[0]);
    const out = generateMultiPageZPL(LABEL, [defined(first), { ...defined(second), objects: [{ ...box, x: 20, dirty: true }] }]);
    expect(out).toContain(DG);
    expect(out).not.toContain('~DY');
  });

  it('does not ship again from a regenerated recall page while the carrier still replays the upload', () => {
    const zpl = `^XA${DG}^FO0,0^GB10,10,1^FS^XZ\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    const [first, second] = imported.pages;
    const out = generateMultiPageZPL(LABEL, [defined(first), { ...defined(second), overlay: undefined }]);
    expect(out.match(/~D[GY]R:LOGO/g)).toHaveLength(1);
    expect(out).toContain(DG);
  });

  it('ships the model upload ahead of a legacy overlay that still replays its own', () => {
    const zpl = `^XA^FO0,0^GB10,10,1^FS^XZ\n^XA${DG}^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    const [first, second] = imported.pages;
    const stored = defined(defined(second).overlay);
    const legacy = { ...stored, segments: stored.segments.map((seg) => (seg.kind === 'upload' ? { kind: 'raw' as const, text: seg.text } : seg)) };
    expect(generateMultiPageZPL(LABEL, [defined(first), { ...defined(second), overlay: legacy }])).toBe(zpl);
    const box = defined(defined(first).objects[0]);
    const out = generateMultiPageZPL(LABEL, [{ ...defined(first), objects: [{ ...box, x: 20, dirty: true }] }, { ...defined(second), overlay: legacy }]);
    expect(out).toContain('~DYR:LOGO');
    expect(out.indexOf('~DYR:LOGO')).toBeLessThan(out.indexOf(DG));
  });

  it('recognises a lowercase upload, so the regenerated page ships it once', () => {
    const lower = importZplText(`~dgR:LOGO.GRF,4,1,${HEX}\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^FO0,50^GB10,10,1^FS^XZ`, 8);
    const page = defined(lower.pages[0]);
    const [img, box] = page.objects;
    const out = generateMultiPageZPL(LABEL, [{ ...page, objects: [defined(img), { ...defined(box), x: 20, dirty: true }] }]);
    expect(out.match(/~d[gy]r:logo/gi)).toHaveLength(1);
  });

  it('re-uploads an image whose bytes changed instead of replaying the old upload', () => {
    const imported = importZplText(`${DG}\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
    const page = defined(imported.pages[0]);
    const img = defined(page.objects[0]);
    const inverted = '^GFA,4,4,1,FF0000FF';
    const changed = { ...img, dirty: true, props: { ...props(img), _gfaCache: inverted } };
    const out = generateMultiPageZPL(LABEL, [{ ...page, objects: [changed as never] }]);
    expect(out).toContain('~DYR:LOGO,A,G,4,1,FF0000FF');
    expect(out).not.toContain(HEX);
  });

  it('keeps a replayed delete on an earlier page ahead of the regenerated upload', () => {
    const zpl = `^XA^IDR:*.GRF^FS^FO0,0^GB10,10,1^FS^XZ\n^XA${DG}^FO0,0^XGR:LOGO.GRF,1,1^FS^FO0,50^GB10,10,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    expect(generateMultiPageZPL(LABEL, imported.pages)).toBe(zpl);
    const [first, second] = imported.pages;
    const img = defined(defined(second).objects[0]);
    const out = generateMultiPageZPL(LABEL, [defined(first), { ...defined(second), objects: [{ ...img, dirty: true, props: { ...props(img), _gfaCache: '^GFA,4,4,1,FF0000FF' } } as never] }]);
    expect(out.indexOf('^IDR:*.GRF')).toBeGreaterThanOrEqual(0);
    expect(out.indexOf('^IDR:*.GRF')).toBeLessThan(out.indexOf('~DYR:LOGO'));
    expect(out.indexOf('~DYR:LOGO')).toBeLessThan(out.indexOf('^XGR:LOGO'));
    expect(out.match(/~D[GY]R:LOGO/g)).toHaveLength(1);
  });

  it('ships a graphic the model stores on a page whose bytes never carried an upload', () => {
    const zpl = '^XA^FX keep^FS^FO0,0^GFA,4,4,1,00FFFF00^FS^FO0,50^GB10,10,1^FS^XZ';
    const imported = importZplText(zpl, 8);
    const page = defined(imported.pages[0]);
    const [gf, box] = page.objects;
    const stored = { ...defined(gf), dirty: true, props: { ...props(gf), storedAs: { device: 'R', name: 'GFX0001' } } };
    const out = generateMultiPageZPL(LABEL, [{ ...page, objects: [stored as never, defined(box)] }]);
    expect(out.indexOf(`~DYR:GFX0001,A,G,4,1,${HEX}`)).toBe(0);
    expect(out).toContain('^XGR:GFX0001.GRF,1,1');
    expect(out).toContain('^FX keep');
    expect(out).not.toContain('^GFA');
  });

  it('ships the upload with the page an image moved to, and no longer with the page it left', () => {
    const zpl = `^XA^FO0,0^GB10,10,1^FS^XZ\n^XA${DG}^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    const [first, second] = imported.pages;
    const img = defined(defined(second).objects[0]);
    const out = generateMultiPageZPL(LABEL, [
      { ...defined(first), objects: [...defined(first).objects, { ...img, dirty: true }] },
      { ...defined(second), objects: [] },
    ]);
    expect(out.match(/~D[GY]R:LOGO/g)).toHaveLength(1);
    expect(out.indexOf('~DYR:LOGO')).toBeLessThan(out.indexOf('^XGR:LOGO'));
    expect(out.indexOf('^XGR:LOGO')).toBeLessThan(out.indexOf('^XZ'));
  });

  it('replays a later page that neither carries nor recalls the upload, delete and all', () => {
    const zpl = `${DG}\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^FO0,50^GB10,10,1^FS^XZ\n^XA^IDR:OTHER.GRF^FS^FX keep^FS^FO0,0^GB10,10,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    expect(imported.pages.map(uploadKeys)).toEqual([['R:LOGO.GRF'], []]);
    const [first, second] = imported.pages;
    const box = defined(defined(first).objects[1]);
    const out = generateMultiPageZPL(LABEL, [{ ...defined(first), objects: [defined(defined(first).objects[0]), { ...box, x: 20, dirty: true }] }, defined(second)]);
    expect(out.startsWith(`${DG}\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS`)).toBe(true);
    expect(out).not.toContain('~DY');
    expect(out.endsWith('^XA^IDR:OTHER.GRF^FS^FX keep^FS^FO0,0^GB10,10,1^FS^XZ')).toBe(true);
  });

  it('keeps the upload in the carrier tail when an object on that page moves', () => {
    const zpl = `^XA^FO0,0^GB10,10,1^FS^IDR:OTHER.GRF^FS^XZ\n${DG}\n^XA^FX keep^FS^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    expect(imported.pages.map(uploadKeys)).toEqual([['R:LOGO.GRF'], []]);
    expect(imported.pages.map((p) => p.overlay?.regenSafe)).toEqual([true, true]);
    const [first, second] = imported.pages;
    const box = defined(defined(first).objects[0]);
    const out = generateMultiPageZPL(LABEL, [{ ...defined(first), objects: [{ ...box, x: 20, dirty: true }] }, defined(second)]);
    expect(out.match(/~D[GY]R:LOGO/g)).toHaveLength(1);
    expect(out).toContain(`^IDR:OTHER.GRF^FS^XZ\n${DG}\n^XA^FX keep^FS^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`);
  });

  it('keeps the upload segment through the saved overlay', () => {
    const imported = importZplText(`${DG}\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
    const overlay = defined(defined(imported.pages[0]).overlay);
    const parsed = blockOverlaySchema.parse(JSON.parse(JSON.stringify(overlay)));
    expect(parsed.segments.find((seg) => seg.kind === 'upload')).toMatchObject({ key: 'R:LOGO.GRF', text: `${DG}\n` });
  });

  it('drops a stream upload once nothing exported recalls it', () => {
    const zpl = `${DG}\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^FO0,50^GB10,10,1^FS^XZ`;
    const imported = importZplText(zpl, 8);
    const page = defined(imported.pages[0]);
    const [img, box] = page.objects;
    const removed = generateMultiPageZPL(LABEL, [{ ...page, objects: [defined(box)] }]);
    expect(removed).not.toMatch(/~D[GY]/);
    expect(removed).toContain('^GB');
    const hidden = generateMultiPageZPL(LABEL, [{ ...page, objects: [{ ...defined(img), includeInExport: false }, defined(box)] }]);
    expect(hidden).not.toMatch(/~D[GY]/);
    const twice = importZplText(`${DG}\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^FO0,50^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
    const twoPage = defined(twice.pages[0]);
    const oneLeft = generateMultiPageZPL(LABEL, [{ ...twoPage, objects: twoPage.objects.slice(1) }]);
    expect(oneLeft.match(/~D[GY]/g)).toHaveLength(1);
  });

  it('flags a short upload on its own segment and leaves the page regen-safe', () => {
    const before = importZplText(`^XA^FO0,0^GB10,10,1^FS^XZ
^XA~DGR:LOGO.GRF,8,1,${HEX}^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
    expect(before.pages.map((p) => uploadSegments(p).map((seg) => seg.short))).toEqual([[], [true]]);
    expect(before.pages.map((p) => p.overlay?.regenSafe)).toEqual([true, true]);
    const after = importZplText(`~DGR:LOGO.GRF,8,1,${HEX}
^XA^FO0,0^GB10,10,1^FS^XZ
^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
    expect(after.pages.map((p) => uploadSegments(p).map((seg) => seg.short))).toEqual([[true], []]);
    expect(after.pages.map((p) => p.overlay?.regenSafe)).toEqual([true, true]);
  });

  it('regenerates a short payload with the count it really carries', () => {
    // The overlay replays the source bytes as they were; only a regenerated stream must not repeat the fault.
    const { objects } = parseSingle(`~DGR:LOGO.GRF,8,1,${HEX}\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
    expect(props(objects[0])._gfaCache).toBe(`^GFA,4,4,1,${HEX}`);
    const out = generateZPL(LABEL, objects);
    expect(out).toContain(`~DYR:LOGO,A,G,4,1,${HEX}`);
    expect(out).not.toContain(',8,1,');
  });

  it('reports a wrong-prefix setup or device code once, as unknown', () => {
    expect(parseSingle('^XA^TA010^XZ', 8).findings.map((f) => [f.kind, f.command])).toEqual([['unknown', '^TA010']]);
    expect(parseSingle('^XA^JA^XZ', 8).findings.map((f) => [f.kind, f.command])).toEqual([['unknown', '^JA']]);
    const r = parseSingle('^XA^FO10,10^GB50,50,50^FS~XZ', 8);
    expect(commandsOf(r, 'unknown')).toEqual(['~XZ']);
    expect(r.unbalanced?.kind).toBe('unclosedXa');
  });

  it('names the target of a device action from the loop, whatever the command', () => {
    const { findings } = parseSingle('^XA^JIR:PROG.BAS^XZ', 8);
    expect(findings.map((f) => [f.kind, f.command])).toEqual([['deviceAction', '^JIR:PROG.BAS']]);
  });

  it('resolves and deletes object names without regard to case or a missing device', () => {
    const lower = parseSingle(`~DGR:logo,4,1,${HEX}\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
    expect(props(lower.objects[0]).widthDots).toBe(8);
    const font = parseSingle('~DYFNT,A,T,4,,01020304\n^XA^IDR:*.*^FS^XZ', 8);
    expect(font.uploadedFontPaths).toEqual([]);
  });

  it('names a failed checksum as its own cause', () => {
    const field = makeZ64Field(new Uint8Array([0, 0xff, 0xff, 0])).replace(/:[0-9A-F]{4}$/, ':0000');
    const { findings } = parseSingle(`~DYR:LOGO,C,G,4,1,${field}\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
    expect(findings.map((f) => [f.command, f.loss])).toEqual([['~DY', 'checksumMismatch']]);
  });

  it('keeps a wrong-prefix spelling out of the handlers', () => {
    const caretDg = parseSingle(`^XA^DGR:LOGO.GRF,4,1,${HEX}^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
    expect(props(caretDg.objects[0]).widthDots).toBe(200);
    expect(commandsOf(caretDg, 'unknown')).toEqual([`^DGR:LOGO.GRF,4,1,${HEX}`]);
    const caretEg = parseSingle(`${DG}\n^XA^EG^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
    expect(props(caretEg.objects[0]).widthDots).toBe(8);
    expect(commandsOf(caretEg, 'unknown')).toEqual(['^EG']);
    const tildeFo = parseSingle('^XA~FO10,10^GB10,10,1^FS^XZ', 8);
    expect(commandsOf(tildeFo, 'unknown')).toEqual(['~FO10,10']);
  });

  it('caps the report token of a ~DY that lost its header', () => {
    const { findings } = parseSingle(`^XA~DYR:X,A,G,${'F'.repeat(300)}^XZ`, 8);
    const [token] = commandsOf({ findings }, 'browserLimit');
    expect(token?.startsWith('~DYR:X,A,G,')).toBe(true);
    expect(defined(token).length).toBeLessThan(100);
  });

  it('re-exports an untouched upload verbatim', () => {
    const imported = importZplText(`${DG}\n^XA^FO50,80^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
    expect(generateMultiPageZPL(LABEL, imported.pages)).toContain(DG);
  });
});

describe('parseZPL — recall paths', () => {
  it('reads the path up to the line break', () => {
    const { objects, findings } = parseSingle(`${DY}\n^XA\n^FO10,10\n^XGR:LOGO.GRF\n^FS\n^XZ`, 8);
    expect(props(objects[0]).widthDots).toBe(8);
    expect(props(objects[0]).storedAs).toEqual(STORED);
    expect(findings).toEqual([]);
  });

  it('reads the path up to a CRLF break', () => {
    const { objects, findings } = parseSingle(`${DY}\r\n^XA\r\n^FO10,10\r\n^IMR:LOGO.GRF\r\n^FS\r\n^XZ`, 8);
    expect(props(objects[0]).storedAs).toEqual(STORED_IM);
    expect(findings).toEqual([]);
  });

  it('tolerates trailing parameters ^IM does not define', () => {
    const { objects, findings } = parseSingle(`${DY}\n^XA^FO10,10^IMR:LOGO.GRF,2,2^FS^XZ`, 8);
    expect(props(objects[0]).storedAs).toEqual(STORED_IM);
    expect(findings).toEqual([]);
  });
});

describe('parseZPL — ^IM image move', () => {
  it('resolves an uploaded graphic at the field position', () => {
    const { objects, findings } = parseSingle(`${DG}\n^XA^FO50,80^IMR:LOGO.GRF^FS^XZ`, 8);
    expect(objects.map((o) => [o.type, o.x, o.y])).toEqual([['image', 50, 80]]);
    expect(props(objects[0]).widthDots).toBe(8);
    expect(props(objects[0]).storedAs).toEqual(STORED_IM);
    expect(findings).toEqual([]);
  });

  it('without an upload imports as a recall-only placeholder', () => {
    const { objects, findings } = parseSingle('^XA^FO50,80^IMR:LOGO.GRF^FS^XZ', 8);
    expect(objects.map((o) => o.type)).toEqual(['image']);
    expect(props(objects[0]).storedAs).toEqual({ device: 'R', name: 'LOGO', recall: 'IM', embedInZpl: false });
    expect(props(objects[0]).widthDots).toBe(200);
    expect(commandsOf({ findings }, 'partial')).toEqual(['^IM']);
    expect(findings).toHaveLength(1);
  });

  it('keeps a .PNG reference together with the ^IM that named it', () => {
    const { objects } = parseSingle('^XA^FO50,80^IMR:LOGO.PNG^FS^XZ', 8);
    expect(props(objects[0]).storedAs).toEqual({ device: 'R', name: 'LOGO', ext: 'PNG', recall: 'IM', embedInZpl: false });
    const zpl = generateZPL(LABEL, objects);
    expect(zpl).toContain('^IMR:LOGO.PNG^FS');
    expect(zpl).not.toContain('^XG');
  });

  it('reports a magnified ^XG as partial, the preview stays at stored size, the export keeps the factors', () => {
    const { objects, findings } = parseSingle(`${DG}\n^XA^FO50,80^XGR:LOGO.GRF,2,3^FS^XZ`, 8);
    expect(props(objects[0]).widthDots).toBe(8);
    expect(props(objects[0]).storedAs).toEqual({ ...STORED, magnify: { x: 2, y: 3 } });
    expect(generateZPL(LABEL, objects)).toContain('^XGR:LOGO.GRF,2,3^FS');
    expect(findings.map((f) => [f.kind, f.command, f.loss])).toEqual([['partial', '^XG', 'recallMagnification']]);
    const plain = parseSingle(`${DG}\n^XA^FO50,80^XGR:LOGO.GRF,1,^FS^XZ`, 8);
    expect(plain.findings).toEqual([]);
  });

  it('lets a missed recall report the missing upload, not the magnification', () => {
    const { findings } = parseSingle('^XA^FO50,80^XGR:GONE.GRF,2,3^FS^XZ', 8);
    expect(findings.map((f) => [f.command, f.loss])).toEqual([['^XG', undefined]]);
  });

  it('leaves a .PNG under ^XG as the source wrote it, printing nothing either way', () => {
    const { objects } = parseSingle('^XA^FO50,80^XGR:LOGO.PNG,1,1^FS^XZ', 8);
    expect(props(objects[0]).storedAs).toEqual({ device: 'R', name: 'LOGO', ext: 'PNG', embedInZpl: false });
    expect(generateZPL(LABEL, objects)).toContain('^XGR:LOGO.PNG,1,1^FS');
  });
});

describe('generateZPL — stored-graphic recall', () => {
  it('keeps the reference as written while no upload ships', () => {
    const zpl = generateZPL(LABEL, image({ storedAs: { device: 'R', name: 'LOGO', ext: 'PNG', recall: 'IM', embedInZpl: true } }));
    expect(zpl).not.toContain('~DY');
    expect(zpl).toContain('^IMR:LOGO.PNG^FS');
  });

  it('writes only magnification the spec allows', () => {
    const zpl = generateZPL(LABEL, image({ storedAs: { device: 'R', name: 'LOGO', magnify: { x: 11, y: 0 }, embedInZpl: false } }));
    expect(zpl).toContain('^XGR:LOGO.GRF,1,1^FS');
  });

  it('treats an empty extension as the implicit .GRF', () => {
    const zpl = generateZPL(LABEL, image({ storedAs: { device: 'R', name: 'LOGO', ext: '', embedInZpl: false } }));
    expect(zpl).toContain('^XGR:LOGO.GRF,1,1^FS');
  });

  it('recalls the .GRF the ~DY upload stores once the bytes ship', () => {
    const zpl = generateZPL(LABEL, image({
      _gfaCache: `^GFA,4,4,1,${HEX}`,
      storedAs: { device: 'R', name: 'LOGO', ext: 'PNG', embedInZpl: true },
    }));
    expect(zpl).toContain('~DYR:LOGO,A,G,4,1,');
    expect(zpl).toContain('^XGR:LOGO.GRF,1,1^FS');
  });
});

describe('parseZPL — ^IL image load', () => {
  const PAGE = '^XA^ILR:BG.GRF^FS^HT^FO40,40^GB100,100,3^FS^XZ';

  it('anchors the recall at the label origin ahead of the fields', () => {
    const { objects } = parseSingle(PAGE, 8);
    expect(objects.map((o) => [o.type, o.x, o.y])).toEqual([['image', 0, 0], ['box', 40, 40]]);
    expect(props(objects[0]).storedAs).toEqual({ device: 'R', name: 'BG', recall: 'IM', embedInZpl: false });
  });

  it('folds the label home like ^FO0,0 would', () => {
    const { objects } = parseSingle('^XA^LH50,50^ILR:BG.GRF^FS^FO0,0^GB10,10,1^FS^XZ', 8);
    expect(objects.map((o) => [o.x, o.y])).toEqual([[50, 50], [50, 50]]);
  });

  it('resolves an uploaded graphic at the label origin', () => {
    const { objects, findings } = parseSingle(`~DGR:BG.GRF,4,1,${HEX}\n^XA^ILR:BG.GRF^FS^XZ`, 8);
    expect(props(objects[0]).widthDots).toBe(8);
    expect(findings).toEqual([]);
  });

  it('keeps the page overlay, so untouched neighbours re-export verbatim', () => {
    const imported = importZplText(PAGE, 8);
    expect(generateMultiPageZPL(LABEL, imported.pages)).toBe(PAGE);
  });

  it('re-emits a moved image as ^IM at its new origin', () => {
    const imported = importZplText(PAGE, 8);
    const page = defined(imported.pages[0]);
    const [bg, ...rest] = page.objects;
    const moved = { ...page, objects: [{ ...defined(bg), x: 10, dirty: true }, ...rest] };
    expect(generateMultiPageZPL(LABEL, [moved])).toContain('^FO10,0^IMR:BG.GRF^FS');
  });

  it('precedes the variable fields without a ^FS of its own, as the spec writes it', () => {
    // Spec p.183: `^XA ^ILR:LOGO.PNG ^XZ` merges the saved format with the fields that follow.
    const zpl = '^XA\n^ILR:LOGO.PNG\n^FO100,100^A0N,50,50^FDvariable^FS\n^XZ';
    const r = parseSingle(zpl, 8, { captureOverlay: true });
    expect(r.objects.map((o) => [o.type, o.x, o.y])).toEqual([['image', 0, 0], ['text', 100, 92.3]]);
    expect(r.findings.map((f) => f.kind)).toEqual(['partial']);
    const span = defined(r.objectSpans?.get(defined(r.objects[0]).id));
    expect(zpl.slice(span.start, span.end)).toBe('^ILR:LOGO.PNG');
    const imported = importZplText(zpl, 8);
    expect(generateMultiPageZPL(LABEL, imported.pages)).toBe(zpl);
  });

  it('leaves a ^FX run before the next field to that field', () => {
    const zpl = '^XA^ILR:BG.GRF^FXnote^FO10,10^GB10,10,1^FS^XZ';
    const r = parseSingle(zpl, 8, { captureOverlay: true });
    expect(r.objects.map((o) => o.comment)).toEqual([undefined, 'note']);
    const span = defined(r.objectSpans?.get(defined(r.objects[0]).id));
    expect(zpl.slice(span.start, span.end)).toBe('^ILR:BG.GRF');
  });

  it('without a path reports the command and creates no object', () => {
    const { objects, findings } = parseSingle('^XA^IL^FO10,10^A0N,20,20^FDx^FS^XZ', 8);
    expect(objects.map((o) => o.type)).toEqual(['text']);
    expect(findings.map((f) => [f.kind, f.command])).toEqual([['browserLimit', '^IL']]);
  });

  it('inside an open field becomes that field\'s content, at the origin, and nothing links', () => {
    const r = parseSingle('^XA^FO10,10^A0N,20,20^FDhi^ILR:BG.GRF^FS^XZ', 8, { captureOverlay: true });
    expect(r.objects.map((o) => [o.type, o.x, o.y])).toEqual([['image', 0, 0], ['text', 10, 6.92]]);
    expect(r.findings.map((f) => f.kind)).toEqual(['partial']);
    expect(r.objectSpans?.size ?? 0).toBe(0);
  });

  it('binds a ^CW alias to its upload whatever case the two spell the path in', () => {
    const r = parseSingle('~DYE:DSGN,A,T,4,,01020304\n^XA^CWM,e:dsgn.ttf^XZ', 8);
    expect(r.labelConfig.customFonts?.[0]?.embedInZpl).toBe(true);
  });

  it('caps a device action naming a long target, like every other finding', () => {
    const { findings } = parseSingle(`^XA^IDR:${'X'.repeat(500)}.GRF^FS^XZ`, 8);
    expect(defined(findings[0]).command.length).toBeLessThan(100);
  });

  it('links each of two consecutive recalls to its own bytes', () => {
    const zpl = `~DGR:A.GRF,4,1,${HEX}\n^XA^ILR:A.GRF^ILR:B.GRF^FS^FO10,10^GB10,10,1^FS^XZ`;
    const r = parseSingle(zpl, 8, { captureOverlay: true });
    const spans = r.objects.map((o) => { const sp = defined(r.objectSpans?.get(o.id)); return zpl.slice(sp.start, sp.end); });
    expect(spans).toEqual(['^ILR:A.GRF', '^ILR:B.GRF', '^FO10,10^GB10,10,1^FS']);
    const imported = importZplText(zpl, 8);
    expect(generateMultiPageZPL(LABEL, imported.pages)).toBe(zpl);
  });

  it('does not let a rejected ^IL take over the open recall', () => {
    const zpl = '^XA^ILR:A.GRF^IL^FO10,10^GB10,10,1^FS^XZ';
    const r = parseSingle(zpl, 8, { captureOverlay: true });
    const span = defined(r.objectSpans?.get(defined(r.objects[0]).id));
    expect(zpl.slice(span.start, span.end).startsWith('^ILR:A.GRF')).toBe(true);
    const imported = importZplText(zpl, 8);
    expect(generateMultiPageZPL(LABEL, imported.pages)).toBe(zpl);
  });

  it('needs no ^FS before a field appended behind it', () => {
    const imported = importZplText('^XA^ILR:BG.GRF^XZ', 8);
    const page = defined(imported.pages[0]);
    expect(page.overlay?.openTail).toBeUndefined();
  });

  it('keeps its own bytes while text without an opener stays unlinked', () => {
    const zpl = '^XA^ILR:A.GRF^A0N,20,20^FDx^FS^XZ';
    const r = parseSingle(zpl, 8, { captureOverlay: true });
    expect(r.objects.map((o) => o.type)).toEqual(['image', 'text']);
    const span = defined(r.objectSpans?.get(defined(r.objects[0]).id));
    expect(zpl.slice(span.start, span.end)).toBe('^ILR:A.GRF');
    expect(r.objectSpans?.size).toBe(1);
  });

  it('owns the ^FX run it took as its comment, so a move re-emits the comment once', () => {
    const zpl = '^XA^FXnote^ILR:BG.GRF^FO40,40^GB100,100,3^FS^XZ';
    const parsed = parseSingle(zpl, 8, { captureOverlay: true });
    const span = defined(parsed.objectSpans?.get(defined(parsed.objects[0]).id));
    expect(zpl.slice(span.start, span.end)).toBe('^FXnote^ILR:BG.GRF');
    const page = defined(importZplText(zpl, 8).pages[0]);
    const [bg, ...rest] = page.objects;
    expect(defined(bg).comment).toBe('note');
    const out = generateMultiPageZPL(LABEL, [{ ...page, objects: [{ ...defined(bg), x: 10, dirty: true }, ...rest] }]);
    expect(out.match(/\^FXnote/g)).toHaveLength(1);
    expect(out).toContain('^FO10,0^IMR:BG.GRF^FS');
  });

  it('owns only its own token, so commands after it survive a move', () => {
    const zpl = '^XA^ILR:BG.GRF^CI28^FO40,40^GB100,100,3^FS^XZ';
    const imported = importZplText(zpl, 8);
    const page = defined(imported.pages[0]);
    const [bg, ...rest] = page.objects;
    const moved = { ...page, objects: [{ ...defined(bg), x: 10, dirty: true }, ...rest] };
    const out = generateMultiPageZPL(LABEL, [moved]);
    expect(out).toContain('^CI28');
    expect(out).toContain('^FO10,0^IMR:BG.GRF^FS');
  });

  it('creates its image when ^XZ closes the format', () => {
    const { objects } = parseSingle('^XA^ILR:BG.GRF^XZ', 8);
    expect(objects.map((o) => o.type)).toEqual(['image']);
  });
});

describe('parseZPL — ^ID and ^IS storage actions', () => {
  it('reports the delete with its target and creates no object', () => {
    const zpl = '^XA^IDR:LOGO.GRF^FS^FO40,40^GB100,100,3^FS^XZ';
    const { objects, findings } = parseSingle(zpl, 8);
    expect(objects.map((o) => o.type)).toEqual(['box']);
    expect(findings.map((f) => [f.kind, f.command])).toEqual([['deviceAction', '^IDR:LOGO.GRF']]);
    const span = defined(findingsOf({ findings }, 'deviceAction')[0]?.span);
    expect(zpl.slice(span.start, span.end)).toBe('^IDR:LOGO.GRF');
  });

  it('deletes the upload in stream order, so a later recall misses like on the printer', () => {
    const { objects, findings } = parseSingle(`${DG}\n^XA^IDR:LOGO.GRF^FS^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
    expect(props(objects[0]).widthDots).toBe(200);
    expect(findings.map((f) => f.kind).sort()).toEqual(['deviceAction', 'partial']);
  });

  it('honours wildcards and ignores case, but never another device', () => {
    const recall = '^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ';
    const hits = (id: string) => props(parseSingle(`${DG}\n^XA^ID${id}^FS${recall}`, 8).objects[0]).widthDots === 8;
    expect(hits('R:*.GRF')).toBe(false);
    expect(hits('R:LOGO.*')).toBe(false);
    expect(hits('r:logo.grf')).toBe(false);
    expect(hits('E:LOGO.GRF')).toBe(true);
    expect(hits('R:LOGO.PNG')).toBe(true);
    expect(hits('LOGO.GRF')).toBe(false);
  });

  it('takes R: for an upload without a device and searches the devices for a recall without one', () => {
    const { objects, findings } = parseSingle(`~DGLOGO.GRF,4,1,${HEX}\n^XA^FO50,80^XGLOGO.GRF,1,1^FS^XZ`, 8);
    expect(props(objects[0]).widthDots).toBe(8);
    expect(props(objects[0]).storedAs).toEqual({ name: 'LOGO', embedInZpl: true });
    expect(findings).toEqual([]);
    const flash = parseSingle(`~DGE:LOGO.GRF,4,1,${HEX}\n^XA^FO50,80^XG:LOGO.GRF,1,1^FS^XZ`, 8);
    expect(props(flash.objects[0]).widthDots).toBe(8);
    const il = parseSingle('^XA^ILBG.GRF^FS^XZ', 8);
    expect(props(il.objects[0]).storedAs).toEqual({ device: 'R', name: 'BG', recall: 'IM', embedInZpl: false });
  });

  it('re-emits a device-less reference as written and uploads it once', () => {
    const zpl = generateZPL(LABEL, [
      ...image({ _gfaCache: `^GFA,4,4,1,${HEX}`, storedAs: { name: 'LOGO', embedInZpl: true } }),
      { id: 'j', type: 'image', x: 30, y: 40, rotation: 0,
        props: { imageId: '', widthDots: 8, heightDots: 4, threshold: 128, _gfaCache: `^GFA,4,4,1,${HEX}`, storedAs: { device: 'R', name: 'LOGO', embedInZpl: true } } },
    ] as never);
    expect(zpl.match(/~DY/g)).toHaveLength(1);
    expect(zpl).toContain('^XGLOGO.GRF,1,1^FS');
    expect(zpl).toContain('^XGR:LOGO.GRF,1,1^FS');
  });

  it('reads an empty device on ^ID as R:', () => {
    const { objects } = parseSingle(`${DG}\n^XA^ID:LOGO.GRF^FS^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
    expect(props(objects[0]).widthDots).toBe(200);
  });

  it('applies the .GRF default of ^ID to a bare name', () => {
    const { objects } = parseSingle(`${DG}\n^XA^IDR:LOGO^FS^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
    expect(props(objects[0]).widthDots).toBe(200);
  });

  it('stops a ^CW alias for later fields but keeps the mapping earlier fields use', () => {
    const font = '~DYE:DSGN,A,T,4,,01020304';
    const zpl = `${font}\n^XA^CWM,E:DSGN.TTF^FO0,0^AMN,20,20^FDbefore^FS^IDE:*.*^FS^FO0,50^AMN,20,20^FDafter^FS^XZ`;
    const r = parseSingle(zpl, 8);
    expect(r.labelConfig.customFonts?.map((m) => m.path)).toEqual(['E:DSGN.TTF']);
    expect(r.objects.map((o) => props(o).fontId)).toEqual(['M', 'M']);
    expect(commandsOf(r, 'partial')).toEqual(['^AM']);
  });

  it('keeps one partial per command and cause, each at its own bytes', () => {
    const zpl = `${DG}\n^XA^FO0,0^XGR:LOGO.GRF,2,2^FS^FO0,50^XGR:GONE.GRF,1,1^FS^XZ`;
    const { report } = importZplText(zpl, 8);
    expect(report.findings.filter((f) => f.kind === 'partial').map((f) => [f.command, f.loss, zpl.slice(f.span?.start, f.span?.end)])).toEqual([
      ['^XG', 'recallMagnification', '^XGR:LOGO.GRF,2,2'],
      ['^XG', undefined, '^XGR:GONE.GRF,1,1'],
    ]);
    expect(report.partial).toEqual(['^XG']);
  });

  it('clears R: graphics on ~EG, as ^ID with its defaults would', () => {
    const { objects, findings } = parseSingle(`${DG}\n^XA~EG^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ`, 8);
    expect(props(objects[0]).widthDots).toBe(200);
    expect(findings.map((f) => [f.kind, f.command]).sort()).toEqual([['deviceAction', '~EG'], ['partial', '^XG']]);
    const flash = parseSingle(`~DGE:LOGO.GRF,4,1,${HEX}\n^XA~EG^FO0,0^XGE:LOGO.GRF,1,1^FS^XZ`, 8);
    expect(props(flash.objects[0]).widthDots).toBe(8);
  });

  it('spells the token with the caret the source used', () => {
    const { findings } = parseSingle('^XA^CC#\n#IDR:L.GRF#FS#XZ', 8);
    expect(findings.map((f) => [f.kind, f.command])).toEqual([['deviceAction', '#IDR:L.GRF']]);
  });

  it('keeps distinct delete targets apart in the report', () => {
    const { report } = importZplText('^XA^IDR:A.GRF^FS^IDE:*.GRF^FS^IDR:A.GRF^FS^XZ', 8);
    expect(report.deviceAction).toEqual(['^IDR:A.GRF', '^IDE:*.GRF']);
  });

  it('reports the image save with its target', () => {
    const { findings } = parseSingle('^XA^FO40,40^GB100,100,3^FS^ISR:SAMPLE.GRF,N^XZ', 8);
    expect(findings.map((f) => [f.kind, f.command])).toEqual([['deviceAction', '^ISR:SAMPLE.GRF,N']]);
  });
});

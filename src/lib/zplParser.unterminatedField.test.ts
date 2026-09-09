import { describe, it, expect } from 'vitest';
import { parseZPL, type ImportFindingKind } from '@zplab/core/lib/zplParser';
import { getObjectStringContent } from '@zplab/core/lib/variableBinding';
import { blockOverlaySchema } from '@zplab/core/lib/zplOverlay/overlay';
import { commandsOf, defined, findingsOf, parseSingle, serialOf } from '../test/helpers';

// ZD230-measured (2026-09-09): a field's content since ^FO/^FT is discarded
// when the next ^FO/^FT arrives without ^FS, for text, ^FT fields and ^GB
// alike. A field still open at ^XZ prints. Labelary differs for ^GB.
const HEAD = '^XA^PW800^LL1200';

const unterminated = (parsed: { findings: { kind: ImportFindingKind; command: string; span?: { start: number; end: number } }[] }) =>
  findingsOf(parsed, 'unterminatedField');

describe('parseZPL — field without ^FS before the next ^FO/^FT', () => {
  it('drops the text field the printer drops and anchors the finding on its bytes', () => {
    const dropped = '^FO40,40^A0N,60,60^FDalpha';
    const zpl = `${HEAD}${dropped}^FO40,200^A0N,60,60^FDbeta^FS^XZ`;
    const r = parseSingle(zpl, 8);
    expect(r.objects.map(getObjectStringContent)).toEqual(['beta']);
    const [f, ...more] = unterminated(r);
    expect(more).toEqual([]);
    expect(f?.command).toBe('^FO40,40');
    expect(zpl.slice(defined(f?.span).start, defined(f?.span).end)).toBe(dropped);
  });

  it('treats ^FT the same as ^FO', () => {
    const r = parseSingle(`${HEAD}^FT40,100^A0N,60,60^FDalpha^FT40,260^A0N,60,60^FDbeta^FS^XZ`, 8);
    expect(r.objects).toHaveLength(1);
    expect(commandsOf(r, 'unterminatedField')).toEqual(['^FT40,100']);
  });

  it('takes back a graphic pushed at its command (^GB is dropped too)', () => {
    const r = parseSingle(`${HEAD}^FO40,40^GB200,100,4^FO40,200^A0N,60,60^FDbeta^FS^XZ`, 8);
    expect(r.objects.map((o) => o.type)).toEqual(['text']);
    expect(commandsOf(r, 'unterminatedField')).toEqual(['^FO40,40']);
  });

  it('drops the text when the next field is the graphic', () => {
    const r = parseSingle(`${HEAD}^FO40,40^A0N,60,60^FDalpha^FO40,200^GB200,100,4^FS^XZ`, 8);
    expect(r.objects.map((o) => o.type)).toEqual(['box']);
    expect(commandsOf(r, 'unterminatedField')).toEqual(['^FO40,40']);
  });

  it('keeps a bare origin benign: nothing was written, nothing is dropped', () => {
    const r = parseSingle(`${HEAD}^FO10,20^FO30,40^A0N,30,0^FDText^FS^XZ`, 8);
    expect(r.objects).toHaveLength(1);
    expect(unterminated(r)).toEqual([]);
  });

  it('spells the opener with the prefix in force after ^CC', () => {
    const zpl = `^XA^CC#${'#PW800#LL1200'}#FO40,40#A0N,60,60#FDalpha#FO40,200#A0N,60,60#FDbeta#FS#XZ`;
    const r = parseSingle(zpl, 8);
    const f = defined(unterminated(r)[0]);
    expect(f.command).toBe('#FO40,40');
    expect(zpl.slice(defined(f.span).start, defined(f.span).end)).toBe('#FO40,40#A0N,60,60#FDalpha');
  });

  it('keeps the field state armed across the discard, as the printer does (ZD230: ^FH and font)', () => {
    const fh = parseSingle(`${HEAD}^FO10,10^FH^A0N,60,60^FDalpha_41^FO10,60^A0N,60,60^FDb_41_42^FS^XZ`, 8);
    expect(fh.objects.map(getObjectStringContent)).toEqual(['bAB']);
    const font = parseSingle(`${HEAD}^FO40,40^A0N,120,120^FDalpha^FO40,200^FDbeta^FS^XZ`, 8);
    expect((defined(font.objects[0]) as { props: { fontHeight: number } }).props.fontHeight).toBe(120);
    // Measured without data as well: an opener never closes a field.
    const bare = parseSingle(`${HEAD}^FO40,40^A0N,120,120^FO40,200^FDbeta^FS^XZ`, 8);
    expect((defined(bare.objects[0]) as { props: { fontHeight: number } }).props.fontHeight).toBe(120);
  });

  it('treats the one-shot arms as consumed by the dropped ^FD (spec: next ^FD only)', () => {
    const fn = parseSingle(`${HEAD}^FO10,10^A0N,30,30^FN1^FDdefault^FO10,60^A0N,30,30^FDplain^FS^XZ`, 8);
    expect(fn.objects.map(getObjectStringContent)).toEqual(['plain']);
    expect(fn.variables).toEqual([]);
    const fc = parseSingle(`${HEAD}^FO10,10^FC%^A0N,30,30^FD%Y-%m^FO10,60^A0N,30,30^FD%Y^FS^XZ`, 8);
    expect(fc.objects.map(getObjectStringContent)).toEqual(['%Y']);
  });

  it('keeps a previous field whose reverse-bg stash commits inside the dropped field', () => {
    const r = parseSingle(`${HEAD}^FO10,10^GB200,60,60^FS^FO20,20^GC50,3^FO30,30^A0N,30,30^FDb^FS^XZ`, 8);
    expect(r.objects.map((o) => o.type)).toEqual(['line', 'text']);
  });

  it('leaves the ^FX of a dropped field in its bytes instead of on the next object', () => {
    const r = parseSingle(`${HEAD}^FXhello^FO10,10^A0N,30,30^FDa^FO10,60^A0N,30,30^FDb^FS^XZ`, 8);
    expect(r.objects[0]?.comment).toBeUndefined();
  });

  it('gives a ^FX run right before the next opener to that field, outside the finding', () => {
    const zpl = `${HEAD}^FXdrop\n^FO10,10^A0N,30,30^FDa\n^FXnote\n^FO10,60^A0N,30,30^FDb^FS^XZ`;
    const r = parseSingle(zpl, 8, { captureOverlay: true });
    expect(r.objects[0]?.comment).toBe('note');
    const f = defined(unterminated(r)[0]);
    expect(zpl.slice(defined(f.span).start, defined(f.span).end)).toBe('^FO10,10^A0N,30,30^FDa');
    const next = defined(r.objectSpans?.get(defined(r.objects[0]).id));
    expect(next.start).toBeGreaterThanOrEqual(defined(f.span).end);
    expect(zpl.slice(next.start, next.end)).toMatch(/^\^FXnote/);
  });

  it('counts content the model cannot carry: ^IM, a filled ^GB stash', () => {
    const im = parseSingle(`${HEAD}^FO10,10^IMR:LOGO.GRF^FO10,60^A0N,30,30^FDb^FS^XZ`, 8);
    expect(commandsOf(im, 'unterminatedField')).toEqual(['^FO10,10']);
    const stash = parseSingle(`${HEAD}^FO10,10^GB200,60,60^FO40,40^A0N,30,30^FDb^FS^XZ`, 8);
    expect(stash.objects.map((o) => o.type)).toEqual(['text']);
    expect(commandsOf(stash, 'unterminatedField')).toEqual(['^FO10,10']);
  });

  it('consumes ^SF and ^FE with the dropped ^FD', () => {
    const sf = parseSingle(`${HEAD}^SFddd,3^FO10,10^A0N,30,0^FD001^FO20,20^A0N,30,0^FD002^FS^XZ`, 8);
    expect(sf.objects).toHaveLength(1);
    expect(serialOf(sf.objects[0])).toBeUndefined();
    const fe = parseSingle(`${HEAD}^FO10,10^FE#^A0N,30,30^FDdrop^FO10,60^A0N,30,30^FD#1#^FS^XZ`, 8);
    expect(fe.variables).toEqual([]);
    expect(fe.objects.map(getObjectStringContent)).toEqual(['#1#']);
  });

  it('keeps ^FR and a symbology header armed across the discard, like font and ^FH', () => {
    const fr = parseSingle(`${HEAD}^FO10,10^FR^A0N,30,30^FDa^FO10,60^A0N,30,30^FDb^FS^XZ`, 8);
    expect((defined(fr.objects[0]) as { props: { reverse?: boolean } }).props.reverse).toBe(true);
    const bc = parseSingle(`${HEAD}^FO10,10^BY2^BCN,50^FDa^FO10,60^FDb^FS^XZ`, 8);
    expect(bc.objects.map((o) => o.type)).toEqual(['code128']);
  });

  it('reports every dropped field', () => {
    const two = parseSingle(`${HEAD}^FO1,1^FDa^FO2,2^FDb^FO3,3^FDc^FS^XZ`, 8);
    expect(commandsOf(two, 'unterminatedField')).toEqual(['^FO1,1', '^FO2,2']);
  });

  it('spans a CRLF field up to its last token, a device command included', () => {
    const zpl = `${HEAD}\r\n^FO40,40\r\n^A0N,60,60\r\n^FDalpha\r\n~JA\r\n^FO40,200^FDbeta^FS\r\n^XZ`;
    const crlf = parseSingle(zpl, 8);
    const f = defined(unterminated(crlf)[0]);
    expect(zpl.slice(defined(f.span).start, defined(f.span).end)).toBe('^FO40,40\r\n^A0N,60,60\r\n^FDalpha\r\n~JA');
  });

  it('forgets a ^FX run once any other command follows it', () => {
    // An empty ^FX must not revive an older comment, and an unknown command ends the run.
    const empty = parseSingle(`${HEAD}^FXold^FO10,10^A0N,30,30^FDa^FS^FO10,20^A0N,30,30^FDb^FX^FO10,60^A0N,30,30^FDc^FS^XZ`, 8);
    expect(empty.objects[1]?.comment).toBeUndefined();
    const unknown = parseSingle(`${HEAD}^FO10,10^A0N,30,30^FDa^FXnote^ZZZ99^FO10,60^A0N,30,30^FDb^FS^XZ`, 8);
    expect(unknown.objects[0]?.comment).toBeUndefined();
  });

  it('does not let a ^FX after a discard pass for the geometry sidecar', () => {
    const r = parseSingle(`${HEAD}^FO10,10^A0N,30,30^FDa^FO20,20^FXZPLab:{"dpmm":12,"w":50,"h":30}^A0N,30,30^FDb^FS^XZ`, 8);
    expect(r.labelConfig.dpmm).not.toBe(12);
  });
});

describe('parseZPL — field still open at ^XZ', () => {
  it('models the text field the printer prints, without a finding', () => {
    const r = parseSingle(`${HEAD}^FO40,40^A0N,60,60^FDbeta^FS^FO40,280^A0N,60,60^FDgamma^XZ`, 8);
    expect(r.objects.map(getObjectStringContent)).toEqual(['beta', 'gamma']);
    expect(unterminated(r)).toEqual([]);
  });

  it('keeps the graphic the printer prints', () => {
    const r = parseSingle(`${HEAD}^FO40,40^A0N,60,60^FDbeta^FS^FO40,200^GB200,100,4^XZ`, 8);
    expect(r.objects.map((o) => o.type)).toEqual(['text', 'box']);
  });

  it('closes the field per page: the next page starts clean', () => {
    const r = parseZPL(`${HEAD}^FO40,40^A0N,60,60^FDone^XZ${HEAD}^FO40,40^A0N,60,60^FDtwo^FS^XZ`, 8);
    expect(r.pages.map((p) => p.objects.length)).toEqual([1, 1]);
    expect(r.pages.flatMap((p) => unterminated(p))).toEqual([]);
  });

  it('is closed by ^XZ: a stray opener before the next ^XA cannot discard it', () => {
    const zpl = `${HEAD}^FO10,10^A0N,30,30^FDa^XZ^FO99,99^XA^FO10,10^A0N,30,30^FDb^FS^XZ`;
    const r = parseZPL(zpl, 8, { captureOverlay: true });
    expect(r.pages.map((p) => p.objects.map(getObjectStringContent))).toEqual([['a'], ['b']]);
    expect(r.pages.flatMap((p) => unterminated(p))).toEqual([]);
    expect(r.pages[0]?.overlay).toBeDefined();
  });

  it('links the open field for the overlay so a zero-edit export stays byte-exact', () => {
    const zpl = `${HEAD}^FO40,40^A0N,60,60^FDgamma^XZ`;
    const r = parseSingle(zpl, 8, { captureOverlay: true });
    const span = defined(r.objectSpans?.get(defined(r.objects[0]).id));
    expect(zpl.slice(span.start, span.end)).toBe('^FO40,40^A0N,60,60^FDgamma');
    expect(defined(r.overlay).regenSafe).toBe(true);
    expect(defined(r.overlay).openTail).toBe(true);
    expect(parseSingle(`${HEAD}^FO40,40^A0N,60,60^FDgamma^FS^XZ`, 8, { captureOverlay: true }).overlay?.openTail).toBeUndefined();
    // A bare opener at ^XZ has nothing to terminate.
    expect(parseSingle(`${HEAD}^FO40,40^A0N,60,60^FDgamma^FS^FO99,99^XZ`, 8, { captureOverlay: true }).overlay?.openTail).toBeUndefined();
  });

  it('carries its flags through the design-file schema', () => {
    const ov = defined(parseSingle(`${HEAD}^FO1,1^FDa^FO40,40^A0N,60,60^FDgamma^XZ`, 8, { captureOverlay: true }).overlay);
    const back = blockOverlaySchema.parse(JSON.parse(JSON.stringify(ov)));
    expect([back.openTail, back.droppedField]).toEqual([true, true]);
  });
});

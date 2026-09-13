import { describe, it, expect } from 'vitest';
import { parseZPL } from '@zplab/core/lib/zplParser';
import { importZplText } from '@zplab/core/lib/zplImportService';
import { getObjectStringContent } from '@zplab/core/lib/variableBinding';
import { defined, findingsOf, parseSingle } from '../test/helpers';

// ZD230-measured (2026-09-13/14): a ^FH-decoded 00, 0A, 0C or 0D ends the printed text of a
// field, under ^FB as well. 09 prints as a gap and every other C0 byte vanishes. Under ^TB
// the 0A breaks the line. Inside a QR payload the byte is encoded.
const HEAD = '^XA^PW800^LL1200';
const field = (data: string, font = '^A0N,60,60^FH') => `${HEAD}^FO40,40${font}^FD${data}^FS^XZ`;
const escapes = (zpl: string) =>
  findingsOf(parseSingle(zpl, 8), 'hexControl').map((f) => [f.command, zpl.slice(defined(f.span).start, defined(f.span).end)]);

describe('parseZPL — hex control bytes the printer truncates at', () => {
  it('flags the first truncating escape of a text field, on its own bytes, and keeps the model', () => {
    const zpl = field('al_0Apha');
    expect(escapes(zpl)).toEqual([['_0A', '_0A']]);
    expect(parseSingle(zpl, 8).objects.map(getObjectStringContent)).toEqual(['al\npha']);
  });

  it('covers 00, 0C and 0D, lowercase, a custom and a regex-special delimiter', () => {
    expect(escapes(field('a_00b'))).toEqual([['_00', '_00']]);
    expect(escapes(field('a_0cb'))).toEqual([['_0c', '_0c']]);
    expect(escapes(field('a#0Db', '^A0N,60,60^FH#'))).toEqual([['#0D', '#0D']]);
    expect(escapes(field('a.0Ab', '^A0N,60,60^FH.'))).toEqual([['.0A', '.0A']]);
    // An unescaped dot would match the harmless `10A` first.
    expect(escapes(field('a10Ab.0Ac', '^A0N,60,60^FH.'))).toEqual([['.0A', '.0A']]);
    // A byte that merely vanishes must not steal the span from the one that truncates.
    expect(escapes(field('a_09b_0Ac'))).toEqual([['_0A', '_0A']]);
  });

  it('spans a raw line break torn through the escape, as the firmware strips it first', () => {
    expect(escapes(field('al_0\nApha'))).toEqual([['_0A', '_0\nA']]);
    expect(escapes(field('al_\n0Apha'))).toEqual([['_0A', '_\n0A']]);
    expect(escapes(`${HEAD}^FO40,40^A0N,60,60^FH^FVal_0\nApha^FS^XZ`)).toEqual([['_0A', '_0\nA']]);
  });

  it('reads the first truncating escape, in either letter case, and none of the harmless ones', () => {
    expect(escapes(field('a_0Ab_0Dc'))).toEqual([['_0A', '_0A']]);
    expect(escapes(field('a_0ab'))).toEqual([['_0a', '_0a']]);
    expect(escapes(field('a_0Cb'))).toEqual([['_0C', '_0C']]);
    expect(escapes(field('a_0db'))).toEqual([['_0d', '_0d']]);
  });

  it('pairs the escape with its own data only', () => {
    // A raw form feed is not a hex escape, and the literal `_0A` is not decoded without ^FH.
    expect(escapes(field('a\fb_0Ac', '^A0N,60,60'))).toEqual([]);
    // ^SN's seed replaced the escaped ^FD, so nothing truncates. A seed of its own does.
    expect(escapes(`${HEAD}^FO40,40^A0N,60,60^FH^FDa_0Ab^SN0001,1,Y^FS^XZ`)).toEqual([]);
    expect(escapes(`${HEAD}^FO40,40^A0N,60,60^FH^SNab_0Acd,1,Y^FS^XZ`)).toEqual([['_0A', '_0A']]);
    // The increment is not data.
    expect(escapes(`${HEAD}^FO40,40^A0N,60,60^FH^SN0001,_0A,Y^FS^XZ`)).toEqual([]);
    // The delimiter changed after the data was read, so the escape no longer decodes.
    expect(escapes(`${HEAD}^FO40,40^A0N,60,60^FH^FDa_0Ab^FH#^FS^XZ`)).toEqual([]);
  });

  it('lets the escape die with the data it was read from', () => {
    const next = `${HEAD}^FO40,40^A0N,60,60^FH^FDa_0Ab^FS^FO40,200^A0N,60,60^FH^SN0_0A1,1,Y^FS^XZ`;
    expect(escapes(next).map(([cmd]) => cmd)).toEqual(['_0A', '_0A']);
    expect(escapes(`${HEAD}^FO40,40^A0N,60,60^FH^FDa_0Ab^FDc\fd^FS^XZ`)).toEqual([]);
  });

  it('decodes the same under ^CI28', () => {
    expect(escapes(field('al_0Apha', '^CI28^A0N,60,60^FH'))).toEqual([['_0A', '_0A']]);
  });

  it('reaches the report bucket the agent tools read, keyed by the escape as written', () => {
    const zpl = `${HEAD}^FO40,40^A0N,60,60^FH^FDa_0Ab^FS^FO40,200^A0N,60,60^FH#^FD#0Ac^FS^XZ`;
    expect(importZplText(zpl, 8).report.hexControl).toEqual(['_0A', '#0A']);
  });

  it('stays quiet without ^FH, for bytes that merely vanish or print, and inside a QR payload', () => {
    expect(escapes(field('al_0Apha', '^A0N,60,60'))).toEqual([]);
    expect(escapes(field('a_09b_1Bc_0Bd'))).toEqual([]);
    expect(escapes(field('LA,al_0Apha', '^BQN,2,4^FH'))).toEqual([]);
  });

  it('flags a ^FB field but not a ^TB field, where the byte breaks the line instead', () => {
    expect(escapes(field('al_0Apha', '^A0N,40,40^FB400,3,0,L,0^FH'))).toEqual([['_0A', '_0A']]);
    expect(escapes(field('al_0Apha', '^A0N,40,40^TBN,400,120^FH'))).toEqual([]);
  });

  it('reads ^FV like ^FD and stamps the page of a later block', () => {
    const zpl = `${HEAD}^FO40,40^A0N,60,60^FH^FVa_0Db^FS^XZ${HEAD}^FO40,40^A0N,60,60^FH^FDc_0Ad^FS^XZ`;
    const r = parseZPL(zpl, 8);
    const found = r.pages.flatMap((p) => p.findings.filter((f) => f.kind === 'hexControl'));
    expect(found.map((f) => [f.command, f.pageIndex])).toEqual([
      ['_0D', 0],
      ['_0A', 1],
    ]);
  });
});

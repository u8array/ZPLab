import { describe, it, expect } from 'vitest';
import { code128 } from '@zplab/core/registry/code128';
import { parseZPL } from '@zplab/core/lib/zplParser';
import { generateZPL, generateBatchZpl } from '@zplab/core/lib/zplGenerator';
import type { Variable } from '@zplab/core/types/Variable';
import { GS1_SAMPLE_CONTENT, GS1_GS, elementStringToContent } from '@zplab/core/lib/gs1';
import { PALETTE_PRESET_IDS } from './palettePresets';
import { gs1EnablePatch } from '@zplab/core/registry/gs1FieldSpec';
import type { PageLabel } from '@zplab/core/types/LabelConfig';
import type { LabelObject } from '@zplab/core/types/Group';
import { parseSingle } from '../test/helpers';

const LABEL = { widthMm: 100, heightMm: 50, dpmm: 8 } as PageLabel;

const baseProps = {
  content: GS1_SAMPLE_CONTENT,
  height: 100,
  moduleWidth: 2,
  printInterpretation: true,
  printInterpretationAbove: false,
  checkDigit: false,
  rotation: 'N' as const,
};

const mk = (props: object): LabelObject =>
  ({ id: 'c', type: 'code128', x: 10, y: 10, rotation: 0, props }) as unknown as LabelObject;

const propsOf = (o: unknown) => (o as { props: { gs1?: boolean; content: string } }).props;

describe('gs1EnablePatch', () => {
  it('seeds the sample when content carries a control chip, even when "bound"', () => {
    // A lone chip classifies as a template (bound=true), but chips can never
    // be GS1 data; leaving them would put unencodable content into GS1 mode.
    expect(gs1EnablePatch('A«ctrl:TAB»B', true).content).toBe(GS1_SAMPLE_CONTENT);
    expect(gs1EnablePatch('«ctrl:GS»', true).content).toBe(GS1_SAMPLE_CONTENT);
  });

  it('keeps parseable GS1 content and bound variable content', () => {
    expect(gs1EnablePatch('0104012345678901', false).content).toBeUndefined();
    expect(gs1EnablePatch('«sku»', true).content).toBeUndefined();
  });
});

describe('GS1-128 (code128 gs1 mode)', () => {
  it('emits ^BC..,D with the parenthesized element string as ^FD', () => {
    const zpl = code128.toZPL(mk({ ...baseProps, gs1: true }) as never);
    expect(zpl).toContain('^BCN,100,Y,N,N,D');
    expect(zpl).toContain('^FD(01)09501101530003^FS');
  });

  it('omits the mode flag and sends raw content when gs1 is off', () => {
    const zpl = code128.toZPL(mk({ ...baseProps, gs1: false, content: '12345678' }) as never);
    expect(zpl).toContain('^BCN,100,Y,N,N^FD12345678^FS');
    expect(zpl).not.toContain(',D^FD');
  });

  it('parses ^BC..,D as gs1 with canonical (unparenthesized) content', () => {
    const { objects } = parseSingle('^XA^FO10,10^BCN,100,Y,N,N,D^FD(01)09501101530003^FS^XZ', 8);
    expect((objects[0] as { type: string }).type).toBe('code128');
    expect(propsOf(objects[0]).gs1).toBe(true);
    expect(propsOf(objects[0]).content).toBe(GS1_SAMPLE_CONTENT);
  });

  it('parses a plain ^BC as non-gs1', () => {
    const { objects } = parseSingle('^XA^FO10,10^BCN,100,Y,N,N^FD12345678^FS^XZ', 8);
    expect(propsOf(objects[0]).gs1).toBeFalsy();
    expect(propsOf(objects[0]).content).toBe('12345678');
  });

  it('round-trips gs1 mode + content through generate->parse', () => {
    const zpl = generateZPL(LABEL, [mk({ ...baseProps, gs1: true })]);
    const { objects } = parseSingle(zpl, LABEL.dpmm);
    expect(propsOf(objects[0]).gs1).toBe(true);
    expect(propsOf(objects[0]).content).toBe(GS1_SAMPLE_CONTENT);
  });

  it('round-trips a multi-AI payload with a GS separator', () => {
    const canonical = elementStringToContent('(01)09501101530003(10)LOT123(21)SER456');
    expect(canonical).not.toBeNull();
    const zpl = generateZPL(LABEL, [mk({ ...baseProps, gs1: true, content: canonical! })]);
    expect(zpl).toContain('^FD(01)09501101530003(10)LOT123>8(21)SER456^FS');
    const { objects } = parseSingle(zpl, LABEL.dpmm);
    expect(propsOf(objects[0]).gs1).toBe(true);
    expect(propsOf(objects[0]).content).toBe(canonical);
  });

  it('emits a TEMPLATE payload in element-string form with intact ^FE embeds', () => {
    // Raw model content `01«gtin»10«lot»` must export as `(01)#n#(10)#n#`, not
    // the raw GS-separated form (which literal payloads never use) and not a
    // post-embed transform (which would mangle the #n# references).
    const vars = [
      { id: 'g', name: 'gtin', fnNumber: 1, defaultValue: '09501101530003' },
      { id: 'l', name: 'lot', fnNumber: 2, defaultValue: 'AB12' },
    ];
    const zpl = generateZPL(LABEL, [mk({ ...baseProps, gs1: true, content: '01«gtin»10«lot»' })], vars);
    expect(zpl).toContain('^FD(01)#1#(10)#2#^FS');
    // And it round-trips back to marker content (the parser mints its own
    // variable names for the ^FN slots).
    const { objects } = parseSingle(zpl, LABEL.dpmm);
    expect(propsOf(objects[0]).gs1).toBe(true);
    expect(propsOf(objects[0]).content).toBe('01«field_1»10«field_2»');
  });

  it('fdTransform emits the element-string form (CSV / single-bind path)', () => {
    const transform = code128.fdTransform?.(mk({ ...baseProps, gs1: true }) as never);
    expect(transform).toBeTypeOf('function');
    expect(transform!(GS1_SAMPLE_CONTENT)).toBe('(01)09501101530003');
  });

  it('registers the GS1-128 palette preset', () => {
    expect(PALETTE_PRESET_IDS).toContain('code128-gs1');
  });
});

describe('GS1-128 FNC1 separators (mode D)', () => {
  // Mode D only auto-inserts the leading FNC1 (Labelary-decoded), so the emit
  // must place >8 after each non-final variable AI or scanners merge the AIs.
  it('emits >8 after a non-final variable AI', () => {
    const content = '0104012345678901' + '1020260707' + GS1_GS + '17261231' + '30144';
    const zpl = code128.toZPL(mk({ ...baseProps, gs1: true, content }) as never);
    expect(zpl).toContain('^FD(01)04012345678901(10)20260707>8(17)261231(30)144^FS');
  });

  it('round-trips a literal > in static content without compounding the escape', () => {
    // (10)A>B emits (10)A>0B; parse must unescape so a second export is stable.
    const zpl1 = generateZPL(LABEL, [mk({ ...baseProps, gs1: true, content: '10A>B' })]);
    expect(zpl1).toContain('^FD(10)A>0B^FS');
    const { objects } = parseSingle(zpl1, LABEL.dpmm);
    expect(propsOf(objects[0]).content).toBe('10A>B');
    expect(generateZPL(LABEL, objects as never)).toContain('^FD(10)A>0B^FS');
  });

  it('round-trips the >8 form back to canonical GS content', () => {
    const zpl = '^XA^FO10,10^BCN,100,N,N,N,D^FD(01)04012345678901(10)20260707>8(17)261231(30)144^FS^XZ';
    const { objects } = parseSingle(zpl, 8);
    const p = propsOf(objects[0]);
    expect(p.gs1).toBe(true);
    expect(p.content).toBe('0104012345678901' + '1020260707' + GS1_GS + '17261231' + '30144');
  });
});

describe('GS1-128 mode-D ^FN value symmetry', () => {
  const vars: Variable[] = [{ id: 'v', name: 'batch', fnNumber: 1, defaultValue: 'A>B' }];
  const tplContent = '01' + '04012345678901' + '10' + '«' + 'batch' + '»';
  const gs1Tpl = () => mk({ ...baseProps, gs1: true, content: tplContent });
  const textConsumer = () => ({
    id: 't', type: 'text', x: 10, y: 60, rotation: 0,
    props: { content: '«' + 'batch' + '» suffix', fontHeight: 30, fontWidth: 0, rotation: 'N' },
  }) as never;

  it('escapes > in the ^FN default when the slot feeds only mode-D fields', () => {
    expect(generateZPL(LABEL, [gs1Tpl()], vars)).toContain('^FN1^FDA>0B^FS');
  });

  it('normalizes a raw (non-paren) mode-D field payload to model form', () => {
    const zpl = '^XA^FO10,10^BCN,100,N,N,N,D^FD010401234567890110LOT>821SER^FS^XZ';
    const { objects } = parseSingle(zpl, LABEL.dpmm);
    expect(propsOf(objects[0]).content).toBe('010401234567890110LOT' + GS1_GS + '21SER');
  });

  it('normalizes a raw mode-D single-bind ^FN default to model form', () => {
    const zpl =
      '^XA^FN1^FD010401234567890110LOT>821SER^FS' +
      '^BY2^FO10,10^BCN,100,N,N,N,D^FE#^FD#1#^FS^XZ';
    const parsed = parseSingle(zpl, LABEL.dpmm);
    expect(parsed.variables.find((v) => v.fnNumber === 1)?.defaultValue)
      .toBe('010401234567890110LOT' + GS1_GS + '21SER');
  });

  it('keeps an embedded numeric default byte-identical (no GS1 canonicalization)', () => {
    // Value slot of (10); a 16-digit serial that HAPPENS to parse as (01)+14
    // digits must not get a recomputed check digit.
    const zpl =
      '^XA^FN1^FD0112345678901231^FS' +
      '^BY2^FO10,10^BCN,100,N,N,N,D^FE#^FD(01)04012345678901(10)#1#^FS^XZ';
    const parsed = parseSingle(zpl, LABEL.dpmm);
    expect(parsed.variables.find((v) => v.fnNumber === 1)?.defaultValue).toBe('0112345678901231');
  });

  it('preserves a foreign mode-D ^FN default byte-for-byte (no >8/GS stripping)', () => {
    const zpl =
      '^XA^FN1^FD>;>80100003486^FS' +
      '^BY2^FO10,10^BCN,100,N,N,N,D^FE#^FD(01)04012345678901(10)#1#^FS^XZ';
    const parsed = parseSingle(zpl, LABEL.dpmm);
    expect(parsed.variables.find((v) => v.fnNumber === 1)?.defaultValue).toBe('>;>80100003486');
  });

  it('does not suppress the escape for a slot shared only with an EXCLUDED consumer', () => {
    const gs1 = mk({ ...baseProps, gs1: true, content: '01' + '04012345678901' + '10' + '«' + 'batch' + '»' });
    const excluded = {
      id: 'g', type: 'group', x: 0, y: 0, rotation: 0, includeInExport: false,
      children: [{ id: 't', type: 'text', x: 10, y: 60, rotation: 0,
        props: { content: '«' + 'batch' + '» x', fontHeight: 30, fontWidth: 0, rotation: 'N' } }],
      props: {},
    } as never;
    expect(generateZPL(LABEL, [gs1, excluded], vars)).toContain('^FN1^FDA>0B^FS');
  });

  it('round-trips the escaped default back to the raw > (no compounding)', () => {
    const zpl = generateZPL(LABEL, [gs1Tpl()], vars);
    const parsed = parseSingle(zpl, LABEL.dpmm);
    expect(parsed.variables.find((v) => v.fnNumber === 1)?.defaultValue).toBe('A>B');
    const zpl2 = generateZPL(LABEL, parsed.objects as never, parsed.variables);
    expect(zpl2).toContain('^FN1^FDA>0B^FS');
  });

  it('keeps the default raw when a non-GS1 field shares the slot', () => {
    expect(generateZPL(LABEL, [gs1Tpl(), textConsumer()], vars)).toContain('^FN1^FDA>B^FS');
  });

  it('escapes the per-row CSV value only for a mode-D-exclusive slot', () => {
    const batch = (objs: Parameters<typeof generateBatchZpl>[1]) => generateBatchZpl(LABEL, objs, vars,
      { headers: ['batch'], rows: [['X>Y']] }, { bindings: { v: 'batch' } });
    expect(batch([gs1Tpl()])).toContain('^FN1^FDX>0Y^FS');
    expect(batch([gs1Tpl(), textConsumer()])).toContain('^FN1^FDX>Y^FS');
  });

  it('normalizes a single-bind gs1 default to model form (stable re-export)', () => {
    const content = '0104012345678901' + '10LOT>X' + GS1_GS + '21SER';
    const single = mk({ ...baseProps, gs1: true, content: '«' + 'lot' + '»' });
    const singleVars: Variable[] = [{ id: 'w', name: 'lot', fnNumber: 2, defaultValue: content }];
    const zpl1 = generateZPL(LABEL, [single], singleVars);
    const parsed = parseSingle(zpl1, LABEL.dpmm);
    expect(parsed.variables.find((v) => v.fnNumber === 2)?.defaultValue).toBe(content);
    const zpl2 = generateZPL(LABEL, parsed.objects as never, parsed.variables);
    expect(zpl2).toBe(zpl1);
  });

  it('scopes mode-D normalization per page: a later block reusing the ^FN number does not suppress it', () => {
    const zpl =
      '^XA^FN1^FD010401234567890110LOT>821SER^FS' +
      '^BY2^FO10,10^BCN,100,N,N,N,D^FE#^FD#1#^FS^XZ' +
      '^XA^FO10,10^A0N,30,30^FN1^FDplain^FS^XZ';
    const parsed = parseZPL(zpl, LABEL.dpmm);
    const modeDVar = parsed.pages[0]?.variables.find((v) => v.fnNumber === 1);
    expect(modeDVar?.defaultValue).toBe('010401234567890110LOT' + GS1_GS + '21SER');
  });
});

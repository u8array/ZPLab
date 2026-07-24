import { describe, it, expect } from 'vitest';
import { symbologyTargets, convertSymbologyMapper } from './symbologySwitch';
import type { LabelObject } from '@zplab/core/types/Group';

function barcode(type: string, props: Record<string, unknown>): LabelObject {
  return {
    id: 'obj-1',
    type,
    x: 42,
    y: 24,
    rotation: 0,
    props: { content: '', ...props },
  } as unknown as LabelObject;
}

const byType = (targets: ReturnType<typeof symbologyTargets>, type: string) =>
  targets.find((t) => t.type === type);

describe('symbologyTargets', () => {
  it('returns no targets for non-barcode objects', () => {
    expect(symbologyTargets(barcode('text', {}))).toEqual([]);
    expect(symbologyTargets(barcode('box', {}))).toEqual([]);
  });

  it('lists every barcode group entry and no shapes/text', () => {
    const targets = symbologyTargets(barcode('code128', {}));
    const types = targets.map((t) => t.type);
    expect(types).toContain('code39');
    expect(types).toContain('qrcode');
    expect(types).toContain('codabar');
    expect(types).not.toContain('text');
    expect(types).not.toContain('box');
    const groups = new Set(targets.map((t) => t.group));
    expect([...groups].sort()).toEqual(['code-1d', 'code-2d', 'legacy']);
  });

  it('enables everything on empty content', () => {
    const targets = symbologyTargets(barcode('code128', { content: '' }));
    expect(targets.every((t) => !t.disabled)).toBe(true);
  });

  it('disables digits-only targets for alphanumeric content, with reason', () => {
    const targets = symbologyTargets(barcode('code128', { content: 'ABC-abc' }));
    expect(byType(targets, 'msi')).toMatchObject({ disabled: true, reason: 'digitsOnly' });
    expect(byType(targets, 'ean13')).toMatchObject({ disabled: true, reason: 'digitsOnly' });
    // Code 39 charset covers letters, dash, dot, space.
    expect(byType(targets, 'code39')?.disabled).toBe(false);
    // Free-content 2D stays open.
    expect(byType(targets, 'qrcode')?.disabled).toBe(false);
  });

  it('disables on length rules (maxLength and validLengths)', () => {
    const over = symbologyTargets(barcode('code128', { content: '12345678901234' }));
    expect(byType(over, 'ean13')).toMatchObject({ disabled: true, reason: 'length' });
    const three = symbologyTargets(barcode('code128', { content: '123' }));
    // UPC/EAN extension accepts exactly 2 or 5 digits.
    expect(byType(three, 'upcEanExtension')).toMatchObject({ disabled: true, reason: 'length' });
    const five = symbologyTargets(barcode('code128', { content: '12345' }));
    expect(byType(five, 'upcEanExtension')?.disabled).toBe(false);
  });

  it('judges charset on literal slices only and skips length for marker content', () => {
    const t1 = symbologyTargets(barcode('code128', { content: '«batch»ABC' }));
    expect(byType(t1, 'msi')).toMatchObject({ disabled: true, reason: 'digitsOnly' });
    const t2 = symbologyTargets(barcode('code128', { content: '«batch»123' }));
    expect(byType(t2, 'ean13')?.disabled).toBe(false);
  });

  it('never disables the current type', () => {
    const targets = symbologyTargets(barcode('ean13', { content: 'not-digits' }));
    expect(byType(targets, 'ean13')?.disabled).toBe(false);
  });

  it('judges a control-key chip as its byte, not as an exempt marker', () => {
    const targets = symbologyTargets(barcode('code128', { content: '123«ctrl:TAB»456' }));
    expect(byType(targets, 'ean13')).toMatchObject({ disabled: true, reason: 'digitsOnly' });
    expect(byType(targets, 'code39')).toMatchObject({ disabled: true, reason: 'charset' });
    expect(byType(targets, 'qrcode')?.disabled).toBe(false);
  });

  it('judges a gs1-capable target in the GS1 mode the convert lands in', () => {
    // 'ä' violates the GS1 charset but plain DataMatrix accepts any bytes: the
    // fit must follow the carried gs1 flag, not the non-GS1 defaults.
    const gs1 = symbologyTargets(barcode('code128', { content: 'ä-test', gs1: true }));
    expect(byType(gs1, 'datamatrix')).toMatchObject({ disabled: true, reason: 'charset' });
    const plain = symbologyTargets(barcode('code128', { content: 'ä-test' }));
    expect(byType(plain, 'datamatrix')?.disabled).toBe(false);
  });

  it('enables gs1databar for GS1 sources by judging it in Expanded mode', () => {
    // Multi-AI content fails the GTIN-only default (symbology 1) but is valid
    // Expanded data; a GS1 source must see the Expanded rule.
    const content = '010401234567890110AB-123';
    const gs1 = symbologyTargets(barcode('code128', { content, gs1: true }));
    expect(byType(gs1, 'gs1databar')?.disabled).toBe(false);
    const plain = symbologyTargets(barcode('code128', { content }));
    expect(byType(plain, 'gs1databar')).toMatchObject({ disabled: true, reason: 'digitsOnly' });
  });
});

describe('convertSymbologyMapper - GS1 DataBar semantics', () => {
  const propsOf = (o: unknown) => (o as { props: Record<string, unknown> }).props;

  it('treats an Expanded databar as a GS1 source (carries gs1 mode to code128/datamatrix)', () => {
    const src = barcode('gs1databar', { content: '010401234567890110AB', symbology: 6, magnification: 2 });
    expect(propsOf(convertSymbologyMapper('code128' as never)(src)).gs1).toBe(true);
    expect(propsOf(convertSymbologyMapper('datamatrix' as never)(src)).gs1).toBe(true);
  });

  it('treats a GTIN databar (sym 1-5) as non-GS1 (bare digits copy, no gs1 flag)', () => {
    const src = barcode('gs1databar', { content: '04012345678901', symbology: 1, magnification: 2 });
    const out = propsOf(convertSymbologyMapper('code128' as never)(src));
    expect(out.gs1).toBeUndefined();
    expect(out.content).toBe('04012345678901');
  });

  it('lands on Expanded when GS1 content is carried into gs1databar', () => {
    const src = barcode('code128', { content: '010401234567890110AB', gs1: true });
    const out = propsOf(convertSymbologyMapper('gs1databar' as never)(src));
    expect(out.symbology).toBe(6);
    expect(out.content).toBe('010401234567890110AB');
  });
});

describe('convertSymbologyMapper', () => {
  const source = barcode('code128', {
    content: '(01)04012345678901',
    rotation: 'R',
    height: 222,
    moduleWidth: 5,
    gs1: true,
    serial: { step: 1, repeat: 1, leadingZeros: true },
  });

  it('keeps content, props.rotation and top-level identity; resets geometry props', () => {
    const out = convertSymbologyMapper('qrcode' as never)(source);
    expect(out.id).toBe('obj-1');
    expect((out as { x: number }).x).toBe(42);
    expect((out as { y: number }).y).toBe(24);
    expect(out.type).toBe('qrcode');
    const props = (out as unknown as { props: Record<string, unknown> }).props;
    expect(props.content).toBe('(01)04012345678901');
    expect(props.rotation).toBe('R');
    // Target defaults, not source geometry.
    expect(props.magnification).toBe(4);
    expect(props.height).toBeUndefined();
    expect(props.moduleWidth).toBeUndefined();
  });

  it('drops gs1/serial when the target cannot honour them', () => {
    const props = (convertSymbologyMapper('qrcode' as never)(source) as unknown as unknown as { props: Record<string, unknown> }).props;
    expect(props.gs1).toBeUndefined();
    expect(props.serial).toBeUndefined();
  });

  it('carries gs1 to a gs1-capable target and serial to a serialisable one', () => {
    const dm = (convertSymbologyMapper('datamatrix' as never)(source) as unknown as { props: Record<string, unknown> }).props;
    expect(dm.gs1).toBe(true);
    const c39 = (convertSymbologyMapper('code39' as never)(source) as unknown as { props: Record<string, unknown> }).props;
    expect(c39.serial).toEqual({ step: 1, repeat: 1, leadingZeros: true });
    expect(c39.gs1).toBeUndefined();
    // 1D geometry starts from defaults.
    expect(c39.height).toBe(100);
    expect(c39.moduleWidth).toBe(2);
  });

  it('carries fieldJustify within the 1D class, drops it across the boundary', () => {
    const src = { ...barcode('code128', { content: 'A' }), fieldJustify: 'R' } as LabelObject;
    expect(convertSymbologyMapper('code39' as never)(src).fieldJustify).toBe('R');
    // Crossing the class boundary would break the echo invariant (mapper).
    expect(convertSymbologyMapper('qrcode' as never)(src).fieldJustify).toBeUndefined();
  });

  it('is a no-op for same type and non-barcode objects', () => {
    expect(convertSymbologyMapper('code128' as never)(source)).toBe(source);
    const text = barcode('text', { content: 'hi' });
    expect(convertSymbologyMapper('qrcode' as never)(text)).toBe(text);
  });
});

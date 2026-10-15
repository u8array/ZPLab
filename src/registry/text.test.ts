import { describe, it, expect } from 'vitest';
import { text, textZplCmd, resolveTextMode } from '@zplab/core/registry/text';
import type { TextProps } from '@zplab/core/registry/text';
import type { LabelObjectBase } from '@zplab/core/types/LabelObject';

describe('textZplCmd', () => {
  it('plain text emits ^A', () => {
    expect(textZplCmd({})).toBe('^A');
  });
  it('blockWidth (field block) emits ^FB', () => {
    expect(textZplCmd({ blockWidth: 400 })).toBe('^FB');
  });
  it('textMode tb emits ^TB', () => {
    expect(textZplCmd({ textMode: 'tb', blockWidth: 400 })).toBe('^TB');
  });
});

const baseObj = (
  overrides: Partial<TextProps> = {},
): LabelObjectBase & { props: TextProps } => ({
  id: 'test',
  type: 'text',
  x: 0,
  y: 0,
  rotation: 0,
  props: {
    content: 'ABC',
    fontHeight: 30,
    fontWidth: 0,
    rotation: 'N',
    ...overrides,
  },
});

const ctx = (over: Partial<Parameters<NonNullable<typeof text.commitTransform>>[1]> = {}) => ({
  sx: 2,
  sy: 2,
  snap: (n: number) => n,
  nodeHeight: 0,
  anchor: null,
  ...over,
});

describe("text — commitTransform frame vs glyph mode", () => {
  it("block default (frame): X grows blockWidth, Y grows the line cap, font stays", () => {
    const r = text.commitTransform!(baseObj({ blockWidth: 400, blockLines: 2 }), ctx());
    expect(r).toEqual({ blockWidth: 800, blockLines: 4 });
  });

  it("block glyph mode: X/Y stretch the font, frame stays", () => {
    const r = text.commitTransform!(
      baseObj({ blockWidth: 400, blockLines: 2 }),
      ctx({ resizeMode: "glyph" }),
    );
    expect(r).toEqual({ fontHeight: 60, fontWidth: 60 });
  });

  it("non-block text always stretches the font (no frame to resize)", () => {
    const r = text.commitTransform!(baseObj(), ctx());
    expect(r).toEqual({ fontHeight: 60, fontWidth: 60 });
  });
});

/**
 * normalizeChanges strips the un-emit shape for ^FP so any prop-write
 * path (panel onChange, import, paste) lands on the same canonical
 * props. Anchors the round-trip guarantee documented in toZPL.
 */
describe('text — normalizeChanges ^FP un-emit shape', () => {
  it('drops explicit fpDirection="H" to undefined', () => {
    const obj = baseObj();
    const result = text.normalizeChanges?.(obj, { props: { fpDirection: 'H' } });
    expect((result?.props as Partial<TextProps>).fpDirection).toBeUndefined();
  });

  it('drops fpCharGap=0 to undefined', () => {
    const obj = baseObj();
    const result = text.normalizeChanges?.(obj, { props: { fpCharGap: 0 } });
    expect((result?.props as Partial<TextProps>).fpCharGap).toBeUndefined();
  });

  it('strips both fields in one patch', () => {
    const obj = baseObj();
    const result = text.normalizeChanges?.(obj, {
      props: { fpDirection: 'H', fpCharGap: 0 },
    });
    const props = result?.props as Partial<TextProps>;
    expect(props.fpDirection).toBeUndefined();
    expect(props.fpCharGap).toBeUndefined();
  });

  it('preserves non-default values', () => {
    const obj = baseObj();
    const result = text.normalizeChanges?.(obj, {
      props: { fpDirection: 'V', fpCharGap: 5 },
    });
    expect((result?.props as Partial<TextProps>).fpDirection).toBe('V');
    expect((result?.props as Partial<TextProps>).fpCharGap).toBe(5);
  });

  it('returns the original changes object when nothing needs normalizing', () => {
    const obj = baseObj();
    const changes = { props: { fontHeight: 40 } };
    const result = text.normalizeChanges?.(obj, changes);
    expect(result).toBe(changes);
  });

  it('is a no-op when changes.props is absent', () => {
    const obj = baseObj();
    const changes = { x: 10 };
    const result = text.normalizeChanges?.(obj, changes);
    expect(result).toBe(changes);
  });
});

describe('text — serial suppresses block/reverse without destroying them', () => {
  const serial = { increment: 1, zplMode: 'SN' as const };

  it('resolveTextMode reports normal for a serial field despite block props', () => {
    expect(resolveTextMode({ serial, textMode: 'tb', blockWidth: 400 })).toBe('normal');
  });

  it('normalizeChanges does not strip block/reverse when serial is set', () => {
    const obj = baseObj({ reverse: true, blockWidth: 400, blockLines: 3 });
    const changes = { props: { serial } };
    const result = text.normalizeChanges?.(obj, changes);
    const props = result?.props as Partial<TextProps>;
    // The patch must not force the dormant props to undefined ...
    expect('reverse' in props).toBe(false);
    expect('blockWidth' in props).toBe(false);
    // ... and the stored formatting survives the switch, ready to return.
    expect(obj.props.reverse).toBe(true);
    expect(obj.props.blockWidth).toBe(400);
  });

  it('toZPL emits the plain serial form, ignoring dormant block/reverse', () => {
    const zpl = text.toZPL(
      baseObj({ content: 'A001', reverse: true, blockWidth: 400, textMode: 'fb', blockLines: 3, serial }),
    );
    expect(zpl).toContain('^SNA001,1,Y^FS');
    expect(zpl).not.toContain('^FB');
    expect(zpl).not.toContain('^FR');
  });
});

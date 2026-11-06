import { describe, it, expect } from 'vitest';
import { importZplText } from '@zplab/core/lib/zplImportService';
import { generateMultiPageZPL } from '@zplab/core/lib/zplGenerator';
import type { LabelConfig } from '@zplab/core/types/LabelConfig';
import type { Page } from '@zplab/core/types/Group';

const LABEL: LabelConfig = { widthMm: 100, heightMm: 60, dpmm: 8 };
const pageOf = (zpl: string): Page => importZplText(zpl, 8).pages[0]!;

describe('the ^FX of a field with ink but no object', () => {
  const ZPL = '^XA^FXlogo^FO0,0^GFA,1,1,268435456,z0^FS^FO5,5^GB10,10,1^FS^XZ';
  const boxOf = (page: Page) => page.objects.find((o) => o.type === 'box')!;

  it.each([
    ['^GF past the width cap', ZPL],
    ['^XG without a name', '^XA^FXlogo^FO0,0^XG^FS^FO5,5^GB10,10,1^FS^XZ'],
  ])('does not move to the next object after %s', (_, zpl) => {
    expect(boxOf(pageOf(zpl)).comment).toBeUndefined();
  });

  it('leaves one ^FX in the export when the next object moves', () => {
    const page = pageOf(ZPL);
    Object.assign(boxOf(page), { x: 7, dirty: true });
    expect(generateMultiPageZPL(LABEL, [page]).match(/\^FXlogo/g)).toHaveLength(1);
  });

  it('leaves the next object its own comment', () => {
    const page = pageOf('^XA^FXlogo^FO0,0^GFA,1,1,268435456,z0^FS^FXbar^FO5,5^GB10,10,1^FS^XZ');
    expect(boxOf(page).comment).toBe('bar');
  });

  it('stays on an object the same field still makes', () => {
    const page = pageOf('^XA^FXnote^FO0,0^GFX,1^A0N,30,30^FDhello^FS^XZ');
    expect(page.objects[0]!.comment).toBe('note');
  });
});

describe('the ^FX of any other field', () => {
  it('keeps a declaration name hint for the slot it names', () => {
    const { variables } = importZplText('^XA^FXsku^FN1^FS^FO10,10^A0N,20,20^FN1^FS^XZ', 8);
    expect(variables.map((v) => v.name)).toEqual(['sku']);
  });

  it('stays in the export when both boxes move and it follows the first box', () => {
    const page = pageOf('^XA^FO0,0^GB10,10,1^FXb^FS^FO5,5^GB10,10,1^FS^XZ');
    for (const object of page.objects) Object.assign(object, { dirty: true });
    expect(generateMultiPageZPL(LABEL, [page])).toContain('^FXb');
  });
});

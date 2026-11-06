import { describe, it, expect } from 'vitest';
import { importZplText } from '@zplab/core/lib/zplImportService';
import { generateMultiPageZPL } from '@zplab/core/lib/zplGenerator';
import { rasterFromGfa } from '@zplab/core/lib/gfaDecode';
import type { LabelConfig } from '@zplab/core/types/LabelConfig';
import type { LabelObject, Page } from '@zplab/core/types/Group';

const LABEL: LabelConfig = { widthMm: 100, heightMm: 60, dpmm: 8 };
const pageOf = (zpl: string): Page => importZplText(zpl, 8).pages[0]!;
const moved = (zpl: string, type?: string) => {
  const page = pageOf(zpl);
  const object = (type ? page.objects.find((o) => o.type === type) : page.objects[0])!;
  Object.assign(object, { x: 7, dirty: true });
  return generateMultiPageZPL(LABEL, [page]);
};

describe('the placeholder of a refused ^GF', () => {
  it('re-exports a wrapped raw ^GFB as format A', () => {
    const out = moved('^XA^FO0,0^GFB,4,1,2,ABCD^FS^XZ');
    expect(out).toContain('^GFA,4,1,2,:B64:');
    expect(out).not.toContain('^GFB');
  });

  it('keeps a ^GFC letter', () => {
    expect(moved('^XA^FO0,0^GFC,4,1,2,ABCD^FS^XZ')).toContain('^GFC,4,1,2,');
  });

  it('keeps an empty ^GFB verbatim, because format A would read its empty :B64: wrapper as run-length hex', () => {
    const { rawGf } = (pageOf('^XA^FO0,0^GFB,0,8,1,^FS^XZ').objects[0] as LabelObject & { props: { rawGf: string } }).props;
    expect(rawGf).toBe('^GFB,0,8,1,');
    expect(rasterFromGfa(rawGf)).toBeNull();
  });
});

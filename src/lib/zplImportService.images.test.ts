import { describe, it, expect, vi } from 'vitest';
import { parseZPL } from '@zplab/core/lib/zplParser';
import { importZplText } from '@zplab/core/lib/zplImportService';
import { getAllImages, getImage } from '@zplab/core/lib/imageCache';
import { exportPrinterImpact } from './exportImpact';
import type * as ImageCache from '@zplab/core/lib/imageCache';
import type * as ImportReport from '@zplab/core/lib/importReport';

const { owners, boom } = vi.hoisted(() => ({ owners: { staged: [] as string[], released: [] as string[] }, boom: { on: false } }));
vi.mock('@zplab/core/lib/imageCache', async (importOriginal) => {
  const real = await importOriginal<typeof ImageCache>();
  return {
    ...real,
    stageImages: (owner: string, rows: readonly ImageCache.CachedImage[]) => { owners.staged.push(owner); real.stageImages(owner, rows); },
    releaseStaged: (owner: string) => { owners.released.push(owner); real.releaseStaged(owner); },
  };
});
vi.mock('@zplab/core/lib/importReport', async (importOriginal) => {
  const real = await importOriginal<typeof ImportReport>();
  return { ...real, reportOf: (...args: Parameters<typeof real.reportOf>) => { if (boom.on) throw new Error('boom'); return real.reportOf(...args); } };
});

const ZPL = '~DGR:LOGO.GRF,4,1,00FFFF00\n~DGR:SPARE.GRF,4,1,00FFFF00\n^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^FO0,20^GFA,4,4,1,FF00FF00^FS^XZ';

describe('decoded image rows', () => {
  it('never persist when a parse runs only for its findings', () => {
    exportPrinterImpact(ZPL);
    expect(getAllImages()).toHaveLength(0);
  });

  it('reach the parse result for every upload and inline graphic, and nothing persists', () => {
    const r = parseZPL(ZPL, 8, { captureOverlay: true });
    expect(r.decodedImages).toHaveLength(3);
    expect(getAllImages()).toHaveLength(0);
  });

  it('are released when the import throws after staging them', () => {
    boom.on = true;
    try {
      expect(() => importZplText(ZPL, 8)).toThrow('boom');
    } finally {
      boom.on = false;
    }
    expect(owners.released.at(-1)).toBe(owners.staged.at(-1));
  });

  it('are no longer staged once the import returns', () => {
    const { decodedImages } = importZplText(ZPL, 8);
    expect(decodedImages).toHaveLength(3);
    for (const img of decodedImages) expect(getImage(img.id)).toBeUndefined();
    expect(getAllImages()).toHaveLength(0);
  });
});

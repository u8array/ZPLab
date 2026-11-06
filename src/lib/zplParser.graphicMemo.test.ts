import { describe, it, expect, vi } from 'vitest';
import { parseZPL } from '@zplab/core/lib/zplParser';
import { decodeGraphicToImage } from '@zplab/core/lib/zplParser/decoders/graphic';
import type * as GraphicDecoder from '@zplab/core/lib/zplParser/decoders/graphic';

vi.mock('@zplab/core/lib/zplParser/decoders/graphic', async (importOriginal) => {
  const original = await importOriginal<typeof GraphicDecoder>();
  return { ...original, decodeGraphicToImage: vi.fn(original.decodeGraphicToImage) };
});

describe('decodeGraphicOnce', () => {
  it('decodes a refused graphic once across template recalls', () => {
    const template = '^XA^DFR:T.ZPL^FO0,0^GFA,4,4,2,:Z64:AAAA:0000^FS^XZ';
    const { pages } = parseZPL(`${template}${'^XA^XFR:T.ZPL^XZ'.repeat(3)}`, 8);
    expect(pages.length).toBeGreaterThan(1);
    expect(decodeGraphicToImage).toHaveBeenCalledTimes(1);
  });
});

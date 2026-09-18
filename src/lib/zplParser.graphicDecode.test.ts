import { describe, it, expect } from 'vitest';
import { decodeGraphicToImage } from '@zplab/core/lib/zplParser/decoders/graphic';
import { getAllImages, getImage } from '@zplab/core/lib/imageCache';

describe('decodeGraphicToImage', () => {
  it('hands the row back and writes nothing to the cache', () => {
    const decoded = decodeGraphicToImage('FF00FF00', 'A', 1, '4', '4');
    expect(decoded?.image.id).toBe(decoded?.imageId);
    expect(getImage(decoded!.imageId)).toBeUndefined();
    expect(getAllImages()).toHaveLength(0);
  });

  it('uses the caller\'s name hint, and falls back to an id-derived name without one', () => {
    const inline = decodeGraphicToImage('FF00FF00', 'A', 1, '4', '4');
    const upload = decodeGraphicToImage('FF00FF00', 'A', 1, '4', '4', 'uploaded_R_LOGO.png');
    expect(inline?.image.name).toBe(`imported_${inline?.imageId.slice(0, 8)}.png`);
    expect(upload?.image.name).toBe('uploaded_R_LOGO.png');
  });
});

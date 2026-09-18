import { describe, it, expect, beforeEach } from 'vitest';
import {
  getImage,
  getAllImages,
  putImage,
  removeImage,
  stageImages,
  releaseStaged,
  commitImages,
  loadImageFile,
  MAX_IMAGE_BYTES,
} from '@zplab/core/lib/imageCache';
import type { CachedImage } from '@zplab/core/lib/imageCache';

function makeFakeImage(id: string): CachedImage {
  return {
    id,
    name: `${id}.png`,
    dataUrl: `data:image/png;base64,${id}`,
    width: 100,
    height: 100,
  };
}

describe('imageCache', () => {
  beforeEach(() => {
    for (const img of getAllImages()) {
      removeImage(img.id);
    }
    for (const owner of ['shadow', 'modal']) releaseStaged(owner);
  });

  it('putImage stores and getImage retrieves an image', () => {
    const img = makeFakeImage('test-1');
    putImage(img);
    const retrieved = getImage('test-1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe('test-1');
    expect(retrieved!.name).toBe('test-1.png');
    expect(retrieved!.dataUrl).toContain('test-1');
  });

  it('getImage returns undefined for unknown IDs', () => {
    expect(getImage('nonexistent')).toBeUndefined();
  });

  it('getAllImages returns all stored images', () => {
    putImage(makeFakeImage('a'));
    putImage(makeFakeImage('b'));
    const all = getAllImages();
    expect(all).toHaveLength(2);
    const ids = all.map((i) => i.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('removeImage deletes from cache and localStorage', () => {
    putImage(makeFakeImage('del'));
    expect(getImage('del')).toBeDefined();
    removeImage('del');
    expect(getImage('del')).toBeUndefined();
    expect(localStorage.getItem('zpl-img-del')).toBeNull();
  });

  it('putImage persists to localStorage', () => {
    putImage(makeFakeImage('persist'));
    const stored = localStorage.getItem('zpl-img-persist');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!) as { id: string };
    expect(parsed.id).toBe('persist');
  });

  it('overwriting an image replaces the old one', () => {
    putImage(makeFakeImage('ow'));
    putImage({ ...makeFakeImage('ow'), name: 'overwrite.png', width: 50 });
    const img = getImage('ow')!;
    expect(img.name).toBe('overwrite.png');
    expect(img.width).toBe(50);
    expect(getAllImages()).toHaveLength(1);
  });

  it('finds a staged row without listing or persisting it, until the commit', () => {
    const row = makeFakeImage('draft');
    stageImages('shadow', [row]);
    expect(getImage('draft')).toBeTruthy();
    expect(getAllImages()).toHaveLength(0);
    expect(localStorage.getItem('zpl-img-draft')).toBeNull();
    commitImages([row]);
    expect(getAllImages().map((i) => i.id)).toEqual(['draft']);
    expect(localStorage.getItem('zpl-img-draft')).not.toBeNull();
  });

  it('lets each owner replace or release only its own rows', () => {
    stageImages('shadow', [makeFakeImage('a')]);
    stageImages('modal', [makeFakeImage('b')]);
    stageImages('shadow', [makeFakeImage('c')]);
    expect(getImage('a')).toBeUndefined();
    expect(getImage('b')).toBeTruthy();
    expect(getImage('c')).toBeTruthy();
    releaseStaged('modal');
    expect(getImage('b')).toBeUndefined();
    expect(getImage('c')).toBeTruthy();
    releaseStaged('shadow');
  });

  it('commits the rows a caller holds even after the owner restaged', () => {
    const planRow = makeFakeImage('plan');
    stageImages('shadow', [planRow]);
    stageImages('shadow', [makeFakeImage('later')]);
    commitImages([planRow]);
    expect(getAllImages().map((i) => i.id)).toEqual(['plan']);
    releaseStaged('shadow');
  });

  it('loadImageFile rejects non-image MIME types', async () => {
    const file = new File(['hello'], 'bad.txt', { type: 'text/plain' });
    await expect(loadImageFile(file)).rejects.toThrow(/Not an image/);
  });

  it('loadImageFile rejects files above the byte cap', async () => {
    // File constructor accepts size from chunks; pad with a buffer larger than cap.
    const oversized = new File(
      [new Uint8Array(MAX_IMAGE_BYTES + 1)],
      'big.png',
      { type: 'image/png' },
    );
    await expect(loadImageFile(oversized)).rejects.toThrow(/too large/);
  });
});

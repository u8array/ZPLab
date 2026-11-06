import { describe, it, expect } from 'vitest';
import { decodeGraphicToImage } from '@zplab/core/lib/zplParser/decoders/graphic';
import { GF_MAX_DECODED_BYTES, gfPayloadToBytes } from '@zplab/core/lib/zplParser/decoders/gfa';
import { getAllImages, getImage } from '@zplab/core/lib/imageCache';
import { rasterFromGfa } from '@zplab/core/lib/gfaDecode';
import { commandsOf, parseSingle } from '../test/helpers';
import { GF_MAX_BYTES_PER_ROW, GF_MAX_ROWS } from '@zplab/core/registry/image';

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

describe('untrusted ^GF sizes', () => {
  const gf = (c: number, bytesPerRow: number, data: string) => `^XA^FO0,0^GFA,${c},${c},${bytesPerRow},${data}^FS^XZ`;
  const refused = (zpl: string) => {
    const parsed = parseSingle(zpl, 8);
    expect(commandsOf(parsed, 'browserLimit')).toHaveLength(1);
    expect(parsed.objects).toHaveLength(0);
  };

  it('refuses a width past the cap before padding any row', () => {
    expect(gfPayloadToBytes('z0', 'A', 2 ** 28, 1)).toBeNull();
    expect(gfPayloadToBytes('FF', 'A', GF_MAX_BYTES_PER_ROW, 1)).not.toBeNull();
    expect(rasterFromGfa(`^GFA,1,1,${2 ** 28},z0`)).toBeNull();
  });

  it('refuses decoded rows past the cap, which a header without c does not declare', () => {
    const rows = (n: number) => ':'.repeat(n - 1);
    expect(decodeGraphicToImage(`FF${rows(GF_MAX_ROWS + 1)}`, 'A', 1, '', '')).toBeNull();
    expect(decodeGraphicToImage(`FF${rows(GF_MAX_ROWS)}`, 'A', 1, '', '')?.heightDots).toBe(GF_MAX_ROWS);
  });

  it('refuses an uncompressed graphic past the decode ceiling, as it does a compressed one', () => {
    const bytesPerRow = 1000;
    const rows = GF_MAX_DECODED_BYTES / bytesPerRow;
    const decode = (n: number) => {
      const size = String(n * bytesPerRow);
      return decodeGraphicToImage('\0'.repeat(n * bytesPerRow), 'B', bytesPerRow, size, size);
    };
    expect(decode(rows + 1)).toBeNull();
    expect(decode(rows)?.heightDots).toBe(rows);
  });

  it('sends a header past the width cap to browserLimit, not to a placeholder of that size', () => {
    refused(gf(1, 2 ** 28, 'z0'));
  });

  it('sends an undecodable header declaring rows past the cap to browserLimit', () => {
    const undecodable = ':Z64:AAAA:0000';
    refused(gf(GF_MAX_ROWS + 1, 1, undecodable));
    const atCap = parseSingle(gf(GF_MAX_ROWS, 1, undecodable), 8);
    expect(commandsOf(atCap, 'browserLimit')).toHaveLength(0);
    expect(atCap.objects).toHaveLength(1);
  });

  it('keeps the rows a graphic carries when its header overstates them, as an upload does', () => {
    const parsed = parseSingle(gf(400_000, 1, 'FFFFFFFF'), 8);
    expect(commandsOf(parsed, 'browserLimit')).toHaveLength(0);
    expect(parsed.objects[0]).toMatchObject({ props: { heightDots: 4 } });
  });

  it('forgets an earlier upload when a later one to the same path is refused', () => {
    const refusedUpload = `~DGR:A.GRF,4000,2000,${'F'.repeat(8000)}`;
    const parsed = parseSingle(`~DGR:A.GRF,2,1,FFFF\n${refusedUpload}\n^XA^FO0,0^XGR:A.GRF^FS^XZ`, 8);
    expect(parsed.objects[0]).toMatchObject({ props: { imageId: '', storedAs: { embedInZpl: false } } });
  });
});

import { describe, it, expect } from 'vitest';
import { sourceApplyRowReplacement } from './labelStore.selectors';
import type { SourceApplyOk } from '@zplab/core/lib/zplSourceEdit';
import type { Dataset } from './slices/dataSlice';

const batch = { dataset: { headers: ['a'], rows: [['1'], ['2']], source: { kind: 'zpl', formatPath: 'R:A.ZPL', importedAt: '', rowCount: 2 } }, columnMapping: { bindings: {} } };
const plan = { batch } as unknown as SourceApplyOk;
const csv: Dataset = { headers: ['a'], rows: [['x']], activeRowIndex: 0, source: { kind: 'csv', filename: 'rows.csv', importedAt: '', rowCount: 1 } } as Dataset;

describe('sourceApplyRowReplacement', () => {
  it('names the loaded rows a recall buffer would replace', () => {
    expect(sourceApplyRowReplacement(csv, plan)).toEqual({ oldName: 'rows.csv', rows: 2 });
    expect(sourceApplyRowReplacement(null, plan)).toBeNull();
    expect(sourceApplyRowReplacement(csv, {} as SourceApplyOk)).toBeNull();
  });

  it('counts rows when the loaded dataset itself came from a recall stream', () => {
    const zplRows = { ...csv, source: batch.dataset.source } as Dataset;
    expect(sourceApplyRowReplacement(zplRows, plan)).toEqual({ oldName: 'R:A.ZPL', rows: 2 });
  });
});

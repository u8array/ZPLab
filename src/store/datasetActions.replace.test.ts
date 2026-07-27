import { describe, it, expect, beforeEach } from 'vitest';
import { useLabelStore } from './labelStore';
import { loadFetchedDataset, settleDatasetReplace } from './datasetActions';
import type { DatasetInput } from '@zplab/core/types/DataSource';

const fetched = (name: string, headers: string[]): DatasetInput => ({
  headers,
  rows: [headers.map((h) => `${h}-1`)],
  source: {
    kind: 'db',
    profileId: 'p1',
    profileName: name,
    table: 't',
    fetchedAt: '2026-01-01T00:00:00Z',
    rowCount: 1,
    truncated: false,
  },
});

beforeEach(() => {
  useLabelStore.setState({
    dataset: null,
    columnMapping: null,
    variables: [],
    pendingDatasetReplace: null,
  } as never);
});

describe('loadFetchedDataset replace confirm', () => {
  it('loads immediately when no dataset exists', async () => {
    const ok = await loadFetchedDataset(async () => fetched('fresh', ['a']));
    expect(ok).toBe(true);
    expect(useLabelStore.getState().dataset?.headers).toEqual(['a']);
    expect(useLabelStore.getState().pendingDatasetReplace).toBeNull();
  });

  it('replaces silently when the current mapping carries over', async () => {
    useLabelStore.getState().loadDataset(fetched('old', ['sku']));
    useLabelStore.setState({
      variables: [{ id: 'v1', name: 'sku', fnNumber: 1, defaultValue: '' }],
      columnMapping: { bindings: { v1: 'sku' }, headerSnapshot: ['sku'] },
    } as never);
    const ok = await loadFetchedDataset(async () => fetched('new', ['sku']));
    expect(ok).toBe(true);
    expect(useLabelStore.getState().pendingDatasetReplace).toBeNull();
  });

  it('defers an incompatible replace behind the confirm and applies on confirm', async () => {
    useLabelStore.getState().loadDataset(fetched('old', ['sku']));
    const promise = loadFetchedDataset(async () => fetched('new', ['other']));
    // Not applied yet: the confirm payload is up instead.
    await Promise.resolve();
    expect(useLabelStore.getState().dataset?.source).toMatchObject({ profileName: 'old' });
    expect(useLabelStore.getState().pendingDatasetReplace).toMatchObject({
      oldName: expect.stringContaining('old'),
      newName: expect.stringContaining('new'),
    });
    settleDatasetReplace(true);
    await expect(promise).resolves.toBe(true);
    expect(useLabelStore.getState().dataset?.source).toMatchObject({ profileName: 'new' });
    expect(useLabelStore.getState().pendingDatasetReplace).toBeNull();
  });

  it('keeps the old dataset when the confirm is declined', async () => {
    useLabelStore.getState().loadDataset(fetched('old', ['sku']));
    const promise = loadFetchedDataset(async () => fetched('new', ['other']));
    await Promise.resolve();
    settleDatasetReplace(false);
    await expect(promise).resolves.toBe(false);
    expect(useLabelStore.getState().dataset?.source).toMatchObject({ profileName: 'old' });
    expect(useLabelStore.getState().pendingDatasetReplace).toBeNull();
  });

  it('drops a confirmed replace whose data context went stale meanwhile', async () => {
    useLabelStore.getState().loadDataset(fetched('old', ['sku']));
    const promise = loadFetchedDataset(async () => fetched('new', ['other']));
    await Promise.resolve();
    // Foreign load while the confirm is open supersedes the pending fetch.
    useLabelStore.getState().loadDataset(fetched('foreign', ['x']));
    settleDatasetReplace(true);
    await expect(promise).resolves.toBe(false);
    expect(useLabelStore.getState().dataset?.source).toMatchObject({ profileName: 'foreign' });
  });
});

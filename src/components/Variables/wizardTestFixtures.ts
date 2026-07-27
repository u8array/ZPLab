import type { DbProfile } from '../../lib/db';

/** Shared wizard-test fixtures: one source of truth for the DataSource shapes
 *  so the four test files cannot drift when the shape changes. */

export const DB_DATASET = {
  headers: ['sku', 'price'],
  rows: [['A1', '9.99']],
  source: {
    kind: 'db' as const,
    profileId: 'p1',
    profileName: 'Local',
    table: 't',
    fetchedAt: '2026-01-01T00:00:00Z',
    truncated: false,
    rowCount: 1,
  },
  activeRowIndex: 0,
};

export const EXCEL_DATASET = {
  headers: ['old'],
  rows: [['x']],
  source: {
    kind: 'excel' as const,
    filename: 'old.xlsx',
    sheet: 'S',
    importedAt: '2020-01-01T00:00:00Z',
    rowCount: 1,
    truncated: false,
  },
  activeRowIndex: 0,
};

/** What a mocked dbFetchDataset resolves with. */
export const dbFetched = (profile: DbProfile, table: string) => ({
  headers: ['sku', 'price'],
  rows: [['A1', '9.99']],
  source: {
    kind: 'db' as const,
    profileId: profile.id,
    profileName: profile.name,
    table,
    fetchedAt: '2026-01-01T00:00:00Z',
    rowCount: 1,
    truncated: false,
  },
});

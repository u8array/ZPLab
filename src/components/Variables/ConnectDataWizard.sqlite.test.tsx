// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { useLabelStore } from '../../store/labelStore';
import { fallbackTranslations as en } from '../../locales';
import { EXCEL_DATASET, dbFetched } from './wizardTestFixtures';
import type * as platform from '../../lib/platform';
import type * as db from '../../lib/db';

vi.mock('../../lib/platform', async (orig) => ({
  ...(await orig<typeof platform>()),
  isDesktopShell: true,
}));
const revokeSqlitePath = vi.fn().mockResolvedValue(undefined);
vi.mock('../../lib/db', async (orig) => ({
  ...(await orig<typeof db>()),
  pickSqliteFile: vi.fn(async () => '/data/store.sqlite'),
  dbListTables: vi.fn(async () => ['items', 'prices']),
  revokeSqlitePath,
  dbFetchDataset: vi.fn(async (profile: db.DbProfile, table: string) => dbFetched(profile, table)),
}));

const { ConnectDataWizard } = await import('./ConnectDataWizard');

afterEach(() => {
  cleanup();
  revokeSqlitePath.mockClear();
});

describe('ConnectDataWizard SQLite (desktop)', () => {
  it('loads a table, persists the profile, and advances to mapping', async () => {
    act(() => {
      useLabelStore.setState({ dataset: null, variables: [], columnMapping: null, dbProfiles: [] } as never);
    });
    const { getByText, findByText } = render(<ConnectDataWizard />);
    await act(async () => {
      fireEvent.click(getByText(en.connectData.sqlite));
    });
    await findByText(en.variables.dbTableLabel);
    await act(async () => {
      fireEvent.click(getByText(en.variables.dbLoad));
    });
    await findByText(en.connectData.finish);
    // Profile persisted only after a successful load, so reconnect works later.
    expect(useLabelStore.getState().dbProfiles).toHaveLength(1);
  });

  it('revokes the path grant when listing tables fails, leaving no orphan', async () => {
    const { dbListTables } = await import('../../lib/db');
    vi.mocked(dbListTables).mockRejectedValueOnce(new Error('not a sqlite db'));
    act(() => {
      useLabelStore.setState({ dataset: null, variables: [], columnMapping: null, dbProfiles: [] } as never);
    });
    const { getByText, queryByText } = render(<ConnectDataWizard />);
    await act(async () => {
      fireEvent.click(getByText(en.connectData.sqlite));
    });
    await waitFor(() =>
      expect(revokeSqlitePath).toHaveBeenCalledWith('/data/store.sqlite', expect.any(Array)),
    );
    expect(queryByText(en.variables.dbTableLabel)).toBeNull();
    expect(useLabelStore.getState().dbProfiles).toHaveLength(0);
  });

  it('closing the wizard with the table modal still open revokes the pending grant', async () => {
    act(() => {
      useLabelStore.setState({ dataset: null, variables: [], columnMapping: null, dbProfiles: [] } as never);
    });
    const view = render(<ConnectDataWizard />);
    await act(async () => {
      fireEvent.click(view.getByText(en.connectData.sqlite));
    });
    await waitFor(() => view.getByText(en.variables.dbTableLabel));
    act(() => {
      view.unmount();
    });
    await waitFor(() =>
      expect(revokeSqlitePath).toHaveBeenCalledWith('/data/store.sqlite', expect.any(Array)),
    );
    expect(useLabelStore.getState().dbProfiles).toHaveLength(0);
  });

  it('cancelling the table modal saves no profile, revokes the grant, and stays on source', async () => {
    act(() => {
      useLabelStore.setState({ dataset: EXCEL_DATASET, variables: [], columnMapping: null, dbProfiles: [] } as never);
    });
    const { getByText, queryByText } = render(<ConnectDataWizard />);
    await act(async () => {
      fireEvent.click(getByText(en.connectData.sqlite));
    });
    await waitFor(() => getByText(en.variables.dbTableLabel));
    await act(async () => {
      fireEvent.click(getByText(en.variables.cancel));
    });
    getByText(en.connectData.chooseSource);
    expect(queryByText(en.connectData.finish)).toBeNull();
    expect(useLabelStore.getState().dbProfiles).toHaveLength(0);
    expect(revokeSqlitePath).toHaveBeenCalledWith('/data/store.sqlite', expect.any(Array));
  });
});

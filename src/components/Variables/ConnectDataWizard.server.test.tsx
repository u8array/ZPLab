// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { useLabelStore } from '../../store/labelStore';
import { fallbackTranslations as en } from '../../locales';
import { dbFetched } from './wizardTestFixtures';
import type * as platform from '../../lib/platform';
import type * as db from '../../lib/db';
import type * as credentialStore from '../../lib/credentialStore';

vi.mock('../../lib/platform', async (orig) => ({
  ...(await orig<typeof platform>()),
  isDesktopShell: true,
}));
const { dbSetPassword, deleteCredential } = vi.hoisted(() => ({
  dbSetPassword: vi.fn().mockResolvedValue(undefined),
  deleteCredential: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../lib/credentialStore', async (orig) => ({
  ...(await orig<typeof credentialStore>()),
  deleteCredential,
}));
vi.mock('../../lib/db', async (orig) => ({
  ...(await orig<typeof db>()),
  dbSetPassword,
  dbListTables: vi.fn(async () => ['orders', 'items']),
  dbFetchDataset: vi.fn(async (profile: db.DbProfile, table: string) => dbFetched(profile, table)),
}));

const { ConnectDataWizard } = await import('./ConnectDataWizard');

afterEach(() => {
  cleanup();
  dbSetPassword.mockClear();
  deleteCredential.mockClear();
});

const openServerForm = async (label: string) => {
  act(() => {
    useLabelStore.setState({ dataset: null, variables: [], columnMapping: null, dbProfiles: [] } as never);
  });
  const view = render(<ConnectDataWizard />);
  act(() => {
    fireEvent.click(view.getByText(label));
  });
  // Field order in the form: host, port, database, user, password.
  const fields = view.container.querySelectorAll<HTMLInputElement>('.fixed input:not([type="file"])');
  fireEvent.change(fields.item(0), { target: { value: 'db.local' } });
  fireEvent.change(fields.item(2), { target: { value: 'shop' } });
  fireEvent.change(fields.item(3), { target: { value: 'reader' } });
  fireEvent.change(fields.item(4), { target: { value: 'sekret' } });
  return view;
};

describe('ConnectDataWizard server DB (desktop)', () => {
  it('connects, lists tables, loads, and persists the profile', async () => {
    const { getByText, findByText } = await openServerForm(en.connectData.mysql);
    await act(async () => {
      fireEvent.click(getByText(en.connectData.connect));
    });
    await findByText(en.variables.dbTableLabel);
    await act(async () => {
      fireEvent.click(getByText(en.variables.dbLoad));
    });
    await findByText(en.connectData.finish);
    // Password stored endpoint-bound before the listing connect.
    expect(dbSetPassword).toHaveBeenCalledWith(
      expect.objectContaining({ driver: 'mysql', host: 'db.local', database: 'shop', user: 'reader' }),
      'sekret',
    );
    expect(useLabelStore.getState().dbProfiles).toMatchObject([
      { driver: 'mysql', host: 'db.local', sslMode: 'prefer' },
    ]);
    expect(deleteCredential).not.toHaveBeenCalled();
  });

  it('shows the listing error and stays on the form', async () => {
    const { dbListTables } = await import('../../lib/db');
    vi.mocked(dbListTables).mockRejectedValueOnce(new Error('auth failed'));
    const { getByText, findByText, queryByText } = await openServerForm(en.connectData.postgres);
    await act(async () => {
      fireEvent.click(getByText(en.connectData.connect));
    });
    await findByText(/auth failed/);
    expect(queryByText(en.variables.dbTableLabel)).toBeNull();
    expect(useLabelStore.getState().dbProfiles).toHaveLength(0);
  });

  it('closing the wizard during a failing load still deletes the stored password', async () => {
    const { dbFetchDataset } = await import('../../lib/db');
    let rejectFetch!: (e: Error) => void;
    vi.mocked(dbFetchDataset).mockImplementationOnce(
      () => new Promise((_res, rej) => (rejectFetch = rej)),
    );
    const view = await openServerForm(en.connectData.mysql);
    await act(async () => {
      fireEvent.click(view.getByText(en.connectData.connect));
    });
    await view.findByText(en.variables.dbTableLabel);
    await act(async () => {
      fireEvent.click(view.getByText(en.variables.dbLoad));
    });
    view.unmount();
    await act(async () => {
      rejectFetch(new Error('timeout'));
    });
    // The cleanup chains on the load outcome: failure -> orphan deleted.
    await waitFor(() => expect(deleteCredential).toHaveBeenCalled());
    expect(useLabelStore.getState().dbProfiles).toHaveLength(0);
  });

  it('closing the wizard during a successful load commits nothing and deletes the password', async () => {
    const { dbFetchDataset } = await import('../../lib/db');
    let resolveFetch!: (v: unknown) => void;
    vi.mocked(dbFetchDataset).mockImplementationOnce(
      () => new Promise((res) => (resolveFetch = res as (v: unknown) => void)),
    );
    const view = await openServerForm(en.connectData.mysql);
    await act(async () => {
      fireEvent.click(view.getByText(en.connectData.connect));
    });
    await view.findByText(en.variables.dbTableLabel);
    await act(async () => {
      fireEvent.click(view.getByText(en.variables.dbLoad));
    });
    view.unmount(); // close supersedes the fetch (token bump)
    await act(async () => {
      resolveFetch({
        headers: ['sku'],
        rows: [['A1']],
        source: {
          kind: 'db',
          profileId: 'x',
          profileName: 'x',
          table: 'orders',
          fetchedAt: '2026-01-01T00:00:00Z',
          rowCount: 1,
          truncated: false,
        },
      });
    });
    // Superseded: no dataset commit, no profile persist, password cleaned up.
    expect(useLabelStore.getState().dataset).toBeNull();
    expect(useLabelStore.getState().dbProfiles).toHaveLength(0);
    await waitFor(() => expect(deleteCredential).toHaveBeenCalled());
  });

  it('closing the wizard while the connect is still storing the password cleans it up', async () => {
    let resolveWrite!: () => void;
    dbSetPassword.mockImplementationOnce(
      () => new Promise<void>((res) => (resolveWrite = res)),
    );
    const view = await openServerForm(en.connectData.postgres);
    await act(async () => {
      fireEvent.click(view.getByText(en.connectData.connect));
    });
    view.unmount();
    await act(async () => {
      resolveWrite();
    });
    // The cleanup chains on the connect too, so the just-stored password
    // is deleted even though the close raced the keychain write.
    await waitFor(() => expect(deleteCredential).toHaveBeenCalled());
    expect(useLabelStore.getState().dbProfiles).toHaveLength(0);
  });

  it('persists the profile that produced the dataset, not an in-flight edit', async () => {
    const { dbFetchDataset } = await import('../../lib/db');
    let resolveFetch!: (v: unknown) => void;
    const original = vi.mocked(dbFetchDataset).getMockImplementation();
    vi.mocked(dbFetchDataset).mockImplementationOnce(
      (profile, table) =>
        new Promise((res) => {
          resolveFetch = () => res(original!(profile, table));
        }),
    );
    const view = await openServerForm(en.connectData.mysql);
    await act(async () => {
      fireEvent.click(view.getByText(en.connectData.connect));
    });
    await view.findByText(en.variables.dbTableLabel);
    await act(async () => {
      fireEvent.click(view.getByText(en.variables.dbLoad));
    });
    const fields = view.container.querySelectorAll<HTMLInputElement>(
      '.fixed input:not([type="file"])',
    );
    act(() => {
      fireEvent.change(fields.item(0), { target: { value: 'other.host' } });
    });
    await act(async () => {
      resolveFetch(undefined);
    });
    await view.findByText(en.connectData.finish);
    // The saved profile matches the fetch snapshot, not the edited draft.
    expect(useLabelStore.getState().dbProfiles).toMatchObject([{ host: 'db.local' }]);
  });

  it('does not publish a table listing for an endpoint edited mid-connect', async () => {
    const { dbListTables } = await import('../../lib/db');
    let resolveList!: (v: string[]) => void;
    vi.mocked(dbListTables).mockImplementationOnce(
      () => new Promise((res) => (resolveList = res)),
    );
    const view = await openServerForm(en.connectData.mysql);
    await act(async () => {
      fireEvent.click(view.getByText(en.connectData.connect));
    });
    const fields = view.container.querySelectorAll<HTMLInputElement>(
      '.fixed input:not([type="file"])',
    );
    act(() => {
      fireEvent.change(fields.item(0), { target: { value: 'other.host' } });
    });
    await act(async () => {
      resolveList(['stale-table']);
    });
    // Stale response must not pair connection A's tables with B's fields.
    expect(view.queryByText(en.variables.dbTableLabel)).toBeNull();
  });

  it('backing out after a connect deletes the stored password, saves no profile', async () => {
    const { getByText, findByText } = await openServerForm(en.connectData.postgres);
    await act(async () => {
      fireEvent.click(getByText(en.connectData.connect));
    });
    await findByText(en.variables.dbTableLabel);
    await act(async () => {
      fireEvent.click(getByText(en.variables.cancel));
    });
    getByText(en.connectData.chooseSource);
    await waitFor(() => expect(deleteCredential).toHaveBeenCalled());
    expect(useLabelStore.getState().dbProfiles).toHaveLength(0);
  });
});

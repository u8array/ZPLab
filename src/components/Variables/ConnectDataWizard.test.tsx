// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act, type RenderResult } from '@testing-library/react';
import { ConnectDataWizard } from './ConnectDataWizard';
import { useLabelStore } from '../../store/labelStore';
import { fallbackTranslations as en } from '../../locales';
import { DB_DATASET, EXCEL_DATASET } from './wizardTestFixtures';

afterEach(cleanup);

/** Land a CSV through the wizard's own hidden input (the real commit path). */
const loadCsv = async (view: RenderResult, name = 'new.csv') => {
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['sku,price\nA1,9.99\n'], name, { type: 'text/csv' });
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
};

const setStore = (extra: Record<string, unknown> = {}) => {
  act(() => {
    useLabelStore.setState({
      dataset: null,
      dataSourceRef: null,
      columnMapping: null,
      variables: [],
      ...extra,
    } as never);
  });
};

describe('ConnectDataWizard', () => {
  it('starts on the source step with CSV enabled and the DB sources disabled', () => {
    setStore();
    const { getByText } = render(<ConnectDataWizard />);
    getByText(en.connectData.chooseSource);
    expect(getByText(en.connectData.csv).closest('button')?.disabled).toBe(false);
    expect(getByText(en.connectData.postgres).closest('button')?.disabled).toBe(true);
  });

  it('stays on source when a dataset exists but no source was picked this session', () => {
    setStore({ dataset: DB_DATASET });
    const { getByText, queryByText } = render(<ConnectDataWizard />);
    // A pre-existing dataset must not skip the picker into a silent remap.
    getByText(en.connectData.chooseSource);
    expect(queryByText(en.connectData.finish)).toBeNull();
  });

  it('advances to mapping once its own CSV lands', async () => {
    setStore();
    const view = render(<ConnectDataWizard />);
    act(() => {
      fireEvent.click(view.getByText(en.connectData.csv));
    });
    expect(view.queryByText(en.connectData.finish)).toBeNull();
    await loadCsv(view);
    view.getByText(en.connectData.finish);
    view.getByText(en.variables.csvVariableHeader);
  });

  it('never advances on a foreign load, even after picking a source', () => {
    setStore();
    const { getByText, queryByText } = render(<ConnectDataWizard />);
    act(() => {
      fireEvent.click(getByText(en.connectData.csv));
    });
    // A foreign load (e.g. MCP push) while the picker is open is not the
    // wizard's load: it must not open a mapping step for foreign data.
    act(() => {
      useLabelStore.getState().loadDataset(DB_DATASET);
    });
    getByText(en.connectData.chooseSource);
    expect(queryByText(en.connectData.finish)).toBeNull();
  });

  it('back from mapping restores the pre-wizard state (fresh case: empty)', async () => {
    setStore();
    const view = render(<ConnectDataWizard />);
    await loadCsv(view);
    view.getByText(en.connectData.finish);
    act(() => {
      fireEvent.click(view.getByText(en.variables.cancel));
    });
    expect(useLabelStore.getState().dataset).toBeNull();
    view.getByText(en.connectData.chooseSource);
  });

  it('back from mapping after a replace restores the previous dataset, mapping and link', async () => {
    const oldMapping = { bindings: {}, headerSnapshot: ['old'] };
    setStore({ dataset: EXCEL_DATASET, columnMapping: oldMapping });
    const view = render(<ConnectDataWizard />);
    await loadCsv(view);
    await view.findByText(en.variables.csvReplaceCsvTitle);
    await act(async () => {
      fireEvent.click(view.getByText(en.variables.csvKeepAndRemap));
    });
    view.getByText(en.connectData.finish);
    act(() => {
      fireEvent.click(view.getByText(en.variables.cancel)); // back = abort the load
    });
    const s = useLabelStore.getState();
    expect(s.dataset).toBe(EXCEL_DATASET);
    expect(s.columnMapping).toBe(oldMapping);
    expect(s.dataSourceRef).toBeNull();
  });

  it('closing the wizard mid-mapping also restores the replaced dataset', async () => {
    setStore({ dataset: EXCEL_DATASET });
    const view = render(<ConnectDataWizard />);
    await loadCsv(view);
    await view.findByText(en.variables.csvReplaceCsvTitle);
    await act(async () => {
      fireEvent.click(view.getByText(en.variables.csvKeepAndRemap));
    });
    view.getByText(en.connectData.finish);
    act(() => {
      view.unmount();
    });
    expect(useLabelStore.getState().dataset).toBe(EXCEL_DATASET);
  });

  it('does not restore over a foreign load that superseded the wizard load', async () => {
    setStore();
    const view = render(<ConnectDataWizard />);
    await loadCsv(view);
    view.getByText(en.connectData.finish);
    const foreign = { ...DB_DATASET, headers: ['foreign'], rows: [['f']] };
    act(() => {
      useLabelStore.getState().loadDataset(foreign);
    });
    act(() => {
      view.unmount();
    });
    // The abort must keep the newer foreign state, not clobber it.
    expect(useLabelStore.getState().dataset?.headers).toEqual(['foreign']);
  });

  it('a later foreign load leaves the mapping step instead of remapping foreign data', async () => {
    setStore();
    const view = render(<ConnectDataWizard />);
    await loadCsv(view);
    view.getByText(en.connectData.finish);
    act(() => {
      useLabelStore.getState().loadDataset(DB_DATASET);
    });
    // Finish must not be able to apply the session to the foreign dataset.
    expect(view.queryByText(en.connectData.finish)).toBeNull();
    view.getByText(en.connectData.chooseSource);
  });

  it('cancelling the CSV replace-confirm keeps the old data and never advances', async () => {
    setStore({ dataset: DB_DATASET });
    const view = render(<ConnectDataWizard />);
    act(() => {
      fireEvent.click(view.getByText(en.connectData.csv));
    });
    await loadCsv(view);
    await view.findByText(en.variables.csvReplaceCsvTitle);
    act(() => {
      fireEvent.click(view.getByText(en.variables.cancel));
    });
    // Declined: a later foreign load must not advance either.
    act(() => {
      useLabelStore.getState().loadDataset(DB_DATASET);
    });
    view.getByText(en.connectData.chooseSource);
    expect(view.queryByText(en.connectData.finish)).toBeNull();
  });

  it('loading a design closes the wizard', () => {
    act(() => {
      useLabelStore.getState().openConnectWizard();
      useLabelStore.getState().loadDesign({ widthMm: 50, heightMm: 30, dpmm: 8 }, []);
    });
    expect(useLabelStore.getState().connectWizardOpen).toBe(false);
  });

  it('finish commits the mapping and reaches the done step', async () => {
    setStore({ variables: [{ id: 'v1', name: 'sku', fnNumber: 1, defaultValue: '' }] });
    const view = render(<ConnectDataWizard />);
    await loadCsv(view);
    await act(async () => {
      fireEvent.click(view.getByText(en.connectData.finish));
    });
    expect(useLabelStore.getState().columnMapping?.bindings.v1).toBe('sku');
    view.getByText(en.connectData.doneTitle);
  });
});

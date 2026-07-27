// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { useLabelStore } from '../../store/labelStore';
import { fallbackTranslations as en } from '../../locales';
import { EXCEL_DATASET } from './wizardTestFixtures';
import type * as platform from '../../lib/platform';

vi.mock('../../lib/platform', async (orig) => ({
  ...(await orig<typeof platform>()),
  isDesktopShell: true,
}));
vi.mock('../../lib/excel', () => ({
  pickExcelFile: vi.fn(async () => '/data/f.xlsx'),
  excelListSheets: vi.fn(async () => ['Sheet1', 'Sheet2']),
  excelFetchDataset: vi.fn(async (_path: string, filename: string, sheet: string) => ({
    headers: ['sku', 'price'],
    rows: [['A1', '9.99']],
    source: { kind: 'excel', filename, sheet, importedAt: '2026-01-01T00:00:00Z', rowCount: 1, truncated: false },
  })),
}));

const { ConnectDataWizard } = await import('./ConnectDataWizard');


afterEach(cleanup);

describe('ConnectDataWizard Excel (desktop)', () => {
  it('advances to mapping after picking a worksheet', async () => {
    act(() => {
      useLabelStore.setState({ dataset: null, variables: [], columnMapping: null } as never);
    });
    const { getByText, findByText } = render(<ConnectDataWizard />);
    await act(async () => {
      fireEvent.click(getByText(en.connectData.excel));
    });
    await findByText(en.variables.excelSheetLabel);
    await act(async () => {
      fireEvent.click(getByText(en.variables.dbLoad));
    });
    await findByText(en.connectData.finish);
  });

  it('cancelling the sheet modal keeps the old dataset and stays on source despite the token bump', async () => {
    // cancelExcelImport bumps the token (invalidateDatasetFetches); the bump
    // must not read as a wizard load against this pre-existing dataset.
    act(() => {
      useLabelStore.setState({ dataset: EXCEL_DATASET, variables: [], columnMapping: null } as never);
    });
    const { getByText, queryByText } = render(<ConnectDataWizard />);
    await act(async () => {
      fireEvent.click(getByText(en.connectData.excel));
    });
    await waitFor(() => getByText(en.variables.excelSheetLabel));
    await act(async () => {
      fireEvent.click(getByText(en.variables.cancel));
    });
    getByText(en.connectData.chooseSource);
    expect(queryByText(en.connectData.finish)).toBeNull();
  });
});

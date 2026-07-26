// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { VariableMappingModal } from './VariableMappingModal';
import { useLabelStore } from '../../store/labelStore';
import { fallbackTranslations as en } from '../../locales';

afterEach(cleanup);

// A db dataset binds directly against fetched headers/rows (no raw-text cache),
// so it exercises the extracted mapping core without the CSV decode path.
const DB_SOURCE = {
  kind: 'db' as const,
  profileId: 'p1',
  profileName: 'Local',
  table: 't',
  fetchedAt: '2026-01-01T00:00:00Z',
  truncated: false,
  rowCount: 2,
};

function seed() {
  act(() => {
    useLabelStore.setState({
      variables: [{ id: 'v1', name: 'sku', fnNumber: 1, defaultValue: '' }],
      columnMapping: null,
      dataset: {
        headers: ['sku', 'price'],
        rows: [
          ['A1', '9.99'],
          ['B2', '4.50'],
        ],
        source: DB_SOURCE,
        activeRowIndex: 0,
      },
    } as never);
  });
}

describe('MappingEditor via VariableMappingModal', () => {
  it('renders the draft table and auto-suggests the matching column', () => {
    seed();
    const { container, getByText } = render(
      <VariableMappingModal onClose={() => undefined} onImportCsv={() => undefined} />,
    );
    // The variable row shows its name and the sample from the active row.
    expect(container.querySelector<HTMLInputElement>('input[value="sku"]')).not.toBeNull();
    getByText('A1');
  });

  it('applies the draft mapping to the store on confirm', () => {
    seed();
    const { getByText } = render(
      <VariableMappingModal onClose={() => undefined} onImportCsv={() => undefined} />,
    );
    act(() => {
      fireEvent.click(getByText(en.variables.csvApply));
    });
    // The name-matched column auto-suggests, so confirm commits sku -> "sku".
    const mapping = useLabelStore.getState().columnMapping;
    expect(mapping?.bindings.v1).toBe('sku');
    expect(mapping?.headerSnapshot).toEqual(['sku', 'price']);
  });

  it('shows the import-first shell when there is no dataset', () => {
    act(() => {
      useLabelStore.setState({ variables: [], columnMapping: null, dataset: null } as never);
    });
    const { getByText } = render(
      <VariableMappingModal onClose={() => undefined} onImportCsv={() => undefined} />,
    );
    getByText(en.variables.csvNoCsvLoaded);
  });
});

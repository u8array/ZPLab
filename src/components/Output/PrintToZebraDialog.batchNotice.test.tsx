// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { PrintToZebraDialog } from './PrintToZebraDialog';
import { useLabelStore } from '../../store/labelStore';
import { fallbackTranslations as en } from '../../locales';

afterEach(cleanup);

const dataset = {
  headers: ['sku'],
  rows: [['A1'], ['B2'], ['C3']],
  source: {
    kind: 'csv' as const,
    filename: 't.csv',
    importedAt: '',
    encoding: 'utf-8',
    delimiter: ',',
    rowCount: 3,
  },
  activeRowIndex: 0,
};
const variables = [{ id: 'v1', name: 'sku', fnNumber: 1, defaultValue: '' }];
const mapping = { bindings: { v1: 'sku' }, headerSnapshot: ['sku'] };

const noticeText = () => en.zebraPrint.batchNoticeFmt.replace('{n}', '3');

describe('PrintToZebraDialog printer-impact notice', () => {
  it('warns when the sent bytes carry printer-setup commands', () => {
    act(() => {
      useLabelStore.setState({ zebraPrintSource: 'label', dataset: null, columnMapping: null });
    });
    const { container } = render(
      <PrintToZebraDialog zpl={'^XA^JUS^FO10,10^A0N,30,30^FDX^FS^XZ'} onClose={vi.fn()} />,
    );
    expect(container.textContent).toContain('^JU');
  });

  it('stays silent for the setup-script source', () => {
    act(() => {
      useLabelStore.setState({ zebraPrintSource: 'setupScript', dataset: null, columnMapping: null });
    });
    const { container } = render(<PrintToZebraDialog zpl={'^XA^JUS^XZ'} onClose={vi.fn()} />);
    expect(container.textContent).not.toContain('^JU');
  });
});

// Regression: the batch send-notice guards against an unaware bulk send, so it
// must appear iff a mapped dataset drives the label source.
describe('PrintToZebraDialog batch notice', () => {
  it('shows the row-count notice for a mapped dataset on the label source', () => {
    act(() => {
      useLabelStore.setState({ zebraPrintSource: 'label', dataset, columnMapping: mapping, variables });
    });
    const { container } = render(<PrintToZebraDialog zpl="^XA^XZ" onClose={vi.fn()} />);
    expect(container.textContent).toContain(noticeText());
  });

  it('multiplies by the per-label print quantity (^PQ rides every recall)', () => {
    act(() => {
      useLabelStore.setState({
        zebraPrintSource: 'label',
        dataset,
        columnMapping: mapping,
        variables,
        label: { widthMm: 50, heightMm: 30, dpmm: 8, printQuantity: 4 },
      });
    });
    const { container } = render(<PrintToZebraDialog zpl="^XA^XZ" onClose={vi.fn()} />);
    const expected = en.zebraPrint.batchNoticeQtyFmt
      .replace('{n}', '12')
      .replace('{rows}', '3')
      .replace('{q}', '4');
    expect(container.textContent).toContain(expected);
  });

  it('hides the notice for the setup-script source', () => {
    act(() => {
      useLabelStore.setState({ zebraPrintSource: 'setupScript', dataset, columnMapping: mapping });
    });
    const { container } = render(<PrintToZebraDialog zpl="^XA^XZ" onClose={vi.fn()} />);
    expect(container.textContent).not.toContain(noticeText());
  });

  it('hides the notice without a mapped dataset', () => {
    act(() => {
      useLabelStore.setState({ zebraPrintSource: 'label', dataset: null, columnMapping: null });
    });
    const { container } = render(<PrintToZebraDialog zpl="^XA^XZ" onClose={vi.fn()} />);
    expect(container.textContent).not.toContain('one per data row');
  });
});

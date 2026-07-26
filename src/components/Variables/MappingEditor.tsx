import { PlusIcon } from '@heroicons/react/16/solid';
import { useT } from '../../hooks/useT';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { inputCls } from '../Properties/styles';
import { Select } from '../ui/Select';
import { Tooltip } from '../ui/Tooltip';
import { MappingRow } from './MappingRow';
import type { DraftOptions, MappingDraft } from './useMappingDraft';

/** Chrome (the modal, later the wizard step) wraps this and drives its footer
 *  from `draft.canApply` / `draft.apply`. */
export function MappingEditor({ draft }: { draft: MappingDraft }) {
  const tv = useT().variables;
  const {
    csvSource,
    draftVariables,
    draftOptions,
    setDraftOptions,
    draftRow,
    setDraftRow,
    virtualRows,
    allSlotsTaken,
    showMismatchWarning,
    parseError,
    addVariable,
  } = draft;

  return (
    <div className="flex flex-col gap-4">
      <p className="font-mono text-[10px] text-muted leading-relaxed">{tv.csvMappingHint}</p>

      {showMismatchWarning && (
        <p className="font-mono text-[10px] text-amber-400 leading-relaxed">
          {tv.csvHeaderMismatchWarning}
        </p>
      )}

      {parseError && <p className="font-mono text-[10px] text-amber-400">{tv.csvParseError}</p>}

      <div className="flex flex-col border border-border/50 rounded">
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0 bg-surface z-10">
              <tr className="text-left text-muted uppercase text-[10px] tracking-wider">
                <th className="pb-2 pt-2 px-3 font-medium">{tv.csvVariableHeader}</th>
                <th className="pb-2 pt-2 pr-3 font-medium">{tv.csvColumnHeader}</th>
                <th className="pb-2 pt-2 pr-3 font-medium">{tv.csvSampleHeader}</th>
              </tr>
            </thead>
            <tbody>
              {draftVariables.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-3 px-3 text-muted italic text-[10px]">
                    {tv.csvNoVariables}
                  </td>
                </tr>
              ) : (
                draftVariables.map((v) => <MappingRow key={v.id} draft={draft} variable={v} />)
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border/50 px-3 py-2 flex flex-col gap-2">
          <button
            onClick={addVariable}
            disabled={allSlotsTaken}
            className="self-start flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono border border-dashed border-border text-muted hover:text-text hover:border-border-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            {tv.add}
          </button>
        </div>
      </div>

      {virtualRows.length > 0 && (
        <Tooltip content={tv.csvActiveRowTooltip} className="w-full">
          <div className="flex w-full items-center gap-2 font-mono text-xs text-text">
            <label htmlFor="variable-mapping-preview-row" className="text-muted">
              {tv.csvActiveRowLabel}:
            </label>
            <input
              id="variable-mapping-preview-row"
              type="number"
              min={1}
              max={virtualRows.length}
              // Inline className instead of inputCls because inputCls includes
              // w-full, which would crowd out the inline label and "of N" suffix.
              className="w-20 bg-surface-2 border border-border rounded px-2 py-1 text-xs font-mono text-text focus:border-accent focus:outline-none"
              value={draftRow + 1}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!Number.isNaN(n)) {
                  setDraftRow(Math.max(0, Math.min(n - 1, virtualRows.length - 1)));
                }
              }}
            />
            <span className="text-muted">
              {tv.csvActiveRowOf} {virtualRows.length}
            </span>
          </div>
        </Tooltip>
      )}

      {csvSource && (
        <CollapsibleSection
          id="variable-mapping-csv-options"
          title={tv.csvOptionsTitle}
          defaultOpen={false}
        >
          <CsvOptionsEditor value={draftOptions} onChange={setDraftOptions} />
        </CollapsibleSection>
      )}
    </div>
  );
}

function CsvOptionsEditor({
  value,
  onChange,
}: {
  value: DraftOptions;
  onChange: (next: DraftOptions) => void;
}) {
  const tv = useT().variables;
  return (
    <div className="flex flex-col gap-2 pt-2">
      <div className="flex flex-col gap-1">
        <label className="font-mono text-[10px] text-muted uppercase tracking-wider">
          {tv.csvDelimiterLabel}
        </label>
        <Select<string>
          value={value.delimiter}
          onChange={(delimiter) => onChange({ ...value, delimiter })}
          groups={[
            {
              options: [
                { value: '', label: tv.csvDelimiterAuto },
                { value: ',', label: tv.csvDelimiterComma },
                { value: ';', label: tv.csvDelimiterSemicolon },
                { value: '\t', label: tv.csvDelimiterTab },
              ],
            },
          ]}
        />
      </div>

      <label className="flex items-center gap-2 font-mono text-[10px] text-text cursor-pointer">
        <input
          type="checkbox"
          className="accent-accent"
          checked={value.hasHeaderRow}
          onChange={(e) => onChange({ ...value, hasHeaderRow: e.target.checked })}
        />
        {tv.csvHasHeaderRow}
      </label>

      <div className="flex flex-col gap-1">
        <label className="font-mono text-[10px] text-muted uppercase tracking-wider">
          {tv.csvSkipRowsLabel}
        </label>
        <input
          type="number"
          min={0}
          className={inputCls}
          value={value.skipRows}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            onChange({ ...value, skipRows: Math.max(0, Number.isNaN(n) ? 0 : n) });
          }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="font-mono text-[10px] text-muted uppercase tracking-wider">
          {tv.csvEncodingLabel}
        </label>
        <Select<string>
          value={value.encoding}
          onChange={(encoding) => onChange({ ...value, encoding })}
          groups={[
            {
              options: [
                { value: 'utf-8', label: tv.csvEncodingUtf8 },
                { value: 'windows-1252', label: tv.csvEncodingWin1252 },
                { value: 'iso-8859-1', label: tv.csvEncodingIso88591 },
                { value: 'utf-16le', label: tv.csvEncodingUtf16le },
              ],
            },
          ]}
        />
      </div>
    </div>
  );
}

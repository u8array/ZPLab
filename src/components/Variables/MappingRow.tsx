import { XMarkIcon } from '@heroicons/react/16/solid';
import type { Variable } from '@zplab/core/types/Variable';
import { getVariableSource } from '@zplab/core/lib/variableBinding';
import { useT } from '../../hooks/useT';
import { inputCls } from '../Properties/styles';
import { Select } from '../ui/Select';
import { Tooltip } from '../ui/Tooltip';
import { VariableSourceBadge } from './VariableSourceBadge';
import type { MappingDraft } from './useMappingDraft';

export function MappingRow({ draft, variable }: { draft: MappingDraft; variable: Variable }) {
  const tv = useT().variables;
  const {
    draftBindings,
    virtualHeaders,
    nameErrors,
    initialVariableIds,
    duplicateHeaders,
    setDraftVariableName,
    changeBinding,
    removeDraftVariable,
  } = draft;

  const nameError = nameErrors[variable.id];
  const isNew = !initialVariableIds.has(variable.id);
  const boundHeader = draftBindings[variable.id];
  const isDuplicate = boundHeader !== undefined && duplicateHeaders.has(boundHeader);
  // Classify against the draft (not the committed store state) so the badge
  // reflects live binding edits before Apply.
  const draftSource = getVariableSource(
    variable,
    { headers: virtualHeaders },
    { bindings: draftBindings, headerSnapshot: virtualHeaders },
  );

  return (
    <tr className="border-t border-border/50 align-top">
      <td className="py-1.5 px-3">
        <div className="flex items-center gap-1">
          <VariableSourceBadge source={draftSource} boundHeader={boundHeader} size="xs" />
          <input
            className={`${inputCls} ${nameError ? 'border-amber-400' : ''}`}
            value={variable.name}
            onChange={(e) => setDraftVariableName(variable.id, e.target.value)}
          />
          {isNew && (
            <Tooltip content={tv.csvRemoveDraftAria}>
              <button
                onClick={() => removeDraftVariable(variable.id)}
                aria-label={tv.csvRemoveDraftAria}
                className="shrink-0 p-1 rounded text-muted hover:text-amber-400 hover:bg-surface-2 transition-colors"
              >
                <XMarkIcon className="w-3 h-3" />
              </button>
            </Tooltip>
          )}
        </div>
        {nameError ? (
          <p className="mt-0.5 font-mono text-[9px] text-amber-400">{nameError}</p>
        ) : isNew ? (
          <p className="mt-0.5 font-mono text-[9px] text-accent/70 italic">{tv.csvWillBeCreated}</p>
        ) : null}
      </td>
      <td className="py-1.5 pr-3">
        <div className={isDuplicate ? 'rounded border border-amber-400' : ''}>
          <Select<string>
            value={boundHeader ?? ''}
            onChange={(value) => changeBinding(variable.id, value)}
            groups={[
              {
                options: [
                  { value: '', label: tv.csvIgnoreOption },
                  ...virtualHeaders.map((h) => ({ value: h, label: h })),
                ],
              },
            ]}
          />
        </div>
        {isDuplicate && (
          <p className="mt-0.5 font-mono text-[9px] text-amber-400">{tv.csvDuplicateColumn}</p>
        )}
      </td>
      <td className="py-1.5 pr-3 align-middle">
        <SampleCell draft={draft} variable={variable} boundHeader={boundHeader} />
      </td>
    </tr>
  );
}

function SampleCell({
  draft,
  variable,
  boundHeader,
}: {
  draft: MappingDraft;
  variable: Variable;
  boundHeader: string | undefined;
}) {
  const tv = useT().variables;
  const { virtualHeaders, virtualRows, draftRow } = draft;

  if (boundHeader !== undefined) {
    const colIdx = virtualHeaders.indexOf(boundHeader);
    const cell = colIdx >= 0 ? virtualRows[draftRow]?.[colIdx] ?? '' : '';
    return cell === '' ? (
      <span className="text-[10px] text-muted italic">{tv.csvSampleEmpty}</span>
    ) : (
      <span className="text-[10px] text-text truncate block max-w-[120px]" title={cell}>
        {cell}
      </span>
    );
  }
  return (
    <span
      className="text-[10px] text-muted italic truncate block max-w-[120px]"
      title={variable.defaultValue || tv.csvSamplePlaceholder}
    >
      {variable.defaultValue || tv.csvSamplePlaceholder}
    </span>
  );
}

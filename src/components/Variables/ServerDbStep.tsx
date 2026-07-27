import { useState } from 'react';
import { ArrowLeftIcon, CircleStackIcon } from '@heroicons/react/16/solid';
import { useT } from '../../hooks/useT';
import { useServerDbConnectActions } from '../../hooks/useServerDbConnectActions';
import { formatTemplate } from '../../lib/formatTemplate';
import { inputCls } from '../Properties/styles';
import { Select } from '../ui/Select';
import { NetworkDbFields } from '../db/NetworkDbFields';
import type { NetworkDbProfile } from '../../lib/db';

interface Props {
  driver: 'postgres' | 'mysql';
  onBack: () => void;
  /** Runs the actual fetch (the wizard marks a success as its own load);
   *  true once the dataset applied. */
  onLoad: (profile: NetworkDbProfile, table: string) => Promise<boolean>;
}

/** Renders the guided network-DB connect: endpoint form, Connect lists tables,
 *  pick one, Load. All connect/persist policy lives in the hook. */
export function ServerDbStep({ driver, onBack, onLoad }: Props) {
  const t = useT();
  const tv = t.variables;
  const tc = t.connectData;
  const {
    fields,
    editFields,
    passwordDraft,
    editPassword,
    ready,
    tables,
    listError,
    busy,
    connect,
    loadTable,
  } = useServerDbConnectActions(driver);
  const [table, setTable] = useState('');
  // A stale selection (listing changed underneath) falls back to the first entry.
  const chosen = tables !== null && tables.includes(table) ? table : tables?.[0] ?? '';

  return (
    <>
      <div className="flex flex-col gap-3 px-4 py-4 overflow-y-auto font-mono text-xs">
        <NetworkDbFields driver={driver} value={fields} onChange={editFields}>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted uppercase tracking-wider">
              {tv.dbPasswordLabel}
            </label>
            <input
              type="password"
              className={inputCls}
              value={passwordDraft}
              onChange={(e) => editPassword(e.target.value)}
              autoComplete="off"
            />
            <p className="text-[9px] text-muted leading-snug">{tv.dbPasswordStoredHint}</p>
          </div>
        </NetworkDbFields>

        {listError !== null && (
          <p className="text-[10px] text-amber-400 wrap-break-word">
            {formatTemplate(tv.dbTablesErrorFmt, { error: listError })}
          </p>
        )}

        {tables !== null && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted uppercase tracking-wider">
              {tv.dbTableLabel}
            </label>
            <Select<string>
              value={chosen}
              onChange={setTable}
              groups={[{ options: tables.map((name) => ({ value: name, label: name })) }]}
            />
          </div>
        )}
      </div>

      <div className="flex justify-between items-center gap-2 px-4 py-3 border-t border-border shrink-0">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs font-mono text-muted hover:text-text hover:bg-surface-2 transition-colors"
        >
          <ArrowLeftIcon className="w-3.5 h-3.5" />
          {tv.cancel}
        </button>
        {tables === null ? (
          <button
            onClick={connect}
            disabled={!ready || busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono bg-accent text-bg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            <CircleStackIcon className="w-3.5 h-3.5" />
            {tc.connect}
          </button>
        ) : (
          <button
            onClick={() => chosen !== '' && loadTable(chosen, onLoad)}
            disabled={chosen === '' || busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono bg-accent text-bg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            <CircleStackIcon className="w-3.5 h-3.5" />
            {tv.dbLoad}
          </button>
        )}
      </div>
    </>
  );
}

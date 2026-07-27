import { useEffect, useState } from 'react';
import { CircleStackIcon, PlusIcon, TableCellsIcon, TrashIcon } from '@heroicons/react/16/solid';
import { useLabelStore } from '../../store/labelStore';
import { useT } from '../../hooks/useT';
import { useDbConnectActions } from '../../hooks/useDbConnectActions';
import {
  dbListTables,
  dbPasswordCred,
  dbSetPassword,
  enqueueCredWrite,
  grantedSqlitePaths,
  pickSqliteFile,
  revokeSqlitePath,
} from '../../lib/db';
import { deleteCredential } from '../../lib/credentialStore';
import { formatTemplate } from '../../lib/formatTemplate';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Select } from '../ui/Select';
import { inputCls } from '../Properties/styles';
import { NetworkDbFields } from '../db/NetworkDbFields';
import type { DbProfile } from '../../lib/db';

import { newId } from "@zplab/core/lib/ids";
type Driver = DbProfile['driver'];

/** Settings tab: pick-or-create a connection profile, browse its tables,
 *  load rows as the session dataset (closes the settings modal, the mapping
 *  review takes over). Desktop-only via TAB_GATES. */
export function DataSourcesTab() {
  const t = useT();
  const tv = t.variables;
  const dbProfiles = useLabelStore((s) => s.dbProfiles);
  const addDbProfile = useLabelStore((s) => s.addDbProfile);
  const updateDbProfile = useLabelStore((s) => s.updateDbProfile);
  const removeDbProfile = useLabelStore((s) => s.removeDbProfile);
  const dataSourceRef = useLabelStore((s) => s.dataSourceRef);
  const setPrinterSettingsTab = useLabelStore((s) => s.setPrinterSettingsTab);
  const openConnectWizard = useLabelStore((s) => s.openConnectWizard);
  const { loadFromDb } = useDbConnectActions();

  const [selectedId, setSelectedId] = useState<string>(() => {
    // A saved link whose profile was deleted must not preselect a ghost id
    // (empty select trigger, hidden form); fall back to the first profile.
    const refId = dataSourceRef?.profileId;
    return (refId && dbProfiles.some((p) => p.id === refId) ? refId : dbProfiles[0]?.id) ?? '';
  });
  const profile = dbProfiles.find((p) => p.id === selectedId) ?? null;

  const [selectedTable, setSelectedTable] = useState<string>(
    () => (dataSourceRef?.profileId === selectedId ? dataSourceRef?.table ?? '' : ''),
  );
  const [loading, setLoading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DbProfile | null>(null);
  // Local mirror of the password input; committed to the keychain on blur,
  // never into the store. Empty means "keep whatever is stored".
  const [passwordDraft, setPasswordDraft] = useState('');
  // Bumped when a new password or path grant lands so a previously-failed
  // table fetch retries even when the profile content is unchanged.
  const [retryNonce, setRetryNonce] = useState(0);

  const connectionReady =
    profile !== null &&
    (profile.driver === 'sqlite'
      ? profile.path !== ''
      : profile.host !== '' && profile.database !== '' && profile.user !== '');

  // Keyed by full connection identity so edits refetch but a rename doesn't;
  // a key mismatch is a stale result, reset derived in render (not via effect).
  const tablesKey = profile
    ? `${retryNonce} ${JSON.stringify({ ...profile, name: undefined })}`
    : '';
  const [tablesResult, setTablesResult] = useState<{
    key: string;
    tables?: string[];
    error?: string;
  } | null>(null);
  const tables = tablesResult?.key === tablesKey ? tablesResult.tables ?? null : null;
  const tablesError = tablesResult?.key === tablesKey ? tablesResult.error ?? null : null;
  // The selection is only valid once it appears in the CURRENT connection's
  // table list; while tables are (re)loading or errored, treat it as unset so
  // Load can't fire against a stale table the (empty) Select no longer shows.
  const liveTable = tables?.includes(selectedTable) ? selectedTable : '';
  useEffect(() => {
    if (!connectionReady) return;
    let cancelled = false;
    // Debounced: tablesKey changes on every keystroke and each listing is a real
    // connect()+login, so without the delay editing a field fires a burst of
    // failed logins that can trip server-side lockout / fail2ban.
    const timer = setTimeout(() => {
      // Re-read from the store so the async callback can't use a stale closure.
      const current = useLabelStore.getState().dbProfiles.find((p) => p.id === selectedId);
      if (!current) return;
      const key = tablesKey;
      dbListTables(current)
        .then((ts) => {
          if (cancelled) return;
          // liveTable masks a stale selection at every consumer, so no prune here.
          setTablesResult({ key, tables: ts });
        })
        .catch((e: unknown) => {
          if (!cancelled) setTablesResult({ key, error: String(e) });
        });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [connectionReady, selectedId, tablesKey]);

  const handleAdd = () => {
    const created: DbProfile = {
      id: newId(),
      name: nextProfileName(dbProfiles, tv.dbProfileLabel),
      driver: 'sqlite',
      path: '',
    };
    addDbProfile(created);
    setSelectedId(created.id);
    setSelectedTable('');
  };

  // Call AFTER the profile mutation so the keep list reflects the new state
  // (revokeSqlitePath documents the shared-grant semantics).
  const revokeOrphanedGrant = (path: string) => {
    void revokeSqlitePath(path, grantedSqlitePaths(useLabelStore.getState().dbProfiles));
  };

  const handleDriverChange = (driver: Driver) => {
    if (!profile || driver === profile.driver) return;
    // Leaving the network drivers orphans the keychain password; drop it so a
    // later switch back can't silently reuse a stale secret.
    if (driver === 'sqlite' && profile.driver !== 'sqlite') {
      void deleteStoredPassword(profile.id);
    }
    const orphanedPath = profile.driver === 'sqlite' ? profile.path : '';
    const base = { id: profile.id, name: profile.name };
    updateDbProfile(
      driver === 'sqlite'
        ? { ...base, driver, path: '' }
        : { ...base, driver, host: '', database: '', user: '' },
    );
    // Leaving sqlite orphans the path grant; drop it like the password above.
    if (orphanedPath) revokeOrphanedGrant(orphanedPath);
    setSelectedTable('');
    setPasswordDraft('');
  };

  const handleBrowse = () => {
    if (!profile || profile.driver !== 'sqlite') return;
    const previous = profile.path;
    void pickSqliteFile(previous || undefined).then((path) => {
      if (path && profile.driver === 'sqlite') {
        updateDbProfile({ ...profile, path });
        // Re-picking the SAME file (grant recovery) leaves the profile content
        // unchanged, so tablesKey alone would not refetch; bump explicitly.
        setRetryNonce((n) => n + 1);
        // After the update, so the keep list already contains the new path
        // (Rust keeps the grant when both resolve to the same file).
        if (previous && previous !== path) revokeOrphanedGrant(previous);
      }
    }, browseError);
  };

  // Pick succeeded but the file vanished before it could be granted; surface
  // it instead of an unhandled rejection (path stays unchanged).
  const browseError = (e: unknown) =>
    useLabelStore
      .getState()
      .setUserError(formatTemplate(tv.dbFetchErrorFmt, { error: String(e) }));

  // Keychain writes serialize through the module-level queue in lib/db (shared
  // with the reconnect chip). A failed save leaves the keychain unchanged, so a
  // later Load just authenticates with the old password and surfaces the error.
  const credError = (e: unknown) =>
    useLabelStore
      .getState()
      .setUserError(formatTemplate(tv.dbPasswordSaveErrorFmt, { error: String(e) }));

  const commitPassword = () => {
    if (!profile || profile.driver === 'sqlite' || passwordDraft === '') return;
    const netProfile = profile;
    const value = passwordDraft;
    // dbSetPassword (not setCredentialExact): stores the password endpoint-bound
    // in Rust so it can't be replayed against another host. Whitespace is kept.
    void enqueueCredWrite(() =>
      dbSetPassword(netProfile, value).then(() => {
        setPasswordDraft('');
        setRetryNonce((n) => n + 1);
      }, credError), // draft stays so the user can retry
    );
  };

  const clearStoredPassword = () => {
    if (!profile) return;
    const id = profile.id;
    setPasswordDraft('');
    void enqueueCredWrite(() =>
      deleteCredential(dbPasswordCred(id)).then(() => setRetryNonce((n) => n + 1), credError),
    );
  };

  const deleteStoredPassword = (id: string): Promise<void> =>
    enqueueCredWrite(() => deleteCredential(dbPasswordCred(id)).catch(credError));

  const handleLoad = () => {
    if (!profile || liveTable === '') return;
    setLoading(true);
    void (async () => {
      // loadFromDb awaits the cred-write queue itself, so a just-typed password
      // still lands before the connect; no second await needed here.
      const ok = await loadFromDb(profile, liveTable);
      setLoading(false);
      // Hand over to the mapping review; settings stay open on failure so
      // the user can correct the connection.
      if (ok) setPrinterSettingsTab(null);
    })();
  };

  const fieldLabel = 'text-[10px] text-muted uppercase tracking-wider';

  return (
    <div className="flex flex-col gap-3 font-mono text-xs max-w-md">
        {/* Secondary entry into the guided flow; the wizard replaces the modal. */}
        <button
          onClick={() => {
            setPrinterSettingsTab(null);
            openConnectWizard();
          }}
          className="self-start flex items-center gap-1.5 px-2 py-1.5 rounded text-xs border border-dashed border-border text-muted hover:text-text hover:border-border-2 transition-colors"
        >
          <TableCellsIcon className="w-3.5 h-3.5" />
          {tv.connectData}
        </button>

        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            <label className={fieldLabel}>{tv.dbProfileLabel}</label>
            {dbProfiles.length === 0 ? (
              <p className="text-[10px] text-muted italic">{tv.dbNoProfiles}</p>
            ) : (
              <Select<string>
                value={selectedId}
                onChange={(id) => {
                  setSelectedId(id);
                  setPasswordDraft('');
                  setSelectedTable(
                    dataSourceRef?.profileId === id ? dataSourceRef.table : '',
                  );
                }}
                groups={[
                  {
                    options: dbProfiles.map((p) => ({ value: p.id, label: p.name })),
                  },
                ]}
              />
            )}
          </div>
          <button
            onClick={handleAdd}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs border border-dashed border-border text-muted hover:text-text hover:border-border-2 transition-colors shrink-0"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            {tv.dbAddProfile}
          </button>
        </div>

        {profile && (
          <>
            <div className="flex flex-col gap-1">
              <label className={fieldLabel}>{tv.dbNameLabel}</label>
              <div className="flex items-center gap-2">
                <input
                  className={`${inputCls} flex-1 min-w-0`}
                  value={profile.name}
                  onChange={(e) => updateDbProfile({ ...profile, name: e.target.value })}
                />
                <button
                  onClick={() => setPendingDelete(profile)}
                  aria-label={tv.dbDeleteProfile}
                  className="p-1.5 rounded text-muted hover:text-amber-400 hover:bg-surface-2 transition-colors shrink-0"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className={fieldLabel}>{tv.dbDriverLabel}</label>
              <Select<Driver>
                value={profile.driver}
                onChange={handleDriverChange}
                groups={[
                  {
                    options: [
                      { value: 'sqlite', label: tv.dbDriverSqlite },
                      { value: 'postgres', label: tv.dbDriverPostgres },
                      { value: 'mysql', label: tv.dbDriverMysql },
                    ],
                  },
                ]}
              />
            </div>

            {profile.driver === 'sqlite' ? (
              <div className="flex flex-col gap-1">
                <label className={fieldLabel}>{tv.dbFileLabel}</label>
                <div className="flex items-center gap-2">
                  <input
                    className={`${inputCls} flex-1 min-w-0`}
                    value={profile.path}
                    readOnly
                    placeholder={tv.dbBrowse}
                  />
                  <button
                    onClick={handleBrowse}
                    className="px-2 py-1.5 rounded text-xs border border-border text-text hover:bg-surface-2 transition-colors shrink-0"
                  >
                    {tv.dbBrowse}
                  </button>
                </div>
              </div>
            ) : (
              <NetworkDbFields
                driver={profile.driver}
                value={{
                  host: profile.host,
                  port: profile.port,
                  database: profile.database,
                  user: profile.user,
                  sslMode: profile.sslMode ?? 'prefer',
                }}
                onChange={(patch) => updateDbProfile({ ...profile, ...patch })}
              >
                <div className="flex flex-col gap-1">
                  <label className={fieldLabel}>{tv.dbPasswordLabel}</label>
                  <input
                    type="password"
                    className={inputCls}
                    value={passwordDraft}
                    onChange={(e) => setPasswordDraft(e.target.value)}
                    onBlur={commitPassword}
                    autoComplete="off"
                  />
                  <p className="text-[9px] text-muted leading-snug">
                    {tv.dbPasswordStoredHint}
                  </p>
                  <button
                    onClick={clearStoredPassword}
                    className="self-start text-[9px] text-muted underline hover:text-amber-400 transition-colors"
                  >
                    {tv.dbPasswordClear}
                  </button>
                </div>
              </NetworkDbFields>
            )}

            <div className="flex flex-col gap-1">
              <label className={fieldLabel}>{tv.dbTableLabel}</label>
              {tablesError ? (
                <p className="text-[10px] text-amber-400 wrap-break-word">
                  {formatTemplate(tv.dbTablesErrorFmt, { error: tablesError })}
                </p>
              ) : (
                <Select<string>
                  value={liveTable}
                  onChange={setSelectedTable}
                  groups={[
                    {
                      options: [
                        { value: '', label: '—' },
                        ...(tables ?? []).map((name) => ({ value: name, label: name })),
                      ],
                    },
                  ]}
                />
              )}
            </div>

            <div className="flex justify-end pt-1">
              <button
                onClick={handleLoad}
                disabled={!connectionReady || liveTable === '' || loading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono bg-accent text-bg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              >
                <CircleStackIcon className="w-3.5 h-3.5" />
                {tv.dbLoad}
              </button>
            </div>
          </>
        )}

      {pendingDelete && (
        <ConfirmDialog
          message={formatTemplate(tv.dbDeleteConfirmFmt, { name: pendingDelete.name })}
          confirmLabel={tv.confirmDelete}
          cancelLabel={tv.cancel}
          destructive
          onConfirm={() => {
            const doomed = dbProfiles.find((p) => p.id === pendingDelete.id);
            removeDbProfile(pendingDelete.id);
            // After the removal, so the keep list no longer contains the
            // deleted profile; a sibling on the same file keeps the grant.
            if (doomed?.driver === 'sqlite' && doomed.path) revokeOrphanedGrant(doomed.path);
            // Drop the orphaned keychain password with the profile.
            void deleteStoredPassword(pendingDelete.id);
            setPendingDelete(null);
            setSelectedId((cur) => {
              if (cur !== pendingDelete.id) return cur;
              const rest = dbProfiles.filter((p) => p.id !== pendingDelete.id);
              return rest[0]?.id ?? '';
            });
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function nextProfileName(existing: readonly DbProfile[], base: string): string {
  const taken = new Set(existing.map((p) => p.name));
  let i = 1;
  while (taken.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

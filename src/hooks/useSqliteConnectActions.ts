import { useEffect, useRef, useState } from 'react';
import { newId } from '@zplab/core/lib/ids';
import { useLabelStore } from '../store/labelStore';
import { currentDataContext, isCurrentDataContext } from '../store/datasetActions';
import { useDbConnectActions } from './useDbConnectActions';
import { pickSqliteFile, dbListTables, revokeSqlitePath, grantedSqlitePaths } from '../lib/db';
import { basename } from '../lib/fileDialogs';
import { formatTemplate } from '../lib/formatTemplate';
import { useT } from './useT';
import type { SqliteProfile } from '../lib/db';

export interface PendingSqliteImport {
  profile: SqliteProfile;
  tables: string[];
  /** datasetFetchToken at pick time; a mismatch on Load means the data context
   *  changed underneath, so the table is not committed. */
  token: number;
}

/** The just-picked path is only in the keep-set once a table loaded (profile
 *  saved), so revoking a cancelled/failed pick drops its grant. */
function grantedPaths(): string[] {
  return grantedSqlitePaths(useLabelStore.getState().dbProfiles);
}

/** Desktop-only guided SQLite connect: pick a file, choose a table, load. The
 *  profile is persisted only once a table loads (so a cancelled pick leaves no
 *  saved connection); its path grant is revoked on cancel. */
export function useSqliteConnectActions() {
  const t = useT();
  const setUserError = useLabelStore((s) => s.setUserError);
  const addDbProfile = useLabelStore((s) => s.addDbProfile);
  const { loadFromDb } = useDbConnectActions();
  const [pendingSqlite, setPendingSqliteState] = useState<PendingSqliteImport | null>(null);
  // Ref mirror for the unmount cleanup: closing the wizard with a pick still
  // pending (dialog open or token-gated hidden) must revoke its path grant,
  // since nothing else will (the profile was never saved).
  const pendingRef = useRef<PendingSqliteImport | null>(null);
  const setPendingSqlite = (v: PendingSqliteImport | null) => {
    pendingRef.current = v;
    setPendingSqliteState(v);
  };
  useEffect(
    () => () => {
      if (pendingRef.current) {
        void revokeSqlitePath(pendingRef.current.profile.path, grantedPaths());
      }
    },
    [],
  );

  const fail = (e: unknown) =>
    setUserError(formatTemplate(t.variables.dbFetchErrorFmt, { error: String(e) }));

  const openSqlitePicker = () => {
    void (async () => {
      // Capture before the pick/list awaits so a document loaded meanwhile
      // invalidates this pick instead of inheriting the new context's token.
      const token = currentDataContext();
      let path: string | null = null;
      try {
        path = await pickSqliteFile();
        if (!path) return;
        const profile: SqliteProfile = { id: newId(), name: basename(path), driver: 'sqlite', path };
        const tables = await dbListTables(profile);
        if (!isCurrentDataContext(token)) {
          void revokeSqlitePath(path, grantedPaths());
          return;
        }
        setPendingSqlite({ profile, tables, token });
      } catch (e) {
        // pickSqliteFile already granted the path when dbListTables rejects;
        // revoke so a failed listing (non-sqlite/locked file) leaves no orphan.
        if (path) void revokeSqlitePath(path, grantedPaths());
        fail(e);
      }
    })();
  };

  const loadTable = async (table: string): Promise<boolean> => {
    if (!pendingSqlite) return false;
    // Dialog opened against an older context: drop it, don't load into the new one.
    if (!isCurrentDataContext(pendingSqlite.token)) {
      void revokeSqlitePath(pendingSqlite.profile.path, grantedPaths());
      setPendingSqlite(null);
      return false;
    }
    try {
      const ok = await loadFromDb(pendingSqlite.profile, table);
      // Persist only on success, so the loaded design can reconnect by profileId.
      if (ok) {
        addDbProfile(pendingSqlite.profile);
        setPendingSqlite(null);
      }
      return ok;
    } catch (e) {
      fail(e);
      return false;
    }
  };

  const cancelSqliteImport = () => {
    // Supersede any in-flight fetch (parity with the excel cancel), then drop the
    // orphaned path grant since no profile was ever saved for it.
    useLabelStore.getState().invalidateDatasetFetches();
    if (pendingSqlite) void revokeSqlitePath(pendingSqlite.profile.path, grantedPaths());
    setPendingSqlite(null);
  };

  return { openSqlitePicker, pendingSqlite, loadTable, cancelSqliteImport };
}

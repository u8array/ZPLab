import { useEffect, useRef, useState } from 'react';
import { newId } from '@zplab/core/lib/ids';
import { useLabelStore } from '../store/labelStore';
import { dbListTables, dbPasswordCred, dbSetPassword, enqueueCredWrite } from '../lib/db';
import { deleteCredential } from '../lib/credentialStore';
import type { DbSslMode, NetworkDbProfile } from '../lib/db';

/** The endpoint form draft: a network profile minus identity. sslMode is
 *  required here (the form always shows a concrete selection). */
export type NetworkDbDraft = Omit<NetworkDbProfile, 'id' | 'name' | 'driver' | 'sslMode'> & {
  sslMode: DbSslMode;
};

/** Guided network-DB connect lifecycle: Connect stores a typed password
 *  endpoint-bound and lists tables; loadTable persists the profile only on
 *  a successful load, and a stored password is deleted on unmount otherwise. */
export function useServerDbConnectActions(driver: 'postgres' | 'mysql') {
  const addDbProfile = useLabelStore((s) => s.addDbProfile);
  const [profileId] = useState(newId);
  const [fields, setFields] = useState<NetworkDbDraft>({
    host: '',
    database: '',
    user: '',
    sslMode: 'prefer',
  });
  const [passwordDraft, setPasswordDraft] = useState('');
  const [tables, setTables] = useState<string[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordStored = useRef(false);
  const persisted = useRef(false);
  const inFlight = useRef<Promise<unknown> | null>(null);
  // Bumped on every draft edit; an in-flight connect only publishes its table
  // listing if the draft is still the one it connected with, so a stale
  // response cannot pair connection A's tables with connection B's fields.
  const draftEpoch = useRef(0);

  // Delete a stored password unless a load persisted the profile that owns it.
  // The decision chains on the in-flight load so it uses the load's OUTCOME,
  // not the unmount moment: closing the wizard mid-fetch must still clean up
  // when that fetch later fails, and must not when it succeeds.
  useEffect(
    () => () => {
      void (inFlight.current ?? Promise.resolve()).then(() => {
        if (passwordStored.current && !persisted.current) {
          void enqueueCredWrite(() =>
            deleteCredential(dbPasswordCred(profileId)).catch(() => undefined),
          );
        }
      });
    },
    [profileId],
  );

  const profile = (): NetworkDbProfile => ({
    id: profileId,
    name: `${fields.database}@${fields.host}`,
    driver,
    ...fields,
  });

  const ready = fields.host !== '' && fields.database !== '' && fields.user !== '';

  /** Any endpoint or password edit invalidates a previous listing. */
  const editFields = (patch: Partial<NetworkDbDraft>) => {
    draftEpoch.current++;
    setFields((prev) => ({ ...prev, ...patch }));
    setTables(null);
    setListError(null);
  };
  const editPassword = (value: string) => {
    draftEpoch.current++;
    setPasswordDraft(value);
    setTables(null);
    setListError(null);
  };

  const connect = () => {
    if (!ready || busy) return;
    setBusy(true);
    setListError(null);
    const epoch = draftEpoch.current;
    // Tracked so the unmount cleanup also waits for a connect that may still
    // store the password, not only for a load.
    inFlight.current = (async () => {
      try {
        // The Rust connector reads the password from the keychain, so a typed
        // one must land there before the listing connect.
        if (passwordDraft !== '') {
          await enqueueCredWrite(() => dbSetPassword(profile(), passwordDraft));
          passwordStored.current = true;
        }
        const listed = await dbListTables(profile());
        if (draftEpoch.current === epoch) setTables(listed);
      } catch (e) {
        if (draftEpoch.current === epoch) setListError(String(e));
      } finally {
        setBusy(false);
      }
    })();
  };

  /** Run a load attempt via `run` (the wizard marks a success as its own load)
   *  and persist the profile on success; the unmount cleanup chains on this
   *  promise, so the password's fate always follows the load's outcome. */
  const loadTable = (
    table: string,
    run: (profile: NetworkDbProfile, table: string) => Promise<boolean>,
  ) => {
    if (busy) return;
    setBusy(true);
    // ONE snapshot for fetch and persist: an in-flight field edit must not
    // save a different profile than the one that produced the dataset.
    const snap = profile();
    inFlight.current = run(snap, table).then((ok) => {
      if (ok) {
        // Persist only on success, so the loaded design can reconnect later.
        persisted.current = true;
        addDbProfile(snap);
      } else {
        setBusy(false);
      }
    });
  };

  return { fields, editFields, passwordDraft, editPassword, ready, tables, listError, busy, connect, loadTable };
}

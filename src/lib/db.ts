import type { DatasetInput } from '@zplab/core/types/DataSource';

interface DbProfileBase {
  id: string;
  name: string;
}

export interface SqliteProfile extends DbProfileBase {
  driver: 'sqlite';
  path: string;
}

/** TLS negotiation level, normalised across drivers (maps to Pg/MySql
 *  SslMode in Rust). `prefer` = opportunistic with plaintext fallback. */
export type DbSslMode = 'disable' | 'prefer' | 'require' | 'verify-full';

/** Network profile. Deliberately WITHOUT a password field: that lives in the
 *  OS keychain under `db-profile-<id>` and is only ever read back in Rust. */
export interface NetworkDbProfile extends DbProfileBase {
  driver: 'postgres' | 'mysql';
  host: string;
  /** Driver default (5432/3306) when unset. */
  port?: number;
  database: string;
  user: string;
  /** Absent = `prefer` (back-compat with pre-TLS-selector profiles). */
  sslMode?: DbSslMode;
}

/** Saved database connection. Machine-level app state (persisted via the
 *  store, not in the design file); designs reference a profile by id via
 *  `dataSourceRef`. */
export type DbProfile = SqliteProfile | NetworkDbProfile;

/** Wire shape of the Rust `DbSpec` enum (serde `tag = "driver"`), built from
 *  a profile. */
type DbSpec =
  | { driver: 'sqlite'; path: string }
  | {
      driver: 'postgres' | 'mysql';
      host: string;
      port?: number;
      database: string;
      user: string;
      profileId: string;
      sslMode: DbSslMode;
    };

/** Wire shape of the Rust `DbRows` struct (shared by the excel commands). */
export interface DbRows {
  headers: string[];
  rows: string[][];
  truncated: boolean;
}

const specOf = (profile: DbProfile): DbSpec =>
  profile.driver === 'sqlite'
    ? { driver: 'sqlite', path: profile.path }
    : {
        driver: profile.driver,
        host: profile.host,
        port: profile.port,
        database: profile.database,
        user: profile.user,
        profileId: profile.id,
        sslMode: profile.sslMode ?? 'prefer',
      };

/** Native pick that also grants the path Rust-side (persisted): the sqlite
 *  db_* commands refuse paths that did not come from this dialog. Returns the
 *  canonical path (store it verbatim), null on cancel; `suggest` preseeds. */
export async function pickSqliteFile(suggest?: string): Promise<string | null> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string | null>('pick_sqlite_file', { suggest: suggest ?? null });
}

/** Drop a persisted sqlite path grant so the set doesn't ratchet up forever.
 *  `keep` = every path still referenced by a profile; Rust compares them
 *  canonically, so a sibling under another spelling keeps its grant. */
export async function revokeSqlitePath(path: string, keep: string[]): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('revoke_db_path', { path, keep });
}

/** Every sqlite path still referenced by a profile: the keep-set for
 *  {@link revokeSqlitePath}, so a file shared by another profile keeps its grant. */
export function grantedSqlitePaths(profiles: readonly DbProfile[]): string[] {
  return profiles.flatMap((p) => (p.driver === 'sqlite' && p.path ? [p.path] : []));
}

/** Keychain account for a profile's password (mirrors Rust `password_cred`). */
export const dbPasswordCred = (profileId: string): string => `db-profile-${profileId}`;

/** Store a network profile's password. Goes through the Rust connector (not the
 *  generic credential command) so it is bound to the profile's endpoint and a
 *  compromised webview can't replay it against another host. */
export async function dbSetPassword(profile: NetworkDbProfile, password: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('db_set_password', { spec: specOf(profile), password });
}

// Module-level serialization of every keychain password mutation so saves and
// deletes apply in call order, and any fetch path can await a pending write
// before connecting (settings tab and reconnect chip are separate components).
let credWriteChain: Promise<unknown> = Promise.resolve();

/** Run a keychain mutation after all previously-enqueued ones. */
export function enqueueCredWrite<T>(op: () => Promise<T>): Promise<T> {
  const run = credWriteChain.then(op, op);
  credWriteChain = run.catch(() => undefined);
  return run;
}

/** Resolves once every enqueued keychain write has settled. */
export function awaitCredWrites(): Promise<unknown> {
  return credWriteChain;
}

export async function dbListTables(profile: DbProfile): Promise<string[]> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string[]>('db_list_tables', { spec: specOf(profile) });
}

/** Fetch a table as the store's dataset shape, stamping the db source. */
export async function dbFetchDataset(profile: DbProfile, table: string): Promise<DatasetInput> {
  const { invoke } = await import('@tauri-apps/api/core');
  const result = await invoke<DbRows>('db_fetch', { spec: specOf(profile), table });
  return {
    headers: result.headers,
    rows: result.rows,
    source: {
      kind: 'db',
      profileId: profile.id,
      profileName: profile.name,
      table,
      fetchedAt: new Date().toISOString(),
      rowCount: result.rows.length,
      truncated: result.truncated,
    },
  };
}

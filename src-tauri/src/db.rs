//! Read-only database connector. The webview sends only a connection spec plus
//! a table name and gets stringified rows back: SQL is composed here against
//! validated identifiers and passwords resolve from the OS keychain, so neither
//! crosses the IPC boundary. TLS is per-profile (`prefer` default); discovery
//! binds the default schema, so schema-qualified links are a deferred follow-up.

use std::time::Duration;

use serde::Deserialize;
use sqlx::mysql::{MySqlConnectOptions, MySqlConnection, MySqlSslMode};
use sqlx::postgres::{PgConnectOptions, PgConnection, PgSslMode};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::{ConnectOptions, Connection, Executor};

use crate::credentials;
use crate::dataset::{Rows, ROW_CAP};
use crate::transport::blocking;

/// Byte budget for a fetched result. ROW_CAP bounds the row count but not cell
/// size, and streaming rows one at a time still needs a ceiling or a table of
/// huge TEXT/BLOB cells could exhaust RAM. Generous vs any real label dataset.
const MAX_FETCH_BYTES: usize = 128 * 1024 * 1024;

/// Typed connector error. Internals propagate this via `?`; only the
/// `#[tauri::command]` entry points stringify it at the IPC edge.
#[derive(Debug, thiserror::Error)]
enum DbError {
  #[error(transparent)]
  Sqlx(#[from] sqlx::Error),
  #[error(transparent)]
  Cred(#[from] credentials::CredError),
  #[error("connection timed out")]
  ConnectTimeout,
  #[error("query timed out")]
  QueryTimeout,
  #[error(
    "result too large (over {} bytes); narrow the selection",
    MAX_FETCH_BYTES
  )]
  OverBudget,
  #[error("unknown table: {0}")]
  UnknownTable(String),
  #[error("stored password no longer matches the connection settings; re-enter it")]
  PasswordMismatch,
  #[error("stored credential is malformed; re-enter the password")]
  PasswordMalformed,
  #[error("sqlite has no password")]
  SqliteNoPassword,
  #[error("file access not granted; re-select the database file in the profile")]
  PathNotAllowed,
  #[error(transparent)]
  Join(#[from] tauri::Error),
}

/// Single source of the over-budget check, so the streaming query and its test
/// agree on the threshold.
fn check_fetch_budget(bytes: usize) -> Result<(), DbError> {
  if bytes > MAX_FETCH_BYTES {
    return Err(DbError::OverBudget);
  }
  Ok(())
}

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Generous: a capped 10k-row fetch over a slow link is legitimate, an
/// indefinitely hung SELECT is not.
const QUERY_TIMEOUT: Duration = Duration::from_secs(30);

/// Bound a fallible future by `dur`, yielding `on_timeout` if it elapses.
async fn with_timeout<T>(
  dur: Duration,
  on_timeout: DbError,
  work: impl std::future::Future<Output = Result<T, DbError>>,
) -> Result<T, DbError> {
  tokio::time::timeout(dur, work)
    .await
    .map_err(|_| on_timeout)?
}

/// TLS level, normalised across drivers. Field defaults to Prefer so a client
/// (or an older wire payload) that omits it keeps the opportunistic behaviour.
#[derive(Deserialize, Clone, Copy, Default)]
#[serde(rename_all = "kebab-case")]
pub enum SslMode {
  Disable,
  #[default]
  Prefer,
  Require,
  VerifyFull,
}

impl SslMode {
  fn tag(self) -> &'static str {
    match self {
      SslMode::Disable => "disable",
      SslMode::Prefer => "prefer",
      SslMode::Require => "require",
      SslMode::VerifyFull => "verify-full",
    }
  }
}

// Driver-enum mappings colocated with SslMode so a new variant is a compile
// error in all three spots (here, the tag above, connect) at once.
impl From<SslMode> for PgSslMode {
  fn from(m: SslMode) -> Self {
    match m {
      SslMode::Disable => PgSslMode::Disable,
      SslMode::Prefer => PgSslMode::Prefer,
      SslMode::Require => PgSslMode::Require,
      SslMode::VerifyFull => PgSslMode::VerifyFull,
    }
  }
}

impl From<SslMode> for MySqlSslMode {
  fn from(m: SslMode) -> Self {
    match m {
      SslMode::Disable => MySqlSslMode::Disabled,
      SslMode::Prefer => MySqlSslMode::Preferred,
      SslMode::Require => MySqlSslMode::Required,
      SslMode::VerifyFull => MySqlSslMode::VerifyIdentity,
    }
  }
}

const PG_DEFAULT_PORT: u16 = 5432;
const MYSQL_DEFAULT_PORT: u16 = 3306;

#[derive(Deserialize, Clone)]
#[serde(tag = "driver", rename_all = "lowercase")]
pub enum DbSpec {
  Sqlite {
    path: String,
  },
  #[serde(rename_all = "camelCase")]
  Postgres {
    host: String,
    port: Option<u16>,
    database: String,
    user: String,
    profile_id: String,
    #[serde(default)]
    ssl_mode: SslMode,
  },
  #[serde(rename_all = "camelCase")]
  Mysql {
    host: String,
    port: Option<u16>,
    database: String,
    user: String,
    profile_id: String,
    #[serde(default)]
    ssl_mode: SslMode,
  },
}

enum DbConn {
  Sqlite(SqliteConnection),
  Postgres(PgConnection),
  Mysql(MySqlConnection),
}

/// Identifier-quoting and text-cast flavour. MySQL differs; the rest are ANSI.
#[derive(Clone, Copy)]
enum Dialect {
  Ansi,
  MySql,
}

impl DbConn {
  fn dialect(&self) -> Dialect {
    match self {
      DbConn::Mysql(_) => Dialect::MySql,
      _ => Dialect::Ansi,
    }
  }
}

/// Keychain account holding a profile's password. The stored value is
/// `endpoint\npassword` (see `db_set_password`); the webview may set/delete it
/// but never read it (IPC guard in credentials.rs).
fn password_cred(profile_id: &str) -> String {
  format!("{}{profile_id}", credentials::RUST_ONLY_PREFIX)
}

/// Full connection identity the stored password is bound to (host, resolved
/// port, ssl_mode, user, database); a fetch differing on any of these can't
/// reuse the secret, so a compromised webview can't replay or downgrade it.
fn endpoint_id(host: &str, port: u16, ssl: SslMode, user: &str, database: &str) -> String {
  format!("{host}|{port}|{}|{user}|{database}", ssl.tag())
}

/// The (profile_id, endpoint_id) a network spec's password is keyed by, or None
/// for sqlite. Single definition, so the store path (db_set_password) and the
/// resolve path (connect) can't drift and silently break the binding.
fn password_binding(spec: &DbSpec) -> Option<(&str, String)> {
  match spec {
    DbSpec::Sqlite { .. } => None,
    DbSpec::Postgres {
      profile_id,
      host,
      port,
      ssl_mode,
      user,
      database,
    } => Some((
      profile_id,
      endpoint_id(
        host,
        port.unwrap_or(PG_DEFAULT_PORT),
        *ssl_mode,
        user,
        database,
      ),
    )),
    DbSpec::Mysql {
      profile_id,
      host,
      port,
      ssl_mode,
      user,
      database,
    } => Some((
      profile_id,
      endpoint_id(
        host,
        port.unwrap_or(MYSQL_DEFAULT_PORT),
        *ssl_mode,
        user,
        database,
      ),
    )),
  }
}

/// Extract the password from a stored `endpoint\npassword` blob only when the
/// endpoint matches; a mismatch or malformed blob refuses rather than leak.
fn password_for_endpoint(blob: Option<&str>, endpoint: &str) -> Result<Option<String>, DbError> {
  match blob {
    None => Ok(None),
    Some(b) => match b.split_once('\n') {
      Some((stored, pw)) if stored == endpoint => Ok(Some(pw.to_string())),
      // host/port/ssl/user/database changed since the password was saved (the
      // password is endpoint-bound), so it can't be released; re-enter it.
      Some(_) => Err(DbError::PasswordMismatch),
      None => Err(DbError::PasswordMalformed),
    },
  }
}

async fn keychain_password(profile_id: &str, endpoint: &str) -> Result<Option<String>, DbError> {
  let name = password_cred(profile_id);
  let blob =
    tauri::async_runtime::spawn_blocking(move || credentials::read_password(&name)).await??;
  password_for_endpoint(blob.as_deref(), endpoint)
}

/// Callers reached from a `#[tauri::command]` must run `check_path_scope`
/// first: a sqlite path is only trustworthy after the path-grant gate.
async fn connect(spec: &DbSpec) -> Result<DbConn, DbError> {
  // Resolved BEFORE the network timeout: a keychain read can block on an OS
  // permission prompt, which must not eat the connect budget.
  let password = match password_binding(spec) {
    None => None,
    Some((profile_id, endpoint)) => keychain_password(profile_id, &endpoint).await?,
  };
  let connect = async {
    match spec {
      DbSpec::Sqlite { path } => Ok(DbConn::Sqlite(
        SqliteConnectOptions::new()
          .filename(path)
          .read_only(true)
          .connect()
          .await?,
      )),
      DbSpec::Postgres {
        host,
        port,
        database,
        user,
        ssl_mode,
        ..
      } => {
        let mut opts = PgConnectOptions::new()
          .host(host)
          .port(port.unwrap_or(PG_DEFAULT_PORT))
          .database(database)
          .username(user)
          .ssl_mode((*ssl_mode).into())
          // Server-side session default: even a hand-crafted statement
          // reaching this connection cannot write.
          .options([("default_transaction_read_only", "on")]);
        if let Some(pw) = &password {
          opts = opts.password(pw);
        }
        Ok(DbConn::Postgres(opts.connect().await?))
      }
      DbSpec::Mysql {
        host,
        port,
        database,
        user,
        ssl_mode,
        ..
      } => {
        let mut opts = MySqlConnectOptions::new()
          .host(host)
          .port(port.unwrap_or(MYSQL_DEFAULT_PORT))
          .database(database)
          .username(user)
          .ssl_mode((*ssl_mode).into());
        if let Some(pw) = &password {
          opts = opts.password(pw);
        }
        let mut conn = opts.connect().await?;
        // No connect-option equivalent of postgres' default_transaction_
        // read_only here; the standard SET syntax covers MySQL and MariaDB.
        conn.execute("SET SESSION TRANSACTION READ ONLY").await?;
        Ok(DbConn::Mysql(conn))
      }
    }
  };
  with_timeout(CONNECT_TIMEOUT, DbError::ConnectTimeout, connect).await
}

async fn close(conn: DbConn) {
  let _ = match conn {
    DbConn::Sqlite(c) => c.close().await,
    DbConn::Postgres(c) => c.close().await,
    DbConn::Mysql(c) => c.close().await,
  };
}

fn quote_ident(dialect: Dialect, name: &str) -> String {
  match dialect {
    Dialect::MySql => format!("`{}`", name.replace('`', "``")),
    Dialect::Ansi => format!("\"{}\"", name.replace('"', "\"\"")),
  }
}

/// CAST in SQL gives uniform text across value types and drivers; COALESCE
/// turns NULL into the empty string the dataset model expects.
fn text_cell(dialect: Dialect, quoted_ident: &str) -> String {
  match dialect {
    Dialect::MySql => format!("COALESCE(CAST({quoted_ident} AS CHAR), '')"),
    Dialect::Ansi => format!("COALESCE(CAST({quoted_ident} AS TEXT), '')"),
  }
}

/// Decode one already-text-cast column. A BLOB survives CAST with its raw
/// bytes, so a non-UTF-8 cell would fail String decode and sink the whole
/// fetch; fall back to a lossy byte decode so one bad cell can't.
fn text_cell_at<'r, R>(row: &'r R, i: usize) -> Result<String, DbError>
where
  R: sqlx::Row,
  String: sqlx::Decode<'r, R::Database> + sqlx::Type<R::Database>,
  Vec<u8>: sqlx::Decode<'r, R::Database> + sqlx::Type<R::Database>,
  usize: sqlx::ColumnIndex<R>,
{
  match row.try_get::<String, _>(i) {
    Ok(s) => Ok(s),
    Err(e) => match row.try_get::<Vec<u8>, _>(i) {
      Ok(bytes) => Ok(String::from_utf8_lossy(&bytes).into_owned()),
      Err(_) => Err(e.into()),
    },
  }
}

macro_rules! impl_text_query {
  ($name:ident, $conn:ty) => {
    async fn $name(
      conn: &mut $conn,
      sql: &str,
      binds: &[&str],
      width: usize,
    ) -> Result<Vec<Vec<String>>, DbError> {
      use tokio_stream::StreamExt;
      // sqlx 0.9 gates `query` on SqlSafeStr; the SQL is composed here against
      // validated identifiers and all data goes through `bind`, never string
      // interpolation, so asserting it safe is sound.
      let mut q = sqlx::query(sqlx::AssertSqlSafe(sql));
      for b in binds {
        q = q.bind(*b);
      }
      // Stream row-by-row (not fetch_all) with a running byte budget, so a
      // pathologically large result errors instead of buffering to OOM.
      let mut stream = q.fetch(conn);
      let mut out: Vec<Vec<String>> = Vec::new();
      let mut bytes: usize = 0;
      while let Some(row) = stream.next().await {
        let row = row?;
        let cells: Vec<String> = (0..width)
          .map(|i| text_cell_at(&row, i))
          .collect::<Result<_, _>>()?;
        bytes = bytes.saturating_add(cells.iter().map(|c| c.len()).sum());
        check_fetch_budget(bytes)?;
        out.push(cells);
      }
      Ok(out)
    }
  };
}
impl_text_query!(text_query_sqlite, SqliteConnection);
impl_text_query!(text_query_pg, PgConnection);
impl_text_query!(text_query_mysql, MySqlConnection);

/// Run a SELECT whose every column is already cast to text.
async fn text_query(
  conn: &mut DbConn,
  sql: &str,
  binds: &[&str],
  width: usize,
) -> Result<Vec<Vec<String>>, DbError> {
  match conn {
    DbConn::Sqlite(c) => text_query_sqlite(c, sql, binds, width).await,
    DbConn::Postgres(c) => text_query_pg(c, sql, binds, width).await,
    DbConn::Mysql(c) => text_query_mysql(c, sql, binds, width).await,
  }
}

async fn list_tables(conn: &mut DbConn) -> Result<Vec<String>, DbError> {
  let sql = match conn {
    DbConn::Sqlite(_) => {
      "SELECT name FROM sqlite_master WHERE type IN ('table','view') \
       AND name NOT LIKE 'sqlite_%' ORDER BY name"
    }
    // information_schema identifier columns are domain types (sql_identifier);
    // cast so the uniform String decode holds.
    DbConn::Postgres(_) => {
      "SELECT CAST(table_name AS TEXT) FROM information_schema.tables \
       WHERE table_schema = current_schema() ORDER BY 1"
    }
    DbConn::Mysql(_) => {
      "SELECT CAST(table_name AS CHAR) FROM information_schema.tables \
       WHERE table_schema = DATABASE() ORDER BY 1"
    }
  };
  Ok(
    text_query(conn, sql, &[], 1)
      .await?
      .into_iter()
      .flatten()
      .collect(),
  )
}

async fn list_columns(conn: &mut DbConn, table: &str) -> Result<Vec<String>, DbError> {
  let sql = match conn {
    // pragma_table_info takes the name as a bound value: no identifier splice.
    DbConn::Sqlite(_) => "SELECT name FROM pragma_table_info(?1)",
    DbConn::Postgres(_) => {
      "SELECT CAST(column_name AS TEXT) FROM information_schema.columns \
       WHERE table_schema = current_schema() AND table_name = $1 \
       ORDER BY ordinal_position"
    }
    DbConn::Mysql(_) => {
      "SELECT CAST(column_name AS CHAR) FROM information_schema.columns \
       WHERE table_schema = DATABASE() AND table_name = ? \
       ORDER BY ordinal_position"
    }
  };
  Ok(
    text_query(conn, sql, &[table], 1)
      .await?
      .into_iter()
      .flatten()
      .collect(),
  )
}

async fn fetch_table(conn: &mut DbConn, table: &str) -> Result<Rows, DbError> {
  // Membership check against the live table list is what makes the
  // identifier splice below safe.
  if !list_tables(conn).await?.iter().any(|t| t == table) {
    return Err(DbError::UnknownTable(table.to_string()));
  }
  let headers = list_columns(conn, table).await?;
  if headers.is_empty() {
    return Err(DbError::UnknownTable(table.to_string()));
  }
  let dialect = conn.dialect();
  let select_list = headers
    .iter()
    .map(|c| text_cell(dialect, &quote_ident(dialect, c)))
    .collect::<Vec<_>>()
    .join(", ");
  // SQL row order is undefined without ORDER BY, so preview/reload/batch could
  // see rows flip between fetches. Order by every output column (all text-cast,
  // hence always orderable) for a fully deterministic order and truncation.
  let order_by = (1..=headers.len())
    .map(|n| n.to_string())
    .collect::<Vec<_>>()
    .join(", ");
  let sql = format!(
    "SELECT {select_list} FROM {} ORDER BY {order_by} LIMIT {}",
    quote_ident(dialect, table),
    ROW_CAP + 1,
  );
  let mut rows = text_query(conn, &sql, &[], headers.len()).await?;
  let truncated = rows.len() > ROW_CAP;
  rows.truncate(ROW_CAP);
  Ok(Rows {
    headers,
    rows,
    truncated,
  })
}

async fn run_list_tables(spec: &DbSpec) -> Result<Vec<String>, DbError> {
  let mut conn = connect(spec).await?;
  let out = with_timeout(QUERY_TIMEOUT, DbError::QueryTimeout, list_tables(&mut conn)).await;
  close(conn).await;
  out
}

/// Refuse a sqlite path the user never granted via the native pick command
/// (scope::PathGrants); network specs carry no path.
fn check_path_scope(app: &tauri::AppHandle, spec: &DbSpec) -> Result<(), DbError> {
  use tauri::Manager;
  match spec {
    DbSpec::Sqlite { path } if !app.state::<crate::scope::PathGrants>().is_granted(path) => {
      Err(DbError::PathNotAllowed)
    }
    _ => Ok(()),
  }
}

#[tauri::command]
pub async fn db_list_tables(app: tauri::AppHandle, spec: DbSpec) -> Result<Vec<String>, String> {
  check_path_scope(&app, &spec).map_err(|e| e.to_string())?;
  run_list_tables(&spec).await.map_err(|e| e.to_string())
}

async fn run_fetch(spec: &DbSpec, table: &str) -> Result<Rows, DbError> {
  let mut conn = connect(spec).await?;
  let out = with_timeout(
    QUERY_TIMEOUT,
    DbError::QueryTimeout,
    fetch_table(&mut conn, table),
  )
  .await;
  close(conn).await;
  out
}

#[tauri::command]
pub async fn db_fetch(app: tauri::AppHandle, spec: DbSpec, table: String) -> Result<Rows, String> {
  check_path_scope(&app, &spec).map_err(|e| e.to_string())?;
  run_fetch(&spec, &table).await.map_err(|e| e.to_string())
}

/// Store a network profile's password bound to its endpoint. The webview never
/// sees the value back (IPC read guard), and the binding stops it from being
/// replayed against a different host.
#[tauri::command]
pub async fn db_set_password(spec: DbSpec, password: String) -> Result<(), String> {
  let Some((profile_id, endpoint)) = password_binding(&spec) else {
    return Err(DbError::SqliteNoPassword.to_string());
  };
  let blob = format!("{endpoint}\n{password}");
  let name = password_cred(profile_id);
  blocking(move || credentials::write_password(&name, &blob))
    .await?
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn rt() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
      .enable_all()
      .build()
      .unwrap()
  }

  async fn seeded_db(dir: &std::path::Path) -> String {
    let path = dir.join("test.sqlite").to_string_lossy().into_owned();
    let mut conn = SqliteConnectOptions::new()
      .filename(&path)
      .create_if_missing(true)
      .connect()
      .await
      .unwrap();
    sqlx::query(
      "CREATE TABLE items (sku TEXT, qty INTEGER, price REAL, note TEXT); \
       CREATE TABLE \"odd \"\"name\"\"\" (c TEXT); \
       CREATE VIEW cheap AS SELECT sku FROM items WHERE price < 2;",
    )
    .execute(&mut conn)
    .await
    .unwrap();
    sqlx::query("INSERT INTO items VALUES ('A-1', 3, 1.5, NULL), ('B-2', 0, 2.25, 'x')")
      .execute(&mut conn)
      .await
      .unwrap();
    conn.close().await.unwrap();
    path
  }

  async fn open_seeded(tag: &str) -> DbConn {
    let dir = std::env::temp_dir().join(format!("zplab-db-test-{tag}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = seeded_db(&dir).await;
    connect(&DbSpec::Sqlite { path }).await.unwrap()
  }

  #[test]
  fn non_utf8_blob_decodes_lossy_without_sinking_the_fetch() {
    rt().block_on(async {
      let dir = std::env::temp_dir().join("zplab-db-test-blob");
      let _ = std::fs::remove_dir_all(&dir);
      std::fs::create_dir_all(&dir).unwrap();
      let path = dir.join("b.sqlite").to_string_lossy().into_owned();
      let mut c = SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true)
        .connect()
        .await
        .unwrap();
      sqlx::query("CREATE TABLE b (v BLOB)")
        .execute(&mut c)
        .await
        .unwrap();
      sqlx::query("INSERT INTO b VALUES (x'fffe0001'), (x'48656c6c6f')")
        .execute(&mut c)
        .await
        .unwrap();
      c.close().await.unwrap();
      let mut conn = connect(&DbSpec::Sqlite { path }).await.unwrap();
      let got = fetch_table(&mut conn, "b").await.unwrap();
      // Both rows survive (the bad cell doesn't sink the fetch); order is by
      // text value, so assert membership rather than position.
      assert_eq!(got.rows.len(), 2);
      assert!(got.rows.iter().any(|r| r == &vec!["Hello".to_string()]));
    });
  }

  #[test]
  fn lists_tables_and_views() {
    rt().block_on(async {
      let mut conn = open_seeded("list").await;
      let tables = list_tables(&mut conn).await.unwrap();
      assert_eq!(tables, vec!["cheap", "items", "odd \"name\""]);
    });
  }

  #[test]
  fn fetches_rows_stringified_with_null_as_empty() {
    rt().block_on(async {
      let mut conn = open_seeded("fetch").await;
      let got = fetch_table(&mut conn, "items").await.unwrap();
      assert_eq!(got.headers, vec!["sku", "qty", "price", "note"]);
      assert_eq!(got.rows[0], vec!["A-1", "3", "1.5", ""]);
      assert_eq!(got.rows[1], vec!["B-2", "0", "2.25", "x"]);
      assert!(!got.truncated);
    });
  }

  #[test]
  fn fetches_through_a_view_and_quoted_identifiers() {
    rt().block_on(async {
      let mut conn = open_seeded("view").await;
      let view = fetch_table(&mut conn, "cheap").await.unwrap();
      assert_eq!(view.rows, vec![vec!["A-1"]]);
      let odd = fetch_table(&mut conn, "odd \"name\"").await.unwrap();
      assert_eq!(odd.headers, vec!["c"]);
    });
  }

  #[test]
  fn rejects_unknown_table_names() {
    rt().block_on(async {
      let mut conn = open_seeded("unknown").await;
      let err = fetch_table(&mut conn, "items; DROP TABLE items")
        .await
        .unwrap_err();
      assert!(err.to_string().contains("unknown table"));
    });
  }

  #[test]
  fn connection_is_read_only() {
    rt().block_on(async {
      let conn = open_seeded("ro").await;
      let DbConn::Sqlite(mut c) = conn else {
        panic!("sqlite expected")
      };
      let err = sqlx::query("INSERT INTO items VALUES ('C-3', 1, 1.0, NULL)")
        .execute(&mut c)
        .await;
      assert!(err.is_err());
    });
  }

  #[test]
  fn quoting_and_cast_follow_the_dialect() {
    assert_eq!(quote_ident(Dialect::Ansi, "a\"b"), "\"a\"\"b\"");
    assert_eq!(quote_ident(Dialect::MySql, "a`b"), "`a``b`");
    assert_eq!(
      text_cell(Dialect::Ansi, "\"c\""),
      "COALESCE(CAST(\"c\" AS TEXT), '')"
    );
    assert_eq!(
      text_cell(Dialect::MySql, "`c`"),
      "COALESCE(CAST(`c` AS CHAR), '')"
    );
  }

  #[test]
  fn specs_deserialize_from_the_webview_shape() {
    let pg: DbSpec = serde_json::from_str(
      r#"{"driver":"postgres","host":"h","port":5433,"database":"d","user":"u","profileId":"p1"}"#,
    )
    .unwrap();
    match pg {
      DbSpec::Postgres {
        port,
        profile_id,
        ssl_mode,
        ..
      } => {
        assert_eq!(port, Some(5433));
        assert_eq!(password_cred(&profile_id), "db-profile-p1");
        // Omitted in this payload -> the Prefer default.
        assert!(matches!(ssl_mode, SslMode::Prefer));
      }
      _ => panic!("postgres expected"),
    }
    let my: DbSpec = serde_json::from_str(
      r#"{"driver":"mysql","host":"h","database":"d","user":"u","profileId":"p2","sslMode":"verify-full"}"#,
    )
    .unwrap();
    assert!(matches!(
      my,
      DbSpec::Mysql {
        port: None,
        ssl_mode: SslMode::VerifyFull,
        ..
      }
    ));
  }

  #[test]
  fn password_is_released_only_for_the_bound_endpoint() {
    let ep = endpoint_id("db.local", 5432, SslMode::Require, "reader", "sales");
    let blob = format!("{ep}\nsecret");
    // Same endpoint -> released.
    assert_eq!(
      password_for_endpoint(Some(blob.as_str()), &ep).unwrap(),
      Some("secret".into())
    );
    // Redirected host -> refused, secret not leaked.
    let other = endpoint_id(
      "attacker.example",
      5432,
      SslMode::Require,
      "reader",
      "sales",
    );
    assert!(password_for_endpoint(Some(blob.as_str()), &other).is_err());
    // Different port on the same host is also a different endpoint.
    assert!(password_for_endpoint(
      Some(blob.as_str()),
      &endpoint_id("db.local", 5433, SslMode::Require, "reader", "sales")
    )
    .is_err());
    // A downgraded ssl_mode is a different endpoint: the secret is withheld so
    // it can't be forced onto a plaintext connection to the real host.
    assert!(password_for_endpoint(
      Some(blob.as_str()),
      &endpoint_id("db.local", 5432, SslMode::Disable, "reader", "sales")
    )
    .is_err());
    // A different user or database on the same host cannot reuse the secret.
    assert!(password_for_endpoint(
      Some(blob.as_str()),
      &endpoint_id("db.local", 5432, SslMode::Require, "postgres", "sales")
    )
    .is_err());
    assert!(password_for_endpoint(
      Some(blob.as_str()),
      &endpoint_id("db.local", 5432, SslMode::Require, "reader", "payroll")
    )
    .is_err());
    // No stored credential -> no password (passwordless connect), not an error.
    assert_eq!(password_for_endpoint(None, &ep).unwrap(), None);
    // A legacy plain value (no endpoint prefix) refuses rather than leaking.
    assert!(password_for_endpoint(Some("bare"), &ep).is_err());
  }

  #[test]
  fn password_cred_names_are_caught_by_the_ipc_read_guard() {
    // The db password account name and the credentials.rs guard must share the
    // prefix, else a compromised webview could read the secret over IPC.
    assert!(credentials::is_rust_only(&password_cred("p1")));
    assert!(credentials::is_rust_only(&password_cred("P1")));
  }

  #[test]
  fn fetch_budget_rejects_oversize_results() {
    assert!(check_fetch_budget(MAX_FETCH_BYTES).is_ok());
    assert!(check_fetch_budget(MAX_FETCH_BYTES + 1).is_err());
  }

  // Live network-driver tests (`--ignored`) against throwaway containers
  // (postgres:16 on 5432, mariadb:11 on 3307, db `zpltest`); password from env
  // ZPLAB_LIVE_DB_PW, through the real keychain path via a test entry.
  fn live_pw() -> String {
    std::env::var("ZPLAB_LIVE_DB_PW")
      .expect("set ZPLAB_LIVE_DB_PW to the throwaway container password")
  }
  fn live_spec(driver: &str, port: u16, user: &str, profile_id: &str) -> DbSpec {
    serde_json::from_str(&format!(
      r#"{{"driver":"{driver}","host":"127.0.0.1","port":{port},"database":"zpltest","user":"{user}","profileId":"{profile_id}"}}"#,
    ))
    .unwrap()
  }

  fn keychain_set(profile_id: &str, port: u16, user: &str, value: &str) {
    // Mirror db_set_password: endpoint-bound blob for host 127.0.0.1, db zpltest,
    // default ssl_mode (the live specs omit sslMode, so serde yields Prefer).
    let blob = format!(
      "{}\n{value}",
      endpoint_id("127.0.0.1", port, SslMode::Prefer, user, "zpltest")
    );
    keyring::Entry::new("ZPLab", &password_cred(profile_id))
      .unwrap()
      .set_password(&blob)
      .unwrap();
  }

  fn keychain_drop(profile_id: &str) {
    let _ = keyring::Entry::new("ZPLab", &password_cred(profile_id))
      .unwrap()
      .delete_credential();
  }

  fn assert_live_rows(spec: &DbSpec) {
    rt().block_on(async {
      let mut conn = connect(spec).await.unwrap();
      let tables = list_tables(&mut conn).await.unwrap();
      assert!(tables.contains(&"items".to_string()), "items in {tables:?}");
      assert!(
        tables.contains(&"cheap".to_string()),
        "cheap view in {tables:?}"
      );
      let got = fetch_table(&mut conn, "items").await.unwrap();
      assert_eq!(got.headers, vec!["sku", "qty", "price", "note", "made"]);
      assert_eq!(got.rows[0], vec!["A-1", "3", "1.50", "", "2026-01-15"]);
      assert_eq!(got.rows[1], vec!["B-2", "0", "2.25", "x", ""]);
      let view = fetch_table(&mut conn, "cheap").await.unwrap();
      assert_eq!(view.rows, vec![vec!["A-1"]]);
      // Read-only proof: the session must reject writes server-side.
      let write = match &mut conn {
        DbConn::Postgres(c) => sqlx::query("INSERT INTO items (sku) VALUES ('X')")
          .execute(c)
          .await
          .err(),
        DbConn::Mysql(c) => sqlx::query("INSERT INTO items (sku) VALUES ('X')")
          .execute(c)
          .await
          .err(),
        DbConn::Sqlite(_) => unreachable!(),
      };
      assert!(write.is_some(), "write must fail on a read-only session");
      close(conn).await;
    });
  }

  #[test]
  #[ignore = "needs the live postgres container"]
  fn live_postgres_end_to_end() {
    keychain_set("live-pg", 5432, "postgres", &live_pw());
    assert_live_rows(&live_spec("postgres", 5432, "postgres", "live-pg"));
    keychain_drop("live-pg");
  }

  #[test]
  #[ignore = "needs the live mariadb container"]
  fn live_mariadb_end_to_end() {
    keychain_set("live-maria", 3307, "zpl", &live_pw());
    assert_live_rows(&live_spec("mysql", 3307, "zpl", "live-maria"));
    keychain_drop("live-maria");
  }

  #[test]
  #[ignore = "needs the live postgres container"]
  fn live_wrong_password_fails_cleanly() {
    keychain_set("live-bad", 5432, "postgres", "wrong");
    let err = rt()
      .block_on(connect(&live_spec(
        "postgres", 5432, "postgres", "live-bad",
      )))
      .err();
    keychain_drop("live-bad");
    let err = err
      .expect("connect must fail with a wrong password")
      .to_string();
    assert!(
      !err.contains("wrong"),
      "error must not echo the password: {err}"
    );
  }
}

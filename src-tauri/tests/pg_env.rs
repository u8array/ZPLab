//! Own test binary, because the test rewrites the process environment.

use sqlx::postgres::PgConnectOptions;

const HOSTILE: [(&str, &str); 13] = [
  ("PGAPPNAME", "probe"),
  ("PGDATABASE", "probe"),
  ("PGHOST", "probe.invalid"),
  ("PGHOSTADDR", "127.0.0.1"),
  ("PGOPTIONS", "-c search_path=probe"),
  ("PGPASSFILE", "probe.pgpass"),
  ("PGPASSWORD", "probe"),
  ("PGPORT", "1"),
  ("PGSSLCERT", "probe.crt"),
  ("PGSSLKEY", "probe.key"),
  ("PGSSLMODE", "disable"),
  ("PGSSLROOTCERT", "probe-root.crt"),
  ("PGUSER", "probe"),
];

fn main() {
  // SAFETY: without the harness the test starts no thread.
  let clear = || unsafe { zplab_lib::clear_inherited_pg_env() };
  clear();
  let clean = format!("{:?}", PgConnectOptions::new_without_pgpass());
  for (name, value) in HOSTILE {
    std::env::set_var(name, value);
  }
  assert_ne!(
    format!("{:?}", PgConnectOptions::new_without_pgpass()),
    clean
  );
  clear();
  assert_eq!(
    format!("{:?}", PgConnectOptions::new_without_pgpass()),
    clean
  );
  for (name, _) in HOSTILE {
    assert!(std::env::var_os(name).is_none(), "{name} survived");
  }
}

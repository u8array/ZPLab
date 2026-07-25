//! OS-native credential storage (Windows Credential Manager, macOS Keychain,
//! Linux Secret Service). Keeps API keys out of localStorage/app-data JSON,
//! which live as plaintext on disk.

use keyring::Entry;

use crate::transport::blocking;

/// Keychain service name; the credential name (e.g. "labelary-api-key") is
/// the account under it.
const SERVICE: &str = "ZPLab";

/// Typed credential error; the db connector consumes it via `#[from]`, the IPC
/// commands stringify it at the edge.
#[derive(Debug, thiserror::Error)]
pub(crate) enum CredError {
  #[error(transparent)]
  Keyring(#[from] keyring::Error),
  #[error("credential is not readable over IPC: {0}")]
  NotReadable(String),
  #[error("credential is not writable over IPC: {0}")]
  NotWritable(String),
}

fn entry(name: &str) -> Result<Entry, CredError> {
  Ok(Entry::new(SERVICE, name)?)
}

/// Rust-internal read (db connector), unlike the IPC `credential_get`
/// command. Blocking; call via `transport::blocking`.
pub(crate) fn read_password(name: &str) -> Result<Option<String>, CredError> {
  match entry(name)?.get_password() {
    Ok(v) => Ok(Some(v)),
    Err(keyring::Error::NoEntry) => Ok(None),
    Err(e) => Err(e.into()),
  }
}

/// Rust-internal write (db connector stores the endpoint-bound blob). Blocking.
pub(crate) fn write_password(name: &str, value: &str) -> Result<(), CredError> {
  entry(name)?.set_password(value)?;
  Ok(())
}

/// Rust-internal delete; a missing entry is the desired end state. Blocking.
pub(crate) fn delete_password(name: &str) -> Result<(), CredError> {
  match entry(name)?.delete_credential() {
    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
    Err(e) => Err(e.into()),
  }
}

/// db-profile passwords flow keychain -> Rust connector only (db.rs
/// `password_cred`): the webview may delete them but never read or write them
/// over the generic IPC (writes go through the endpoint-binding `db_set_password`).
pub(crate) const RUST_ONLY_PREFIX: &str = "db-profile-";

/// Credential-name prefixes the generic IPC may never read or write: the
/// db-profile passwords and the host-bound Labelary key (`preview.rs`). Each
/// is written only through its endpoint-binding command.
const RUST_ONLY_PREFIXES: [&str; 2] = [RUST_ONLY_PREFIX, "preview-"];

/// Windows Credential Manager matches target names case-insensitively, so the
/// guard must too or `DB-PROFILE-x` slips past yet resolves the same secret.
/// Allocation-free ASCII prefix compare.
pub(crate) fn is_rust_only(name: &str) -> bool {
  RUST_ONLY_PREFIXES.iter().any(|prefix| {
    name
      .as_bytes()
      .get(..prefix.len())
      .is_some_and(|p| p.eq_ignore_ascii_case(prefix.as_bytes()))
  })
}

#[tauri::command]
pub async fn credential_get(name: String) -> Result<Option<String>, String> {
  if is_rust_only(&name) {
    return Err(CredError::NotReadable(name).to_string());
  }
  // keyring is blocking (DBus/OS calls); keep it off the async runtime.
  blocking(move || read_password(&name))
    .await?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn credential_set(name: String, value: String) -> Result<(), String> {
  if is_rust_only(&name) {
    return Err(CredError::NotWritable(name).to_string());
  }
  blocking(move || write_password(&name, &value))
    .await?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn credential_delete(name: String) -> Result<(), String> {
  blocking(move || -> Result<(), CredError> {
    match entry(&name)?.delete_credential() {
      // Deleting a missing entry is the caller's desired end state, not an error.
      Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
      Err(e) => Err(e.into()),
    }
  })
  .await?
  .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn db_profile_credentials_are_not_readable_over_ipc() {
    let rt = tokio::runtime::Builder::new_current_thread()
      .enable_all()
      .build()
      .unwrap();
    let err = rt
      .block_on(credential_get("db-profile-p1".into()))
      .unwrap_err();
    assert!(err.contains("not readable"));
    // Case-variant must not slip past the guard (Windows CredMan is case-insensitive).
    let err = rt
      .block_on(credential_get("DB-PROFILE-p1".into()))
      .unwrap_err();
    assert!(err.contains("not readable"));
  }

  #[test]
  fn db_profile_credentials_are_not_writable_over_ipc() {
    let rt = tokio::runtime::Builder::new_current_thread()
      .enable_all()
      .build()
      .unwrap();
    let err = rt
      .block_on(credential_set("db-profile-p1".into(), "x".into()))
      .unwrap_err();
    assert!(err.contains("not writable"));
  }
}

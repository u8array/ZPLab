//! Labelary preview proxy: the desktop webview never fetches previews itself
//! (CSP drops generic http:/https:), and the API key resolves keychain -> Rust
//! -> header, never crossing IPC or webview memory.

use std::sync::OnceLock;
use std::time::Duration;

use base64::Engine;

use crate::credentials;
use crate::transport::{blocking, check_payload};

const TIMEOUT: Duration = Duration::from_secs(10);
/// Generous for label PNGs (a 4x6" 300dpi label is well under 1 MB).
const MAX_BYTES: usize = 10 * 1024 * 1024;
/// The public service; always reachable so the free tier needs no key.
const DEFAULT_HOST: &str = "https://api.labelary.com";
/// Host-bound key blob (rust-only via the `preview-` prefix), stored as
/// `host\nkey`; the binding is enforced in bound_key_for. LEGACY_KEY_CRED is
/// the pre-binding location drained by the migration.
const KEY_CRED: &str = "preview-labelary-key";
const LEGACY_KEY_CRED: &str = "labelary-api-key";

/// Same normalisation on the set and fetch paths so the host comparison can't
/// drift on a trailing slash or surrounding whitespace.
fn normalize_host(host: &str) -> String {
  host.trim().trim_end_matches('/').to_ascii_lowercase()
}

/// The bound key iff it belongs to `host`; None otherwise (unbound, or bound
/// to a different host the webview must not borrow the key for).
fn bound_key_for(host: &str) -> Result<Option<String>, credentials::CredError> {
  let Some(blob) = credentials::read_password(KEY_CRED)? else {
    return Ok(None);
  };
  let (bound_host, key) = blob.split_once('\n').unwrap_or(("", ""));
  Ok((bound_host == host && !key.is_empty()).then(|| key.to_string()))
}

#[derive(serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PreviewFetchResult {
  Png { base64: String },
  Api { status: u16 },
  Timeout,
  Network,
  TooLarge,
}

/// Plain HTTP stays inside networks the user controls; everything else must
/// be TLS so the key/ZPL never transit an open network unencrypted.
fn http_host_allowed(host: &str) -> bool {
  if host == "localhost" || host.ends_with(".localhost") {
    return true;
  }
  match host.parse::<std::net::IpAddr>() {
    Ok(ip) => match ip {
      std::net::IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local(),
      std::net::IpAddr::V6(v6) => v6.is_loopback(),
    },
    Err(_) => false,
  }
}

/// Host allowlist for the proxy: the public default and LAN/loopback are always
/// fine; any other host needs a key the user bound to it (a deliberate keychain
/// write), so a compromised webview can't use the proxy as an open relay.
/// Residual: it can relay only by overwriting the user's real key, never read it.
fn host_allowed(host: &str, url_host: &str, has_bound_key: bool) -> bool {
  has_bound_key || host == DEFAULT_HOST || http_host_allowed(url_host)
}

/// The webview supplies host + path separately so the validated host can't be
/// smuggled inside a path; the path itself must be the labelary print route.
fn build_url(host: &str, path: &str) -> Result<reqwest::Url, String> {
  let re_ok = path.strip_prefix("/v1/printers/").is_some_and(|rest| {
    let mut parts = rest.split('/');
    matches!(
      (parts.next(), parts.next(), parts.next(), parts.next(), parts.next(), parts.next()),
      (Some(printer), Some("labels"), Some(size), Some(index), Some(""), None)
        if printer.ends_with("dpmm")
          && printer.trim_end_matches("dpmm").chars().all(|c| c.is_ascii_digit())
          && size.chars().all(|c| c.is_ascii_digit() || c == '.' || c == 'x')
          && index.chars().all(|c| c.is_ascii_digit())
    )
  });
  if !re_ok {
    return Err(format!("not a labelary print path: {path}"));
  }
  let url = reqwest::Url::parse(&format!("{host}{path}")).map_err(|e| e.to_string())?;
  match url.scheme() {
    "https" => {}
    "http" => {
      let h = url.host_str().unwrap_or_default();
      if !http_host_allowed(h) {
        return Err(format!(
          "plain http is only allowed for local hosts, not {h}"
        ));
      }
    }
    s => return Err(format!("unsupported scheme: {s}")),
  }
  Ok(url)
}

/// Shared HTTP client: reqwest pools connections internally, so it is built
/// once and reused. Rebuilt on the next call if the one-time TLS init ever
/// fails (no poisoning).
fn http_client() -> Result<&'static reqwest::Client, String> {
  static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
  if let Some(c) = CLIENT.get() {
    return Ok(c);
  }
  let built = reqwest::Client::builder()
    .redirect(reqwest::redirect::Policy::none())
    .timeout(TIMEOUT)
    .build()
    .map_err(|e| e.to_string())?;
  Ok(CLIENT.get_or_init(|| built))
}

/// POST the ZPL and return the rendered PNG. Redirects are hard errors so the
/// bound key can't be replayed against a host the user didn't configure.
#[tauri::command]
pub async fn fetch_labelary_preview(
  host: String,
  path: String,
  zpl: String,
) -> Result<PreviewFetchResult, String> {
  check_payload(zpl.len())?;
  let host = normalize_host(&host);
  let url = build_url(&host, &path)?;

  let api_key = blocking({
    let host = host.clone();
    move || bound_key_for(&host)
  })
  .await
  .map_err(|e| e.to_string())?
  .map_err(|e| e.to_string())?;

  if !host_allowed(&host, url.host_str().unwrap_or_default(), api_key.is_some()) {
    return Err(format!("host not allowed without a saved key: {host}"));
  }

  let mut req = http_client()?
    .post(url)
    .header("Content-Type", "application/x-www-form-urlencoded")
    .body(zpl);
  if let Some(key) = api_key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
    req = req.header("X-API-Key", key);
  }

  let res = match req.send().await {
    Ok(r) => r,
    Err(e) if e.is_timeout() => return Ok(PreviewFetchResult::Timeout),
    Err(_) => return Ok(PreviewFetchResult::Network),
  };

  let status = res.status();
  if status.is_redirection() {
    return Ok(PreviewFetchResult::Network);
  }
  if !status.is_success() {
    return Ok(PreviewFetchResult::Api {
      status: status.as_u16(),
    });
  }
  if res.content_length().is_some_and(|l| l > MAX_BYTES as u64) {
    return Ok(PreviewFetchResult::TooLarge);
  }

  let mut bytes: Vec<u8> = Vec::new();
  let mut stream = res;
  loop {
    match stream.chunk().await {
      Ok(Some(chunk)) => {
        if bytes.len() + chunk.len() > MAX_BYTES {
          return Ok(PreviewFetchResult::TooLarge);
        }
        bytes.extend_from_slice(&chunk);
      }
      Ok(None) => break,
      Err(e) if e.is_timeout() => return Ok(PreviewFetchResult::Timeout),
      Err(_) => return Ok(PreviewFetchResult::Network),
    }
  }

  Ok(PreviewFetchResult::Png {
    base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
  })
}

/// Store the Labelary key bound to `host` (rust-only). An empty key clears it.
#[tauri::command]
pub async fn preview_set_labelary_key(host: String, key: String) -> Result<(), String> {
  let host = normalize_host(&host);
  let key = key.trim().to_string();
  blocking(move || -> Result<(), credentials::CredError> {
    if key.is_empty() {
      credentials::delete_password(KEY_CRED)
    } else {
      credentials::write_password(KEY_CRED, &format!("{host}\n{key}"))
    }
  })
  .await
  .map_err(|e| e.to_string())?
  .map_err(|e| e.to_string())
}

/// One-time move of a legacy (unbound, IPC-readable) `labelary-api-key` into
/// the host-bound rust-only credential; idempotent once the legacy entry drains.
#[tauri::command]
pub async fn preview_migrate_labelary_key(host: String) -> Result<(), String> {
  let host = normalize_host(&host);
  blocking(move || -> Result<(), credentials::CredError> {
    if let Some(key) = credentials::read_password(LEGACY_KEY_CRED)? {
      let key = key.trim();
      if !key.is_empty() {
        credentials::write_password(KEY_CRED, &format!("{host}\n{key}"))?;
      }
      credentials::delete_password(LEGACY_KEY_CRED)?;
    }
    Ok(())
  })
  .await
  .map_err(|e| e.to_string())?
  .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn accepts_the_labelary_print_path() {
    assert!(build_url(
      "https://api.labelary.com",
      "/v1/printers/8dpmm/labels/3.937x1.969/0/"
    )
    .is_ok());
  }

  #[test]
  fn rejects_foreign_paths_and_schemes() {
    assert!(build_url(
      "https://api.labelary.com",
      "/v1/printers/8dpmm/labels/1x1/0/../../steal"
    )
    .is_err());
    assert!(build_url("https://api.labelary.com", "/anything").is_err());
    assert!(build_url("ftp://api.labelary.com", "/v1/printers/8dpmm/labels/1x1/0/").is_err());
  }

  #[test]
  fn bound_key_splits_host_and_key() {
    // Pure split logic (no keychain): the blob is `host\nkey`.
    let blob = "https://api.labelary.com\nsecret-123";
    let (h, k) = blob.split_once('\n').unwrap();
    assert_eq!(h, "https://api.labelary.com");
    assert_eq!(k, "secret-123");
  }

  #[test]
  fn normalize_host_trims_slash_space_and_case() {
    assert_eq!(
      normalize_host("  https://API.Labelary.com/ "),
      "https://api.labelary.com"
    );
  }

  #[test]
  fn host_allowlist_default_lan_and_bound() {
    assert!(host_allowed(DEFAULT_HOST, "api.labelary.com", false));
    assert!(host_allowed("http://192.168.1.5", "192.168.1.5", false));
    assert!(host_allowed("http://localhost:9090", "localhost", false));
    // Custom remote host only with a bound key; bare relay is refused.
    assert!(!host_allowed(
      "https://attacker.example",
      "attacker.example",
      false
    ));
    assert!(host_allowed(
      "https://custom.example.com",
      "custom.example.com",
      true
    ));
  }

  #[test]
  fn plain_http_is_local_only() {
    assert!(build_url("http://127.0.0.1:8080", "/v1/printers/8dpmm/labels/1x1/0/").is_ok());
    assert!(build_url("http://192.168.1.20", "/v1/printers/8dpmm/labels/1x1/0/").is_ok());
    assert!(build_url("http://localhost:9090", "/v1/printers/8dpmm/labels/1x1/0/").is_ok());
    assert!(build_url(
      "http://api.labelary.com",
      "/v1/printers/8dpmm/labels/1x1/0/"
    )
    .is_err());
    assert!(build_url("http://8.8.8.8", "/v1/printers/8dpmm/labels/1x1/0/").is_err());
  }
}

// Shared plumbing for the printer commands: connect, write-with-timeout,
// read-one-reply, the blocking-pool wrapper, and the payload bound, so a
// timeout or classification change lives in one place. The USB transports
// frame their writes themselves (ZLP-terminated on macOS), but their reply
// reads go through read_reply like TCP.

use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

/// The webview is untrusted input; bound the payload well above any real batch.
pub(crate) const MAX_ZPL_BYTES: usize = 16 * 1024 * 1024;

const IO_TIMEOUT: Duration = Duration::from_secs(4);

// A ~DY upload of a full label bitmap is ~200 KiB base64; bound far above that.
const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
// The printer renders before replying; a ~DY font download can take an
// entry-level printer past 10s (observed on the ZD230). Generous: a preview is
// a manual one-shot the user waits on.
const FIRST_BYTE_TIMEOUT: Duration = Duration::from_secs(30);
// After data flows, a short idle gap marks the end of the reply (the printer
// keeps the channel open, so waiting for a close would always hit the timeout).
const IDLE_TIMEOUT: Duration = Duration::from_millis(1200);
// Overall cap on the read phase: a peer that trickles bytes just under the idle
// gap would otherwise never break, holding the query open until MAX_RESPONSE_BYTES.
const READ_DEADLINE: Duration = Duration::from_secs(60);

pub(crate) fn check_payload(len: usize) -> Result<(), String> {
  if len > MAX_ZPL_BYTES {
    return Err("payload too large".to_string());
  }
  Ok(())
}

/// Run a blocking closure on the pool, flattening the `JoinError` to a String
/// for the String-returning command edges. Typed callers (db/excel) use
/// `spawn_blocking` directly so `#[from] tauri::Error` folds the panic in.
pub(crate) async fn blocking<F, T>(f: F) -> Result<T, String>
where
  F: FnOnce() -> T + Send + 'static,
  T: Send + 'static,
{
  tauri::async_runtime::spawn_blocking(f)
    .await
    .map_err(|e| e.to_string())
}

/// Why a connect failed; callers map it onto their own result enum so the UI
/// keeps a single message mapping regardless of which command ran.
pub(crate) enum ConnectError {
  Refused,
  Unreachable,
}

pub(crate) async fn connect(host: &str, port: u16) -> Result<TcpStream, ConnectError> {
  match timeout(IO_TIMEOUT, TcpStream::connect((host, port))).await {
    Ok(Ok(s)) => Ok(s),
    Ok(Err(e)) if e.kind() == std::io::ErrorKind::ConnectionRefused => Err(ConnectError::Refused),
    // Timeout, no route, unresolvable host: the printer can't be reached.
    Err(_) | Ok(Err(_)) => Err(ConnectError::Unreachable),
  }
}

pub(crate) async fn write_all_timeout(stream: &mut TcpStream, bytes: &[u8]) -> Result<(), String> {
  match timeout(IO_TIMEOUT, stream.write_all(bytes)).await {
    Ok(Ok(())) => Ok(()),
    Ok(Err(e)) => Err(e.to_string()),
    Err(_) => Err("write timed out".to_string()),
  }
}

/// Read one printer reply: wait for the first byte, then collect until an idle
/// gap or a close ends it. A trickle past the deadline or an overflow is an error,
/// while an empty body means the printer sent nothing and the caller decides.
pub(crate) async fn read_reply<R: tokio::io::AsyncRead + Unpin>(
  stream: &mut R,
) -> Result<Vec<u8>, String> {
  let mut body = Vec::new();
  let mut buf = [0u8; 64 * 1024];
  let deadline = tokio::time::Instant::now() + READ_DEADLINE;
  loop {
    // Reaching this cap means the reply never idled (slow render, trickle):
    // report the timeout instead of returning a truncated body.
    if tokio::time::Instant::now() >= deadline {
      return Err("read timed out".to_string());
    }
    let wait = if body.is_empty() {
      FIRST_BYTE_TIMEOUT
    } else {
      IDLE_TIMEOUT
    };
    match timeout(wait, stream.read(&mut buf)).await {
      Ok(Ok(0)) => break, // peer closed / end of stream
      Ok(Ok(n)) => {
        if body.len() + n > MAX_RESPONSE_BYTES {
          return Err("response too large".to_string());
        }
        body.extend_from_slice(&buf[..n]);
      }
      Ok(Err(e)) => return Err(e.to_string()),
      // Timeout: end of reply.
      Err(_) => break,
    }
  }
  Ok(body)
}

#[cfg(test)]
mod tests {
  use super::*;

  // Paused clock: the timeouts auto-advance when the reader idles, so the
  // 30s/60s waits complete instantly.
  fn rt() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
      .enable_all()
      .start_paused(true)
      .build()
      .unwrap()
  }

  #[test]
  fn read_reply_ends_on_idle_gap() {
    rt().block_on(async {
      let (mut a, mut b) = tokio::io::duplex(1024);
      a.write_all(b"~DYreply").await.unwrap();
      // `a` stays open, so only the idle gap can end the reply.
      let body = read_reply(&mut b).await.unwrap();
      assert_eq!(body, b"~DYreply");
    });
  }

  #[test]
  fn read_reply_returns_empty_when_nothing_arrives() {
    rt().block_on(async {
      let (_a, mut b) = tokio::io::duplex(1024);
      assert!(read_reply(&mut b).await.unwrap().is_empty());
    });
  }

  #[test]
  fn read_reply_returns_empty_on_eof_without_data() {
    rt().block_on(async {
      let (a, mut b) = tokio::io::duplex(1024);
      drop(a);
      assert!(read_reply(&mut b).await.unwrap().is_empty());
    });
  }

  #[test]
  fn read_reply_times_out_on_trickle() {
    rt().block_on(async {
      let (mut a, mut b) = tokio::io::duplex(1024);
      // A byte just inside every idle gap holds the reply open past the
      // overall deadline.
      tokio::spawn(async move {
        while a.write_all(b"x").await.is_ok() {
          tokio::time::sleep(Duration::from_millis(1000)).await;
        }
      });
      let err = read_reply(&mut b).await.unwrap_err();
      assert_eq!(err, "read timed out");
    });
  }
}

use crate::transport::{
  blocking, check_payload, connect, stream_done, write_all_timeout, ChunkSink, ConnectError,
  QueryStops, StopFlag, StreamDone,
};
use std::time::Duration;
use tauri::ipc::Channel;

/// Kinds mirror the frontend NetworkPrintResult union. `unreachable` (not the
/// browser's ambiguous `no_response`) says the send did not complete, so the UI
/// maps each kind to a message without knowing which transport ran.
#[derive(serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TcpSendResult {
  Sent,
  Refused,
  Unreachable,
}

fn validate(host: &str, port: u16, zpl_len: usize) -> Result<(), String> {
  if host.is_empty() || host.contains('/') || host.contains(char::is_whitespace) {
    return Err("invalid host".to_string());
  }
  if port == 0 {
    return Err("invalid port".to_string());
  }
  check_payload(zpl_len)
}

#[tauri::command]
pub async fn send_zpl_tcp(host: String, port: u16, zpl: String) -> Result<TcpSendResult, String> {
  let host = host.trim();
  validate(host, port, zpl.len())?;

  let mut stream = match connect(host, port).await {
    Ok(s) => s,
    Err(ConnectError::Refused) => return Ok(TcpSendResult::Refused),
    Err(ConnectError::Unreachable) => return Ok(TcpSendResult::Unreachable),
  };

  // Dropping the stream closes it (FIN), which the printer reads as job end;
  // no explicit shutdown, so a printer that RSTs after reading can't fail the
  // send. The write phase is reached, so its failures are not "unreachable".
  write_all_timeout(&mut stream, zpl.as_bytes()).await?;
  Ok(TcpSendResult::Sent)
}

/// Connect failures mirror TcpSendResult, so the UI reuses its wording.
#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TcpQueryResult {
  Done(StreamDone),
  Refused,
  Unreachable,
}

/// Not for plain print jobs: those use send_zpl_tcp, which never waits.
#[tauri::command]
pub async fn query_zpl_tcp(
  host: String,
  port: u16,
  zpl: String,
  deadline_ms: u64,
  on_chunk: Channel<String>,
  stops: tauri::State<'_, QueryStops>,
) -> Result<TcpQueryResult, String> {
  let stop = stops.begin(on_chunk.id());
  let mut sink = ChunkSink::new(&on_chunk);
  query_tcp(
    host.trim(),
    port,
    &zpl,
    Duration::from_millis(deadline_ms),
    &stop.flag,
    &mut sink,
  )
  .await
}

async fn query_tcp(
  host: &str,
  port: u16,
  zpl: &str,
  deadline: Duration,
  stop: &StopFlag,
  sink: &mut ChunkSink<'_>,
) -> Result<TcpQueryResult, String> {
  validate(host, port, zpl.len())?;

  let mut stream = match connect(host, port).await {
    Ok(s) => s,
    Err(ConnectError::Refused) => return Ok(TcpQueryResult::Refused),
    Err(ConnectError::Unreachable) => return Ok(TcpQueryResult::Unreachable),
  };

  write_all_timeout(&mut stream, zpl.as_bytes()).await?;
  Ok(TcpQueryResult::Done(
    stream_done(&mut stream, deadline, stop, sink).await?,
  ))
}

/// One local OS print queue for the picker. driver_name/port_name let the UI
/// hint which queues are likely Zebra/raw-capable (never for filtering).
#[derive(serde::Serialize)]
pub struct LocalPrinter {
  system_name: String,
  name: String,
  driver_name: String,
  port_name: String,
}

// Windows winspool defaults pDatatype to RAW; passing a CUPS MIME there would
// set an invalid datatype. CUPS needs the explicit raw format to bypass filters.
#[cfg(windows)]
const RAW_PROPS: &[(&str, &str)] = &[];
#[cfg(not(windows))]
const RAW_PROPS: &[(&str, &str)] = &[("document-format", "application/vnd.cups-raw")];

#[tauri::command]
pub async fn list_printers() -> Result<Vec<LocalPrinter>, String> {
  blocking(|| {
    // No default-printer lookup: printers::get_default_printer() has a Windows
    // dangling-deref when no default is set, and the UI sorts Zebra-first anyway.
    printers::get_printers()
      .into_iter()
      .map(|p| LocalPrinter {
        system_name: p.system_name,
        name: p.name,
        driver_name: p.driver_name,
        port_name: p.port_name,
      })
      .collect::<Vec<_>>()
  })
  .await
}

#[tauri::command]
pub async fn send_zpl_local(printer: String, zpl: String) -> Result<(), String> {
  check_payload(zpl.len())?;
  blocking(move || -> Result<(), String> {
    // Allowlist the caller's string against enumerated queues; never hand an
    // arbitrary name to the spooler.
    let target = printers::get_printers()
      .into_iter()
      .find(|p| p.system_name == printer)
      .ok_or_else(|| "unknown printer".to_string())?;
    let opts = printers::common::base::job::PrinterJobOptions {
      name: Some("zpl-designer"),
      raw_properties: RAW_PROPS,
      ..printers::common::base::job::PrinterJobOptions::none()
    };
    target
      .print(zpl.as_bytes(), opts)
      .map(|_| ())
      .map_err(|e| e.message)
  })
  .await?
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::transport::ReplyEnd;
  use std::time::Duration;
  use tokio::io::{AsyncReadExt, AsyncWriteExt};

  #[test]
  fn rejects_empty_and_malformed_hosts() {
    assert!(validate("", 9100, 10).is_err());
    assert!(validate("http://x", 9100, 10).is_err());
    assert!(validate("a b", 9100, 10).is_err());
    assert!(validate("192.168.1.20", 9100, 10).is_ok());
    assert!(validate("printer.local", 9100, 10).is_ok());
  }

  #[test]
  fn rejects_port_zero_and_oversized_payload() {
    assert!(validate("h", 0, 10).is_err());
    assert!(validate("h", 9100, crate::transport::MAX_ZPL_BYTES + 1).is_err());
    assert!(validate("h", 9100, crate::transport::MAX_ZPL_BYTES).is_ok());
  }

  fn rt() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
      .enable_all()
      .build()
      .unwrap()
  }

  #[test]
  fn sends_exact_bytes_to_a_listener() {
    rt().block_on(async {
      let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
      let port = listener.local_addr().unwrap().port();
      let server = tokio::spawn(async move {
        let (mut sock, _) = listener.accept().await.unwrap();
        let mut buf = Vec::new();
        tokio::io::AsyncReadExt::read_to_end(&mut sock, &mut buf)
          .await
          .unwrap();
        buf
      });
      let res = send_zpl_tcp("127.0.0.1".into(), port, "^XA^FDx^FS^XZ".into())
        .await
        .unwrap();
      assert!(matches!(res, TcpSendResult::Sent));
      assert_eq!(server.await.unwrap(), b"^XA^FDx^FS^XZ");
    });
  }

  async fn query_collecting(port: u16, zpl: &str, deadline: Duration) -> (String, TcpQueryResult) {
    let (channel, texts) = crate::transport::collecting_channel();
    let mut sink = ChunkSink::new(&channel);
    let res = query_tcp(
      "127.0.0.1",
      port,
      zpl,
      deadline,
      &StopFlag::default(),
      &mut sink,
    )
    .await
    .unwrap();
    let body = texts.lock().unwrap().concat();
    (body, res)
  }

  async fn serve<F, Fut>(reply: F) -> u16
  where
    F: FnOnce(tokio::net::TcpStream) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = ()> + Send,
  {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
      let (mut sock, _) = listener.accept().await.unwrap();
      let mut buf = [0u8; 1024];
      let _ = sock.read(&mut buf).await.unwrap();
      reply(sock).await;
    });
    port
  }

  #[test]
  fn query_streams_an_answer_that_comes_seconds_after_the_first() {
    rt().block_on(async {
      let port = serve(|mut sock| async move {
        sock.write_all(b"\x02030,0,0,0892\x03\r\n").await.unwrap();
        tokio::time::sleep(Duration::from_secs(2)).await;
        sock.write_all(b"HEADER 4711 END").await.unwrap();
      })
      .await;
      let (body, res) = query_collecting(
        port,
        "^XA~HS^FN1^FD4711^FS^HV1,20,HEADER ,END^XZ",
        Duration::from_secs(30),
      )
      .await;
      assert_eq!(body, "\u{2}030,0,0,0892\u{3}\r\nHEADER 4711 END");
      assert_eq!(
        res,
        TcpQueryResult::Done(StreamDone {
          end: ReplyEnd::Closed,
          chunks: 2
        })
      );
    });
  }

  #[test]
  fn query_ends_at_its_deadline_while_the_printer_keeps_the_socket_open() {
    rt().block_on(async {
      let port = serve(|mut sock| async move {
        sock
          .write_all(b"~DYPRE,A,G,4,2,:B64:gAE=:AAAA")
          .await
          .unwrap();
        tokio::time::sleep(Duration::from_secs(5)).await;
      })
      .await;
      let (body, res) =
        query_collecting(port, "^XA^HYR:PRE.GRF^XZ", Duration::from_millis(1500)).await;
      assert_eq!(body, "~DYPRE,A,G,4,2,:B64:gAE=:AAAA");
      assert!(matches!(
        res,
        TcpQueryResult::Done(StreamDone {
          end: ReplyEnd::Deadline,
          ..
        })
      ));
    });
  }

  #[test]
  fn query_ends_empty_when_the_printer_closes_without_a_reply() {
    rt().block_on(async {
      // Close without replying: print-only endpoints behave like this.
      let port = serve(|_sock| async {}).await;
      let (body, res) = query_collecting(port, "^XA^XZ", Duration::from_secs(30)).await;
      assert!(body.is_empty());
      assert_eq!(
        res,
        TcpQueryResult::Done(StreamDone {
          end: ReplyEnd::Closed,
          chunks: 0
        })
      );
    });
  }

  #[test]
  fn query_results_serialize_with_kind_end_and_chunks() {
    let json = serde_json::to_string(&TcpQueryResult::Done(StreamDone {
      end: ReplyEnd::Stopped,
      chunks: 2,
    }))
    .unwrap();
    assert_eq!(json, r#"{"kind":"done","end":"stopped","chunks":2}"#);
  }

  #[test]
  fn reports_refused_when_nothing_listens() {
    rt().block_on(async {
      // Bind then drop to get a loopback port that is momentarily free.
      let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
      let port = listener.local_addr().unwrap().port();
      drop(listener);
      let res = send_zpl_tcp("127.0.0.1".into(), port, "^XA^XZ".into())
        .await
        .unwrap();
      assert!(matches!(res, TcpSendResult::Refused));
      let (_, res) = query_collecting(port, "^XA^XZ", Duration::from_secs(30)).await;
      assert_eq!(res, TcpQueryResult::Refused);
    });
  }
}

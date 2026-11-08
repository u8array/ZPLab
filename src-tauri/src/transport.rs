use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::Channel;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

/// The webview is untrusted input; bound the payload well above any real batch.
pub(crate) const MAX_ZPL_BYTES: usize = 16 * 1024 * 1024;

const IO_TIMEOUT: Duration = Duration::from_secs(4);

// A ~DY upload of a full label bitmap is ~200 KiB base64; bound far above that.
const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
// Caps a webview that asks for forever.
const MAX_READ_DEADLINE: Duration = Duration::from_secs(600);
// How soon a stop is seen, against the wakeups a quiet printer costs.
const STOP_TICK: Duration = Duration::from_millis(250);
// A stop that outlived its stream ages out instead of poisoning a later one.
const EARLY_STOPS_KEPT: usize = 16;

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

pub(crate) type StopFlag = Arc<AtomicBool>;

/// Keyed by channel id, so a stop reaches the stream it means. One lock over
/// both sets, so a stop cannot slip between the early check and the registration.
#[derive(Default)]
pub(crate) struct QueryStops(Mutex<Stops>);

#[derive(Default)]
struct Stops {
  running: HashMap<u32, StopFlag>,
  early: VecDeque<u32>,
}

/// A failed command leaves no stale flag.
pub(crate) struct StopHandle<'a> {
  stops: &'a QueryStops,
  channel: u32,
  pub(crate) flag: StopFlag,
}

impl Drop for StopHandle<'_> {
  fn drop(&mut self) {
    let mut stops = self.stops.0.lock().unwrap();
    // A channel id taken over by a later stream keeps that stream's flag.
    if stops
      .running
      .get(&self.channel)
      .is_some_and(|flag| Arc::ptr_eq(flag, &self.flag))
    {
      stops.running.remove(&self.channel);
    }
  }
}

#[tauri::command]
pub fn query_stop(channel: u32, stops: tauri::State<'_, QueryStops>) {
  stops.stop(channel);
}

impl QueryStops {
  pub(crate) fn begin(&self, channel: u32) -> StopHandle<'_> {
    let flag = StopFlag::default();
    let mut stops = self.0.lock().unwrap();
    if let Some(at) = stops.early.iter().position(|id| *id == channel) {
      stops.early.remove(at);
      flag.store(true, Ordering::Relaxed);
    }
    stops.running.insert(channel, flag.clone());
    StopHandle {
      stops: self,
      channel,
      flag,
    }
  }

  pub(crate) fn stop(&self, channel: u32) {
    let mut stops = self.0.lock().unwrap();
    match stops.running.get(&channel) {
      Some(flag) => flag.store(true, Ordering::Relaxed),
      None => {
        stops.early.push_back(channel);
        if stops.early.len() > EARLY_STOPS_KEPT {
          stops.early.pop_front();
        }
      }
    }
  }
}

/// The webview reads the bytes, so none of these is an error.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ReplyEnd {
  Closed,
  Deadline,
  Stopped,
  /// The link failed behind the write, with or without bytes out, so the webview keeps what came.
  Lost,
}

/// The reply went out as `chunks` channel messages, which may still be in flight when this lands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub(crate) struct StreamDone {
  pub(crate) end: ReplyEnd,
  pub(crate) chunks: u32,
}

/// The reply of a stream that is open and written, as chunk messages on `sink`'s channel.
pub(crate) async fn stream_done<R: tokio::io::AsyncRead + Unpin>(
  stream: &mut R,
  deadline: Duration,
  stop: &AtomicBool,
  sink: &mut ChunkSink<'_>,
) -> Result<StreamDone, String> {
  let end = stream_reply(stream, deadline, stop, |chunk| sink.push(chunk)).await?;
  Ok(StreamDone {
    end,
    chunks: sink.finish()?,
  })
}

pub(crate) async fn stream_reply<R, F>(
  stream: &mut R,
  deadline: Duration,
  stop: &AtomicBool,
  mut sink: F,
) -> Result<ReplyEnd, String>
where
  R: tokio::io::AsyncRead + Unpin,
  F: FnMut(&[u8]) -> Result<(), String>,
{
  let mut buf = [0u8; 64 * 1024];
  let mut total = 0usize;
  let until = tokio::time::Instant::now() + deadline.min(MAX_READ_DEADLINE);
  loop {
    if stop.load(Ordering::Relaxed) {
      return Ok(ReplyEnd::Stopped);
    }
    let now = tokio::time::Instant::now();
    if now >= until {
      return Ok(ReplyEnd::Deadline);
    }
    match tokio::time::timeout_at(until.min(now + STOP_TICK), stream.read(&mut buf)).await {
      Ok(Ok(0)) => return Ok(ReplyEnd::Closed),
      Ok(Ok(n)) => {
        total += n;
        if total > MAX_RESPONSE_BYTES {
          return Err("response too large".to_string());
        }
        sink(&buf[..n])?;
      }
      Ok(Err(e)) if e.kind() == std::io::ErrorKind::Interrupted => {}
      Ok(Err(_)) => return Ok(ReplyEnd::Lost),
      Err(_) => {}
    }
  }
}

/// ^HV returns field data under ^CI28, so a UTF-8 sequence a read splits is
/// sent whole with the next chunk.
pub(crate) struct ChunkSink<'a> {
  channel: &'a Channel<String>,
  tail: Vec<u8>,
  sent: u32,
}

impl<'a> ChunkSink<'a> {
  pub(crate) fn new(channel: &'a Channel<String>) -> Self {
    Self {
      channel,
      tail: Vec::new(),
      sent: 0,
    }
  }

  pub(crate) fn push(&mut self, chunk: &[u8]) -> Result<(), String> {
    self.tail.extend_from_slice(chunk);
    let mut text = String::new();
    // One drain at the end, since a run of invalid bytes would shift the tail once per byte.
    let mut start = 0;
    loop {
      match std::str::from_utf8(&self.tail[start..]) {
        Ok(whole) => {
          text.push_str(whole);
          start = self.tail.len();
          break;
        }
        Err(e) => {
          let valid = e.valid_up_to();
          let Some(bad) = e.error_len() else {
            text.push_str(&String::from_utf8_lossy(&self.tail[start..start + valid]));
            start += valid;
            break;
          };
          text.push_str(&String::from_utf8_lossy(
            &self.tail[start..start + valid + bad],
          ));
          start += valid + bad;
        }
      }
    }
    self.tail.drain(..start);
    if text.is_empty() {
      return Ok(());
    }
    self.send(text)
  }

  pub(crate) fn finish(&mut self) -> Result<u32, String> {
    if !self.tail.is_empty() {
      let text = String::from_utf8_lossy(&self.tail).into_owned();
      self.tail.clear();
      self.send(text)?;
    }
    Ok(self.sent)
  }

  fn send(&mut self, text: String) -> Result<(), String> {
    self.channel.send(text).map_err(|e| e.to_string())?;
    self.sent += 1;
    Ok(())
  }
}

/// A real Channel needs the Tauri runtime.
#[cfg(test)]
pub(crate) fn collecting_channel() -> (Channel<String>, Arc<Mutex<Vec<String>>>) {
  let texts = Arc::new(Mutex::new(Vec::new()));
  let seen = texts.clone();
  let channel = Channel::new(move |body| {
    let tauri::ipc::InvokeResponseBody::Json(json) = body else {
      panic!("a text channel sends JSON")
    };
    seen
      .lock()
      .unwrap()
      .push(serde_json::from_str::<String>(&json).unwrap());
    Ok(())
  });
  (channel, texts)
}

#[cfg(test)]
mod tests {
  use super::*;

  // Paused clock: the tick and the deadline auto-advance when the reader idles.
  fn rt() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
      .enable_all()
      .start_paused(true)
      .build()
      .unwrap()
  }

  async fn collect<R: tokio::io::AsyncRead + Unpin>(
    stream: &mut R,
    deadline: Duration,
    stop: &StopFlag,
  ) -> (Vec<u8>, Result<ReplyEnd, String>) {
    let mut body = Vec::new();
    let end = stream_reply(stream, deadline, stop, |chunk| {
      body.extend_from_slice(chunk);
      Ok(())
    })
    .await;
    (body, end)
  }

  #[test]
  fn stream_reply_keeps_reading_across_a_long_gap() {
    rt().block_on(async {
      let (mut a, mut b) = tokio::io::duplex(1024);
      tokio::spawn(async move {
        a.write_all(b"\x02030,0,0\x03\r\n").await.unwrap();
        tokio::time::sleep(Duration::from_secs(20)).await;
        a.write_all(b"HEADER 4711 END").await.unwrap();
      });
      let (body, end) = collect(&mut b, Duration::from_secs(60), &StopFlag::default()).await;
      assert_eq!(body, b"\x02030,0,0\x03\r\nHEADER 4711 END");
      assert_eq!(end.unwrap(), ReplyEnd::Closed);
    });
  }

  #[test]
  fn stream_reply_ends_at_the_deadline_with_what_came() {
    rt().block_on(async {
      let (mut a, mut b) = tokio::io::duplex(1024);
      a.write_all(b"~DYreply").await.unwrap();
      // `a` stays open, so only the deadline can end the stream.
      let (body, end) = collect(&mut b, Duration::from_secs(5), &StopFlag::default()).await;
      assert_eq!(body, b"~DYreply");
      assert_eq!(end.unwrap(), ReplyEnd::Deadline);
    });
  }

  struct ResetAfter(Option<&'static [u8]>);
  impl tokio::io::AsyncRead for ResetAfter {
    fn poll_read(
      mut self: std::pin::Pin<&mut Self>,
      _cx: &mut std::task::Context<'_>,
      buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
      std::task::Poll::Ready(match self.0.take() {
        Some(bytes) => {
          buf.put_slice(bytes);
          Ok(())
        }
        None => Err(std::io::Error::from(std::io::ErrorKind::ConnectionReset)),
      })
    }
  }

  struct InterruptedOnce(Option<&'static [u8]>, bool);
  impl tokio::io::AsyncRead for InterruptedOnce {
    fn poll_read(
      mut self: std::pin::Pin<&mut Self>,
      _cx: &mut std::task::Context<'_>,
      buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
      if !self.1 {
        self.1 = true;
        return std::task::Poll::Ready(Err(std::io::Error::from(std::io::ErrorKind::Interrupted)));
      }
      if let Some(bytes) = self.0.take() {
        buf.put_slice(bytes);
      }
      std::task::Poll::Ready(Ok(()))
    }
  }

  #[test]
  fn stream_reply_reads_on_past_an_interrupted_read() {
    rt().block_on(async {
      let (body, end) = collect(
        &mut InterruptedOnce(Some(b"HDR 1 END"), false),
        Duration::from_secs(5),
        &StopFlag::default(),
      )
      .await;
      assert_eq!(body, b"HDR 1 END");
      assert_eq!(end.unwrap(), ReplyEnd::Closed);
    });
  }

  #[test]
  fn stream_reply_ends_as_lost_on_a_reset_behind_or_ahead_of_the_first_byte() {
    rt().block_on(async {
      let stop = StopFlag::default();
      let (body, end) = collect(
        &mut ResetAfter(Some(b"HDR 1 END")),
        Duration::from_secs(5),
        &stop,
      )
      .await;
      assert_eq!(body, b"HDR 1 END");
      assert_eq!(end.unwrap(), ReplyEnd::Lost);
      let (body, end) = collect(&mut ResetAfter(None), Duration::from_secs(5), &stop).await;
      assert!(body.is_empty());
      assert_eq!(end.unwrap(), ReplyEnd::Lost);
    });
  }

  #[test]
  fn stream_reply_ends_when_the_caller_stops_it() {
    rt().block_on(async {
      let (mut a, mut b) = tokio::io::duplex(1024);
      a.write_all(b"first").await.unwrap();
      let stop = StopFlag::default();
      let stopper = stop.clone();
      tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(2)).await;
        stopper.store(true, Ordering::Relaxed);
      });
      let (body, end) = collect(&mut b, Duration::from_secs(60), &stop).await;
      assert_eq!(body, b"first");
      assert_eq!(end.unwrap(), ReplyEnd::Stopped);
    });
  }

  #[test]
  fn stream_reply_ends_empty_on_eof_without_data() {
    rt().block_on(async {
      let (a, mut b) = tokio::io::duplex(1024);
      drop(a);
      let (body, end) = collect(&mut b, Duration::from_secs(5), &StopFlag::default()).await;
      assert!(body.is_empty());
      assert_eq!(end.unwrap(), ReplyEnd::Closed);
    });
  }

  #[test]
  fn stream_reply_ends_empty_at_the_deadline_without_data() {
    rt().block_on(async {
      let (_a, mut b) = tokio::io::duplex(1024);
      let (body, end) = collect(&mut b, Duration::from_secs(5), &StopFlag::default()).await;
      assert!(body.is_empty());
      assert_eq!(end.unwrap(), ReplyEnd::Deadline);
    });
  }

  #[test]
  fn stream_reply_caps_the_deadline() {
    rt().block_on(async {
      let (_a, mut b) = tokio::io::duplex(1024);
      let started = tokio::time::Instant::now();
      let (_, end) = collect(&mut b, Duration::from_secs(100_000), &StopFlag::default()).await;
      assert_eq!(end.unwrap(), ReplyEnd::Deadline);
      assert!(started.elapsed() <= MAX_READ_DEADLINE + STOP_TICK);
    });
  }

  #[test]
  fn stream_reply_caps_the_bytes() {
    rt().block_on(async {
      let (mut a, mut b) = tokio::io::duplex(64 * 1024);
      tokio::spawn(async move {
        let block = vec![b'x'; 64 * 1024];
        while a.write_all(&block).await.is_ok() {}
      });
      let (_, end) = collect(&mut b, Duration::from_secs(60), &StopFlag::default()).await;
      assert_eq!(end.unwrap_err(), "response too large");
    });
  }

  #[test]
  fn a_stop_reaches_its_stream_even_ahead_of_its_begin() {
    let stops = QueryStops::default();
    let one = stops.begin(1);
    let two = stops.begin(2);
    stops.stop(2);
    stops.stop(3);
    assert!(!one.flag.load(Ordering::Relaxed));
    assert!(two.flag.load(Ordering::Relaxed));
    drop(two);
    stops.stop(2);
    assert!(stops.begin(2).flag.load(Ordering::Relaxed));
    assert!(stops.begin(3).flag.load(Ordering::Relaxed));
    assert!(!stops.begin(3).flag.load(Ordering::Relaxed));
  }

  #[test]
  fn an_early_stop_ages_out_behind_newer_ones() {
    let stops = QueryStops::default();
    for id in 10..(10 + EARLY_STOPS_KEPT as u32 + 1) {
      stops.stop(id);
    }
    assert!(!stops.begin(10).flag.load(Ordering::Relaxed));
    assert!(stops.begin(11).flag.load(Ordering::Relaxed));
  }

  #[test]
  fn stream_reply_hands_back_a_sink_error_at_once() {
    rt().block_on(async {
      let (mut a, mut b) = tokio::io::duplex(1024);
      a.write_all(b"HEADER").await.unwrap();
      let end = stream_reply(&mut b, Duration::from_secs(5), &StopFlag::default(), |_| {
        Err("sink".to_string())
      })
      .await;
      assert_eq!(end.unwrap_err(), "sink");
    });
  }

  #[test]
  fn a_handle_dropped_late_leaves_the_stream_that_took_over_its_channel() {
    let stops = QueryStops::default();
    let first = stops.begin(7);
    let second = stops.begin(7);
    drop(first);
    stops.stop(7);
    assert!(second.flag.load(Ordering::Relaxed));
    drop(second);
    assert!(!stops.begin(7).flag.load(Ordering::Relaxed));
  }

  fn sink_texts(chunks: &[&[u8]]) -> (Vec<String>, u32) {
    let (channel, texts) = collecting_channel();
    let mut sink = ChunkSink::new(&channel);
    for chunk in chunks {
      sink.push(chunk).unwrap();
    }
    let sent = sink.finish().unwrap();
    let texts = texts.lock().unwrap().clone();
    (texts, sent)
  }

  #[test]
  fn chunk_sink_joins_a_utf8_sequence_split_across_reads_and_counts_its_messages() {
    let euro = "€".as_bytes();
    let (texts, sent) = sink_texts(&[b"HEAD ", &euro[..1], &euro[1..], b" END"]);
    assert_eq!(texts, vec!["HEAD ", "€", " END"]);
    assert_eq!(sent, 3);
    let smile = "😀".as_bytes();
    let (texts, _) = sink_texts(&[&smile[..1], &smile[1..3], &smile[3..]]);
    assert_eq!(texts, vec!["😀"]);
  }

  #[test]
  fn chunk_sink_replaces_every_byte_of_a_long_invalid_run() {
    let run = [0xffu8; 4096];
    let (texts, sent) = sink_texts(&[&run[..]]);
    assert_eq!(texts, vec!["\u{fffd}".repeat(4096)]);
    assert_eq!(sent, 1);
  }

  #[test]
  fn chunk_sink_replaces_an_invalid_byte_without_losing_the_sequence_behind_it() {
    let euro = "€".as_bytes();
    let (texts, _) = sink_texts(&[b"a\xffb"]);
    assert_eq!(texts, vec!["a\u{fffd}b"]);
    let (texts, _) = sink_texts(&[&[b"\xff", &euro[..2]].concat(), &euro[2..]]);
    assert_eq!(texts, vec!["\u{fffd}", "€"]);
    let (texts, _) = sink_texts(&[b"x", &euro[..2]]);
    assert_eq!(texts, vec!["x", "\u{fffd}"]);
    let (texts, sent) = sink_texts(&[b"", &euro[..1]]);
    assert_eq!(texts, vec!["\u{fffd}"]);
    assert_eq!(sent, 1);
  }
}

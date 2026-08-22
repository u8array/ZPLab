//! Lifecycle for the loopback MCP server child process: a bearer-authenticated
//! HTTP MCP server the desktop app can toggle. These commands spawn, stop, and
//! probe it, and the app kills it on exit so it never outlives the window.

use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;

/// Tauri event carrying an openDraft design file to the editor.
const OPEN_DRAFT_EVENT: &str = "mcp://open-draft";

/// Tauri event carrying a designRequest id; the webview answers via mcp_reply.
const DESIGN_REQUEST_EVENT: &str = "mcp://design-request";
const RASTER_REQUEST_EVENT: &str = "mcp://raster-request";

/// Windows: kill-on-close Job Object that ties the child's cmd/pnpm/node tree
/// to the app. Closing the handle (explicitly, or when the process dies and the
/// OS closes it) terminates the whole tree, so grandchildren never orphan.
#[cfg(windows)]
mod job {
  use std::os::windows::io::AsRawHandle;
  use std::process::Child;
  use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
  use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
  };

  /// Job handle stored as isize so McpState stays Send (a raw HANDLE pointer is
  /// not). We only ever hand it back to Win32, never dereference it.
  pub struct Job(isize);

  // SAFETY: a Win32 job handle is a process-global kernel object, safe to move
  // and close from any thread; the pointer is never dereferenced.
  unsafe impl Send for Job {}

  impl Drop for Job {
    /// Closing the kill-on-close handle terminates any process still in the job.
    fn drop(&mut self) {
      // SAFETY: self.0 is the sole owner of a live job handle, closed once here.
      unsafe { CloseHandle(self.0 as HANDLE) };
    }
  }

  /// Create a kill-on-close job and assign `child` to it. None if any Win32 call
  /// fails, in which case the caller falls back to a plain child kill.
  pub fn assign(child: &Child) -> Option<Job> {
    // SAFETY: CreateJobObjectW returns a valid handle we own until CloseHandle
    // (via Job's Drop). `info` is a fully-zeroed, correctly-sized struct and we
    // pass its matching byte length. child.as_raw_handle() is a live process
    // handle owned by `child`, valid for the duration of this call.
    unsafe {
      let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
      if handle.is_null() {
        return None;
      }
      let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
      info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      let set = SetInformationJobObject(
        handle,
        JobObjectExtendedLimitInformation,
        std::ptr::addr_of!(info).cast::<core::ffi::c_void>(),
        std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
      );
      let assigned = AssignProcessToJobObject(handle, child.as_raw_handle() as HANDLE);
      if set == 0 || assigned == 0 {
        CloseHandle(handle);
        return None;
      }
      Some(Job(handle as isize))
    }
  }
}

/// Liveness of the stored child, distinguishing "gone" (concurrently stopped)
/// from "crashed" so startup can report the right failure.
enum ChildStatus {
  Alive,
  Exited,
  Absent,
}

/// A child event held back until the webview has its listeners up.
enum BufferedEvent {
  OpenDraft { id: u64, design_file: String },
  DesignRequest(u64),
  RasterRequest(String),
}

fn emit_event(app: &AppHandle, ev: &BufferedEvent) {
  match ev {
    BufferedEvent::OpenDraft { id, design_file } => {
      let _ = app.emit(OPEN_DRAFT_EVENT, (*id, design_file.clone()));
    }
    BufferedEvent::DesignRequest(id) => {
      let _ = app.emit(DESIGN_REQUEST_EVENT, *id);
    }
    BufferedEvent::RasterRequest(line) => {
      let _ = app.emit(RASTER_REQUEST_EVENT, line.clone());
    }
  }
}

/// Managed handle to the running server child, if any.
pub struct McpState {
  child: Mutex<Option<Child>>,
  /// Held for the whole of mcp_start so concurrent starts serialize instead of
  /// racing the TOCTOU is_running() check.
  start_lock: tokio::sync::Mutex<()>,
  /// Some = webview listeners not up yet, events queue here (a boot-started
  /// server would otherwise emit into the void and silently drop a draft);
  /// mcp_listeners_ready takes it to None and flushes. Webview-reload edge accepted.
  event_buffer: Mutex<Option<Vec<BufferedEvent>>>,
  /// Port + token of the running child, so mcp_reply can reach it. Published
  /// only once the child reports `listening`, cleared the moment it is reaped:
  /// a reply to a port someone else rebound would hand them the token.
  endpoint: Mutex<Option<(u16, String)>>,
  #[cfg(windows)]
  job: Mutex<Option<job::Job>>,
}

impl Default for McpState {
  fn default() -> Self {
    Self {
      child: Mutex::new(None),
      start_lock: tokio::sync::Mutex::new(()),
      event_buffer: Mutex::new(Some(Vec::new())),
      endpoint: Mutex::new(None),
      #[cfg(windows)]
      job: Mutex::new(None),
    }
  }
}

impl McpState {
  /// Kill and reap the child if one is running. Idempotent.
  pub fn kill(&self) {
    if let Some(mut child) = self.child.lock().unwrap().take() {
      #[cfg(unix)]
      {
        // The child leads its own process group (process_group(0)); signal the
        // group so pnpm/node grandchildren die with it, not just the shell.
        unsafe { libc::killpg(child.id() as libc::pid_t, libc::SIGKILL) };
      }
      let _ = child.kill();
      let _ = child.wait();
    }
    *self.endpoint.lock().unwrap() = None;
    // Drop the job after the child: closing its kill-on-close handle terminates
    // any grandchildren that survived the direct kill. take()->drop is a no-op
    // when already cleared, so kill stays idempotent.
    #[cfg(windows)]
    drop(self.job.lock().unwrap().take());
  }

  /// True while the child is alive. Reaps and clears it if it has exited, so
  /// status reflects a server that crashed instead of a stale handle.
  fn is_running(&self) -> bool {
    let mut guard = self.child.lock().unwrap();
    match guard.as_mut() {
      Some(child) => match child.try_wait() {
        Ok(Some(_)) => {
          *guard = None;
          *self.endpoint.lock().unwrap() = None;
          false
        }
        _ => true,
      },
      None => false,
    }
  }

  fn child_status(&self) -> ChildStatus {
    let mut guard = self.child.lock().unwrap();
    match guard.as_mut() {
      None => ChildStatus::Absent,
      Some(child) => match child.try_wait() {
        Ok(Some(_)) => {
          *self.endpoint.lock().unwrap() = None;
          ChildStatus::Exited
        }
        _ => ChildStatus::Alive,
      },
    }
  }
}

/// How long to await the child's `listening` signal before declaring the spawn
/// a failure. Dev runs the package from source through pnpm and tsx, which
/// needs far longer to bind than the release binary.
#[cfg(debug_assertions)]
const READY_TIMEOUT: Duration = Duration::from_secs(30);

#[cfg(not(debug_assertions))]
const READY_TIMEOUT: Duration = Duration::from_secs(5);

#[cfg(windows)]
fn suppress_console(cmd: &mut Command) {
  use std::os::windows::process::CommandExt;
  const CREATE_NO_WINDOW: u32 = 0x0800_0000;
  cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn suppress_console(_cmd: &mut Command) {}

/// Capability mcp_status reports so the UI can hide the controls. Dev always
/// can (source spawn); release only when the bundled binary is present.
#[cfg(debug_assertions)]
pub fn sidecar_available() -> bool {
  true
}

#[cfg(not(debug_assertions))]
pub fn sidecar_available() -> bool {
  sidecar_path().is_some()
}

/// The child that serves the MCP HTTP transport. Dev runs the workspace package
/// from source; release spawns the bundled sidecar binary.
/// The token travels over stdin (--token-stdin), never argv: argv is readable
/// by any same-user process (/proc/pid/cmdline, WMI CommandLine).
#[cfg(debug_assertions)]
fn mcp_command(port: u16) -> Result<Command, String> {
  // cwd is the repo root (src-tauri's parent) so the pnpm workspace filter
  // resolves the package.
  let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
    .parent()
    .ok_or("cannot resolve repo root")?;
  // cmd /C so CreateProcess finds corepack's pnpm.cmd shim (no pnpm.exe).
  #[cfg(windows)]
  let mut cmd = {
    let mut c = Command::new("cmd");
    c.args(["/C", "pnpm"]);
    c
  };
  #[cfg(not(windows))]
  let mut cmd = Command::new("pnpm");
  cmd.current_dir(repo_root).args([
    "--filter",
    "@zplab/mcp-server",
    "exec",
    "tsx",
    "src/index.ts",
    "--http",
    "--port",
    &port.to_string(),
    "--token-stdin",
  ]);
  Ok(cmd)
}

/// Bundled sidecar binary next to the app executable (tauri externalBin drops
/// it there on every platform, triple suffix stripped).
#[cfg(not(debug_assertions))]
fn sidecar_path() -> Option<std::path::PathBuf> {
  let name = if cfg!(windows) {
    "zplab-mcp.exe"
  } else {
    "zplab-mcp"
  };
  let path = std::env::current_exe().ok()?.parent()?.join(name);
  path.exists().then_some(path)
}

#[cfg(not(debug_assertions))]
fn mcp_command(port: u16) -> Result<Command, String> {
  // Stable code the frontend maps to a localized message.
  let exe = sidecar_path().ok_or("sidecar_not_bundled")?;
  let mut cmd = Command::new(exe);
  cmd.args(["--http", "--port", &port.to_string(), "--token-stdin"]);
  Ok(cmd)
}

/// Extract the request id and design file from a child stdout line, or None if
/// the line is not an openDraft event (dev logging, partial output). The child
/// emits these lines only in HTTP mode, where stdout is not the JSON-RPC channel.
/// The id travels with the draft so the webview can post its receipt back.
fn open_draft_payload(line: &str) -> Option<(u64, String)> {
  let value: serde_json::Value = serde_json::from_str(line).ok()?;
  if value.get("zplabEvent")?.as_str()? != "openDraft" {
    return None;
  }
  Some((
    value.get("id")?.as_u64()?,
    value.get("designFile")?.to_string(),
  ))
}

/// True for the child's one-shot `{"zplabEvent":"listening"}` line, emitted once
/// the HTTP server has bound its port.
fn is_listening_event(line: &str) -> bool {
  serde_json::from_str::<serde_json::Value>(line)
    .ok()
    .and_then(|v| v.get("zplabEvent")?.as_str().map(|s| s == "listening"))
    .unwrap_or(false)
}

/// Extract the request id from a child `designRequest` line, or None.
fn design_request_id(line: &str) -> Option<u64> {
  let value: serde_json::Value = serde_json::from_str(line).ok()?;
  if value.get("zplabEvent")?.as_str()? != "designRequest" {
    return None;
  }
  value.get("id")?.as_u64()
}

/// A rasterRequest travels as its whole JSON line: the payload is an opaque
/// image plus its target size, which only the webview reads.
fn raster_request_line(line: &str) -> Option<String> {
  let value: serde_json::Value = serde_json::from_str(line).ok()?;
  if value.get("zplabEvent")?.as_str()? != "rasterRequest" {
    return None;
  }
  value.get("id")?.as_u64()?;
  Some(line.to_string())
}

/// Signal readiness on the child's first `listening` stdout line, then forward
/// openDraft and designRequest events. Ends when stdout closes; dropping an
/// unused `ready` sender then makes wait_until_ready observe the child as gone.
fn forward_child_events(
  stdout: std::process::ChildStdout,
  app: AppHandle,
  ready: oneshot::Sender<()>,
) {
  use std::io::BufRead;
  let mut ready = Some(ready);
  for line in std::io::BufReader::new(stdout).lines() {
    let Ok(line) = line else { break };
    if is_listening_event(&line) {
      if let Some(tx) = ready.take() {
        let _ = tx.send(());
      }
      continue;
    }
    let ev = if let Some((id, design_file)) = open_draft_payload(&line) {
      BufferedEvent::OpenDraft { id, design_file }
    } else if let Some(id) = design_request_id(&line) {
      BufferedEvent::DesignRequest(id)
    } else if let Some(raw) = raster_request_line(&line) {
      BufferedEvent::RasterRequest(raw)
    } else {
      continue;
    };
    let state = app.state::<McpState>();
    let mut buffer = state.event_buffer.lock().unwrap();
    match buffer.as_mut() {
      Some(queue) => queue.push(ev),
      None => emit_event(&app, &ev),
    }
  }
}

/// The webview's listeners are registered: flush anything queued and emit
/// directly from now on.
#[tauri::command]
pub fn mcp_listeners_ready(app: AppHandle, state: State<'_, McpState>) {
  let drained = state.event_buffer.lock().unwrap().take();
  if let Some(events) = drained {
    for ev in &events {
      emit_event(&app, ev);
    }
  }
}

/// Await the child's own `listening` signal: only OUR child bound the port (a
/// foreign listener can't forge it), and a child dying first drops the sender,
/// surfacing as "exited during startup" rather than a timeout.
async fn wait_until_ready(ready: oneshot::Receiver<()>) -> Result<(), String> {
  match tokio::time::timeout(READY_TIMEOUT, ready).await {
    Ok(Ok(())) => Ok(()),
    Ok(Err(_)) => Err("mcp server exited during startup (port in use?)".to_string()),
    Err(_) => Err("mcp server did not start within timeout".to_string()),
  }
}

/// Start the MCP server on `port` with bearer `token`; a no-op if already
/// running on the same port/token, else an error. Returns `true` only for a
/// freshly spawned child, so the caller forgets its attach session only then.
#[tauri::command]
pub async fn mcp_start(
  app: AppHandle,
  state: State<'_, McpState>,
  port: u16,
  token: String,
) -> Result<bool, String> {
  // Serialize starts. A caller that would rather not wait out the readiness
  // window asks mcp_status for `starting` first.
  let _start = state.start_lock.lock().await;
  if state.is_running() {
    // Success for a port the child does not serve would leave the settings
    // snippet pointing at a port nothing listens on.
    let bound = state.endpoint.lock().unwrap().clone();
    if let Some((bound_port, bound_token)) = bound {
      if bound_port != port {
        return Err("already running on another port".to_string());
      }
      // The child only accepts the token it was spawned with; Ok here would
      // point the settings snippet at a token nothing accepts.
      if bound_token != token {
        return Err("already running with a different token".to_string());
      }
    }
    return Ok(false);
  }
  let mut cmd = mcp_command(port)?;
  suppress_console(&mut cmd);
  // Pipe stdout for the openDraft event channel; stderr stays inherited.
  // stdin is piped solely for the one token line below.
  cmd.stdout(Stdio::piped()).stdin(Stdio::piped());
  #[cfg(unix)]
  {
    // Own process group so kill() can SIGKILL the whole pnpm/node tree.
    use std::os::unix::process::CommandExt;
    cmd.process_group(0);
  }
  let mut child = cmd
    .spawn()
    .map_err(|e| format!("failed to spawn mcp server: {e}"))?;
  // Hand the token over stdin, then drop the handle (EOF): the child reads
  // exactly one line, and a failed write surfaces as the readiness timeout.
  if let Some(mut stdin) = child.stdin.take() {
    use std::io::Write;
    let _ = writeln!(stdin, "{token}");
  }
  // Known micro-race: a grandchild forked between spawn and AssignProcessToJobObject
  // escapes the job's kill-on-close. The canonical fix (CREATE_SUSPENDED + ResumeThread)
  // needs the primary-thread handle std::process::Child does not expose.
  #[cfg(windows)]
  {
    *state.job.lock().unwrap() = job::assign(&child);
  }
  let (ready_tx, ready_rx) = oneshot::channel();
  if let Some(stdout) = child.stdout.take() {
    std::thread::spawn(move || forward_child_events(stdout, app, ready_tx));
  }
  // Store the child before the wait so a teardown mid-startup still reaps it;
  // the endpoint waits for `listening` (see its field doc).
  *state.child.lock().unwrap() = Some(child);
  match wait_until_ready(ready_rx).await {
    // A concurrent mcp_stop can take our child while we waited; only report
    // success if it is still ours and alive.
    Ok(()) if matches!(state.child_status(), ChildStatus::Alive) => {
      *state.endpoint.lock().unwrap() = Some((port, token));
      Ok(true)
    }
    // Also clears the job handle on this path so it is not leaked.
    Ok(()) => {
      state.kill();
      Err("stopped during startup".to_string())
    }
    Err(e) => {
      state.kill();
      Err(e)
    }
  }
}

#[tauri::command]
pub fn mcp_stop(state: State<'_, McpState>) {
  state.kill();
}

/// The sidecar routes the webview may answer on. An allowlist keeps the command
/// from becoming a general loopback POST client for the webview.
const REPLY_ROUTES: [&str; 5] = [
  "/app-attach",
  "/app-detach",
  "/design-response",
  "/draft-receipt",
  "/raster-response",
];

/// Upper bound on a single loopback POST. Bounds the send itself, not the
/// sidecar's wait for it: hanging the webview's request forever would be worse
/// than a wasted round trip.
const REPLY_TIMEOUT: Duration = Duration::from_secs(10);

fn reply_client() -> Result<&'static reqwest::Client, String> {
  static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
  if let Some(c) = CLIENT.get() {
    return Ok(c);
  }
  let built = reqwest::Client::builder()
    // A configured system proxy must not swallow loopback traffic.
    .no_proxy()
    .timeout(REPLY_TIMEOUT)
    .build()
    .map_err(|e| e.to_string())?;
  Ok(CLIENT.get_or_init(|| built))
}

/// Answer the sidecar from Rust rather than the webview: a fetch out of the
/// webview is cross-origin, and the bearer gate 401s the CORS preflight.
#[tauri::command]
pub async fn mcp_reply(
  state: State<'_, McpState>,
  route: String,
  payload: serde_json::Value,
) -> Result<(), String> {
  if !REPLY_ROUTES.contains(&route.as_str()) {
    return Err(format!("unknown mcp route: {route}"));
  }
  // Reap first, so a reply to a dead child fails here (see `endpoint`).
  if !state.is_running() {
    return Err("mcp server is not running".to_string());
  }
  let (port, token) = state
    .endpoint
    .lock()
    .unwrap()
    .clone()
    .ok_or("mcp server is not running")?;
  reply_client()?
    .post(format!("http://127.0.0.1:{port}{route}"))
    .bearer_auth(token)
    .header("content-type", "application/json")
    .body(payload.to_string())
    .send()
    .await
    .map_err(|e| e.to_string())?
    .error_for_status()
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct McpStatus {
  pub running: bool,
  pub available: bool,
  /// A start is in flight. Without it `running` is false for the whole
  /// readiness wait, and a caller cannot tell that from "never started".
  pub starting: bool,
}

#[tauri::command]
pub fn mcp_status(state: State<'_, McpState>) -> McpStatus {
  McpStatus {
    // Ready, not merely spawned: see `endpoint`'s doc for why is_running() alone is not enough.
    running: state.is_running() && state.endpoint.lock().unwrap().is_some(),
    available: sidecar_available(),
    starting: state.start_lock.try_lock().is_err(),
  }
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

  #[test]
  fn raster_line_passes_through_only_its_own_event() {
    let line =
      r#"{"zplabEvent":"rasterRequest","id":7,"dataUrl":"data:image/png;base64,AA","widthDots":8}"#;
    assert_eq!(raster_request_line(line), Some(line.to_string()));
    assert!(raster_request_line(r#"{"zplabEvent":"designRequest","id":7}"#).is_none());
    assert!(raster_request_line(r#"{"zplabEvent":"rasterRequest"}"#).is_none());
    assert!(raster_request_line("not json").is_none());
  }

  #[test]
  fn reply_routes_are_the_ones_the_app_answers_on() {
    assert_eq!(REPLY_ROUTES.len(), 5);
    for route in REPLY_ROUTES {
      assert!(route.starts_with('/'), "{route} needs its leading slash");
    }
    assert!(!REPLY_ROUTES.contains(&"/"));
  }

  #[test]
  fn status_serializes_running_and_available_flags() {
    let json = serde_json::to_string(&McpStatus {
      running: true,
      available: false,
      starting: false,
    })
    .unwrap();
    assert_eq!(
      json,
      r#"{"running":true,"available":false,"starting":false}"#
    );
  }

  #[test]
  fn empty_state_reports_not_running() {
    let state = McpState::default();
    assert!(!state.is_running());
    // kill is a no-op when nothing runs.
    state.kill();
    assert!(!state.is_running());
  }

  #[test]
  fn open_draft_payload_extracts_id_and_design_file() {
    let line = r#"{"zplabEvent":"openDraft","id":7,"designFile":{"schemaVersion":3}}"#;
    assert_eq!(
      open_draft_payload(line),
      Some((7, r#"{"schemaVersion":3}"#.to_string()))
    );
  }

  #[test]
  fn open_draft_payload_ignores_non_events() {
    assert_eq!(open_draft_payload("plain dev log line"), None);
    assert_eq!(open_draft_payload(r#"{"other":"json"}"#), None);
    assert_eq!(
      open_draft_payload(r#"{"zplabEvent":"openDraft","id":1}"#),
      None,
      "missing designFile is not forwardable"
    );
    assert_eq!(
      open_draft_payload(r#"{"zplabEvent":"openDraft","designFile":{}}"#),
      None,
      "without an id the webview could not answer"
    );
  }

  #[test]
  fn is_listening_event_matches_only_the_listening_line() {
    assert!(is_listening_event(
      r#"{"zplabEvent":"listening","port":4923}"#
    ));
    assert!(!is_listening_event(r#"{"zplabEvent":"openDraft"}"#));
    assert!(!is_listening_event("plain dev log line"));
  }

  #[cfg(debug_assertions)]
  #[test]
  fn mcp_command_keeps_the_token_off_argv() {
    let cmd = mcp_command(4923).unwrap();
    let args: Vec<String> = cmd
      .get_args()
      .map(|a| a.to_string_lossy().into_owned())
      .collect();
    assert!(args.contains(&"--token-stdin".to_string()));
    assert!(!args.iter().any(|a| a == "--token"));
  }

  #[test]
  fn design_request_id_extracts_the_id() {
    assert_eq!(
      design_request_id(r#"{"zplabEvent":"designRequest","id":7}"#),
      Some(7)
    );
    assert_eq!(design_request_id(r#"{"zplabEvent":"designRequest"}"#), None);
    assert_eq!(
      design_request_id(r#"{"zplabEvent":"openDraft","id":7}"#),
      None
    );
    assert_eq!(design_request_id("plain dev log line"), None);
  }

  #[test]
  fn wait_until_ready_succeeds_on_signal() {
    rt().block_on(async {
      let (tx, rx) = oneshot::channel();
      tx.send(()).unwrap();
      assert!(wait_until_ready(rx).await.is_ok());
    });
  }

  #[test]
  fn wait_until_ready_reports_exit_when_sender_dropped() {
    rt().block_on(async {
      // Sender dropped without a value = child's stdout closed = child gone.
      let (tx, rx) = oneshot::channel::<()>();
      drop(tx);
      let err = wait_until_ready(rx).await.unwrap_err();
      assert_eq!(err, "mcp server exited during startup (port in use?)");
    });
  }

  #[test]
  fn wait_until_ready_times_out_when_never_signaled() {
    // Paused clock: the debug READY_TIMEOUT is 30s of wall time otherwise.
    let rt = tokio::runtime::Builder::new_current_thread()
      .enable_all()
      .start_paused(true)
      .build()
      .unwrap();
    rt.block_on(async {
      // Hold the sender so it neither signals nor drops: only the timeout fires.
      let (_tx, rx) = oneshot::channel::<()>();
      let err = wait_until_ready(rx).await.unwrap_err();
      assert_eq!(err, "mcp server did not start within timeout");
    });
  }

  #[test]
  fn a_held_start_lock_is_what_status_reports_as_starting() {
    rt().block_on(async {
      let state = McpState::default();
      let held = state.start_lock.lock().await;
      assert!(state.start_lock.try_lock().is_err());
      drop(held);
      assert!(state.start_lock.try_lock().is_ok());
    });
  }
}

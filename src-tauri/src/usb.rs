// Direct USB transport for label printers. Linux writes the kernel usblp char
// device; macOS drives the printer interface via IOKit (nusb), which also gives
// a read channel for bidirectional queries (^HY preview). Windows has neither.

/// One USB printer for the picker. `id` is stable across replug (by serial, or
/// by a port-stable fallback when the device has no serial); the caller
/// round-trips it back to send.
#[derive(serde::Serialize)]
pub struct UsbPrinter {
  pub id: String,
  pub name: String,
  pub vendor_id: String, // lowercase hex, so comparisons need no folding
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
impl UsbPrinter {
  /// `serial` must be non-empty (callers fall back to a port-stable id) so
  /// identical models can't collide on "vid:pid:".
  fn new(
    vendor_id: String,
    product_id: &str,
    serial: &str,
    manufacturer: &str,
    product: &str,
  ) -> Self {
    let name = format!("{manufacturer} {product}").trim().to_string();
    Self {
      id: format!("{vendor_id}:{product_id}:{serial}"),
      name,
      vendor_id,
    }
  }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
const ZEBRA_VENDOR_ID: &str = "0a5f";

// The printer may consume slowly while storing a ~DY download, so far above
// the TCP socket timeout.
#[cfg(any(target_os = "linux", target_os = "macos"))]
const SEND_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// Zebra vendor first, then by name, so the label printer beats an office one.
#[cfg(any(target_os = "linux", target_os = "macos"))]
fn zebra_first(a: &UsbPrinter, b: &UsbPrinter) -> std::cmp::Ordering {
  (a.vendor_id != ZEBRA_VENDOR_ID, &a.name).cmp(&(b.vendor_id != ZEBRA_VENDOR_ID, &b.name))
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[derive(Debug, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum UsbSendResult {
  Sent,
  /// Linux only: the udev uaccess rule has not applied yet.
  #[cfg(target_os = "linux")]
  PermissionDenied,
  NotFound,
}

/// Serialized like TcpQueryResult; only the Data payload shape is shared (the
/// USB path has no refused/unreachable, and a TCP path has no not_found).
#[cfg(any(target_os = "linux", target_os = "macos"))]
#[derive(Debug, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum UsbQueryResult {
  Data {
    body: String,
  },
  /// Linux only: the udev uaccess rule has not applied yet.
  #[cfg(target_os = "linux")]
  PermissionDenied,
  NotFound,
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
impl UsbQueryResult {
  /// ~DY payloads are ASCII (ZB64); lossy keeps any stray control bytes benign.
  fn from_reply(body: Vec<u8>) -> Self {
    Self::Data {
      body: String::from_utf8_lossy(&body).into_owned(),
    }
  }
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
#[tauri::command]
pub async fn list_usb_printers() -> Result<Vec<UsbPrinter>, String> {
  Ok(Vec::new())
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
#[tauri::command]
pub async fn send_zpl_usb(_device: String, _zpl: String) -> Result<(), String> {
  Err("USB transport is not supported on this platform".to_string())
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
#[tauri::command]
pub async fn query_zpl_usb(_device: String, _zpl: String) -> Result<(), String> {
  Err("USB query is not supported on this platform".to_string())
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub async fn setup_usb_access() -> Result<(), String> {
  Err("USB setup is Linux only".to_string())
}

#[cfg(target_os = "macos")]
mod macos {
  use super::{zebra_first, UsbPrinter, UsbQueryResult, UsbSendResult, SEND_TIMEOUT};
  use nusb::descriptors::TransferType;
  use nusb::transfer::{Bulk, Direction, In, Out};
  use nusb::{DeviceInfo, Interface};
  use tokio::io::AsyncWriteExt;
  use tokio::time::timeout;

  /// USB base class 07: printer.
  const PRINTER_CLASS: u8 = 7;
  // nusb splits larger payloads across transfers, so this only sizes the buffer.
  const TRANSFER_SIZE: usize = 64 * 1024;

  fn printer_interface(info: &DeviceInfo) -> Option<u8> {
    info
      .interfaces()
      .find(|i| i.class() == PRINTER_CLASS)
      .map(|i| i.interface_number())
  }

  fn to_printer(info: &DeviceInfo) -> UsbPrinter {
    // No serial: the IOKit location id is stable per physical port (mirrors
    // the Linux sysfs-path fallback).
    let serial = info
      .serial_number()
      .filter(|s| !s.is_empty())
      .map(str::to_string)
      .unwrap_or_else(|| format!("loc:{:08x}", info.location_id()));
    UsbPrinter::new(
      format!("{:04x}", info.vendor_id()),
      &format!("{:04x}", info.product_id()),
      &serial,
      info.manufacturer_string().unwrap_or_default(),
      info.product_string().unwrap_or_default(),
    )
  }

  pub(super) async fn list() -> Result<Vec<UsbPrinter>, String> {
    let devices = nusb::list_devices().await.map_err(|e| e.to_string())?;
    let mut out: Vec<UsbPrinter> = devices
      .filter(|d| printer_interface(d).is_some())
      .map(|d| to_printer(&d))
      .collect();
    out.sort_by(zebra_first);
    Ok(out)
  }

  // The id is resolved fresh against the current device list, never trusted
  // from the caller; None means the printer was unplugged.
  async fn resolve(id: &str) -> Result<Option<(DeviceInfo, u8)>, String> {
    let mut devices = nusb::list_devices().await.map_err(|e| e.to_string())?;
    Ok(devices.find_map(|d| {
      let interface = printer_interface(&d)?;
      (to_printer(&d).id == id).then_some((d, interface))
    }))
  }

  async fn claim(info: &DeviceInfo, interface: u8) -> Result<Interface, String> {
    let device = info.open().await.map_err(|e| e.to_string())?;
    // Fails with "exclusive access" while CUPS is mid-job on the same printer.
    device
      .claim_interface(interface)
      .await
      .map_err(|e| e.to_string())
  }

  fn bulk_endpoint(interface: &Interface, direction: Direction) -> Option<u8> {
    interface.descriptor()?.endpoints().find_map(|e| {
      (e.transfer_type() == TransferType::Bulk && e.direction() == direction).then(|| e.address())
    })
  }

  async fn write_zpl(interface: &Interface, zpl: &[u8]) -> Result<(), String> {
    let out = bulk_endpoint(interface, Direction::Out)
      .ok_or_else(|| "printer has no bulk-out endpoint".to_string())?;
    let mut writer = interface
      .endpoint::<Bulk, Out>(out)
      .map_err(|e| e.to_string())?
      .writer(TRANSFER_SIZE);
    timeout(SEND_TIMEOUT, async {
      writer.write_all(zpl).await?;
      // flush_end (not flush) terminates with a short/zero-length packet, so a
      // payload that is an exact multiple of the endpoint max packet size is
      // still marked complete instead of leaving the printer waiting for more.
      writer.flush_end_async().await
    })
    .await
    .map_err(|_| "write timed out".to_string())?
    .map_err(|e| e.to_string())
  }

  pub(super) async fn send(device: &str, zpl: &[u8]) -> Result<UsbSendResult, String> {
    let Some((info, interface)) = resolve(device).await? else {
      return Ok(UsbSendResult::NotFound);
    };
    let interface = claim(&info, interface).await?;
    write_zpl(&interface, zpl).await?;
    Ok(UsbSendResult::Sent)
  }

  pub(super) async fn query(device: &str, zpl: &[u8]) -> Result<UsbQueryResult, String> {
    let Some((info, interface)) = resolve(device).await? else {
      return Ok(UsbQueryResult::NotFound);
    };
    let interface = claim(&info, interface).await?;
    // Probe the read channel before sending: a unidirectional interface can't
    // answer, and the job must not print as a side effect of a failed preview.
    let input = bulk_endpoint(&interface, Direction::In)
      .ok_or_else(|| "printer interface has no read-back endpoint".to_string())?;
    let mut reader = interface
      .endpoint::<Bulk, In>(input)
      .map_err(|e| e.to_string())?
      .reader(TRANSFER_SIZE);
    write_zpl(&interface, zpl).await?;
    // The short packet ends the reply immediately in the common case; the
    // idle gap inside read_reply is the fallback for firmware that omits it.
    let mut short = reader.until_short_packet();
    let body = crate::transport::read_reply(&mut short).await?;
    Ok(UsbQueryResult::from_reply(body))
  }
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn list_usb_printers() -> Result<Vec<UsbPrinter>, String> {
  macos::list().await
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn send_zpl_usb(device: String, zpl: String) -> Result<UsbSendResult, String> {
  crate::transport::check_payload(zpl.len())?;
  macos::send(&device, zpl.as_bytes()).await
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn query_zpl_usb(device: String, zpl: String) -> Result<UsbQueryResult, String> {
  crate::transport::check_payload(zpl.len())?;
  macos::query(&device, zpl.as_bytes()).await
}

#[cfg(target_os = "linux")]
use crate::transport::{blocking, check_payload};
#[cfg(target_os = "linux")]
use std::path::{Path, PathBuf};

// Reads one sysfs attribute, trimmed. Missing, unreadable, or empty becomes
// None so an empty `serial` file falls back to the path id instead of yielding
// a colliding "vid:pid:" that would route to the wrong printer.
#[cfg(target_os = "linux")]
fn attr(dir: &Path, name: &str) -> Option<String> {
  std::fs::read_to_string(dir.join(name))
    .ok()
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty())
}

#[cfg(target_os = "linux")]
fn parse_printer(usb_dev_dir: &Path) -> Option<UsbPrinter> {
  let vendor_id = attr(usb_dev_dir, "idVendor")?;
  let product_id = attr(usb_dev_dir, "idProduct")?;
  // No serial: derive a port-stable id from the canonical sysfs device path.
  // canonicalize resolves the volatile lpN symlink to /sys/devices/.../<bus-port>,
  // so the id survives replug into the same port instead of embedding lpN.
  let serial = attr(usb_dev_dir, "serial").unwrap_or_else(|| {
    std::fs::canonicalize(usb_dev_dir)
      .unwrap_or_else(|_| usb_dev_dir.to_path_buf())
      .to_string_lossy()
      .into_owned()
  });
  let manufacturer = attr(usb_dev_dir, "manufacturer").unwrap_or_default();
  let product = attr(usb_dev_dir, "product").unwrap_or_default();
  Some(UsbPrinter::new(
    vendor_id,
    &product_id,
    &serial,
    &manufacturer,
    &product,
  ))
}

// Each /sys/class/usbmisc/lpN has a "device" symlink to the USB interface,
// whose parent is the USB device carrying idVendor/idProduct/serial.
#[cfg(target_os = "linux")]
fn enumerate(usbmisc_root: &Path) -> Vec<(String, UsbPrinter)> {
  let Ok(entries) = std::fs::read_dir(usbmisc_root) else {
    return Vec::new();
  };
  let mut out: Vec<(String, UsbPrinter)> = entries
    .flatten()
    .filter_map(|entry| {
      let node = entry.file_name().to_string_lossy().into_owned();
      if !node.starts_with("lp") {
        return None;
      }
      // Attributes sit on the interface's parent device; fixtures flatten them
      // under "device", so probe there first, then the parent.
      let base = entry.path().join("device");
      let dev_dir = if base.join("idVendor").exists() {
        base
      } else {
        base.join("..")
      };
      parse_printer(&dev_dir).map(|p| (node, p))
    })
    .collect();
  out.sort_by(|a, b| zebra_first(&a.1, &b.1));
  out
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn list_usb_printers() -> Result<Vec<UsbPrinter>, String> {
  blocking(|| {
    enumerate(Path::new("/sys/class/usbmisc"))
      .into_iter()
      .map(|(_, p)| p)
      .collect::<Vec<_>>()
  })
  .await
}

// The two sysfs/dev roots the send and query paths both resolve through.
#[cfg(target_os = "linux")]
const USBMISC_ROOT: &str = "/sys/class/usbmisc";
#[cfg(target_os = "linux")]
const DEV_USB_ROOT: &str = "/dev/usb";

// Map the stable id back to the current char device. lpN numbering can change
// across replug, so it is resolved fresh here, never trusted from the caller.
#[cfg(target_os = "linux")]
fn resolve_node(usbmisc_root: &Path, dev_root: &Path, id: &str) -> Result<PathBuf, UsbSendResult> {
  let node = enumerate(usbmisc_root)
    .into_iter()
    .find(|(_, p)| p.id == id)
    .map(|(node, _)| node)
    .ok_or(UsbSendResult::NotFound)?;
  Ok(dev_root.join(node))
}

// EACCES: the udev uaccess rule has not applied yet. ENOENT: the node vanished
// (replug). Anything else (e.g. EBUSY while CUPS holds it) is a genuine error.
#[cfg(target_os = "linux")]
fn classify_lp_io_err<T>(e: std::io::Error, on_perm: T, on_missing: T) -> Result<T, String> {
  match e.kind() {
    std::io::ErrorKind::PermissionDenied => Ok(on_perm),
    std::io::ErrorKind::NotFound => Ok(on_missing),
    _ => Err(e.to_string()),
  }
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn send_zpl_usb(device: String, zpl: String) -> Result<UsbSendResult, String> {
  check_payload(zpl.len())?;
  blocking(move || {
    let path = match resolve_node(Path::new(USBMISC_ROOT), Path::new(DEV_USB_ROOT), &device) {
      Ok(p) => p,
      Err(r) => return Ok(r),
    };
    use std::io::Write;
    let result = std::fs::OpenOptions::new()
      .write(true)
      .open(&path)
      .and_then(|mut f| f.write_all(zpl.as_bytes()));
    match result {
      Ok(()) => Ok(UsbSendResult::Sent),
      Err(e) => classify_lp_io_err(e, UsbSendResult::PermissionDenied, UsbSendResult::NotFound),
    }
  })
  .await?
}

// One source of truth for the rule text: the packaged file is embedded so the
// pkexec path and the package payload never drift.
#[cfg(target_os = "linux")]
const UDEV_RULE: &str = include_str!("../packaging/udev/70-zplab.rules");

#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn setup_usb_access() -> Result<(), String> {
  // No pkexec in the sandbox and the host /etc is out of reach.
  if crate::package::is_flatpak() {
    return Err("flatpak".to_string());
  }
  // Used by AppImage (no installer) and as a repair path. Writes to
  // /etc/udev/rules.d (writable on immutable distros, the right place for a
  // runtime rule); set -e so a failed step surfaces instead of being swallowed.
  let script = format!(
    "set -e\ninstall -Dm644 /dev/stdin /etc/udev/rules.d/70-zplab.rules <<'ZEBRA_UDEV_RULE_EOF'\n{UDEV_RULE}\nZEBRA_UDEV_RULE_EOF\nrm -f /usr/lib/udev/rules.d/99-zebraprintlab.rules /etc/udev/rules.d/99-zebraprintlab.rules /etc/udev/rules.d/70-zebraprintlab.rules /usr/lib/udev/rules.d/70-zebraprintlab.rules || true\nudevadm control --reload-rules || true\nudevadm trigger --subsystem-match=usbmisc --subsystem-match=usb || true"
  );
  blocking(move || {
    let status = std::process::Command::new("pkexec")
      .args(["sh", "-c", &script])
      .status()
      .map_err(|e| e.to_string())?;
    if status.success() {
      Ok(())
    } else {
      match status.code() {
        // pkexec: 126 = auth dialog dismissed, 127 = not authorized.
        Some(126) | Some(127) => Err("setup cancelled".to_string()),
        _ => Err("setup failed".to_string()),
      }
    }
  })
  .await?
}

// AsyncRead/AsyncWrite over the non-blocking usblp fd, so the shared
// transport::read_reply loop drives the char device like a socket.
#[cfg(target_os = "linux")]
mod lp_io {
  use std::fs::File;
  use std::io::{Read, Write};
  use std::pin::Pin;
  use std::task::{Context, Poll};
  use tokio::io::unix::AsyncFd;
  use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

  pub(super) struct LpDevice(AsyncFd<File>);

  impl LpDevice {
    pub(super) fn new(file: File) -> std::io::Result<Self> {
      Ok(Self(AsyncFd::new(file)?))
    }
  }

  impl AsyncRead for LpDevice {
    fn poll_read(
      self: Pin<&mut Self>,
      cx: &mut Context<'_>,
      buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
      let this = self.get_mut();
      loop {
        let mut guard = match this.0.poll_read_ready_mut(cx) {
          Poll::Ready(r) => r?,
          Poll::Pending => return Poll::Pending,
        };
        match guard.try_io(|inner| inner.get_mut().read(buf.initialize_unfilled())) {
          Ok(Ok(n)) => {
            buf.advance(n);
            return Poll::Ready(Ok(()));
          }
          Ok(Err(e)) => return Poll::Ready(Err(e)),
          Err(_would_block) => continue,
        }
      }
    }
  }

  impl AsyncWrite for LpDevice {
    fn poll_write(
      self: Pin<&mut Self>,
      cx: &mut Context<'_>,
      buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
      let this = self.get_mut();
      loop {
        let mut guard = match this.0.poll_write_ready_mut(cx) {
          Poll::Ready(r) => r?,
          Poll::Pending => return Poll::Pending,
        };
        match guard.try_io(|inner| inner.get_mut().write(buf)) {
          Ok(result) => return Poll::Ready(result),
          Err(_would_block) => continue,
        }
      }
    }

    // usblp has no userspace buffer to flush and no half-close.
    fn poll_flush(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
      Poll::Ready(Ok(()))
    }

    fn poll_shutdown(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
      Poll::Ready(Ok(()))
    }
  }
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn query_zpl_usb(device: String, zpl: String) -> Result<UsbQueryResult, String> {
  check_payload(zpl.len())?;
  // Resolve (sysfs walk) and open (a char-device open can sleep) off the runtime
  // like the send path; only the read-back needs it.
  let opened = blocking(
    move || -> Result<Result<std::fs::File, UsbQueryResult>, String> {
      let path = match resolve_node(Path::new(USBMISC_ROOT), Path::new(DEV_USB_ROOT), &device) {
        Ok(p) => p,
        Err(_) => return Ok(Err(UsbQueryResult::NotFound)),
      };
      use std::os::unix::fs::OpenOptionsExt;
      match std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(libc::O_NONBLOCK)
        .open(&path)
      {
        Ok(f) => Ok(Ok(f)),
        Err(e) => classify_lp_io_err(
          e,
          UsbQueryResult::PermissionDenied,
          UsbQueryResult::NotFound,
        )
        .map(Err),
      }
    },
  )
  .await??;
  let file = match opened {
    Ok(f) => f,
    Err(result) => return Ok(result),
  };
  let mut dev = lp_io::LpDevice::new(file).map_err(|e| e.to_string())?;
  use tokio::io::AsyncWriteExt;
  tokio::time::timeout(SEND_TIMEOUT, dev.write_all(zpl.as_bytes()))
    .await
    .map_err(|_| "write timed out".to_string())?
    .map_err(|e| e.to_string())?;
  // No short-packet boundary on the char device; the idle gap inside
  // read_reply delimits the reply instead.
  let body = crate::transport::read_reply(&mut dev).await?;
  Ok(UsbQueryResult::from_reply(body))
}

#[cfg(all(test, any(target_os = "linux", target_os = "macos")))]
mod tests {
  use super::*;

  // Pins the wire formats the frontend parses.
  #[test]
  fn send_result_serializes_with_kind_tag() {
    let json = serde_json::to_string(&UsbSendResult::NotFound).unwrap();
    assert_eq!(json, r#"{"kind":"not_found"}"#);
  }

  #[test]
  fn query_result_serializes_with_kind_tag() {
    let json = serde_json::to_string(&UsbQueryResult::Data {
      body: "~DY".to_string(),
    })
    .unwrap();
    assert_eq!(json, r#"{"kind":"data","body":"~DY"}"#);
    let json = serde_json::to_string(&UsbQueryResult::NotFound).unwrap();
    assert_eq!(json, r#"{"kind":"not_found"}"#);
  }

  #[test]
  fn printer_ctor_builds_id_and_trims_name() {
    let p = UsbPrinter::new(
      "0a5f".to_string(),
      "0166",
      "D4J260700032",
      "Zebra Technologies",
      "ZTC ZD230-203dpi ZPL",
    );
    assert_eq!(p.id, "0a5f:0166:D4J260700032");
    assert_eq!(p.vendor_id, "0a5f");
    assert_eq!(p.name, "Zebra Technologies ZTC ZD230-203dpi ZPL");
    // Missing strings must not leave stray whitespace in the name.
    let anon = UsbPrinter::new("0a5f".to_string(), "0166", "S", "", "ZD230");
    assert_eq!(anon.name, "ZD230");
  }

  #[test]
  fn zebra_sorts_before_other_vendors() {
    let mut printers = [
      UsbPrinter::new("03f0".to_string(), "0512", "S1", "HP", "LaserJet"),
      UsbPrinter::new("0a5f".to_string(), "0166", "S2", "Zebra", "ZD230"),
    ];
    printers.sort_by(zebra_first);
    assert_eq!(printers[0].vendor_id, "0a5f");
  }
}

// Linux usblp paths (enumerate/parse/resolve); every case builds sysfs fixtures.
#[cfg(all(test, target_os = "linux"))]
mod linux_tests {
  use super::*;

  #[test]
  fn permission_denied_serializes_with_kind_tag() {
    let json = serde_json::to_string(&UsbSendResult::PermissionDenied).unwrap();
    assert_eq!(json, r#"{"kind":"permission_denied"}"#);
  }

  #[test]
  fn query_permission_denied_serializes_with_kind_tag() {
    let json = serde_json::to_string(&UsbQueryResult::PermissionDenied).unwrap();
    assert_eq!(json, r#"{"kind":"permission_denied"}"#);
  }

  // A pipe stands in for the usblp node: both deliver readiness via poll.
  #[test]
  fn lp_device_reply_ends_on_idle_gap() {
    use std::io::Write;
    use std::os::fd::FromRawFd;
    let mut fds = [0i32; 2];
    assert_eq!(
      unsafe { libc::pipe2(fds.as_mut_ptr(), libc::O_NONBLOCK) },
      0
    );
    let (read_end, mut write_end) = unsafe {
      (
        std::fs::File::from_raw_fd(fds[0]),
        std::fs::File::from_raw_fd(fds[1]),
      )
    };
    // Written before the reader starts, so the paused clock's auto-advance
    // cannot outrun fd readiness.
    write_end.write_all(b"~HIreply").unwrap();
    let rt = tokio::runtime::Builder::new_current_thread()
      .enable_all()
      .start_paused(true)
      .build()
      .unwrap();
    rt.block_on(async {
      let mut dev = lp_io::LpDevice::new(read_end).unwrap();
      let body = crate::transport::read_reply(&mut dev).await.unwrap();
      assert_eq!(body, b"~HIreply");
    });
  }

  #[test]
  fn enumerates_and_sorts_zebra_first() {
    use std::fs;
    let root = std::env::temp_dir().join(format!("zpl_usbmisc_{}", std::process::id()));
    // Two usbmisc entries: lp0 generic, lp1 Zebra, each with a "device" dir of
    // USB attributes.
    for (node, vid, pid, ser, man, prod) in [
      ("lp0", "03f0", "0512", "S1", "HP", "LaserJet"),
      ("lp1", "0a5f", "0166", "S2", "Zebra Technologies", "ZD230"),
    ] {
      let dev = root.join(node).join("device");
      fs::create_dir_all(&dev).unwrap();
      for (f, v) in [
        ("idVendor", vid),
        ("idProduct", pid),
        ("serial", ser),
        ("manufacturer", man),
        ("product", prod),
      ] {
        fs::write(dev.join(f), format!("{v}\n")).unwrap();
      }
    }
    let out = enumerate(&root);
    assert_eq!(out.len(), 2);
    assert_eq!(out[0].1.vendor_id, "0a5f");
    assert_eq!(out[0].0, "lp1");
    fs::remove_dir_all(&root).ok();
  }

  #[test]
  fn resolve_node_maps_missing_device_to_not_found() {
    use std::fs;
    let root = std::env::temp_dir().join(format!("zpl_resolve_{}", std::process::id()));
    let dev = root.join("lp0").join("device");
    fs::create_dir_all(&dev).unwrap();
    for (f, v) in [
      ("idVendor", "0a5f"),
      ("idProduct", "0166"),
      ("serial", "S2"),
    ] {
      fs::write(dev.join(f), format!("{v}\n")).unwrap();
    }
    let dev_root = root.join("dev");
    fs::create_dir_all(&dev_root).unwrap();
    let ok = resolve_node(&root, &dev_root, "0a5f:0166:S2").unwrap();
    assert_eq!(ok, dev_root.join("lp0"));
    let miss = resolve_node(&root, &dev_root, "dead:beef:X").unwrap_err();
    assert!(matches!(miss, UsbSendResult::NotFound));
    fs::remove_dir_all(&root).ok();
  }

  #[test]
  fn enumerates_via_device_parent_and_serialless_id() {
    use std::fs;
    let root = std::env::temp_dir().join(format!("zpl_parent_{}", std::process::id()));
    // Real sysfs: lpN/device is the interface (no idVendor); the device one
    // level up carries the attributes. Also omit serial.
    let node = root.join("lp0");
    fs::create_dir_all(node.join("device")).unwrap();
    for (f, v) in [
      ("idVendor", "0a5f"),
      ("idProduct", "0166"),
      ("manufacturer", "Zebra Technologies"),
      ("product", "ZD230"),
    ] {
      fs::write(node.join(f), format!("{v}\n")).unwrap();
    }
    let out = enumerate(&root);
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].1.vendor_id, "0a5f");
    // No serial: id falls back to the sysfs device path.
    assert!(out[0].1.id.starts_with("0a5f:0166:"));
    assert!(out[0].1.id.contains("lp0"));
    fs::remove_dir_all(&root).ok();
  }

  #[test]
  fn empty_serial_falls_back_to_path_not_colliding_id() {
    use std::fs;
    let dir = std::env::temp_dir().join(format!("zpl_emptyser_{}", std::process::id()));
    let dev = dir.join("1-6");
    fs::create_dir_all(&dev).unwrap();
    // A present-but-empty serial file must not yield "vid:pid:" (which would
    // collide across identical models); it falls back to the unique path.
    for (f, v) in [
      ("idVendor", "0a5f"),
      ("idProduct", "0166"),
      ("serial", "  \n"),
    ] {
      fs::write(dev.join(f), v).unwrap();
    }
    let p = parse_printer(&dev).unwrap();
    assert_ne!(p.id, "0a5f:0166:");
    assert!(p.id.starts_with("0a5f:0166:"));
    assert!(p.id.contains("1-6"));
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn parses_printer_from_sysfs_dir() {
    use std::fs;
    let dir = std::env::temp_dir().join(format!("zpl_sysfs_{}", std::process::id()));
    let dev = dir.join("1-6");
    fs::create_dir_all(&dev).unwrap();
    for (f, v) in [
      ("idVendor", "0a5f"),
      ("idProduct", "0166"),
      ("serial", "D4J260700032"),
      ("manufacturer", "Zebra Technologies"),
      ("product", "ZTC ZD230-203dpi ZPL"),
    ] {
      fs::write(dev.join(f), format!("{v}\n")).unwrap();
    }
    let p = parse_printer(&dev).unwrap();
    assert_eq!(p.id, "0a5f:0166:D4J260700032");
    assert_eq!(p.vendor_id, "0a5f");
    assert_eq!(p.name, "Zebra Technologies ZTC ZD230-203dpi ZPL");
    fs::remove_dir_all(&dir).ok();
  }
}

// Talks to real hardware; excluded from the default run. With the ZD230
// attached: cd src-tauri && cargo test -- --ignored
#[cfg(all(test, target_os = "macos"))]
mod hardware_tests {
  #[test]
  #[ignore = "needs a USB printer attached"]
  fn lists_and_queries_the_attached_printer() {
    let rt = tokio::runtime::Builder::new_current_thread()
      .enable_all()
      .build()
      .unwrap();
    rt.block_on(async {
      let printers = super::macos::list().await.unwrap();
      let printer = printers.first().expect("a USB printer should be attached");
      assert!(!printer.id.is_empty());
      // ~HI answers with the model string, e.g. "ZD230-203dpi,V84.20.18Z,...".
      let res = super::macos::query(&printer.id, b"~HI").await.unwrap();
      match res {
        super::UsbQueryResult::Data { body } => {
          assert!(!body.is_empty(), "expected a ~HI reply");
          println!("~HI reply: {body}");
        }
        other => panic!("expected data, got {other:?}"),
      }
      // Plain send path: an empty format is accepted without feeding a label.
      let res = super::macos::send(&printer.id, b"^XA^XZ").await.unwrap();
      assert!(matches!(res, super::UsbSendResult::Sent));
      // The preview flow the frontend runs: store the rendered format without
      // printing (^IS..,N), then upload its bitmap (^HY answers with ~DY).
      let preview = b"^XA^FO30,30^A0N,40,40^FDUSB Preview^FS^ISR:PRE.GRF,N^XZ\n^XA^HYR:PRE.GRF^XZ";
      let res = super::macos::query(&printer.id, preview).await.unwrap();
      match res {
        super::UsbQueryResult::Data { body } => {
          assert!(body.contains("~DY"), "expected a ~DY graphic upload");
          println!("preview reply: {} bytes", body.len());
        }
        other => panic!("expected data, got {other:?}"),
      }
    });
  }
}

// Talks to real hardware; excluded from the default run. With the ZD230
// attached: cd src-tauri && cargo test -- --ignored
#[cfg(all(test, target_os = "linux"))]
mod linux_hardware_tests {
  #[test]
  #[ignore = "needs a USB printer attached"]
  fn queries_the_attached_printer() {
    let rt = tokio::runtime::Builder::new_current_thread()
      .enable_all()
      .build()
      .unwrap();
    rt.block_on(async {
      let printers = super::list_usb_printers().await.unwrap();
      let printer = printers.first().expect("a USB printer should be attached");
      // ~HI answers with the model string, e.g. "ZD230-203dpi,V84.20.18Z,...".
      let res = super::query_zpl_usb(printer.id.clone(), "~HI".to_string())
        .await
        .unwrap();
      match res {
        super::UsbQueryResult::Data { body } => {
          assert!(!body.is_empty(), "expected a ~HI reply");
          println!("~HI reply: {body}");
        }
        other => panic!("expected data, got {other:?}"),
      }
      // The preview flow the frontend runs: store the rendered format without
      // printing (^IS..,N), then upload its bitmap (^HY answers with ~DY).
      let preview = "^XA^FO30,30^A0N,40,40^FDUSB Preview^FS^ISR:PRE.GRF,N^XZ\n^XA^HYR:PRE.GRF^XZ";
      let res = super::query_zpl_usb(printer.id.clone(), preview.to_string())
        .await
        .unwrap();
      match res {
        super::UsbQueryResult::Data { body } => {
          assert!(body.contains("~DY"), "expected a ~DY graphic upload");
          println!("preview reply: {} bytes", body.len());
        }
        other => panic!("expected data, got {other:?}"),
      }
      // Multi-packet read: dense varied text resists Z64, so this ~DY spans many
      // USB packets. Two identical replies past the CRC prove read_reply never
      // takes a mid-stream boundary for the end (usblp signals no-more-data with
      // EAGAIN, not a zero-length read). Sequential: usblp is single-opener.
      let mut big = String::from("^XA^PW812^LL1218");
      let mut y = 0;
      while y < 1180 {
        big.push_str(&format!(
          "^FO5,{y}^A0N,18,18^FD{y} the quick brown fox 0123456789 ABCDEFGHIJKLM^FS"
        ));
        y += 20;
      }
      big.push_str("^ISR:PRE.GRF,N^XZ\n^XA^HYR:PRE.GRF^XZ");
      let run = || super::query_zpl_usb(printer.id.clone(), big.clone());
      match (run().await.unwrap(), run().await.unwrap()) {
        (super::UsbQueryResult::Data { body: a }, super::UsbQueryResult::Data { body: b }) => {
          println!("multi-packet reply: {} bytes", a.len());
          assert!(
            a.len() > 4000,
            "expected a multi-packet reply, got {}",
            a.len()
          );
          assert_eq!(a, b, "reply differed across runs (truncation)");
          // A complete Z64 stream ends with ":crc16" (4 hex digits); a
          // truncated reply would not.
          assert!(a.contains(":Z64:"), "expected a Z64 payload");
          let crc = a.trim_end().rsplit(':').next().unwrap_or_default();
          assert!(
            crc.len() == 4 && crc.bytes().all(|c| c.is_ascii_hexdigit()),
            "reply did not end with a Z64 CRC: {crc:?}"
          );
        }
        other => panic!("expected data twice, got {other:?}"),
      }
    });
  }
}

#[cfg(windows)]
pub fn is_packaged() -> bool {
  use windows_sys::Win32::Foundation::ERROR_INSUFFICIENT_BUFFER;
  use windows_sys::Win32::Storage::Packaging::Appx::GetCurrentPackageFamilyName;

  let mut len = 0u32;
  // SAFETY: a zero length with a null buffer only queries the required size.
  // Packaged processes get ERROR_INSUFFICIENT_BUFFER, others
  // APPMODEL_ERROR_NO_PACKAGE.
  unsafe {
    GetCurrentPackageFamilyName(&mut len, std::ptr::null_mut()) == ERROR_INSUFFICIENT_BUFFER
  }
}

#[cfg(not(windows))]
pub fn is_packaged() -> bool {
  false
}

/// The file marks every sandbox, even one started with a cleared environment.
pub fn is_flatpak() -> bool {
  cfg!(target_os = "linux") && std::path::Path::new("/.flatpak-info").exists()
}

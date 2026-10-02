use tauri::{AppHandle, Config};

/// Tauri's Windows updater runs the NSIS setup, which cannot replace a packaged install.
/// The Store variant also ships without plugins.updater.
pub fn self_update_enabled(config: &Config) -> bool {
  config.plugins.0.contains_key("updater") && !crate::package::is_packaged()
}

#[tauri::command]
pub fn app_update_supported(app: AppHandle) -> bool {
  self_update_enabled(app.config())
}

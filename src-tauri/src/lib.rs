mod credentials;
mod dataset;
mod db;
mod excel;
mod mcp;
mod preview;
mod print;
mod scope;
mod transport;
mod usb;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default()
    .manage(mcp::McpState::default())
    // In setup, not manage(): loading the persisted grants needs the app paths.
    .setup(|app| {
      let grants = scope::PathGrants::load(app.handle());
      app.manage(grants);
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      print::send_zpl_tcp,
      print::query_zpl_tcp,
      print::list_printers,
      print::send_zpl_local,
      usb::list_usb_printers,
      usb::send_zpl_usb,
      usb::query_zpl_usb,
      usb::setup_usb_access,
      db::db_list_tables,
      db::db_fetch,
      db::db_set_password,
      excel::excel_list_sheets,
      excel::excel_fetch,
      scope::pick_sqlite_file,
      scope::pick_excel_file,
      scope::revoke_db_path,
      preview::fetch_labelary_preview,
      preview::preview_set_labelary_key,
      preview::preview_migrate_labelary_key,
      credentials::credential_get,
      credentials::credential_set,
      credentials::credential_delete,
      mcp::mcp_start,
      mcp::mcp_stop,
      mcp::mcp_status,
      mcp::mcp_listeners_ready,
      mcp::mcp_reply
    ]);
  // On the builder, not in setup(): config windows exist before the setup
  // closure runs, and window-state only restores/tracks via on_window_ready.
  #[cfg(desktop)]
  let builder = builder
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init());
  builder
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      // Kill the MCP child on exit so it never outlives the app window.
      if let tauri::RunEvent::Exit = event {
        app.state::<mcp::McpState>().kill();
      }
    });
}

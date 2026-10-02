import { invoke } from "@tauri-apps/api/core";

/** Whether this install can update itself through the in-app updater. */
export function appUpdateSupported(): Promise<boolean> {
  return invoke<boolean>("app_update_supported");
}

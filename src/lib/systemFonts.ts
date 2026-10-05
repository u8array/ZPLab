import { isDesktopShell } from "./platform";

/** Mirrors the Rust `SystemFont` DTO. */
export interface SystemFont {
  family: string;
  style: string;
  path: string;
  file_name: string;
  bytes: number;
  restricted: boolean;
  variable: boolean;
}

export async function listSystemFonts(): Promise<SystemFont[]> {
  if (!isDesktopShell) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SystemFont[]>("list_system_fonts");
}

/** Only a path the listing returned is served. */
export async function readSystemFont(path: string): Promise<Uint8Array> {
  if (!isDesktopShell) throw new Error("desktop only");
  const { invoke } = await import("@tauri-apps/api/core");
  return new Uint8Array(await invoke<ArrayBuffer>("read_system_font", { path }));
}

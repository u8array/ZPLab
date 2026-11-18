// Prevents an extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  // SAFETY: the program has started no thread yet.
  let cleared = unsafe { zplab_lib::clear_inherited_pg_env() };
  zplab_lib::run(cleared);
}

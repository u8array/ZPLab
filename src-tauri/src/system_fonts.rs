//! A path leaves this module only through the listing, and the read serves only what the listing named.
//! The name and OS/2 tables are parsed here instead of with ttf-parser, which is unmaintained under RUSTSEC-2026-0192.
use std::io::{Cursor, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;

use crate::transport::blocking;

/// The font cache's own cap, so the listing only offers rows the cache will take.
const MAX_FONT_BYTES: u64 = 4 * 1024 * 1024;

/// The scan opens every font file, so one session keeps its result.
#[derive(Default)]
pub struct SystemFonts {
  listing: Mutex<Option<Vec<SystemFont>>>,
}

impl SystemFonts {
  fn listed(&self) -> Result<Option<Vec<SystemFont>>, String> {
    Ok(self.listing.lock().map_err(|e| e.to_string())?.clone())
  }

  fn keep(&self, fonts: Vec<SystemFont>) -> Result<(), String> {
    *self.listing.lock().map_err(|e| e.to_string())? = Some(fonts);
    Ok(())
  }

  fn allows(&self, path: &str) -> Result<bool, String> {
    let listing = self.listing.lock().map_err(|e| e.to_string())?;
    Ok(allows(listing.as_deref().unwrap_or(&[]), path))
  }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct SystemFont {
  pub family: String,
  pub style: String,
  pub path: String,
  pub file_name: String,
  pub bytes: u64,
  pub restricted: bool,
  pub variable: bool,
}

#[tauri::command]
pub async fn list_system_fonts(
  state: tauri::State<'_, SystemFonts>,
) -> Result<Vec<SystemFont>, String> {
  if let Some(fonts) = state.listed()? {
    return Ok(fonts);
  }
  let fonts = blocking(scan).await?;
  state.keep(fonts.clone())?;
  Ok(fonts)
}

#[tauri::command]
pub async fn read_system_font(
  state: tauri::State<'_, SystemFonts>,
  path: String,
) -> Result<tauri::ipc::Response, String> {
  let allowed = state.allows(&path)?;
  let bytes = blocking(move || read_listed(allowed, &path)).await??;
  Ok(tauri::ipc::Response::new(bytes))
}

/// The listing keeps a restricted font for its row, but the license forbids serving its bytes.
fn allows(listed: &[SystemFont], path: &str) -> bool {
  listed.iter().any(|f| !f.restricted && f.path == path)
}

/// The file may have changed since the listing, so it is judged again.
fn read_listed(allowed: bool, path: &str) -> Result<Vec<u8>, String> {
  if !allowed {
    return Err("not listed".to_string());
  }
  let mut bytes = Vec::new();
  std::fs::File::open(path)
    .and_then(|f| f.take(MAX_FONT_BYTES + 1).read_to_end(&mut bytes))
    .map_err(|e| e.to_string())?;
  if bytes.len() as u64 > MAX_FONT_BYTES {
    return Err("too large".to_string());
  }
  match read_face(&mut Cursor::new(&bytes)) {
    Some(face) if !face.restricted => Ok(bytes),
    Some(_) => Err("restricted".to_string()),
    None => Err("not a font".to_string()),
  }
}

/// The printer takes one face per file, so collections stay out.
fn single_face_file(path: &Path) -> bool {
  matches!(
    path
      .extension()
      .and_then(|e| e.to_str())
      .map(|e| e.to_ascii_lowercase())
      .as_deref(),
    Some("ttf") | Some("otf") | Some("tte")
  )
}

fn font_dirs() -> Vec<PathBuf> {
  let home = || std::env::var_os("HOME").map(PathBuf::from);
  let mut dirs = Vec::new();
  if cfg!(target_os = "windows") {
    if let Some(root) = std::env::var_os("SYSTEMROOT") {
      dirs.push(PathBuf::from(root).join("Fonts"));
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
      dirs.push(PathBuf::from(local).join("Microsoft/Windows/Fonts"));
    }
  } else if cfg!(target_os = "macos") {
    dirs.extend(
      [
        "/Library/Fonts",
        "/System/Library/Fonts",
        "/Network/Library/Fonts",
      ]
      .map(PathBuf::from),
    );
    if let Some(home) = home() {
      dirs.push(home.join("Library/Fonts"));
    }
  } else {
    dirs.extend(["/usr/share/fonts", "/usr/local/share/fonts"].map(PathBuf::from));
    if let Some(home) = home() {
      dirs.push(home.join(".fonts"));
      dirs.push(home.join(".local/share/fonts"));
    }
  }
  dirs
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
  let Ok(entries) = std::fs::read_dir(dir) else {
    return;
  };
  for entry in entries.flatten() {
    let path = entry.path();
    // file_type does not follow links, so a symlink cycle cannot recurse forever.
    if entry.file_type().is_ok_and(|t| t.is_dir()) {
      walk(&path, out);
    } else if single_face_file(&path) {
      out.push(path);
    }
  }
}

fn scan() -> Vec<SystemFont> {
  let mut files = Vec::new();
  for dir in font_dirs() {
    walk(&dir, &mut files);
  }
  let mut out = Vec::new();
  for path in files {
    let Ok(mut file) = std::fs::File::open(&path) else {
      continue;
    };
    let Ok(meta) = file.metadata() else {
      continue;
    };
    if meta.len() > MAX_FONT_BYTES {
      continue;
    }
    let Some(face) = read_face(&mut file) else {
      continue;
    };
    out.push(SystemFont {
      family: face.family,
      style: face.style,
      path: path.to_string_lossy().into_owned(),
      file_name: path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default(),
      bytes: meta.len(),
      restricted: face.restricted,
      variable: face.variable,
    });
  }
  out.sort_by(|a, b| a.family.cmp(&b.family).then(a.style.cmp(&b.style)));
  out
}

struct Face {
  family: String,
  style: String,
  restricted: bool,
  variable: bool,
}

fn u16_at(b: &[u8], at: usize) -> Option<u16> {
  b.get(at..at + 2).map(|s| u16::from_be_bytes([s[0], s[1]]))
}

fn u32_at(b: &[u8], at: usize) -> Option<u32> {
  b.get(at..at + 4)
    .map(|s| u32::from_be_bytes([s[0], s[1], s[2], s[3]]))
}

struct Directory(Vec<u8>);

impl Directory {
  fn read<R: Read + Seek>(src: &mut R) -> Option<Self> {
    let mut head = [0u8; 12];
    src.read_exact(&mut head).ok()?;
    let version = &head[..4];
    if version != [0, 1, 0, 0] && version != b"OTTO" && version != b"true" {
      return None;
    }
    let entries = read_exact_vec(src, u16_at(&head, 4)? as u64 * 16)?;
    Some(Self(entries))
  }

  fn entry(&self, tag: &[u8; 4]) -> Option<(u64, u64)> {
    self.0.chunks_exact(16).find_map(|e| {
      if &e[..4] != tag {
        return None;
      }
      Some((u32_at(e, 8)? as u64, u32_at(e, 12)? as u64))
    })
  }

  fn table<R: Read + Seek>(&self, src: &mut R, tag: &[u8; 4]) -> Option<Vec<u8>> {
    let (offset, length) = self.entry(tag)?;
    src.seek(SeekFrom::Start(offset)).ok()?;
    read_exact_vec(src, length)
  }
}

/// Fails unless the whole length arrives, so a length the file declares never sizes an allocation.
fn read_exact_vec<R: Read>(src: &mut R, length: u64) -> Option<Vec<u8>> {
  let mut bytes = Vec::new();
  src.by_ref().take(length).read_to_end(&mut bytes).ok()?;
  (bytes.len() as u64 == length).then_some(bytes)
}

/// Unicode names win, Macintosh Roman is the fallback the oldest fonts carry.
fn name_string(name: &[u8], id: u16) -> Option<String> {
  let count = u16_at(name, 2)? as usize;
  let strings = u16_at(name, 4)? as usize;
  let mut mac = None;
  for i in 0..count {
    let rec = 6 + i * 12;
    // Records are fixed and sequential, so a short one ends the table.
    let Some(record) = name.get(rec..rec + 12) else {
      break;
    };
    if u16_at(record, 6)? != id {
      continue;
    }
    let platform = u16_at(record, 0)?;
    let encoding = u16_at(record, 2)?;
    let len = u16_at(record, 8)? as usize;
    let at = strings + u16_at(record, 10)? as usize;
    // One record pointing outside the table must not hide the others.
    let Some(data) = name.get(at..at + len) else {
      continue;
    };
    match (platform, encoding) {
      (3, 1) | (3, 10) | (0, _) => {
        let units: Vec<u16> = data
          .chunks_exact(2)
          .map(|c| u16::from_be_bytes([c[0], c[1]]))
          .collect();
        return Some(String::from_utf16_lossy(&units));
      }
      (1, 0) if mac.is_none() => mac = Some(data.iter().map(|&b| b as char).collect()),
      _ => {}
    }
  }
  mac
}

/// OS/2 fsType: bit 1 forbids any embedding, bit 9 allows bitmaps only, and ~DY sends outlines.
const FSTYPE_RESTRICTED: u16 = 0x0002;
const FSTYPE_BITMAP_ONLY: u16 = 0x0200;

fn read_face<R: Read + Seek>(src: &mut R) -> Option<Face> {
  let dir = Directory::read(src)?;
  let name = dir.table(src, b"name")?;
  let family = name_string(&name, 16).or_else(|| name_string(&name, 1))?;
  let style = name_string(&name, 17)
    .or_else(|| name_string(&name, 2))
    .unwrap_or_else(|| "Regular".to_string());
  let fs_type = dir
    .table(src, b"OS/2")
    .and_then(|t| u16_at(&t, 8))
    .unwrap_or(0);
  Some(Face {
    family,
    style,
    restricted: fs_type & (FSTYPE_RESTRICTED | FSTYPE_BITMAP_ONLY) != 0,
    variable: dir.entry(b"fvar").is_some(),
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  fn listed(path: &str, restricted: bool) -> SystemFont {
    SystemFont {
      family: "Arial".into(),
      style: "Regular".into(),
      path: path.into(),
      file_name: "arial.ttf".into(),
      bytes: 1,
      restricted,
      variable: false,
    }
  }

  fn font(family: &str, style: &str, fs_type: u16, variable: bool) -> Vec<u8> {
    let utf16 = |s: &str| {
      s.encode_utf16()
        .flat_map(u16::to_be_bytes)
        .collect::<Vec<u8>>()
    };
    let (fam, sty) = (utf16(family), utf16(style));
    let name = name_table(
      &[
        [3, 1, 0x0409, 1, fam.len() as u16, 0],
        [3, 1, 0x0409, 2, sty.len() as u16, fam.len() as u16],
      ],
      &[fam, sty].concat(),
    );
    let mut os2 = vec![0u8; 78];
    os2[8..10].copy_from_slice(&fs_type.to_be_bytes());
    let mut tables: Vec<(&[u8; 4], Vec<u8>)> = vec![
      (b"glyf", vec![0u8; 64 * 1024]),
      (b"OS/2", os2),
      (b"name", name),
    ];
    if variable {
      tables.push((b"fvar", vec![0u8; 16]));
    }
    let mut out = Vec::new();
    out.extend(0x0001_0000u32.to_be_bytes());
    out.extend((tables.len() as u16).to_be_bytes());
    out.extend([0u8; 6]);
    let mut offset = 12 + tables.len() * 16;
    for (tag, data) in &tables {
      out.extend(*tag);
      out.extend(0u32.to_be_bytes());
      out.extend((offset as u32).to_be_bytes());
      out.extend((data.len() as u32).to_be_bytes());
      offset += data.len();
    }
    for (_, data) in &tables {
      out.extend(data);
    }
    out
  }

  struct Counting<R>(R, usize);

  impl<R: Read> Read for Counting<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
      let n = self.0.read(buf)?;
      self.1 += n;
      Ok(n)
    }
  }

  impl<R: Seek> Seek for Counting<R> {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
      self.0.seek(pos)
    }
  }

  fn parse(bytes: &[u8]) -> Option<Face> {
    read_face(&mut Cursor::new(bytes))
  }

  #[test]
  fn reads_none_of_the_glyph_table() {
    let bytes = font("A", "B", 0, true);
    let mut src = Counting(Cursor::new(&bytes), 0);
    read_face(&mut src).unwrap();
    assert!(src.1 < 1024, "read {} of {} bytes", src.1, bytes.len());
  }

  #[test]
  fn a_variable_font_needs_no_fvar_read() {
    let mut bytes = font("A", "B", 0, true);
    let fvar = 12 + 3 * 16;
    bytes[fvar + 8..fvar + 12].copy_from_slice(&u32::MAX.to_be_bytes());
    assert!(parse(&bytes).unwrap().variable);
  }

  #[test]
  fn reads_names_and_flags_from_the_tables() {
    let face = parse(&font("Noto Sans", "Bold Italic", 0, true)).unwrap();
    assert_eq!(
      (face.family.as_str(), face.style.as_str()),
      ("Noto Sans", "Bold Italic")
    );
    assert!(!face.restricted);
    assert!(face.variable);
    assert!(
      parse(&font("A", "B", FSTYPE_RESTRICTED, false))
        .unwrap()
        .restricted
    );
    assert!(
      parse(&font("A", "B", FSTYPE_BITMAP_ONLY, false))
        .unwrap()
        .restricted
    );
    assert!(!parse(&font("A", "B", 0x0008, false)).unwrap().restricted);
  }

  /// Records as platform, encoding, language, id, length and offset into `pool`.
  fn name_table(records: &[[u16; 6]], pool: &[u8]) -> Vec<u8> {
    let mut table = Vec::new();
    table.extend(0u16.to_be_bytes());
    table.extend((records.len() as u16).to_be_bytes());
    table.extend((6 + 12 * records.len() as u16).to_be_bytes());
    for record in records {
      for v in record {
        table.extend(v.to_be_bytes());
      }
    }
    table.extend(pool);
    table
  }

  #[test]
  fn skips_a_name_record_that_points_outside_the_table() {
    let table = name_table(
      &[[3, 1, 0x0409, 1, 2, 0xFFF0], [3, 1, 0x0409, 1, 2, 0]],
      &[0, 65],
    );
    assert_eq!(name_string(&table, 1).as_deref(), Some("A"));
  }

  #[test]
  fn keeps_the_fallback_name_when_the_record_count_overstates_the_table() {
    let mut table = name_table(&[[1, 0, 0, 1, 1, 0]], b"B");
    table[2..4].copy_from_slice(&2u16.to_be_bytes());
    assert_eq!(name_string(&table, 1).as_deref(), Some("B"));
  }

  #[test]
  fn rejects_a_foreign_or_truncated_file() {
    assert!(parse(b"not a font at all").is_none());
    assert!(parse(&[]).is_none());
    let mut short_directory = font("A", "B", 0, false);
    short_directory.truncate(12 + 10);
    assert!(parse(&short_directory).is_none());
    let mut short_table = font("A", "B", 0, false);
    short_table.truncate(12 + 3 * 16 + 10);
    assert!(parse(&short_table).is_none());
  }

  #[test]
  fn serves_only_the_listed_spelling_of_an_unrestricted_font() {
    let fonts = [listed("C:/Windows/Fonts/arial.ttf", false)];
    assert!(allows(&fonts, "C:/Windows/Fonts/arial.ttf"));
    assert!(!allows(&fonts, "C:/Windows/Fonts/../Fonts/arial.ttf"));
    assert!(!allows(&fonts, "c:/windows/fonts/arial.ttf"));
    assert!(!allows(&fonts, "C:/Windows/Fonts/other.ttf"));
    assert!(!allows(
      &[listed("C:/Windows/Fonts/arial.ttf", true)],
      "C:/Windows/Fonts/arial.ttf"
    ));
  }

  #[test]
  fn reads_only_an_allowed_unrestricted_font_within_the_cap() {
    let dir = std::env::temp_dir().join(format!("zplab-font-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("a.ttf");
    let open = font("A", "B", 0, false);
    std::fs::write(&file, &open).unwrap();
    let path = file.to_string_lossy().into_owned();
    assert_eq!(read_listed(true, &path).unwrap(), open);
    assert_eq!(read_listed(false, &path).unwrap_err(), "not listed");
    std::fs::write(&file, font("A", "B", FSTYPE_BITMAP_ONLY, false)).unwrap();
    assert_eq!(read_listed(true, &path).unwrap_err(), "restricted");
    std::fs::write(&file, b"font").unwrap();
    assert_eq!(read_listed(true, &path).unwrap_err(), "not a font");
    let big = dir.join("big.ttf");
    std::fs::write(&big, vec![0u8; (MAX_FONT_BYTES + 1) as usize]).unwrap();
    assert_eq!(
      read_listed(true, &big.to_string_lossy()).unwrap_err(),
      "too large"
    );
    std::fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn lists_single_face_files_only() {
    assert!(single_face_file(Path::new("C:/Windows/Fonts/ARIAL.TTF")));
    assert!(single_face_file(Path::new("/usr/share/fonts/a.otf")));
    assert!(single_face_file(Path::new("/usr/share/fonts/a.tte")));
    assert!(!single_face_file(Path::new("/usr/share/fonts/a.ttc")));
  }
}

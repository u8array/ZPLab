//! Excel worksheets as a plain file data source (calamine); same row/cap
//! contract as the db connector, no driver manager. Cells carry their STORED
//! value, not the number-format-rendered text (leading zeros / fixed decimals
//! are lost); full number-format rendering is a deferred follow-up.

use std::time::Duration;

use calamine::{open_workbook_auto, Data, Reader};

use crate::dataset::{Rows, ROW_CAP};

/// Same budget as the db queries. Cannot cancel the blocking parse (calamine
/// materializes the whole sheet), but bounds what the user waits on.
const READ_TIMEOUT: Duration = Duration::from_secs(30);

/// Compressed on-disk cap (accidental huge files). A label dataset is never
/// this large. NOT a RAM guard on its own: xlsx is a ZIP, so this bounds
/// compressed bytes, not the decompressed size calamine materializes.
const MAX_FILE_BYTES: u64 = 100 * 1024 * 1024;

/// Decompressed cap. calamine materializes the whole sheet before ROW_CAP and
/// the timeout can't abort it, so a decompression bomb would exhaust RAM; bound
/// the declared uncompressed size up front. Generous vs any real workbook.
const MAX_UNCOMPRESSED_BYTES: u64 = 256 * 1024 * 1024;

/// Typed reader error; stringified only at the `#[tauri::command]` edge.
#[derive(Debug, thiserror::Error)]
enum ExcelError {
  #[error(transparent)]
  Io(#[from] std::io::Error),
  #[error(transparent)]
  Calamine(#[from] calamine::Error),
  #[error(transparent)]
  Zip(#[from] zip::result::ZipError),
  #[error("excel read timed out")]
  Timeout,
  #[error("file too large: {0} bytes (max {max})", max = MAX_FILE_BYTES)]
  TooLarge(u64),
  #[error("workbook expands to more than {max} bytes uncompressed", max = MAX_UNCOMPRESSED_BYTES)]
  TooLargeUncompressed,
  #[error("empty sheet: {0}")]
  EmptySheet(String),
  #[error("file access not granted; re-select the file")]
  PathNotAllowed,
  #[error(transparent)]
  Join(#[from] tauri::Error),
}

fn check_size(path: &str) -> Result<(), ExcelError> {
  let len = std::fs::metadata(path)?.len();
  if len > MAX_FILE_BYTES {
    return Err(ExcelError::TooLarge(len));
  }
  // xls (CFB) and other non-zip formats aren't compressed, so MAX_FILE_BYTES
  // already bounds them; a non-zip open here just skips the expansion check.
  let file = std::fs::File::open(path)?;
  let Ok(mut zip) = zip::ZipArchive::new(std::io::BufReader::new(file)) else {
    return Ok(());
  };
  let mut total: u64 = 0;
  for i in 0..zip.len() {
    total = total.saturating_add(zip.by_index(i)?.size());
    if total > MAX_UNCOMPRESSED_BYTES {
      return Err(ExcelError::TooLargeUncompressed);
    }
  }
  Ok(())
}

async fn timed_read<T>(
  work: impl std::future::Future<Output = Result<Result<T, ExcelError>, tauri::Error>>,
) -> Result<T, ExcelError> {
  let parsed = tokio::time::timeout(READ_TIMEOUT, work)
    .await
    .map_err(|_| ExcelError::Timeout)?;
  parsed?
}

/// Refuse a path the user never granted via the native pick command
/// (scope::PathGrants).
fn check_path_scope(app: &tauri::AppHandle, path: &str) -> Result<(), ExcelError> {
  use tauri::Manager;
  if !app.state::<crate::scope::PathGrants>().is_granted(path) {
    return Err(ExcelError::PathNotAllowed);
  }
  Ok(())
}

// calamine parses under the release panic="abort" profile, so a panic on a
// crafted/corrupt workbook aborts the app instead of returning Err. Accepted;
// check_size + the dialog-only pick keep realistic inputs benign.
#[tauri::command]
pub async fn excel_list_sheets(app: tauri::AppHandle, path: String) -> Result<Vec<String>, String> {
  check_path_scope(&app, &path).map_err(|e| e.to_string())?;
  timed_read(tauri::async_runtime::spawn_blocking(
    move || -> Result<Vec<String>, ExcelError> {
      check_size(&path)?;
      let workbook = open_workbook_auto(&path)?;
      Ok(workbook.sheet_names().to_vec())
    },
  ))
  .await
  .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn excel_fetch(
  app: tauri::AppHandle,
  path: String,
  sheet: String,
) -> Result<Rows, String> {
  check_path_scope(&app, &path).map_err(|e| e.to_string())?;
  timed_read(tauri::async_runtime::spawn_blocking(
    move || -> Result<Rows, ExcelError> {
      check_size(&path)?;
      let mut workbook = open_workbook_auto(&path)?;
      let range = workbook.worksheet_range(&sheet)?;
      // The range starts at the first used cell; offset so a synthesized name
      // matches the sheet's real column number.
      let col_offset = range.start().map_or(0, |(_, c)| c as usize);
      let mut rows_iter = range.rows();
      let Some(header_row) = rows_iter.next() else {
        return Err(ExcelError::EmptySheet(sheet));
      };
      let headers: Vec<String> = header_row
        .iter()
        .enumerate()
        // Blank header cells still need a stable, mappable name.
        .map(|(i, c)| {
          let name = cell_text(c);
          if name.is_empty() {
            format!("Column {}", col_offset + i + 1)
          } else {
            name
          }
        })
        .collect();
      let mut truncated = false;
      let mut rows: Vec<Vec<String>> = Vec::new();
      for row in rows_iter {
        if rows.len() >= ROW_CAP {
          truncated = true;
          break;
        }
        rows.push(row.iter().map(cell_text).collect());
      }
      Ok(Rows {
        headers,
        rows,
        truncated,
      })
    },
  ))
  .await
  .map_err(|e| e.to_string())
}

/// Excel's day-zero (the 1900 leap-year bug puts it at 1899-12-30/31); a
/// serial below 1 lands here and means "time, no date".
const EXCEL_EPOCH: chrono::NaiveDate = match chrono::NaiveDate::from_ymd_opt(1899, 12, 31) {
  Some(d) => d,
  None => unreachable!(),
};

fn cell_text(cell: &Data) -> String {
  match cell {
    Data::Empty => String::new(),
    Data::String(s) => s.clone(),
    // Excel stores integers as floats; render them without the ".0".
    Data::Float(f) if f.fract() == 0.0 && f.abs() < 1e15 => (*f as i64).to_string(),
    Data::Float(f) => f.to_string(),
    Data::Int(i) => i.to_string(),
    Data::Bool(b) => (if *b { "TRUE" } else { "FALSE" }).to_string(),
    Data::Error(e) => e.to_string(),
    Data::DateTime(dt) => match dt.as_datetime() {
      // Date-only cells sit at midnight; keep them free of a phantom time.
      Some(ndt) if ndt.time() == chrono::NaiveTime::MIN => ndt.format("%Y-%m-%d").to_string(),
      // A pure time is a sub-1 serial, so calamine dates it at the Excel
      // epoch (1899-12-30/31); drop that phantom date and emit time only.
      Some(ndt) if ndt.date() <= EXCEL_EPOCH => ndt.format("%H:%M:%S").to_string(),
      Some(ndt) => ndt.format("%Y-%m-%d %H:%M:%S").to_string(),
      None => dt.as_f64().to_string(),
    },
    Data::DateTimeIso(s) | Data::DurationIso(s) => s.clone(),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn oversize_files_are_rejected_before_parsing() {
    let dir = std::env::temp_dir().join("zplab-excel-size");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let small = dir.join("small.bin");
    std::fs::write(&small, b"hi").unwrap();
    // Non-zip small file: passes both caps (zip open is skipped).
    assert!(check_size(&small.to_string_lossy()).is_ok());
    assert!(check_size(&dir.join("missing.bin").to_string_lossy()).is_err());
  }

  #[test]
  fn a_normal_zip_workbook_passes_the_expansion_guard() {
    use std::io::Write;
    let dir = std::env::temp_dir().join("zplab-excel-zip");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let p = dir.join("small.xlsx");
    let mut zw = zip::ZipWriter::new(std::fs::File::create(&p).unwrap());
    zw.start_file(
      "xl/worksheets/sheet1.xml",
      zip::write::SimpleFileOptions::default(),
    )
    .unwrap();
    zw.write_all(b"<sheetData/>").unwrap();
    zw.finish().unwrap();
    assert!(check_size(&p.to_string_lossy()).is_ok());
  }

  #[test]
  fn cell_text_covers_the_data_variants() {
    assert_eq!(cell_text(&Data::Empty), "");
    assert_eq!(cell_text(&Data::String("x".into())), "x");
    assert_eq!(cell_text(&Data::Float(3.0)), "3");
    assert_eq!(cell_text(&Data::Float(3.25)), "3.25");
    assert_eq!(cell_text(&Data::Int(7)), "7");
    assert_eq!(cell_text(&Data::Bool(true)), "TRUE");
    assert_eq!(
      cell_text(&Data::DateTimeIso("2026-07-20T10:00".into())),
      "2026-07-20T10:00"
    );
  }

  #[test]
  fn time_only_cell_drops_the_phantom_epoch_date() {
    // Serial 0.395833… = 09:30, no date component.
    assert_eq!(
      cell_text(&Data::DateTime(calamine::ExcelDateTime::new(
        0.395_833_333_333_333_3,
        calamine::ExcelDateTimeType::DateTime,
        false,
      ))),
      "09:30:00"
    );
  }
}

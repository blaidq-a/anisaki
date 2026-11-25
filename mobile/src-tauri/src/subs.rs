// Subtitle files on the phone (downloaded, converted, translated): the app's cache folder. Same commands
// as the desktop's media.rs, so the UI's subtitle code runs unchanged.
use std::path::PathBuf;
use std::sync::OnceLock;

static BASE: OnceLock<PathBuf> = OnceLock::new();
pub fn set_base_dir(dir: PathBuf) {
  let _ = BASE.set(dir);
}
fn subs_dir() -> PathBuf {
  let d = BASE.get().cloned().unwrap_or_else(std::env::temp_dir).join("subs");
  let _ = std::fs::create_dir_all(&d);
  d
}
/// Only files inside the subtitle folder can be read or written from the page.
fn inside(path: &str) -> Result<PathBuf, String> {
  let p = PathBuf::from(path);
  let dir = subs_dir();
  let name = p.file_name().ok_or("geçersiz dosya")?;
  if p.parent().map(|x| x == dir.as_path() || x.as_os_str().is_empty()).unwrap_or(true) {
    Ok(dir.join(name))
  } else {
    Err("izin verilmeyen dosya yolu".into())
  }
}

#[tauri::command]
pub fn subs_dir_path() -> String {
  subs_dir().to_string_lossy().into_owned()
}
#[tauri::command]
pub fn subs_exists(name: String) -> bool {
  inside(&name).map(|p| p.exists()).unwrap_or(false)
}
#[tauri::command]
pub async fn subs_write(name: String, text: String) -> Result<String, String> {
  let p = inside(&name)?;
  tokio::fs::write(&p, text).await.map_err(|e| e.to_string())?;
  Ok(p.to_string_lossy().into_owned())
}
#[tauri::command]
pub async fn subs_read(name: String) -> Result<String, String> {
  let p = inside(&name)?;
  tokio::fs::read_to_string(&p).await.map_err(|e| e.to_string())
}

// One-click update for the desktop app: the new installer (from the address in the update manifest, see
// src/renderer/src/lib/update.ts) is downloaded into the temp folder and started, and the app closes so the
// installer can replace it. Only https addresses on the release host are accepted.
use std::io::Write;
use tauri::{AppHandle, Emitter};

/// Where update files may come from (the release host); anything else is refused.
fn allowed(url: &str) -> bool {
  // only this project's release files (GitHub sends the download on to its file host itself)
  url.starts_with("https://github.com/blaidq-a/anisaki/releases/download/")
}

#[tauri::command]
pub async fn update_install(app: AppHandle, url: String) -> Result<(), String> {
  if !allowed(&url) || !url.to_lowercase().ends_with(".exe") {
    return Err("Güncelleme adresi kabul edilmedi".into());
  }
  let client = reqwest::Client::builder().build().map_err(|e| e.to_string())?;
  let mut res = client.get(&url).send().await.map_err(|e| format!("İndirilemedi: {e}"))?;
  if !res.status().is_success() {
    return Err(format!("İndirilemedi ({})", res.status()));
  }
  let total = res.content_length().unwrap_or(0);
  let path = std::env::temp_dir().join("Anisaki-Guncelleme.exe");
  let mut f = std::fs::File::create(&path).map_err(|e| e.to_string())?;
  let mut got: u64 = 0;
  while let Some(chunk) = res.chunk().await.map_err(|e| format!("İndirme kesildi: {e}"))? {
    f.write_all(&chunk).map_err(|e| e.to_string())?;
    got += chunk.len() as u64;
    if total > 0 {
      let _ = app.emit("update:progress", (got * 100 / total) as u32);
    }
  }
  drop(f);
  std::process::Command::new(&path).spawn().map_err(|e| format!("Kurulum başlatılamadı: {e}"))?;
  app.exit(0);
  Ok(())
}

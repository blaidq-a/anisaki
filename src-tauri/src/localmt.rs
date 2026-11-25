// On-device translation (Töz, English → Turkish) for the subtitle translator in the page. The model
// ships with the app (vendor/toz-anime); it is loaded on first use and freed after 5 idle minutes.
use crate::player::vendor;
use crate::toz::Toz;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::AppHandle;

struct State {
  model: Option<Toz>,
  used: Instant,
}
fn state() -> &'static Mutex<State> {
  static S: OnceLock<Mutex<State>> = OnceLock::new();
  S.get_or_init(|| {
    // free the model (~300 MB) a few minutes after the last line
    std::thread::spawn(|| loop {
      std::thread::sleep(Duration::from_secs(30));
      let mut s = state().lock().unwrap();
      if s.model.is_some() && s.used.elapsed() > Duration::from_secs(300) {
        s.model = None;
      }
    });
    Mutex::new(State { model: None, used: Instant::now() })
  })
}

fn dir(app: &AppHandle) -> std::path::PathBuf {
  vendor(app).join("toz-anime")
}

#[tauri::command]
pub fn mt_ready(app: AppHandle) -> bool {
  let d = dir(&app);
  ["onnx/encoder_q8.onnx", "onnx/decoder_q8.onnx", "tokenizer.model"].iter().all(|f| d.join(f).exists())
}

/// Load the model ahead (the player is still finding a source), so the first lines come quickly.
#[tauri::command]
pub async fn mt_warm(app: AppHandle) -> Result<(), String> {
  let d = dir(&app);
  tokio::task::spawn_blocking(move || {
    let mut s = state().lock().unwrap();
    s.used = Instant::now();
    if s.model.is_none() {
      let threads = (std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4) / 2).saturating_sub(1).max(2);
      s.model = Some(Toz::load(&d, threads)?);
    }
    Ok::<(), String>(())
  })
  .await
  .map_err(|e| e.to_string())?
}

/// One sentence through the model (the page splits lines into sentences and applies the repair rules).
#[tauri::command]
pub async fn mt_sentence(app: AppHandle, text: String) -> Result<String, String> {
  mt_warm(app).await?;
  tokio::task::spawn_blocking(move || {
    let mut s = state().lock().unwrap();
    s.used = Instant::now();
    s.model.as_mut().ok_or("model yok")?.sentence(&text, 4)
  })
  .await
  .map_err(|e| e.to_string())?
}

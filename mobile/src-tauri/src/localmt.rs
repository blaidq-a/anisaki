// Töz on the phone / TV: the same model and runner as the desktop (src-tauri/src/toz.rs). ONNX Runtime
// comes from Microsoft's Android package (libonnxruntime.so in the APK, loaded at run time); the model
// files ship inside the APK and are unpacked once into the app's files folder (PlayerPlugin.prepareToz),
// since ONNX Runtime needs real files.
use crate::toz::Toz;
use std::path::PathBuf;
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
    // free the model (~300 MB) a couple of minutes after the last line: phones and TVs have less memory
    std::thread::spawn(|| loop {
      std::thread::sleep(Duration::from_secs(30));
      let mut s = state().lock().unwrap();
      if s.model.is_some() && s.used.elapsed() > Duration::from_secs(150) {
        s.model = None;
      }
    });
    Mutex::new(State { model: None, used: Instant::now() })
  })
}

static DIR: OnceLock<PathBuf> = OnceLock::new();

/// Where the model is on this device (unpacked from the APK the first time).
async fn dir(app: &AppHandle) -> Result<PathBuf, String> {
  if let Some(d) = DIR.get() {
    return Ok(d.clone());
  }
  let d = crate::player_dir(app, "prepareToz").await?;
  let _ = DIR.set(d.clone());
  Ok(d)
}

fn files_ok(d: &std::path::Path) -> bool {
  ["onnx/encoder_q8.onnx", "onnx/decoder_q8.onnx", "tokenizer.model"].iter().all(|f| d.join(f).exists())
}

#[tauri::command]
pub async fn mt_ready(app: AppHandle) -> bool {
  match dir(&app).await {
    Ok(d) => files_ok(&d),
    Err(_) => false,
  }
}

#[tauri::command]
pub async fn mt_warm(app: AppHandle) -> Result<(), String> {
  let d = dir(&app).await?;
  tokio::task::spawn_blocking(move || {
    let mut s = state().lock().unwrap();
    load(&mut s, &d)
  })
  .await
  .map_err(|e| e.to_string())?
}

/// The model in memory (ONNX Runtime opened once).
fn load(s: &mut State, d: &std::path::Path) -> Result<(), String> {
  s.used = Instant::now();
  if s.model.is_none() {
    static INIT: OnceLock<Result<(), String>> = OnceLock::new();
    INIT
      .get_or_init(|| ort::init_from("libonnxruntime.so").commit().map(|_| ()).map_err(|e| format!("ONNX Runtime açılamadı: {e}")))
      .clone()?;
    // leave a core or two for the video
    let threads = (std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4) / 2).max(2);
    s.model = Some(Toz::load(d, threads)?);
  }
  Ok(())
}

/// A subtitle line (one or more sentences, maybe on two lines) into Turkish, sentence by sentence.
fn translate_line(d: &std::path::Path, text: &str) -> Result<String, String> {
  let mut s = state().lock().unwrap();
  load(&mut s, d)?;
  let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
  let mut out = Vec::new();
  let mut cur = String::new();
  let chars: Vec<char> = flat.chars().collect();
  for (i, c) in chars.iter().enumerate() {
    cur.push(*c);
    let end = matches!(c, '.' | '!' | '?' | '…') && chars.get(i + 1).map(|n| *n == ' ').unwrap_or(true);
    if end && cur.trim().chars().count() > 1 {
      out.push(s.model.as_mut().ok_or("model yok")?.sentence(cur.trim(), 4)?);
      cur.clear();
    }
  }
  if !cur.trim().is_empty() {
    out.push(s.model.as_mut().ok_or("model yok")?.sentence(cur.trim(), 4)?);
  }
  Ok(out.join(" "))
}

/// Live translation in the phone's player (PlayerActivity.tozTranslate): the line on screen, now.
/// Empty answer on any error (the player then keeps the English line).
#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub extern "system" fn Java_app_anisaki_mobile_PlayerActivity_tozTranslate<'l>(
  mut env: jni::JNIEnv<'l>,
  _cls: jni::objects::JClass<'l>,
  dir: jni::objects::JString<'l>,
  text: jni::objects::JString<'l>,
) -> jni::sys::jstring {
  let dir: String = env.get_string(&dir).map(|s| s.into()).unwrap_or_default();
  let text: String = env.get_string(&text).map(|s| s.into()).unwrap_or_default();
  let out = translate_line(std::path::Path::new(&dir), &text).unwrap_or_default();
  env.new_string(out).map(|s| s.into_raw()).unwrap_or(std::ptr::null_mut())
}

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


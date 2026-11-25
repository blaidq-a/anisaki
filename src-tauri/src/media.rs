// Media helpers on top of ffmpeg (vendor/ffmpeg): the subtitle folder, embedded subtitle extraction
// (streamed while ffmpeg reads the file), seek-bar preview frames and audio for subtitle sync.
use crate::events::{emit_to, Ch};
use crate::player::vendor;
use serde_json::json;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Manager};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

fn ffmpeg(app: &AppHandle) -> PathBuf {
  vendor(app).join("ffmpeg").join("ffmpeg.exe")
}
fn cmd(app: &AppHandle) -> Command {
  let mut c = Command::new(ffmpeg(app));
  c.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
  #[cfg(windows)]
  c.creation_flags(0x0800_0000); // no console window
  c
}
fn net_args(src: &str) -> Vec<&'static str> {
  if src.starts_with("http://") || src.starts_with("https://") {
    vec!["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"]
  } else {
    vec![]
  }
}

/* ------------------------------ subtitle files ------------------------------ */
/// Translated and downloaded subtitles live here (same folder as before, so finished translations are kept).
pub fn subs_dir() -> PathBuf {
  let d = std::env::temp_dir().join("anisaki-subs");
  let _ = std::fs::create_dir_all(&d);
  d
}
/// Only files inside the subtitle folder can be read or written from the page.
fn inside(path: &str) -> Result<PathBuf, String> {
  let p = PathBuf::from(path);
  let dir = subs_dir();
  let name = p.file_name().ok_or("geçersiz dosya")?;
  let full = dir.join(name);
  if p.parent().map(|x| x == dir.as_path() || x.as_os_str().is_empty()).unwrap_or(true) {
    Ok(full)
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

/* --------------------------- embedded subtitles --------------------------- */
fn jobs() -> &'static Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>> {
  static J: OnceLock<Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>> = OnceLock::new();
  J.get_or_init(Default::default)
}

/// One embedded subtitle stream as ASS text, sent in pieces as ffmpeg reaches them.
#[tauri::command]
pub async fn sub_extract(app: AppHandle, id: String, src: String, sub_index: u32, from: Option<f64>, on: Channel<String>) -> Result<(), String> {
  let local = src.contains("127.0.0.1") || src.contains("localhost");
  let mut c = cmd(&app);
  c.args(["-hide_banner", "-loglevel", "error", "-nostdin"]).args(net_args(&src));
  if local && src.starts_with("http") {
    c.args(["-readrate", "10"]);
  }
  // From a point in the file (the viewer jumped ahead of the reading): ffmpeg seeks there and keeps the
  // original timestamps, so the rows fit the video as they are.
  if let Some(t) = from.filter(|t| *t > 1.0) {
    c.args(["-ss", &format!("{t:.1}"), "-copyts"]);
  }
  c.args(["-i", &src, "-map", &format!("0:s:{sub_index}"), "-c:s", "ass", "-f", "ass", "-flush_packets", "1", "pipe:1"]);
  let mut child = c.spawn().map_err(|e| format!("ffmpeg başlatılamadı: {e}"))?;
  let (tx, mut rx) = tokio::sync::oneshot::channel();
  jobs().lock().unwrap().insert(id.clone(), tx);
  let mut out = child.stdout.take().unwrap();
  let mut err = child.stderr.take().unwrap();
  let errtask = tokio::spawn(async move {
    let mut s = String::new();
    let _ = err.read_to_string(&mut s).await;
    s
  });
  let mut buf = vec![0u8; 64 * 1024];
  let mut carry: Vec<u8> = Vec::new();
  let result = loop {
    tokio::select! {
      _ = &mut rx => { let _ = child.kill().await; break Err("Çeviri iptal edildi".to_string()) }
      _ = tokio::time::sleep(Duration::from_secs(30 * 60)) => { let _ = child.kill().await; break Err("zaman aşımı".to_string()) }
      n = out.read(&mut buf) => match n {
        Ok(0) | Err(_) => break Ok(()),
        Ok(n) => {
          carry.extend_from_slice(&buf[..n]);
          // send whole UTF-8 text only (a character may be split between reads)
          let valid = match std::str::from_utf8(&carry) { Ok(_) => carry.len(), Err(e) => e.valid_up_to() };
          if valid > 0 {
            let text = String::from_utf8_lossy(&carry[..valid]).into_owned();
            carry.drain(..valid);
            let _ = on.send(text);
          }
        }
      }
    }
  };
  jobs().lock().unwrap().remove(&id);
  let status = child.wait().await.ok();
  let err = errtask.await.unwrap_or_default();
  result?;
  if status.map(|s| s.success()).unwrap_or(false) {
    Ok(())
  } else {
    Err(format!("Altyazı dosyadan okunamadı{}", err.trim().lines().last().map(|l| format!(": {l}")).unwrap_or_default()))
  }
}
#[tauri::command]
pub fn sub_extract_cancel(id: String) {
  if let Some(tx) = jobs().lock().unwrap().remove(&id) {
    let _ = tx.send(());
  }
}

/* -------------------------------- audio sync -------------------------------- */
/// [from, from+dur) seconds of audio as mono 16 kHz float32 (raw bytes) for speech detection.
#[tauri::command]
pub async fn audio_pcm(app: AppHandle, src: String, from: f64, dur: f64) -> Result<Response, String> {
  let mut c = cmd(&app);
  c.args(["-hide_banner", "-loglevel", "error", "-nostdin"]).args(net_args(&src));
  c.args(["-ss", &from.max(0.0).to_string(), "-t", &dur.to_string(), "-i", &src, "-vn", "-sn", "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"]);
  let out = tokio::time::timeout(Duration::from_secs(180), c.output()).await.map_err(|_| "Ses okunamadı (zaman aşımı)")?.map_err(|e| e.to_string())?;
  if out.stdout.len() < 16000 * 4 * 10 {
    let e = String::from_utf8_lossy(&out.stderr);
    return Err(format!("Ses okunamadı{}", e.trim().lines().last().map(|l| format!(": {l}")).unwrap_or_default()));
  }
  Ok(Response::new(out.stdout))
}

/* ------------------------------ seek previews ------------------------------ */
// Frames are prepared in the background across the episode (every 60 s, then every 20 s); the spot under
// the mouse jumps the queue. Debrid links dislike many connections: one grab at a time over the network.
struct Thumbs {
  src: String,
  done: HashSet<i64>,
  bg: VecDeque<i64>,
  hover: Option<i64>,
  active: usize,
}
fn thumbs() -> &'static Mutex<Option<Thumbs>> {
  static T: OnceLock<Mutex<Option<Thumbs>>> = OnceLock::new();
  T.get_or_init(Default::default)
}

async fn grab(app: &AppHandle, src: &str, t: i64) -> Option<String> {
  let mut c = cmd(app);
  c.args(["-hide_banner", "-loglevel", "error", "-nostdin"]);
  if src.starts_with("http") {
    c.args(["-reconnect", "1", "-reconnect_delay_max", "2", "-rw_timeout", "10000000"]);
  }
  c.args(["-skip_frame", "nokey", "-ss", &t.max(0).to_string(), "-noaccurate_seek", "-i", src, "-map", "0:v:0", "-frames:v", "1", "-an", "-sn", "-vf", "scale=320:-2", "-q:v", "6", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"]);
  let out = tokio::time::timeout(Duration::from_secs(15), c.output()).await.ok()?.ok()?;
  if out.stdout.len() < 500 {
    return None;
  }
  use base64::Engine;
  Some(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(&out.stdout)))
}

fn pump(app: AppHandle) {
  let job = {
    let mut g = thumbs().lock().unwrap();
    let Some(c) = g.as_mut() else { return };
    let limit = if c.src.starts_with("http") && !c.src.contains("127.0.0.1") { 1 } else { 3 };
    if c.active >= limit {
      return;
    }
    let mut pick = None;
    if let Some(t) = c.hover.take() {
      if !c.done.contains(&t) {
        pick = Some(t);
      }
    }
    while pick.is_none() {
      match c.bg.pop_front() {
        Some(t) if !c.done.contains(&t) => pick = Some(t),
        Some(_) => {}
        None => break,
      }
    }
    let Some(t) = pick else { return };
    c.done.insert(t);
    c.active += 1;
    (c.src.clone(), t)
  };
  let app2 = app.clone();
  tauri::async_runtime::spawn(async move {
    let img = grab(&app2, &job.0, job.1).await;
    {
      let mut g = thumbs().lock().unwrap();
      if let Some(c) = g.as_mut() {
        c.active = c.active.saturating_sub(1);
      }
    }
    if let Some(img) = img {
      if thumbs().lock().unwrap().as_ref().map(|c| c.src == job.0).unwrap_or(false) {
        if let Some(o) = app2.get_webview_window("overlay") {
          emit_to(&o, Ch::new("media:thumb", json!([job.0, job.1, img])));
        }
      }
    }
    pump(app2.clone());
    pump(app2);
  });
  pump(app);
}

#[tauri::command]
pub fn thumb_start(app: AppHandle, src: String, duration: f64, background: bool) {
  {
    let mut g = thumbs().lock().unwrap();
    if g.as_ref().map(|c| c.src != src).unwrap_or(true) {
      let mut bg = VecDeque::new();
      if background && duration > 0.0 {
        for step in [60.0, 20.0] {
          let mut t = step / 2.0;
          while t < duration {
            let r = t.round() as i64;
            if !bg.contains(&r) {
              bg.push_back(r);
            }
            t += step;
          }
        }
      }
      *g = Some(Thumbs { src, done: HashSet::new(), bg, hover: None, active: 0 });
    }
  }
  pump(app);
}
#[tauri::command]
pub fn thumb_at(app: AppHandle, src: String, t: f64) {
  {
    let mut g = thumbs().lock().unwrap();
    match g.as_mut() {
      Some(c) if c.src == src => c.hover = Some(t.round() as i64),
      _ => return,
    }
  }
  pump(app);
}

/// The player closed: stop preparing frames and any extraction.
pub fn stop_all() {
  *thumbs().lock().unwrap() = None;
  for (_, tx) in jobs().lock().unwrap().drain() {
    let _ = tx.send(());
  }
}

/* ------------------------------- local library ------------------------------- */
#[derive(serde::Serialize)]
pub struct LocalEntry {
  path: String,
  name: String,
  size: u64,
}
/// Video files under the user's library folders (6 levels deep at most).
#[tauri::command]
pub async fn local_scan(folders: Vec<String>) -> Vec<LocalEntry> {
  tokio::task::spawn_blocking(move || {
    let mut out = Vec::new();
    fn walk(dir: &std::path::Path, depth: u32, out: &mut Vec<LocalEntry>) {
      if depth > 6 {
        return;
      }
      let Ok(rd) = std::fs::read_dir(dir) else { return };
      for e in rd.flatten() {
        let p = e.path();
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
          walk(&p, depth + 1, out);
        } else {
          let name = e.file_name().to_string_lossy().into_owned();
          let ext = p.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
          if ["mkv", "mp4", "webm", "avi", "m4v", "mov"].contains(&ext.as_str()) {
            let size = e.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(LocalEntry { path: p.to_string_lossy().into_owned(), name, size });
          }
        }
      }
    }
    for f in folders {
      walk(std::path::Path::new(&f), 0, &mut out);
    }
    out
  })
  .await
  .unwrap_or_default()
}

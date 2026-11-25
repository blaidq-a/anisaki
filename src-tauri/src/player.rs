// Embedded mpv player. mpv draws into a borderless black "video" window owned by the main window
// (--wid); a transparent "overlay" webview with the controls (index.html#overlay) is owned by the video
// window, so it always sits on top of it. Both follow the main window: they cover its content area
// ("full") or float small in one of its corners ("mini"). The UI talks to mpv through its JSON IPC
// (a named pipe) via the commands below; mpv's property changes go to the overlay as events.
use crate::events::{emit_to, Ch};
use crate::mpvlib;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::sync::oneshot;

#[cfg(windows)]
use windows::Win32::{
  Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
  Graphics::Gdi::{CreateSolidBrush, HBRUSH},
  System::LibraryLoader::GetModuleHandleW,
  UI::WindowsAndMessaging::*,
};

const OBSERVED: &[&str] = &[
  "time-pos", "duration", "pause", "paused-for-cache", "cache-buffering-state", "seeking", "eof-reached", "idle-active",
  "track-list", "chapter-list", "volume", "mute", "sub-delay", "aid", "sid", "demuxer-cache-time",
  "video-params", "video-codec", "audio-codec-name", "audio-params", "hwdec-current", "file-format", "file-size",
  "video-bitrate", "audio-bitrate", "container-fps", "width", "height", "glsl-shaders", "speed",
  // the line on screen (and the invisible English one behind a growing translation, MpvPlayer.tsx)
  "sub-text", "secondary-sub-text",
];

// Anime4K presets from its official mpv instructions ("HQ" for strong GPUs)
fn preset(mode: &str) -> &'static [&'static str] {
  match mode {
    "A" => &["Clamp_Highlights", "Restore_CNN_VL", "Upscale_CNN_x2_VL", "AutoDownscalePre_x2", "AutoDownscalePre_x4", "Upscale_CNN_x2_M"],
    "B" => &["Clamp_Highlights", "Restore_CNN_Soft_VL", "Upscale_CNN_x2_VL", "AutoDownscalePre_x2", "AutoDownscalePre_x4", "Upscale_CNN_x2_M"],
    "C" => &["Clamp_Highlights", "Upscale_Denoise_CNN_x2_VL", "AutoDownscalePre_x2", "AutoDownscalePre_x4", "Upscale_CNN_x2_M"],
    "A+A" => &["Clamp_Highlights", "Restore_CNN_VL", "Upscale_CNN_x2_VL", "Restore_CNN_M", "AutoDownscalePre_x2", "AutoDownscalePre_x4", "Upscale_CNN_x2_M"],
    "B+B" => &["Clamp_Highlights", "Restore_CNN_Soft_VL", "Upscale_CNN_x2_VL", "AutoDownscalePre_x2", "AutoDownscalePre_x4", "Restore_CNN_Soft_M", "Upscale_CNN_x2_M"],
    "C+A" => &["Clamp_Highlights", "Upscale_Denoise_CNN_x2_VL", "AutoDownscalePre_x2", "AutoDownscalePre_x4", "Restore_CNN_M", "Upscale_CNN_x2_M"],
    _ => &[],
  }
}

/// vendor/ next to the project in development, the app's resources when installed
pub fn vendor(app: &AppHandle) -> PathBuf {
  if cfg!(debug_assertions) {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("vendor")
  } else {
    app.path().resource_dir().unwrap_or_default()
  }
}
fn mpv_exe(app: &AppHandle) -> PathBuf {
  vendor(app).join("mpv").join("libmpv-2.dll")
}

fn shaders(app: &AppHandle, mode: &str, quality: &str) -> String {
  preset(mode)
    .iter()
    .map(|n| {
      let n = if quality == "fast" { n.replace("_M", "_S").replace("_VL", "_M") } else { n.to_string() };
      vendor(app).join("anime4k").join(format!("Anime4K_{n}.glsl")).to_string_lossy().into_owned()
    })
    .collect::<Vec<_>>()
    .join(";")
}

/* ----------------------------------- mpv ----------------------------------- */
struct Mpv {
  m: Arc<mpvlib::Mpv>,
  done: tokio::sync::watch::Receiver<bool>,
}

#[derive(Clone, Copy, PartialEq)]
enum Mode {
  Full,
  Mini,
}

struct State {
  video: isize,
  overlay: Option<WebviewWindow>,
  open: bool,
  mode: Mode,
  corner: [u8; 2], // b/t, r/l
  drag: Option<(POINTI, RECTI, bool)>,
  /// the mini player is a window of its own (it can leave the app, and stays when the app is minimized)
  floating: bool,
  /// where the mini player was dropped outside the app's corners (screen pixels)
  free: Option<(i32, i32, i32, i32)>,
  /// no picture yet (the source is being found or opened): the video window stays hidden, so the opening
  /// screen on the main window shows while the controls window is hidden during a drag (it was black)
  waiting: bool,
}
#[derive(Clone, Copy)]
struct POINTI(i32, i32);
#[derive(Clone, Copy)]
struct RECTI(i32, i32, i32, i32);

pub struct Player {
  /// set by the overlay page once its listeners are in place
  ready: tokio::sync::watch::Sender<bool>,
  st: Mutex<State>,
  mpv: tokio::sync::Mutex<Option<Mpv>>,
  #[allow(dead_code)]
  next_id: AtomicU64,
}

impl Player {
  pub fn new() -> Self {
    Player {
      ready: tokio::sync::watch::channel(false).0,
      st: Mutex::new(State { video: 0, overlay: None, open: false, mode: Mode::Full, corner: [b'b', b'r'], drag: None, floating: false, free: None, waiting: false }),
      mpv: tokio::sync::Mutex::new(None),
      next_id: AtomicU64::new(1),
    }
  }
}

fn main_win(app: &AppHandle) -> Option<WebviewWindow> {
  app.get_webview_window("main")
}

/* ------------------------------- video window ------------------------------- */
#[cfg(windows)]
unsafe extern "system" fn video_proc(h: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
  unsafe {
    if msg == WM_MOUSEACTIVATE {
      return LRESULT(MA_NOACTIVATE as isize);
    }
    DefWindowProcW(h, msg, w, l)
  }
}

#[cfg(windows)]
fn create_video_window(owner: isize) -> isize {
  use windows::core::w;
  unsafe {
    let inst = GetModuleHandleW(None).unwrap_or_default();
    let class = WNDCLASSW {
      lpfnWndProc: Some(video_proc),
      hInstance: inst.into(),
      lpszClassName: w!("AnisakiVideo"),
      hbrBackground: HBRUSH(CreateSolidBrush(windows::Win32::Foundation::COLORREF(0)).0),
      ..Default::default()
    };
    RegisterClassW(&class);
    // A child of the main window: it moves and resizes with it in the same frame (as a separate window it
    // trailed behind a fast drag and the app showed at its edges).
    let h = CreateWindowExW(
      WINDOW_EX_STYLE(0),
      w!("AnisakiVideo"),
      w!("Anisaki video"),
      WS_CHILD | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
      0, 0, 640, 360,
      Some(HWND(owner as _)),
      None,
      Some(inst.into()),
      None,
    )
    .unwrap_or_default();
    h.0 as isize
  }
}

/// Full size: the video is a child of the main window (moves with it in the same frame). Mini: a small
/// window of its own above everything, so it can be dragged out of the app and stays on screen while the
/// app is minimized; the controls window follows it (not owned by the main window then, as owned windows
/// are hidden with their owner).
#[cfg(windows)]
fn set_floating(st: &State, main: isize, floating: bool) {
  unsafe {
    let v = HWND(st.video as _);
    if floating {
      let _ = SetParent(v, None);
      SetWindowLongPtrW(v, GWL_STYLE, (WS_POPUP | WS_CLIPCHILDREN | WS_VISIBLE).0 as isize);
      SetWindowLongPtrW(v, GWL_EXSTYLE, (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST).0 as isize);
      let _ = SetWindowPos(v, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    } else {
      SetWindowLongPtrW(v, GWL_EXSTYLE, 0);
      SetWindowLongPtrW(v, GWL_STYLE, (WS_CHILD | WS_CLIPSIBLINGS | WS_CLIPCHILDREN | WS_VISIBLE).0 as isize);
      let _ = SetParent(v, Some(HWND(main as _)));
      let _ = SetWindowPos(v, Some(HWND_TOP), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    }
    if let Some(o) = &st.overlay {
      SetWindowLongPtrW(HWND(hwnd_of(o) as _), GWLP_HWNDPARENT, if floating { 0 } else { main });
      let _ = o.set_always_on_top(floating);
    }
  }
}

/// Rounded corners for the mini player (a child window gets no DWM corners; the main window's own
/// rounded corners already clip the full-size player).
#[cfg(windows)]
fn set_corners(video: isize, round: bool, w: i32, h: i32, scale: f64) {
  use windows::Win32::Graphics::Gdi::{CreateRoundRectRgn, SetWindowRgn, HRGN};
  unsafe {
    if round {
      let r = (16.0 * scale) as i32;
      let rgn = CreateRoundRectRgn(0, 0, w + 1, h + 1, r, r);
      let _ = SetWindowRgn(HWND(video as _), Some(rgn), true);
    } else {
      let _ = SetWindowRgn(HWND(video as _), None::<HRGN>, true);
    }
  }
}

fn hwnd_of(w: &WebviewWindow) -> isize {
  w.hwnd().map(|h| h.0 as isize).unwrap_or(0)
}

/// Where the player goes inside the main window (physical pixels, screen coordinates)
fn bounds(main: &WebviewWindow, st: &State) -> (i32, i32, i32, i32) {
  let pos = main.inner_position().unwrap_or(PhysicalPosition::new(0, 0));
  let size = main.inner_size().unwrap_or(PhysicalSize::new(1280, 720));
  let (x, y, w, h) = (pos.x, pos.y, size.width as i32, size.height as i32);
  if st.mode == Mode::Full {
    return (x, y, w, h);
  }
  if let Some(r) = st.free {
    return r;
  }
  let scale = main.scale_factor().unwrap_or(1.0);
  let mw = ((w as f64 * 0.3).clamp(320.0 * scale, 480.0 * scale)) as i32;
  let mh = mw * 9 / 16;
  let m = (20.0 * scale) as i32;
  let top = (64.0 * scale) as i32;
  let nx = if st.corner[1] == b'r' { x + w - mw - m } else { x + m };
  let ny = if st.corner[0] == b'b' { y + h - mh - m } else { y + top };
  (nx, ny, mw, mh)
}

fn place(st: &State, b: (i32, i32, i32, i32)) {
  // b is in screen pixels: the video (a child) takes them relative to the main window's client area and
  // stays on top of the page's own view; the controls (a top-level window) take them as they are.
  #[cfg(windows)]
  unsafe {
    let v = HWND(st.video as _);
    if st.floating {
      let _ = SetWindowPos(v, None, b.0, b.1, b.2, b.3, SWP_NOACTIVATE | SWP_NOZORDER);
    } else {
      let mut pt = POINT { x: b.0, y: b.1 };
      if let Ok(parent) = GetParent(v) {
        let _ = windows::Win32::Graphics::Gdi::ScreenToClient(parent, &mut pt);
      }
      let _ = SetWindowPos(v, Some(HWND_TOP), pt.x, pt.y, b.2, b.3, SWP_NOACTIVATE);
    }
  }
  if let Some(o) = &st.overlay {
    let _ = o.set_position(PhysicalPosition::new(b.0, b.1));
    let _ = o.set_size(PhysicalSize::new(b.2 as u32, b.3 as u32));
  }
}

/// Places the player from any thread. The work always runs on the main thread: done on another thread
/// it held the player lock while waiting for the main window to answer (its position, SetWindowPos on the
/// child video), and a window move at that moment asked for the same lock on the main thread. Both waited
/// and the app froze ("Yanıt Vermiyor", Windows split it into two ghost windows).
pub fn layout(app: &AppHandle) {
  let a = app.clone();
  let _ = app.run_on_main_thread(move || layout_now(&a));
}

/// Main thread only.
fn layout_now(app: &AppHandle) {
  let Some(main) = main_win(app) else { return };
  let p = app.state::<Arc<Player>>();
  let st = p.st.lock().unwrap();
  if !st.open || st.drag.is_some() || st.video == 0 {
    return;
  }
  // the app went to the taskbar: the mini player stays where it is
  if st.mode == Mode::Mini && main.is_minimized().unwrap_or(false) {
    return;
  }
  let b = bounds(&main, &st);
  place(&st, b);
  let square = st.mode == Mode::Full && (main.is_maximized().unwrap_or(false) || main.is_fullscreen().unwrap_or(false));
  #[cfg(windows)]
  set_corners(st.video, st.mode == Mode::Mini, b.2, b.3, main.scale_factor().unwrap_or(1.0));
  if let Some(o) = &st.overlay {
    emit_to(o, Ch::new("player:mode", json!([{ "mini": st.mode == Mode::Mini, "square": square }])));
  }
  // the main page goes black under a full-size player (nothing of it shows if the controls trail a drag)
  main_emit(app, "player:cover", json!([st.mode == Mode::Full]));
}

/// Creates the video window and the controls overlay once (the overlay page is kept loaded).
async fn ensure_windows(app: &AppHandle) -> Result<(), String> {
  let p = app.state::<Arc<Player>>().inner().clone();
  {
    let st = p.st.lock().unwrap();
    if st.video != 0 && st.overlay.is_some() {
      return Ok(());
    }
  }
  let main = main_win(app).ok_or("ana pencere yok")?;
  let owner = hwnd_of(&main);
  let (tx, rx) = oneshot::channel();
  app
    .run_on_main_thread(move || {
      #[cfg(windows)]
      let _ = tx.send(create_video_window(owner));
    })
    .map_err(|e| e.to_string())?;
  let video = rx.await.map_err(|e| e.to_string())?;
  if video == 0 {
    return Err("video penceresi açılamadı".into());
  }
  let builder = WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("index.html#overlay".into()))
    .title("Anisaki")
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .resizable(false)
    .skip_taskbar(true)
    .visible(false)
    .focused(false);
  let overlay = builder.build().map_err(|e| e.to_string())?;
  // Owned by the main window (a top-level window, so it can be transparent; a child window would be
  // opaque). Owned windows always stay above their owner, so also above the video inside it.
  #[cfg(windows)]
  unsafe {
    let _ = SetWindowLongPtrW(HWND(hwnd_of(&overlay) as _), GWLP_HWNDPARENT, owner);
  }
  {
    let mut st = p.st.lock().unwrap();
    st.video = video;
    st.overlay = Some(overlay);
  }
  // messages sent before the page listens would be lost: wait for it (like Electron's did-finish-load)
  let mut rx = p.ready.subscribe();
  let _ = tokio::time::timeout(Duration::from_secs(20), rx.wait_for(|v| *v)).await;
  Ok(())
}

/// Shows the player in full or mini size; runs on the main thread for the same reason as `layout`.
fn show(app: &AppHandle, mode: Mode) {
  let a = app.clone();
  let _ = app.run_on_main_thread(move || show_now(&a, mode));
}

fn show_now(app: &AppHandle, mode: Mode) {
  let p = app.state::<Arc<Player>>();
  let main_h = main_win(app).map(|m| hwnd_of(&m)).unwrap_or(0);
  {
    let mut st = p.st.lock().unwrap();
    st.mode = mode;
    st.open = true;
    let floating = mode == Mode::Mini;
    if st.floating != floating && st.video != 0 {
      #[cfg(windows)]
      set_floating(&st, main_h, floating);
      st.floating = floating;
    }
  }
  layout_now(app);
  let st = p.st.lock().unwrap();
  #[cfg(windows)]
  unsafe {
    let _ = ShowWindow(HWND(st.video as _), if st.waiting { SW_HIDE } else { SW_SHOWNOACTIVATE });
  }
  if let Some(o) = &st.overlay {
    let _ = o.show();
    if mode == Mode::Full {
      let _ = o.set_focus();
    } else if let Some(m) = main_win(app) {
      let _ = m.set_focus();
    }
  }
}

/* ------------------------------ mpv (libmpv) ------------------------------ */
async fn start_mpv(app: &AppHandle, extra: &str) -> Result<(), String> {
  let p = app.state::<Arc<Player>>().inner().clone();
  let mut guard = p.mpv.lock().await;
  if guard.is_some() {
    return Ok(());
  }
  let video = p.st.lock().unwrap().video;
  let mut opts: Vec<(String, String)> = [
    ("wid", video.to_string().as_str()),
    ("idle", "yes"), ("force-window", "yes"), ("keep-open", "yes"),
    ("osc", "no"), ("osd-level", "0"), ("osd-bar", "no"), ("border", "no"),
    ("input-default-bindings", "no"), ("input-vo-keyboard", "no"), ("input-cursor", "no"), ("cursor-autohide", "no"),
    ("hwdec", "auto-safe"), ("vo", "gpu-next"),
    ("slang", "tur,tr,eng,en"), ("alang", "jpn,ja,eng,en"), ("subs-fallback", "default"),
    ("sub-auto", "no"), ("embeddedfonts", "yes"),
    // read-ahead kept modest: 400 MiB of buffered video was most of the RAM used while playing
    ("cache", "yes"), ("demuxer-max-bytes", "120MiB"), ("demuxer-max-back-bytes", "24MiB"), ("demuxer-readahead-secs", "45"),
    ("network-timeout", "20"), ("stream-lavf-o", "reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_delay_max=5"),
    ("background-color", "#000000"), ("ytdl", "no"), ("terminal", "no"), ("volume", "100"), ("volume-max", "300"),
  ]
  .into_iter()
  .map(|(k, v)| (k.to_string(), v.to_string()))
  .collect();
  // user's extra mpv options (Ayarlar): "--name=value" words, quotes keep spaces together
  let mut words = Vec::new();
  let (mut cur, mut q) = (String::new(), false);
  for c in extra.chars() {
    match c {
      '"' => q = !q,
      c if c.is_whitespace() && !q => {
        if !cur.is_empty() {
          words.push(std::mem::take(&mut cur));
        }
      }
      c => cur.push(c),
    }
  }
  if !cur.is_empty() {
    words.push(cur);
  }
  for w in words {
    let w = w.trim_start_matches("--");
    let (k, v) = w.split_once('=').unwrap_or((w, "yes"));
    opts.push((k.to_string(), v.to_string()));
  }
  let dll = vendor(app).join("mpv").join("libmpv-2.dll");
  let m = Arc::new(tokio::task::spawn_blocking(move || mpvlib::Mpv::new(&dll, &opts)).await.map_err(|e| e.to_string())??);
  for (i, name) in OBSERVED.iter().enumerate() {
    let _ = m.command(&[json!("observe_property"), json!(i + 1), json!(name)]);
  }
  // mpv's events: property changes and file events go to the controls overlay
  let (done_tx, done_rx) = tokio::sync::watch::channel(false);
  let ev_m = m.clone();
  let app2 = app.clone();
  std::thread::spawn(move || {
    loop {
      match ev_m.wait(1.0) {
        Some(mpvlib::Ev::Prop(name, value)) => overlay_emit(&app2, "mpv:event", json!([{ "type": "prop", "name": name, "value": value }])),
        Some(mpvlib::Ev::Event(name, data)) => {
          // the first picture is ready: the video window comes out from under the opening screen
          if name == "playback-restart" {
            show_picture(&app2);
          }
          overlay_emit(&app2, "mpv:event", json!([{ "type": "event", "name": name, "data": data }]))
        }
        Some(mpvlib::Ev::Shutdown) => break,
        None => {}
      }
    }
    ev_m.destroy();
    let _ = done_tx.send(true);
    let app3 = app2.clone();
    tauri::async_runtime::spawn(async move {
      let p = app3.state::<Arc<Player>>().inner().clone();
      let was_ours = { p.mpv.lock().await.take().is_some() };
      if was_ours {
        // mpv went away by itself (crash, error): don't leave a dead overlay
        overlay_emit(&app3, "mpv:event", json!([{ "type": "exit", "code": null }]));
        if p.st.lock().unwrap().open {
          close(&app3).await;
        }
      }
    });
  });
  *guard = Some(Mpv { m, done: done_rx });
  Ok(())
}

async fn send(app: &AppHandle, command: Value) -> Result<Value, String> {
  let p = app.state::<Arc<Player>>().inner().clone();
  let m = p.mpv.lock().await.as_ref().map(|x| x.m.clone()).ok_or("mpv çalışmıyor")?;
  let cmd = match command {
    Value::Array(a) => a,
    other => vec![other],
  };
  tokio::task::spawn_blocking(move || m.command(&cmd)).await.map_err(|e| e.to_string())?
}

async fn stop_mpv(app: &AppHandle) {
  let p = app.state::<Arc<Player>>().inner().clone();
  let taken = p.mpv.lock().await.take();
  if let Some(Mpv { m, mut done }) = taken {
    let _ = m.command(&[json!("quit")]);
    m.wake();
    let _ = tokio::time::timeout(Duration::from_secs(3), done.wait_for(|v| *v)).await;
  }
}

fn overlay_emit(app: &AppHandle, ch: &str, args: Value) {
  if let Some(o) = app.state::<Arc<Player>>().st.lock().unwrap().overlay.clone() {
    emit_to(&o, Ch::new(ch, args));
  }
}
fn main_emit(app: &AppHandle, ch: &str, args: Value) {
  if let Some(m) = main_win(app) {
    emit_to(&m, Ch::new(ch, args));
  }
}

async fn close(app: &AppHandle) {
  main_emit(app, "player:cover", json!([false]));
  let p = app.state::<Arc<Player>>().inner().clone();
  let (overlay, video) = {
    let mut st = p.st.lock().unwrap();
    if !st.open {
      return;
    }
    st.open = false;
    (st.overlay.clone(), st.video)
  };
  // not under the lock: hiding a window of the main thread waits for that thread (see `layout`)
  #[cfg(windows)]
  unsafe {
    let _ = ShowWindow(HWND(video as _), SW_HIDE);
  }
  if let Some(o) = &overlay {
    let _ = o.hide();
    emit_to(o, Ch::new("player:reset", json!([])));
  }
  stop_mpv(app).await;
  crate::media::stop_all();
  if let Some(m) = main_win(app) {
    let _ = m.set_fullscreen(false);
    main_emit(app, "player:closed", json!([]));
    let _ = m.set_focus();
  }
}

/* --------------------------------- commands --------------------------------- */
#[tauri::command]
pub fn mpv_available(app: AppHandle) -> bool {
  mpv_exe(&app).exists()
}

/// No picture until the next file plays (see `State::waiting`).
fn hide_picture(app: &AppHandle) {
  let p = app.state::<Arc<Player>>().inner().clone();
  p.st.lock().unwrap().waiting = true;
  let _ = app.run_on_main_thread(move || {
    let st = p.st.lock().unwrap();
    #[cfg(windows)]
    if st.waiting && st.video != 0 {
      unsafe {
        let _ = ShowWindow(HWND(st.video as _), SW_HIDE);
      }
    }
  });
}

fn show_picture(app: &AppHandle) {
  let p = app.state::<Arc<Player>>().inner().clone();
  {
    let mut st = p.st.lock().unwrap();
    if !st.waiting {
      return;
    }
    st.waiting = false;
  }
  let _ = app.run_on_main_thread(move || {
    let st = p.st.lock().unwrap();
    #[cfg(windows)]
    if st.open && !st.waiting && st.video != 0 {
      unsafe {
        let _ = ShowWindow(HWND(st.video as _), SW_SHOWNOACTIVATE);
      }
    }
  });
}

#[tauri::command]
pub async fn player_loading(app: AppHandle, l: Value) -> Result<(), String> {
  if !mpv_exe(&app).exists() {
    return Ok(());
  }
  ensure_windows(&app).await?;
  hide_picture(&app);
  overlay_emit(&app, "player:loading", json!([l]));
  let (open, mode) = {
    let st = app.state::<Arc<Player>>();
    let st = st.st.lock().unwrap();
    (st.open, st.mode)
  };
  // Another episode is being prepared: the one playing stops now (its sound went on under the opening
  // screen until the new file was opened).
  if open && app.state::<Arc<Player>>().mpv.lock().await.is_some() {
    let _ = send(&app, json!(["stop"])).await;
  }
  if !open || mode == Mode::Mini {
    show(&app, Mode::Full);
  }
  Ok(())
}

/// What mpv may open: web addresses (sources, debrid, the local torrent stream) and files on this computer
/// the viewer picked. Not network shares (\\host\share: Windows would hand that host the user's login hash)
/// nor mpv's other protocols (av://, lavfi://, edl://… could open a camera or other devices), which an add-on
/// could otherwise send as a "video".
fn safe_src(s: &str) -> bool {
  let l = s.to_ascii_lowercase();
  if l.starts_with("http://") || l.starts_with("https://") {
    return true;
  }
  if s.starts_with("\\\\") || s.starts_with("//") || l.contains("://") {
    return false;
  }
  // a plain absolute path on a drive (C:\…)
  let b = s.as_bytes();
  b.len() > 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/') && std::path::Path::new(s).is_file()
}

#[tauri::command]
pub async fn player_open(app: AppHandle, p: Value, anime4k: String, quality: String, extra_args: String) -> Result<(), String> {
  if !mpv_exe(&app).exists() {
    return Err("mpv bulunamadı (vendor/mpv/libmpv-2.dll).".into());
  }
  ensure_windows(&app).await?;
  hide_picture(&app);
  overlay_emit(&app, "player:load", json!([p.clone()]));
  let (open, mode) = {
    let st = app.state::<Arc<Player>>();
    let st = st.st.lock().unwrap();
    (st.open, st.mode)
  };
  if !open || mode == Mode::Mini {
    show(&app, Mode::Full);
  }
  start_mpv(&app, &extra_args).await?;
  let title = match p["subtitle"].as_str() {
    Some(s) if !s.is_empty() => format!("{} — {}", p["title"].as_str().unwrap_or(""), s),
    _ => p["title"].as_str().unwrap_or("").to_string(),
  };
  let _ = send(&app, json!(["set_property", "force-media-title", title])).await;
  let list = shaders(&app, &anime4k, &quality);
  let _ = send(&app, if list.is_empty() { json!(["change-list", "glsl-shaders", "clr", ""]) } else { json!(["change-list", "glsl-shaders", "set", list]) }).await;
  let src = p["src"].as_str().unwrap_or("");
  if !safe_src(src) {
    return Err("Bu video adresi açılmadı (yalnızca internet adresleri ve bilgisayardaki dosyalar açılır).".into());
  }
  let start = p["start"].as_f64().unwrap_or(0.0);
  // the previous episode was paused while the next one was found; mpv keeps "pause" across files
  let _ = send(&app, json!(["set_property", "pause", false])).await;
  // A torrent's first pieces can take a while from a cold start (peers still being found): mpv gave up
  // after 20 s without data and the episode "didn't open". Debrid / web links keep the short limit.
  let torrent = src.starts_with("http://127.0.0.1:") && src.contains("/t/");
  let _ = send(&app, json!(["set_property", "network-timeout", if torrent { 150 } else { 20 }])).await;
  if start > 0.0 {
    send(&app, json!(["loadfile", src, "replace", -1, format!("start={}", start.floor())])).await?;
  } else {
    send(&app, json!(["loadfile", src, "replace"])).await?;
  }
  Ok(())
}

#[tauri::command]
pub async fn player_close(app: AppHandle) {
  close(&app).await
}

#[tauri::command]
pub async fn player_to_main(app: AppHandle, ch: String, args: Value, close_first: bool) {
  if close_first {
    close(&app).await;
  }
  main_emit(&app, &ch, args);
}

#[tauri::command]
pub fn player_mini(app: AppHandle, mini: bool) {
  if !app.state::<Arc<Player>>().st.lock().unwrap().open {
    return;
  }
  if let Some(m) = main_win(&app) {
    if mini && m.is_fullscreen().unwrap_or(false) {
      let _ = m.set_fullscreen(false);
    }
  }
  show(&app, if mini { Mode::Mini } else { Mode::Full });
}

#[tauri::command]
pub fn player_fullscreen(app: AppHandle) -> bool {
  let Some(m) = main_win(&app) else { return false };
  if app.state::<Arc<Player>>().st.lock().unwrap().mode == Mode::Mini {
    show(&app, Mode::Full);
  }
  let fs = !m.is_fullscreen().unwrap_or(false);
  let _ = m.set_fullscreen(fs);
  fs
}

#[cfg(windows)]
fn cursor() -> POINTI {
  let mut p = POINT::default();
  unsafe {
    let _ = GetCursorPos(&mut p);
  }
  POINTI(p.x, p.y)
}

#[tauri::command]
pub fn player_mini_drag_start(app: AppHandle) {
  let p = app.state::<Arc<Player>>().inner().clone();
  let (video, start) = {
    let mut st = p.st.lock().unwrap();
    if st.mode != Mode::Mini || st.video == 0 {
      return;
    }
    let mut r = RECT::default();
    #[cfg(windows)]
    unsafe {
      let _ = GetWindowRect(HWND(st.video as _), &mut r);
    }
    let start = cursor();
    st.drag = Some((start, RECTI(r.left, r.top, r.right - r.left, r.bottom - r.top), false));
    (st.video, start)
  };
  let _ = video;
  // follow the cursor until the drag ends (the windows are moved on the main thread, see `layout`)
  let app2 = app.clone();
  std::thread::spawn(move || loop {
    std::thread::sleep(Duration::from_millis(12));
    let b = {
      let mut st = p.st.lock().unwrap();
      let Some((s, b0, moved)) = st.drag else { return };
      let c = cursor();
      let (dx, dy) = (c.0 - s.0, c.1 - s.1);
      if !moved && dx.abs() + dy.abs() < 5 {
        continue;
      }
      st.drag = Some((s, b0, true));
      (b0.0 + dx, b0.1 + dy, b0.2, b0.3)
    };
    let _ = start;
    let a = app2.clone();
    let _ = app2.run_on_main_thread(move || {
      let p = a.state::<Arc<Player>>();
      let st = p.st.lock().unwrap();
      if st.drag.is_some() {
        place(&st, b);
      }
    });
  });
}

#[tauri::command]
pub fn player_mini_drag_end(app: AppHandle) -> bool {
  let p = app.state::<Arc<Player>>();
  let moved = {
    let mut st = p.st.lock().unwrap();
    let Some((_, _, moved)) = st.drag.take() else { return false };
    if moved {
      if let Some(m) = main_win(&app) {
        let mut r = RECT::default();
        #[cfg(windows)]
        unsafe {
          let _ = GetWindowRect(HWND(st.video as _), &mut r);
        }
        let pos = m.inner_position().unwrap_or(PhysicalPosition::new(0, 0));
        let size = m.inner_size().unwrap_or(PhysicalSize::new(1, 1));
        let inside = !m.is_minimized().unwrap_or(false)
          && r.left >= pos.x - 8 && r.top >= pos.y - 8 && r.right <= pos.x + size.width as i32 + 8 && r.bottom <= pos.y + size.height as i32 + 8;
        if inside {
          // dropped inside the app: it goes to the nearest corner and follows the app again
          let cx = (r.left + r.right) / 2 - pos.x;
          let cy = (r.top + r.bottom) / 2 - pos.y;
          st.corner = [if cy > size.height as i32 / 2 { b'b' } else { b't' }, if cx > size.width as i32 / 2 { b'r' } else { b'l' }];
          st.free = None;
        } else {
          st.free = Some((r.left, r.top, r.right - r.left, r.bottom - r.top));
        }
      }
    }
    moved
  };
  layout(&app);
  moved
}

// Only what the player UI needs: mpv can also run programs and write files ("run", "subprocess"…),
// which a compromised page must not reach.
const COMMANDS: &[&str] = &["cycle", "seek", "get_property", "sub-add", "sub-reload", "sub-step", "set", "sub-remove", "audio-add", "osd-overlay"];
const PROPS: &[&str] = &[
  "aid", "sid", "mute", "pause", "speed", "sub-delay", "sub-pos", "sub-scale", "volume", "volume-max", "sub-ass-style-overrides",
  "sub-ass-override", "sub-color", "sub-border-color", "sub-border-size", "sub-border-style", "sub-back-color", "sub-font", "sub-bold", "sub-shadow-offset",
  "secondary-sid", "secondary-sub-visibility",
];

#[tauri::command]
pub async fn mpv_command(app: AppHandle, cmd: Vec<Value>) -> Result<Value, String> {
  let name = cmd.first().and_then(|v| v.as_str()).unwrap_or("");
  if !COMMANDS.contains(&name) {
    return Err("İzin verilmeyen oynatıcı komutu".into());
  }
  if name == "set" && !PROPS.contains(&cmd.get(1).and_then(|v| v.as_str()).unwrap_or("")) {
    return Err("İzin verilmeyen oynatıcı ayarı".into());
  }
  if name == "sub-add" {
    let f = cmd.get(1).and_then(|v| v.as_str()).unwrap_or("");
    let ok = f.starts_with("http://") || f.starts_with("https://") || (f.len() > 2 && f.as_bytes()[1] == b':') || f.starts_with('/');
    if !ok {
      return Err("Geçersiz altyazı".into());
    }
  }
  send(&app, Value::Array(cmd)).await
}

#[tauri::command]
pub async fn mpv_set(app: AppHandle, name: String, value: Value) -> Result<Value, String> {
  if !PROPS.contains(&name.as_str()) {
    return Err("İzin verilmeyen oynatıcı ayarı".into());
  }
  send(&app, json!(["set_property", name, value])).await
}

#[tauri::command]
pub async fn mpv_anime4k(app: AppHandle, mode: String, quality: String) -> Result<(), String> {
  let list = shaders(&app, &mode, &quality);
  send(&app, if list.is_empty() { json!(["change-list", "glsl-shaders", "clr", ""]) } else { json!(["change-list", "glsl-shaders", "set", list]) }).await?;
  Ok(())
}

/// Follow the main window (called from its move / resize events), and give the keyboard back to the
/// player when the app is clicked while the player fills it.
pub fn on_main_event(app: &AppHandle, ev: &tauri::WindowEvent) {
  match ev {
    tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. } => layout_now(app),
    tauri::WindowEvent::Focused(true) => {
      let st = app.state::<Arc<Player>>();
      let st = st.st.lock().unwrap();
      if st.open && st.mode == Mode::Full {
        if let Some(o) = &st.overlay {
          let _ = o.set_focus();
        }
      }
    }
    _ => {}
  }
}


/// Move ('move') or resize ('n', 'se'…) the main window from the player overlay: hands the mouse to
/// Windows' own move / size loop on the main window, as if its border had been grabbed.
#[tauri::command]
pub fn win_drag_start(app: AppHandle, mode: String) {
  let Some(m) = main_win(&app) else { return };
  let hit: usize = match mode.as_str() {
    "move" => 2,
    "w" => 10,
    "e" => 11,
    "n" => 12,
    "nw" => 13,
    "ne" => 14,
    "s" => 15,
    "sw" => 16,
    "se" => 17,
    _ => return,
  };
  let h = hwnd_of(&m);
  overlay_emit(&app, "player:dragging", json!([true]));
  let app2 = app.clone();
  std::thread::spawn(move || {
    #[cfg(windows)]
    unsafe {
      use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
      std::thread::sleep(Duration::from_millis(60));
      let mut n = 0;
      while (GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000) != 0 && n < 6000 {
        std::thread::sleep(Duration::from_millis(15));
        n += 1;
      }
    }
    std::thread::sleep(Duration::from_millis(40));
    layout(&app2);
    overlay_emit(&app2, "player:dragging", json!([false]));
  });
  let _ = app.run_on_main_thread(move || {
    #[cfg(windows)]
    unsafe {
      let _ = windows::Win32::UI::Input::KeyboardAndMouse::ReleaseCapture();
      let _ = PostMessageW(Some(HWND(h as _)), WM_NCLBUTTONDOWN, WPARAM(hit), LPARAM(0));
    }
  });
}

/// The player overlay page is loaded and listening.
#[tauri::command]
pub fn overlay_ready(app: AppHandle) {
  let _ = app.state::<Arc<Player>>().ready.send(true);
}

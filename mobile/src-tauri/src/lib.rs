// Anisaki for Android phones and TVs (Tauri). The React UI is the desktop one (src/renderer) with phone
// styles; this side holds the native parts that work on a phone. The torrent engine and the sign-in
// callback are the desktop's own files; video plays in ExoPlayer through the "player" Kotlin plugin.
#[path = "../../../src-tauri/src/events.rs"]
#[allow(dead_code)]
mod events;
#[path = "../../../src-tauri/src/torrent.rs"]
mod torrent;
#[path = "../../../src-tauri/src/anilist.rs"]
mod anilist;
mod subs;
#[path = "../../../src-tauri/src/toz.rs"]
mod toz;
mod localmt;

use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};
use tauri::{Manager, Runtime};

/// ExoPlayer (PlayerActivity) and the phone's other players, from Kotlin: app.anisaki.mobile.PlayerPlugin.
/// The page reaches it through the player_call command below (app commands need no extra permission).
struct PlayerHandle<R: Runtime>(#[allow(dead_code)] Option<tauri::plugin::PluginHandle<R>>);

fn player<R: Runtime>() -> TauriPlugin<R> {
  PluginBuilder::new("player")
    .setup(|app, _api| {
      #[cfg(target_os = "android")]
      let h = Some(_api.register_android_plugin("app.anisaki.mobile", "PlayerPlugin")?);
      #[cfg(not(target_os = "android"))]
      let h = None;
      app.manage(PlayerHandle::<R>(h));
      Ok(())
    })
    .build()
}

/// play (in-app ExoPlayer) / open (the phone's own player): resolves when the player closes, with where it
/// stopped and what the viewer asked for next.
#[tauri::command]
async fn player_call(app: tauri::AppHandle, method: String, args: serde_json::Value) -> Result<serde_json::Value, String> {
  if !["play", "open", "exit", "load", "status", "sources", "close", "installApk", "youtube"].contains(&method.as_str()) {
    return Err("bilinmeyen oynatıcı komutu".into());
  }
  let h = app.state::<PlayerHandle<tauri::Wry>>();
  #[cfg(mobile)]
  let r = match &h.0 {
    Some(h) => h.run_mobile_plugin_async::<serde_json::Value>(method, args).await.map_err(|e| e.to_string()),
    None => Err("Oynatıcı açılamadı".into()),
  };
  #[cfg(not(mobile))]
  let r = {
    let _ = (&h.0, args);
    Err("Oynatıcı yalnızca telefonda çalışır".into())
  };
  r
}

/// The app, for messages the player sends while it is open (next episode, source list…)
static APP: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

/// PlayerActivity.toApp(ch, json): delivered to the page like any other app message ("anisaki" event).
#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub extern "system" fn Java_app_anisaki_mobile_PlayerActivity_toApp<'l>(
  mut env: jni::JNIEnv<'l>,
  _cls: jni::objects::JClass<'l>,
  ch: jni::objects::JString<'l>,
  json: jni::objects::JString<'l>,
) {
  use tauri::Emitter;
  let ch: String = env.get_string(&ch).map(|s| s.into()).unwrap_or_default();
  let json: String = env.get_string(&json).map(|s| s.into()).unwrap_or_default();
  let v: serde_json::Value = serde_json::from_str(&json).unwrap_or(serde_json::Value::Null);
  if let Some(app) = APP.get() {
    let _ = app.emit("anisaki", events::Ch::new(&ch, serde_json::Value::Array(vec![v])));
  }
}

/// Ask the Kotlin side for a folder (prepareToz: Töz's files unpacked from the APK).
async fn player_dir(app: &tauri::AppHandle, method: &str) -> Result<std::path::PathBuf, String> {
  let h = app.state::<PlayerHandle<tauri::Wry>>();
  #[cfg(mobile)]
  {
    let Some(h) = &h.0 else { return Err("Çeviri modeli bu cihazda yok".into()) };
    let v = h.run_mobile_plugin_async::<serde_json::Value>(method, serde_json::json!({})).await.map_err(|e| e.to_string())?;
    v["path"].as_str().map(std::path::PathBuf::from).ok_or_else(|| "Çeviri modeli açılamadı".to_string())
  }
  #[cfg(not(mobile))]
  {
    let _ = (&h.0, method);
    Err("Çeviri modeli yalnızca telefonda".into())
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(player())
    .setup(|app| {
      let _ = APP.set(app.handle().clone());
      // the phone has no writable temp folder: downloads and subtitles go to the app's cache
      if let Ok(dir) = app.path().app_cache_dir() {
        let _ = std::fs::create_dir_all(&dir);
        torrent::set_base_dir(dir.clone());
        subs::set_base_dir(dir);
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      player_call,
      localmt::mt_ready,
      localmt::mt_warm,
      localmt::mt_sentence,
      subs::subs_dir_path,
      subs::subs_exists,
      subs::subs_write,
      subs::subs_read,
      anilist::anilist_wait_token,
      anilist::anilist_cancel,
      anilist::mal_wait_code,
      anilist::lan_ip,
      torrent::torrent_files,
      torrent::torrent_warm,
      torrent::torrent_stream,
      torrent::torrent_stats,
      torrent::torrent_stop_all,
    ])
    .run(tauri::generate_context!())
    .expect("error while running Anisaki");
}

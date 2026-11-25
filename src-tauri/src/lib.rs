// Anisaki desktop (Tauri). The React UI runs in the system WebView (WebView2 on Windows); this side
// holds the native parts: the embedded mpv player, media/subtitle files, on-device translation.
mod events;
mod media;
mod mpvlib;
mod toz;
mod localmt;
mod torrent;
mod anilist;
mod migrate;
mod player;
mod update;

use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .manage(Arc::new(player::Player::new()))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
      }
      let handle = app.handle().clone();
      if let Some(main) = app.get_webview_window("main") {
        main.on_window_event(move |ev| player::on_main_event(&handle, ev));
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      update::update_install,
      player::mpv_available,
      player::player_loading,
      player::player_open,
      player::player_close,
      player::player_to_main,
      player::player_mini,
      player::player_fullscreen,
      player::player_mini_drag_start,
      player::player_mini_drag_end,
      player::mpv_command,
      player::mpv_set,
      player::mpv_anime4k,
      player::win_drag_start,
      player::overlay_ready,
      media::subs_dir_path,
      media::subs_exists,
      media::subs_write,
      media::subs_read,
      media::sub_extract,
      media::sub_extract_cancel,
      media::audio_pcm,
      media::thumb_start,
      media::thumb_at,
      media::local_scan,
      anilist::anilist_wait_token,
      anilist::anilist_cancel,
      anilist::mal_wait_code,
      anilist::lan_ip,
      migrate::electron_settings,
      localmt::mt_ready,
      localmt::mt_warm,
      localmt::mt_sentence,
      torrent::torrent_files,
      torrent::torrent_warm,
      torrent::torrent_stream,
      torrent::torrent_stats,
      torrent::torrent_stop_all,
    ])
    .run(tauri::generate_context!())
    .expect("error while running Anisaki");
}

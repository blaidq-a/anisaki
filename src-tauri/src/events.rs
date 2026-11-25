// One Tauri event ("anisaki") carries every message for the UI: { ch, args } is delivered to the
// listeners the page registered with window.api.on…(ch) (see desktop/api.ts).
use serde::Serialize;
use serde_json::Value;
use tauri::{Emitter, EventTarget, WebviewWindow};

#[derive(Serialize, Clone)]
pub struct Ch {
  ch: String,
  args: Value,
}
impl Ch {
  pub fn new(ch: &str, args: Value) -> Self {
    Ch { ch: ch.to_string(), args }
  }
}

pub fn emit_to(w: &WebviewWindow, c: Ch) {
  let _ = w.emit_to(EventTarget::webview_window(w.label()), "anisaki", c);
}

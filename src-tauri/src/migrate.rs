// Brings over the settings of the old Electron app (%APPDATA%\Anisaki\settings.json): profiles, watch
// lists, addons, AniList links and debrid keys. Electron sealed the keys with its "safeStorage"
// (AES-256-GCM, the key itself protected by Windows DPAPI in "Local State"); they are opened here and
// handed over as plain values, which the page stores again.
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use serde_json::Value;
use std::path::PathBuf;

fn electron_dir() -> Option<PathBuf> {
  std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("Anisaki"))
}

#[cfg(windows)]
fn dpapi(data: &[u8]) -> Option<Vec<u8>> {
  use windows::Win32::Foundation::{HLOCAL, LocalFree};
  use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};
  unsafe {
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut out = CRYPT_INTEGER_BLOB::default();
    CryptUnprotectData(&input, None, None, None, None, 0, &mut out).ok()?;
    let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
    let _ = LocalFree(Some(HLOCAL(out.pbData as _)));
    Some(v)
  }
}

/// The old app's settings as JSON text (sealed values opened), or None when there is nothing to bring over.
#[tauri::command]
pub fn electron_settings() -> Option<String> {
  let dir = electron_dir()?;
  let text = std::fs::read_to_string(dir.join("settings.json")).ok()?;
  let mut json: Value = serde_json::from_str(&text).ok()?;
  // the AES key of Electron's safeStorage
  let key = std::fs::read_to_string(dir.join("Local State"))
    .ok()
    .and_then(|s| serde_json::from_str::<Value>(&s).ok())
    .and_then(|v| v["os_crypt"]["encrypted_key"].as_str().map(String::from))
    .and_then(|k| base64::engine::general_purpose::STANDARD.decode(k).ok())
    .and_then(|k| if k.starts_with(b"DPAPI") { dpapi(&k[5..]) } else { None });
  let open = |v: &str| -> Option<String> {
    let raw = base64::engine::general_purpose::STANDARD.decode(v).ok()?;
    if raw.starts_with(b"v10") && raw.len() > 15 {
      let k = key.as_ref()?;
      let c = Aes256Gcm::new_from_slice(k).ok()?;
      let plain = c.decrypt(Nonce::from_slice(&raw[3..15]), &raw[15..]).ok()?;
      String::from_utf8(plain).ok()
    } else {
      dpapi(&raw).and_then(|p| String::from_utf8(p).ok())
    }
  };
  // every "enc:…" string anywhere in the file becomes "raw:…"
  fn walk(v: &mut Value, open: &dyn Fn(&str) -> Option<String>) {
    match v {
      Value::String(s) if s.starts_with("enc:") => {
        *s = open(&s[4..]).map(|p| format!("raw:{p}")).unwrap_or_default();
      }
      Value::Array(a) => a.iter_mut().for_each(|x| walk(x, open)),
      Value::Object(o) => o.values_mut().for_each(|x| walk(x, open)),
      _ => {}
    }
  }
  walk(&mut json, &open);
  Some(json.to_string())
}

// AniList sign-in: the default browser opens AniList's page (implicit OAuth grant); AniList redirects to
// a small page served here on 127.0.0.1:43219, which posts the token (from the URL fragment) back. The
// page then links the profile with that token. No copy/paste, no in-app browser.
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

const PORT: u16 = 43219;
const CALLBACK_HTML: &str = include_str!("anilist_callback.html");

/// Where the sign-in waits: this device only, or (TV) the home network too, since the sign-in is done
/// on a phone that scanned the TV's QR code and comes back to the TV's own address. Only while waiting.
fn host(lan: Option<bool>) -> &'static str {
  if lan == Some(true) { "0.0.0.0" } else { "127.0.0.1" }
}

/// This device's address on the home network (for the TV's sign-in QR code).
#[tauri::command]
pub fn lan_ip() -> Option<String> {
  let s = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
  s.connect("8.8.8.8:80").ok()?; // nothing is sent: this only picks the outgoing interface
  match s.local_addr().ok()?.ip() {
    std::net::IpAddr::V4(v) if v.is_private() => Some(v.to_string()),
    _ => None,
  }
}

fn pending() -> &'static Mutex<Option<oneshot::Sender<()>>> {
  static P: OnceLock<Mutex<Option<oneshot::Sender<()>>>> = OnceLock::new();
  P.get_or_init(Default::default)
}

/// Waits (up to 5 minutes) for the browser to come back with the token.
#[tauri::command]
pub async fn anilist_wait_token(lan: Option<bool>) -> Result<String, String> {
  anilist_cancel();
  let (cancel_tx, mut cancel_rx) = oneshot::channel();
  *pending().lock().unwrap() = Some(cancel_tx);
  let l = TcpListener::bind((host(lan), PORT)).await.map_err(|_| "AniList girişi için gereken port (43219) kullanımda.".to_string())?;
  let wait = async {
    loop {
      let Ok((mut s, _)) = l.accept().await else { continue };
      let mut buf = vec![0u8; 8192];
      let mut n = 0;
      // read the request (headers + a small body)
      loop {
        match tokio::time::timeout(Duration::from_secs(5), s.read(&mut buf[n..])).await {
          Ok(Ok(0)) | Err(_) | Ok(Err(_)) => break,
          Ok(Ok(k)) => {
            n += k;
            let t = String::from_utf8_lossy(&buf[..n]);
            if let Some(h) = t.find("\r\n\r\n") {
              let len = t[..h].lines().find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0))).unwrap_or(0);
              if n >= h + 4 + len || n == buf.len() {
                break;
              }
            }
          }
        }
      }
      let t = String::from_utf8_lossy(&buf[..n]).to_string();
      let first = t.lines().next().unwrap_or("");
      if first.starts_with("GET /anilist/callback") {
        let body = CALLBACK_HTML.as_bytes();
        let _ = s.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).as_bytes()).await;
        let _ = s.write_all(body).await;
      } else if first.starts_with("POST /anilist/token") {
        let token = t.split("\r\n\r\n").nth(1).unwrap_or("").trim().to_string();
        let ok = !token.is_empty() && token.len() < 4096;
        let _ = s.write_all(if ok { b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n" as &[u8] } else { b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n" }).await;
        if ok {
          return token;
        }
      } else {
        let _ = s.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
      }
    }
  };
  let r = tokio::select! {
    t = wait => Ok(t),
    _ = &mut cancel_rx => Err("Giriş iptal edildi.".to_string()),
    _ = tokio::time::sleep(Duration::from_secs(1200)) => Err("Giriş zaman aşımına uğradı.".to_string()),
  };
  *pending().lock().unwrap() = None;
  r
}

#[tauri::command]
pub fn anilist_cancel() {
  if let Some(tx) = pending().lock().unwrap().take() {
    let _ = tx.send(());
  }
}

/// MyAnimeList sign-in (OAuth code + PKCE): the browser comes back to 127.0.0.1:43219/mal/callback with
/// ?code=…&state=…; the query is handed to the page, which exchanges the code for a token itself.
#[tauri::command]
pub async fn mal_wait_code(lan: Option<bool>) -> Result<String, String> {
  anilist_cancel();
  let (cancel_tx, mut cancel_rx) = oneshot::channel();
  *pending().lock().unwrap() = Some(cancel_tx);
  let l = TcpListener::bind((host(lan), PORT)).await.map_err(|_| "MyAnimeList girişi için gereken port (43219) kullanımda.".to_string())?;
  let wait = async {
    loop {
      let Ok((mut s, _)) = l.accept().await else { continue };
      let mut buf = vec![0u8; 8192];
      let n = match tokio::time::timeout(Duration::from_secs(5), s.read(&mut buf)).await {
        Ok(Ok(k)) => k,
        _ => 0,
      };
      let t = String::from_utf8_lossy(&buf[..n]).to_string();
      let first = t.lines().next().unwrap_or("");
      if let Some(rest) = first.strip_prefix("GET /mal/callback?") {
        let query = rest.split(' ').next().unwrap_or("").to_string();
        let page = "<!doctype html><meta charset=utf-8><title>Anisaki</title><body style=\"font:16px system-ui;background:#0a0a0d;color:#f3f3f6;display:grid;place-items:center;height:100vh;margin:0\"><div style=\"text-align:center\"><h2>MyAnimeList bağlandı</h2><p>Bu sekmeyi kapatıp Anisaki'ye dönebilirsin.</p></div>";
        let _ = s.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", page.len()).as_bytes()).await;
        let _ = s.write_all(page.as_bytes()).await;
        if query.contains("code=") || query.contains("error=") {
          return query;
        }
      } else {
        let _ = s.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
      }
    }
  };
  let r = tokio::select! {
    q = wait => Ok(q),
    _ = &mut cancel_rx => Err("Giriş iptal edildi.".to_string()),
    _ = tokio::time::sleep(Duration::from_secs(1200)) => Err("Giriş zaman aşımına uğradı.".to_string()),
  };
  *pending().lock().unwrap() = None;
  r
}

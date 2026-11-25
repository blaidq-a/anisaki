// Streaming straight from BitTorrent (no debrid) with librqbit: only the episode's file is downloaded,
// the pieces under the playback position first, and a small loopback HTTP server hands it to mpv like
// any link (seeking moves the download with it). Uses the user's own connection: peers see their IP.
use librqbit::{AddTorrent, AddTorrentOptions, AddTorrentResponse, ListenerMode, ListenerOptions, ManagedTorrent, Session, SessionOptions};
type ManagedTorrentHandle = Arc<ManagedTorrent>;
use serde::Serialize;
use std::collections::HashMap;
use std::num::NonZeroU32;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const TRACKERS: &[&str] = &[
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.moeking.me:6969/announce",
  "http://nyaa.tracker.wf:7777/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://explodie.org:6969/announce",
  "udp://tracker.qu.ax:6969/announce",
  "udp://tracker.dler.org:6969/announce",
  "udp://opentracker.io:6969/announce",
  "https://tracker.tamersunion.org:443/announce",
  "http://anidex.moe:6969/announce",
];

static BASE: OnceLock<std::path::PathBuf> = OnceLock::new();
/// Where downloads go: the system temp folder, or the app's cache folder on the phone (set at start).
pub fn set_base_dir(dir: std::path::PathBuf) {
  let _ = BASE.set(dir);
}
pub fn torrent_dir() -> std::path::PathBuf {
  BASE.get().cloned().unwrap_or_else(std::env::temp_dir).join("anisaki-torrent")
}

struct Playing {
  handle: ManagedTorrentHandle,
  file: usize,
  len: u64,
}
struct State {
  session: Option<Arc<Session>>,
  port: u16,
  playing: HashMap<String, Playing>,
}
fn st() -> &'static tokio::sync::Mutex<State> {
  static S: OnceLock<tokio::sync::Mutex<State>> = OnceLock::new();
  S.get_or_init(|| tokio::sync::Mutex::new(State { session: None, port: 0, playing: HashMap::new() }))
}

async fn session(upload_kib: u32) -> Result<Arc<Session>, String> {
  let mut s = st().lock().await;
  if let Some(x) = &s.session {
    return Ok(x.clone());
  }
  let _ = std::fs::create_dir_all(torrent_dir());
  // Listening for incoming peers (TCP + uTP, port opened on the router with UPnP) and the well-known
  // trackers for every torrent: without these only outgoing TCP connections were made, and many peers
  // (behind NAT, uTP-only) were never reached.
  let mut last = String::new();
  let mut made = None;
  for port in [42069u16, 42070, 42071, 0] {
    let mut opts = SessionOptions { fastresume: false, persistence: None, ..Default::default() };
    opts.ratelimits.upload_bps = NonZeroU32::new(upload_kib.saturating_mul(1024));
    opts.trackers = TRACKERS.iter().filter_map(|t| url::Url::parse(t).ok()).collect();
    opts.peer_limit = Some(200);
    // The DHT's peer list is saved between runs; on the phone the default (a desktop config folder) does
    // not exist and the engine didn't start, so it goes next to the downloads there.
    if BASE.get().is_some() {
      if let Some(p) = opts.dht.as_mut().and_then(|d| d.persistence.as_mut()) {
        p.config_filename = Some(torrent_dir().join("dht.json"));
      }
    }
    opts.listen = Some(ListenerOptions {
      mode: ListenerMode::TcpAndUtp,
      listen_addr: (std::net::Ipv4Addr::UNSPECIFIED, port).into(),
      enable_upnp_port_forwarding: port != 0,
      announce_port: if port != 0 { Some(port) } else { None },
      ipv4_only: true,
      ..Default::default()
    });
    match Session::new_with_opts(torrent_dir(), opts).await {
      Ok(s) => {
        made = Some(s);
        break;
      }
      Err(e) => last = e.to_string(),
    }
  }
  let sess = made.ok_or_else(|| format!("Torrent başlatılamadı: {last}"))?;
  s.session = Some(sess.clone());
  if s.port == 0 {
    let l = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    s.port = l.local_addr().map_err(|e| e.to_string())?.port();
    tokio::spawn(async move {
      while let Ok((sock, _)) = l.accept().await {
        tokio::spawn(serve(sock));
      }
    });
  }
  Ok(sess)
}

fn with_trackers(magnet: &str) -> String {
  let mut m = magnet.to_string();
  for t in TRACKERS {
    m.push_str("&tr=");
    m.push_str(&urlencode(t));
  }
  m
}
fn urlencode(s: &str) -> String {
  s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

#[derive(Serialize)]
pub struct TFile {
  path: String,
  length: u64,
}

/// Start the torrent engine ahead of time (an anime page opened): finding peers through the DHT is slow
/// from a cold start, and the first episode waited for it.
#[tauri::command]
pub async fn torrent_warm(upload_kib: u32) {
  let _ = session(upload_kib).await;
}

/// The files of a torrent (its metadata comes from peers), so the page can pick the episode's file.
#[tauri::command]
pub async fn torrent_files(magnet: String, upload_kib: u32) -> Result<Vec<TFile>, String> {
  let sess = session(upload_kib).await?;
  let add = sess.add_torrent(AddTorrent::from_url(with_trackers(&magnet)), Some(AddTorrentOptions { list_only: true, ..Default::default() }));
  let r = tokio::time::timeout(Duration::from_secs(60), add)
    .await
    .map_err(|_| "Bu torrent için eş bulunamadı (seed yok ya da ağın torrenti engelliyor). Başka bir kaynak dene.".to_string())?
    .map_err(|e| format!("Torrent açılamadı: {e}"))?;
  let info = match r {
    AddTorrentResponse::ListOnly(l) => l.info,
    AddTorrentResponse::AlreadyManaged(_, h) | AddTorrentResponse::Added(_, h) => {
      let m = h.metadata.load_full().ok_or("torrent bilgisi yok")?;
      m.info.clone()
    }
  };
  Ok(info.iter_file_details().map(|f| TFile { path: f.filename.to_vec().join("/"), length: f.len }).collect())
}

/// Start downloading one file of the torrent and return a local URL that streams it.
#[tauri::command]
pub async fn torrent_stream(magnet: String, hash: String, index: usize, name: Option<String>, upload_kib: u32, keep: bool) -> Result<String, String> {
  let sess = session(upload_kib).await?;
  let hash = hash.to_lowercase();
  // the episode's file, by name when the source gives one (an addon's file number was off by one in a pack)
  let base = name.as_deref().map(|n| n.rsplit(['/', '\\']).next().unwrap_or(n).to_string()).filter(|n| !n.is_empty());
  {
    let mut s = st().lock().await;
    if let Some(p) = s.playing.get(&hash) {
      let same = match &base {
        Some(b) => p.handle.metadata.load_full().and_then(|m| m.info.iter_file_details().nth(p.file).map(|f| f.filename.to_vec().last().map(|x| x == b).unwrap_or(false))).unwrap_or(false),
        None => p.file == index,
      };
      if same {
        return Ok(format!("http://127.0.0.1:{}/t/{hash}", s.port));
      }
    }
    // another episode / source: stop the torrents. The same pack with another episode is taken out too
    // (keeping what it downloaded) and added again below, or it would go on with the previous file.
    let all: Vec<_> = s.playing.drain().map(|(h, p)| (h, p.handle.id())).collect();
    for (h, id) in all {
      let _ = sess.delete(id.into(), h != hash && !keep).await;
    }
  }
  let add = |only: AddTorrentOptions| sess.add_torrent(AddTorrent::from_url(with_trackers(&magnet)), Some(only));
  let by_name = base.as_ref().map(|b| AddTorrentOptions { only_files_regex: Some(format!("{}$", regex::escape(b))), overwrite: true, ..Default::default() });
  let r = match by_name {
    Some(o) => match add(o).await {
      Ok(r) => r,
      Err(_) => add(AddTorrentOptions { only_files: Some(vec![index]), overwrite: true, ..Default::default() }).await.map_err(|e| format!("Torrent açılamadı: {e}"))?,
    },
    None => add(AddTorrentOptions { only_files: Some(vec![index]), overwrite: true, ..Default::default() }).await.map_err(|e| format!("Torrent açılamadı: {e}"))?,
  };
  let handle = r.into_handle().ok_or("torrent eklenemedi")?;
  let meta = handle.metadata.load_full().ok_or("torrent bilgisi yok")?;
  let files: Vec<(String, u64)> = meta.info.iter_file_details().map(|f| (f.filename.to_vec().last().cloned().unwrap_or_default(), f.len)).collect();
  let file = base.as_ref().and_then(|b| files.iter().position(|(n, _)| n == b)).unwrap_or(index);
  let len = files.get(file).map(|f| f.1).ok_or("dosya bulunamadı")?;
  let mut s = st().lock().await;
  s.playing.insert(hash.clone(), Playing { handle, file, len });
  Ok(format!("http://127.0.0.1:{}/t/{hash}", s.port))
}

#[derive(Serialize)]
pub struct TStats {
  peers: usize,
  down: f64,
  up: f64,
  progress: f64,
}
/// Live numbers for the info panel and the opening screen.
#[tauri::command]
pub async fn torrent_stats(hash: String) -> Option<TStats> {
  let s = st().lock().await;
  let p = s.playing.get(&hash.to_lowercase())?;
  let stats = p.handle.stats();
  let (peers, down, up) = stats
    .live
    .as_ref()
    .map(|l| (l.snapshot.peer_stats.live, l.download_speed.mbps * 125_000.0, l.upload_speed.mbps * 125_000.0))
    .unwrap_or((0, 0.0, 0.0));
  let done = stats.file_progress.get(p.file).copied().unwrap_or(0);
  Some(TStats { peers: peers as usize, down, up, progress: if p.len > 0 { done as f64 / p.len as f64 } else { 0.0 } })
}

/// Player closed: stop downloading / uploading and (unless kept) delete the downloaded parts.
#[tauri::command]
pub async fn torrent_stop_all(keep: bool) {
  let mut s = st().lock().await;
  let Some(sess) = s.session.clone() else { return };
  let ids: Vec<_> = s.playing.drain().map(|(_, p)| p.handle.id()).collect();
  drop(s);
  for id in ids {
    let _ = sess.delete(id.into(), !keep).await;
  }
}

/* ------------------------------ loopback server ------------------------------ */
// GET /t/<hash> with an optional Range header; one response per connection.
async fn serve(mut sock: TcpStream) {
  let mut head = Vec::new();
  let mut b = [0u8; 1];
  while !head.ends_with(b"\r\n\r\n") && head.len() < 16 * 1024 {
    match sock.read(&mut b).await {
      Ok(1) => head.push(b[0]),
      _ => return,
    }
  }
  let text = String::from_utf8_lossy(&head).to_string();
  let mut lines = text.lines();
  let first = lines.next().unwrap_or("");
  let mut parts = first.split_whitespace();
  let method = parts.next().unwrap_or("").to_string();
  let path = parts.next().unwrap_or("");
  let hash = path.strip_prefix("/t/").unwrap_or("").split('?').next().unwrap_or("").to_lowercase();
  let range = lines.find_map(|l| l.to_ascii_lowercase().strip_prefix("range: bytes=").map(|r| r.trim().to_string()));
  let found = {
    let s = st().lock().await;
    s.playing.get(&hash).map(|p| (p.handle.clone(), p.file, p.len))
  };
  let Some((handle, file, size)) = found else {
    let _ = sock.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
    return;
  };
  let (start, end) = match &range {
    Some(r) => {
      let (a, z) = r.split_once('-').unwrap_or((r, ""));
      let a: u64 = a.parse().unwrap_or(0);
      let z: u64 = z.parse().ok().map(|z: u64| z.min(size.saturating_sub(1))).unwrap_or(size.saturating_sub(1));
      (a, z)
    }
    None => (0, size.saturating_sub(1)),
  };
  if start >= size {
    let _ = sock.write_all(format!("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{size}\r\nConnection: close\r\n\r\n").as_bytes()).await;
    return;
  }
  let len = end - start + 1;
  let status = if range.is_some() { "206 Partial Content" } else { "200 OK" };
  let cr = if range.is_some() { format!("Content-Range: bytes {start}-{end}/{size}\r\n") } else { String::new() };
  let hdr = format!("HTTP/1.1 {status}\r\nContent-Type: video/x-matroska\r\nAccept-Ranges: bytes\r\nContent-Length: {len}\r\n{cr}Connection: close\r\n\r\n");
  if sock.write_all(hdr.as_bytes()).await.is_err() || method == "HEAD" {
    return;
  }
  // the stream asks for these pieces first; a seek moves the priority with it
  let Ok(mut stream) = handle.clone().stream(file).await else { return };
  if stream.seek(std::io::SeekFrom::Start(start)).await.is_err() {
    return;
  }
  let mut left = len;
  let mut buf = vec![0u8; 256 * 1024];
  while left > 0 {
    let want = (left as usize).min(buf.len());
    match stream.read(&mut buf[..want]).await {
      Ok(0) | Err(_) => break,
      Ok(n) => {
        if sock.write_all(&buf[..n]).await.is_err() {
          break;
        }
        left -= n as u64;
      }
    }
  }
}

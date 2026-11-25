// Straight torrent streaming through Rust (librqbit, src-tauri/src/torrent.rs). The episode's file is
// picked here with the same rules as debrid (file name, file index, episode number).
import { invoke } from '@tauri-apps/api/core'
import { magnet, pickFile } from '../../../main/debrid'
import * as settings from '../../../main/settings'
import type { ResolveProgress, ResolveRequest } from '../../../shared/types'

type TFile = { path: string; length: number }
const opts = () => {
  const s = settings.load()
  return { uploadKib: Math.max(0, s.torrentUploadLimit ?? 0), keep: !!s.torrentKeep }
}

export async function streamTorrent(req: ResolveRequest, onProgress: (p: ResolveProgress) => void): Promise<string> {
  const m = magnet(req)
  onProgress({ stage: 'adding', message: 'Eşler aranıyor…' })
  // The addon already says which file of the torrent is the episode: no separate file listing (that
  // fetched the torrent's metadata from peers twice before anything downloaded).
  // The Rust side then picks the file by its name when it can (the addon's number was off by one in a
  // pack) and by the number otherwise. Without a number (name searches) the file list is read first.
  let index = req.fileIdx
  if (index == null) {
    const files = await invoke<TFile[]>('torrent_files', { magnet: m, uploadKib: opts().uploadKib })
    index = files.indexOf(pickFile<TFile>(files, f => f.path, f => f.length, f => files.indexOf(f), req))
    onProgress({ stage: 'adding', message: 'Eşlere bağlanılıyor…' })
  }
  const url = await invoke<string>('torrent_stream', { magnet: m, hash: req.infoHash, index, name: req.fileIdx != null ? req.filename ?? null : null, ...opts() })
  onProgress({ stage: 'ready', message: 'Hazır' })
  return url
}

export const warmTorrent = () => invoke('torrent_warm', { uploadKib: opts().uploadKib }).catch(() => {})
export const stopTorrents = () => invoke('torrent_stop_all', { keep: opts().keep }).catch(() => {})
export const torrentStats = (hash: string) => invoke<{ peers: number; down: number; up: number; progress: number } | null>('torrent_stats', { hash })

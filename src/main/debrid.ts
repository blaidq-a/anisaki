// Debrid providers: turn a torrent infoHash into a direct HTTP link.
import type { DebridProvider, ResolveProgress, ResolveRequest } from '../shared/types'
import { getDebridKey, load } from './settings'
import { episodeOf } from '../shared/episode'

const VIDEO = /\.(mkv|mp4|webm|avi|m4v|mov|ts)$/i
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

type Progress = (p: ResolveProgress) => void

export function magnet(req: ResolveRequest): string {
  const trackers = (req.sources ?? [])
    .filter(s => s.startsWith('tracker:'))
    .map(s => '&tr=' + encodeURIComponent(s.slice(8)))
    .join('')
  return `magnet:?xt=urn:btih:${req.infoHash}${trackers}`
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p


/**
 * Pick the episode's file inside a torrent. `index` is the file's position in the torrent
 * (what Torrentio's fileIdx refers to); providers number files differently, so it's passed in.
 * The episode number is the safety net: a match that names another episode is not trusted.
 */
export function pickFile<T>(files: T[], name: (f: T) => string, size: (f: T) => number, index: (f: T) => number, req: ResolveRequest): T {
  const videos = files.filter(f => VIDEO.test(name(f)))
  if (!videos.length) throw new Error('Torrentte oynatılabilir video dosyası yok.')
  const fits = (f: T) => req.episode == null || episodeOf(name(f)) == null || episodeOf(name(f)) === req.episode
  if (req.filename) {
    const want = req.filename.toLowerCase()
    const hit = videos.find(f => baseName(name(f)).toLowerCase() === want)
    if (hit && fits(hit)) return hit
  }
  if (req.fileIdx != null) {
    const hit = videos.find(f => index(f) === req.fileIdx)
    if (hit && fits(hit)) return hit
  }
  if (req.episode != null) {
    const same = videos.filter(f => episodeOf(name(f)) === req.episode)
    if (same.length) return same.sort((a, b) => size(b) - size(a))[0]
  }
  if (videos.length === 1) return videos[0]
  if (req.episode != null) throw new Error(`Bu paketin içinde ${req.episode}. bölüm bulunamadı. Başka bir kaynak seç.`)
  return videos.sort((a, b) => size(b) - size(a))[0]
}

function requireKey(p: 'realdebrid' | 'torbox'): string {
  const key = getDebridKey(p)
  if (!key) throw new Error('Debrid API anahtarı kayıtlı değil. Ayarlar sayfasından ekle.')
  return key
}

/* ------------------------------ Real-Debrid ------------------------------ */
const RD = 'https://api.real-debrid.com/rest/1.0'

async function rd<T = any>(key: string, path: string, form?: Record<string, string>): Promise<T> {
  const res = await fetch(RD + path, {
    method: form ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + key },
    body: form ? new URLSearchParams(form) : undefined,
    signal: AbortSignal.timeout(20000)
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : {}
  if (!res.ok) throw new Error('Real-Debrid: ' + (json.error ?? `HTTP ${res.status}`))
  return json
}

async function resolveRealDebrid(req: ResolveRequest, onProgress: Progress): Promise<string> {
  const key = requireKey('realdebrid')
  onProgress({ stage: 'adding', message: 'Torrent Real-Debrid hesabına ekleniyor…' })
  const { id } = await rd<{ id: string }>(key, '/torrents/addMagnet', { magnet: magnet(req) })

  for (let i = 0; i < 120; i++) {
    const info = await rd(key, `/torrents/info/${id}`)
    if (info.status === 'waiting_files_selection') {
      onProgress({ stage: 'selecting', message: 'Bölüm dosyası seçiliyor…' })
      // Real-Debrid numbers files from 1 in torrent order.
      const file = pickFile<any>(info.files, f => f.path, f => f.bytes, f => f.id - 1, req)
      await rd(key, `/torrents/selectFiles/${id}`, { files: String(file.id) })
    } else if (info.status === 'downloaded') {
      onProgress({ stage: 'unrestricting', message: 'Oynatma linki hazırlanıyor…' })
      const { download } = await rd<{ download: string }>(key, '/unrestrict/link', { link: info.links[0] })
      return download
    } else if (['error', 'magnet_error', 'virus', 'dead'].includes(info.status)) {
      throw new Error('Real-Debrid bu torrenti indiremedi (' + info.status + ').')
    } else {
      onProgress({ stage: 'downloading', progress: info.progress ?? 0, message: `Real-Debrid indiriyor… %${info.progress ?? 0}` })
    }
    await sleep(2000)
  }
  throw new Error('Real-Debrid indirmesi çok uzun sürdü. Önbellekte olan (⚡) bir kaynak dene.')
}

/* -------------------------------- TorBox -------------------------------- */
const TB = 'https://api.torbox.app/v1/api'

async function tb<T = any>(key: string, path: string, form?: Record<string, string>): Promise<T> {
  let body: FormData | undefined
  if (form) {
    body = new FormData()
    Object.entries(form).forEach(([k, v]) => body!.append(k, v))
  }
  const res = await fetch(TB + path, {
    method: form ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + key },
    body,
    signal: AbortSignal.timeout(20000)
  })
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok || json.success === false) throw new Error('TorBox: ' + (json.detail ?? json.error ?? `HTTP ${res.status}`))
  return json.data
}

async function resolveTorBox(req: ResolveRequest, onProgress: Progress): Promise<string> {
  const key = requireKey('torbox')
  onProgress({ stage: 'adding', message: 'Torrent TorBox hesabına ekleniyor…' })
  const created = await tb(key, '/torrents/createtorrent', { magnet: magnet(req), seed: '3', allow_zip: 'false' })
  let torrentId: number | undefined = created?.torrent_id ?? created?.id
  const hash = req.infoHash.toLowerCase()

  for (let i = 0; i < 120; i++) {
    let t: any = null
    try {
      if (torrentId != null) t = await tb(key, `/torrents/mylist?id=${torrentId}&bypass_cache=true`)
      else {
        // Queued torrents get no id at first: find it in the list by hash.
        const all: any[] = (await tb(key, '/torrents/mylist?bypass_cache=true')) ?? []
        t = all.find(x => String(x.hash).toLowerCase() === hash) ?? null
        if (t) torrentId = t.id
      }
    } catch (e: any) {
      // A torrent added a moment ago may not be listed yet ("No torrents found"): wait and retry.
      if (!/no torrents found|not found/i.test(e?.message ?? '') || i > 15) throw e
    }
    if (t && (t.download_finished || t.download_present)) {
      // TorBox file ids follow the torrent's own order (what Torrentio's fileIdx refers to).
      const file = pickFile<any>(t.files ?? [], f => f.name ?? f.short_name, f => f.size, f => f.id, req)
      onProgress({ stage: 'unrestricting', message: 'Oynatma linki hazırlanıyor…' })
      return await tb<string>(key, `/torrents/requestdl?token=${encodeURIComponent(key)}&torrent_id=${torrentId}&file_id=${file.id}`)
    }
    const pct = Math.round((t?.progress ?? 0) * 100)
    onProgress({ stage: 'downloading', progress: pct, message: `TorBox indiriyor… %${pct}` })
    await sleep(2000)
  }
  throw new Error('TorBox indirmesi çok uzun sürdü. Önbellekte olan (⚡) bir kaynak dene.')
}

/* ------------------------------- Public API ------------------------------ */
export async function resolve(req: ResolveRequest, onProgress: Progress): Promise<string> {
  const p = load().debridProvider
  let url: string
  if (p === 'realdebrid') url = await resolveRealDebrid(req, onProgress)
  else if (p === 'torbox') url = await resolveTorBox(req, onProgress)
  else throw new Error('Bu kaynak bir torrent. Oynatmak için Ayarlar’dan Real-Debrid veya TorBox anahtarı ekle.')
  await checkLink(url)
  return url
}

/**
 * The service sometimes hands out a link to a file it no longer has (404 on its CDN; mpv then only says
 * "loading failed"). Ask for the first byte before the player gets it, so a broken source counts as failed
 * and the next one is tried.
 */
async function checkLink(url: string) {
  let status = 0
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(15000) })
    status = res.status
    res.body?.cancel().catch(() => {})
  } catch {
    return // slow / unreachable right now: let the player try (it has its own retries)
  }
  if (status === 404 || status === 410 || status >= 500)
    throw new Error(`Bu kaynağın dosyası debrid sunucusunda bozuk (HTTP ${status}). Başka bir kaynak seç.`)
}

/** Which hashes are already cached (instant). Only TorBox exposes this now. */
export async function checkCached(hashes: string[]): Promise<string[]> {
  if (load().debridProvider !== 'torbox' || !hashes.length) return []
  const key = getDebridKey('torbox')
  if (!key) return []
  const out: string[] = []
  for (let i = 0; i < hashes.length; i += 100) {
    const chunk = hashes.slice(i, i + 100)
    try {
      const data = await tb<any>(key, `/torrents/checkcached?hash=${chunk.join(',')}&format=list&list_files=false`)
      for (const d of data ?? []) if (d?.hash) out.push(String(d.hash).toLowerCase())
    } catch {
      /* cache check is best effort */
    }
  }
  return out
}

/** Verify a key and return the account's name. */
export async function testKey(provider: DebridProvider, key: string): Promise<string> {
  if (provider === 'realdebrid') {
    const u = await rd(key, '/user')
    return `${u.username} · ${u.type === 'premium' ? 'Premium' : 'Ücretsiz'}${u.expiration ? ' · bitiş ' + u.expiration.slice(0, 10) : ''}`
  }
  if (provider === 'torbox') {
    const u = await tb(key, '/user/me')
    return `${u.email ?? 'TorBox'} · plan ${u.plan ?? '?'}`
  }
  throw new Error('Sağlayıcı seçilmedi.')
}

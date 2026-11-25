// window.api for the phone / TV app (Tauri on Android). It is the desktop's own api (settings, addons,
// debrid, AniList / MAL, straight torrent streaming through Rust, subtitle files, translation) with the
// player swapped: video plays in ExoPlayer (PlayerActivity, through the "player" Kotlin plugin) or in an
// installed player (mpv, VLC…), which hand back where playback stopped.
import { invoke } from '@tauri-apps/api/core'
import { onBackButtonPress } from '@tauri-apps/api/app'
import { askExit, closeLayer } from './tv'
import { api as desktop, bus } from '../../src/renderer/src/desktop/api'
import * as settings from '../../src/main/settings'
import { prepareSubs } from './subs'
import { aniSkip } from '../../src/renderer/src/components/playerUi'
import { resolveRequest, resolveStream } from '../../src/renderer/src/components/StreamPicker'
import { parseStream, rankStreams, torrentMode, type ParsedStream } from '../../src/renderer/src/lib/streams'
import type { LibraryEntry, PlayPayload, PlayerLoading } from '../../src/shared/types'

type PlayResult = { position: number; duration: number; player: string; action?: string }
const player = (method: 'play' | 'open', args: Record<string, unknown>) => invoke<PlayResult>('player_call', { method, args })

/** Which player the phone uses: the app's own (default) or an installed one (mpv, VLC…) */
export const phonePlayer = {
  get: (): 'internal' | 'external' => (localStorage.getItem('phonePlayer') === 'external' ? 'external' : 'internal'),
  set: (v: 'internal' | 'external') => localStorage.setItem('phonePlayer', v)
}
/** Android TV (or a big screen with a remote): set by the Kotlin side through the user agent */
export const isTv = /AnisakiTV/.test(navigator.userAgent) || matchMedia('(pointer: none)').matches

const { emit, on, changed } = bus

/* ------------------------------ opening screen ------------------------------ */
// A plain overlay while the source is found (the desktop shows this inside its player window).
let overlay: HTMLDivElement | null = null
function showLoading(l: PlayerLoading) {
  hideLoading()
  overlay = document.createElement('div')
  overlay.className = 'm-opening'
  if (l.backdrop) overlay.style.backgroundImage = `url("${l.backdrop}")`
  overlay.innerHTML = `<div class="m-opening-shade"></div><button class="m-opening-x" aria-label="Kapat">✕</button>
    <div class="m-opening-mid"><h1></h1><p></p><div class="m-opening-st"><div class="spinner sm"></div><span>Yükleniyor…</span></div></div>`
  overlay.querySelector('h1')!.textContent = l.title
  overlay.querySelector('p')!.textContent = l.subtitle ?? ''
  overlay.querySelector('button')!.onclick = () => {
    hideLoading()
    emit('player:closed')
  }
  document.body.appendChild(overlay)
}
function hideLoading() {
  overlay?.remove()
  overlay = null
}
function loadingStatus(msg: string) {
  if (session) return void status({ message: msg })
  const el = overlay?.querySelector('.m-opening-st span')
  if (el) el.textContent = msg
}

/* ---------------------------------- player ---------------------------------- */
// One player session for many episodes: the next / previous episode, an episode from the list and another
// source all load into the player that is already open (it shows its own waiting screen meanwhile), so
// the phone never drops back to the app between episodes.
let session = false
let current: PlayPayload | null = null
const ls = (k: string) => localStorage.getItem('player.' + k)

/** What the player gets for one episode / source (subtitles and OP/ED times are fetched first). */
async function playArgs(p: PlayPayload, position: number) {
  const s = settings.publicSettings()
  const [subtitles, segments] = await Promise.all([
    prepareSubs(p, s, loadingStatus),
    p.malId && p.episode ? aniSkip(p.malId, p.episode, p.expectedDuration ?? 1440).catch(() => []) : Promise.resolve([])
  ])
  return {
    url: p.src, title: p.title, subtitle: p.subtitle, position, audioLang: s.audioLangs[0], subLang: subtitles[0]?.lang ?? s.subLangs[0], subLangs: s.subLangs.join(','), subtitles,
    segments: segments.filter(x => x.kind !== 'normal').map(x => ({ start: x.start, end: x.end, kind: x.kind })),
    // OP and ED have their own switches (like the desktop player); the old single switch seeds both
    autoSkipOp: (ls('autoSkipOp') ?? ls('autoSkip')) === 'on',
    autoSkipEd: (ls('autoSkipEd') ?? ls('autoSkip')) === 'on',
    autoNext: ls('autoNext') !== 'off',
    hasNext: !!p.hasNext,
    hasPrev: !!p.hasPrev,
    episode: p.episode ?? 0,
    episodeList: (p.episodeList ?? []).map(e => ({ number: e.number, title: e.title, image: e.image, filler: !!e.filler })),
    // Nothing in Turkish (the file's English subtitles can't be read ahead on a phone): the player
    // translates the English with Töz (the whole file in the background when it is a downloaded one)
    tozAuto: s.autoTranslate && (s.subLangs[0] || 'tr') === 'tr' && !subtitles.some(x => x.lang === 'tr')
  }
}

const resumeAt = (p: PlayPayload) => {
  if (p.start) return p.start * 1000
  try {
    const r = JSON.parse(localStorage.getItem('resume:' + p.animeId) ?? 'null')
    return r && r.ep === p.episode ? r.t * 1000 : 0
  } catch {
    return 0
  }
}

/**
 * The in-app player opens at once, on its own (landscape) waiting screen, while the source is found; the
 * video then loads into it. Before, a waiting screen inside the app came first: it stood upright, had a
 * close button a TV doesn't need, and the anime page flashed between it and the player.
 */
function startSession(l: { title: string; subtitle?: string | null }) {
  session = true
  void player('play', { title: l.title, subtitle: l.subtitle ?? null, message: 'Kaynak aranıyor…' })
    .catch(e => (emit('toast', 'Oynatıcı açılamadı: ' + (e?.message ?? e)), null))
    .then(r => {
      session = false
      if (r && current) afterPlay(current, r.position / 1000, r.duration / 1000)
      current = null
      emit('player:closed')
    })
}

async function playerOpen(p: PlayPayload) {
  if (phonePlayer.get() === 'external') {
    let r: PlayResult | null = null
    current = p
    try {
      hideLoading()
      r = await player('open', { url: p.src, title: p.subtitle ? `${p.title} — ${p.subtitle}` : p.title, position: resumeAt(p) })
    } catch (e: any) {
      emit('toast', 'Oynatıcı açılamadı: ' + (e?.message ?? e))
    } finally {
      if (r && current) afterPlay(current, r.position / 1000, r.duration / 1000)
      current = null
      emit('player:closed')
    }
    return
  }
  // the first episode (the player may already show its waiting screen) or the next one / another source
  hideLoading()
  if (!session) startSession({ title: p.title, subtitle: p.subtitle })
  current = p
  try {
    const args = await playArgs(p, resumeAt(p))
    if (!session) return // closed meanwhile (Back on the waiting screen)
    await invoke('player_call', { method: 'load', args })
  } catch (e: any) {
    void status({ message: 'Açılamadı: ' + (e?.message ?? e) })
  }
}

/** The source search gave up, or the viewer picks the source by hand: the waiting player closes. */
const closeWaiting = () => (session ? invoke('player_call', { method: 'close', args: {} }).catch(() => {}) : undefined)

const status = (o: { title?: string; subtitle?: string; message?: string }) => invoke('player_call', { method: 'status', args: o }).catch(() => {})

// Messages from the open player (PlayerActivity.toApp → Rust → here)
on('player:progress', (pr: { position: number; duration: number }) => current && afterPlay(current, pr.position / 1000, pr.duration / 1000))
// "Kaynaklar" in the player: this episode's sources, best first, listed in the player itself
let offered: ParsedStream[] = []
on('player:sourceList', async () => {
  const p = current
  if (!p?.subIds) return void invoke('player_call', { method: 'sources', args: { list: [] } }).catch(() => {})
  try {
    const s = settings.publicSettings()
    const groups = await api.getStreams(p.subIds.type, p.subIds.ids, p.searchTitles?.length ? { titles: p.searchTitles, episode: p.episode ?? null } : undefined)
    const list = groups.flatMap(g => g.streams.map(x => parseStream(x, g.addon)))
    const hashes = [...new Set(list.filter(x => x.raw.infoHash && !x.direct).map(x => x.raw.infoHash!.toLowerCase()))]
    const cached = new Set(hashes.length ? await desktop.checkCached(hashes).catch(() => [] as string[]) : [])
    const marked = list.map(x => (x.raw.infoHash && cached.has(x.raw.infoHash.toLowerCase()) ? { ...x, cached: true } : x))
    const ranked = rankStreams(marked, p.episode ?? null, s.preferredQuality ?? '1080p', new Set(), p.year, p.total, torrentMode(s), p.searchTitles, s.subLangs?.[0], p.later)
    offered = ranked.slice(0, 30).map(r => r.s)
    await invoke('player_call', {
      method: 'sources',
      args: { list: offered.map(x => ({ label: [x.resolution, x.cached ? '⚡' : null, x.label].filter(Boolean).join(' '), hint: [x.addon, x.size, x.seeders != null ? x.seeders + ' seed' : null].filter(Boolean).join(' · ') })) }
    })
  } catch {
    void invoke('player_call', { method: 'sources', args: { list: [] } }).catch(() => {})
  }
})
let lastPos = 0
on('player:progress', (pr: { position: number }) => (lastPos = pr.position))
on('player:pickSource', async (i: number) => {
  const p = current
  const x = offered[i]
  if (!p || !x) return
  try {
    const off = desktop.onResolveProgress(pr => void status({ message: pr.message }))
    const url = await resolveStream(x, p.episode ?? null).finally(off)
    await playerOpen({ ...p, src: url, source: { addon: x.addon, label: x.label, size: x.size }, start: Math.max(0, lastPos / 1000 - 2), resolve: resolveRequest(x, p.episode ?? null) })
  } catch (e: any) {
    void status({ message: 'Bu kaynak açılamadı: ' + (e?.message ?? e) + ' · Kaynaklar’dan başka birini seç' })
  }
})
// Near the end of an episode: look for the next one's sources now (the list is kept for a few minutes),
// so the switch at the end goes straight to the source
on('player:prefetch', async () => {
  const p = current
  if (!p?.subIds || !p.episode) return
  const next = p.episode + 1
  const ids = p.subIds.ids.map(id => id.replace(/:(\d+)$/, (_, n) => ':' + (Number(n) + 1)))
  void api.getStreams(p.subIds.type, ids, p.searchTitles?.length ? { titles: p.searchTitles, episode: next } : undefined).catch(() => {})
})

/** Sources asked for again within a few minutes (prepared near the end of the last episode) come at once. */
const streamCache = new Map<string, { at: number; job: ReturnType<typeof desktop.getStreams> }>()
function getStreams(type: string, ids: string[], byName?: Parameters<typeof desktop.getStreams>[2]) {
  const key = JSON.stringify([type, ids, byName ?? null])
  const hit = streamCache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.job
  const job = desktop.getStreams(type, ids, byName)
  streamCache.set(key, { at: Date.now(), job })
  job.catch(() => streamCache.delete(key))
  return job
}

/** Back from the player: remember the spot, mark the episode watched past the threshold. */
function afterPlay(p: PlayPayload, pos: number, dur: number) {
  if (!p.animeId || !p.episode || !dur || !pos) return
  try {
    localStorage.setItem('resume:' + p.animeId, JSON.stringify({ ep: p.episode, t: Math.round(pos), d: Math.round(dur), at: Date.now() }))
  } catch {}
  const s = settings.publicSettings()
  if (pos / dur < (s.watchedAt ?? 0.8)) return
  const cur = s.library[p.animeId] as LibraryEntry | undefined
  if ((cur?.progress ?? 0) >= p.episode) return
  const done = p.episodes != null && p.episode >= p.episodes
  void desktop.setLibrary({
    id: p.animeId, title: p.title, cover: p.cover ?? '', episodes: p.episodes ?? null, score: cur?.score ?? null, updated: Date.now(),
    progress: p.episode, status: done ? 'done' : cur?.status === 'plan' || !cur ? 'watching' : cur.status
  })
}

const noop = async () => undefined
const off = () => () => {}
// No Anime4K or mpv on the phone: those settings read as off here. Töz runs on the device (localmt.rs).
const pub = async () => ({ ...(await desktop.getSettings()), engine: 'mpv' as const, anime4k: 'off' as const })

export const api = {
  ...desktop,
  getSettings: pub,
  getStreams,
  setSettings: async (patch: Record<string, unknown>) => (await desktop.setSettings(patch), pub()),

  // player
  mpvAvailable: async () => true,
  playerOpen,
  playerLoading: async (l: PlayerLoading) => {
    // Töz in use: load the model while the source is found, so the translation starts sooner
    const st = settings.load()
    if (st.localTranslate && st.autoTranslate && st.subLangs[0] === 'tr') void invoke('mt_warm').catch(() => {})
    // the player is open (next episode, an episode from its list): its own waiting screen shows this
    if (session) return void status({ title: l.title, subtitle: l.subtitle, message: 'Kaynak aranıyor…' })
    if (phonePlayer.get() === 'external') return showLoading(l)
    startSession({ title: l.title, subtitle: l.subtitle })
  },
  playerClose: async () => (hideLoading(), void closeWaiting(), emit('player:closed')),
  playerManual: async () => (hideLoading(), void closeWaiting(), emit('player:closed')),
  playerNext: noop,
  playerEpisode: noop,
  playerRetry: noop,
  playerMini: noop,
  playerFullscreen: async () => false,
  onPlayerMode: off,
  onPlayerCover: off,
  onPlayerDragging: off,

  // desktop-only things the UI may call
  winMinimize: noop,
  winMaximize: noop,
  winClose: noop,
  winDragStart: noop,
  winDragEnd: noop,
  winState: async () => ({ maximized: false, fullscreen: false }),
  onWinState: off,
  addFolder: async () => pub(),
  removeFolder: async () => pub(),
  scanLocal: async () => [],
  localUrl: async (f: string) => f
}

// Android back button / gesture (and the TV remote's back key): close the opening screen, go back in the
// app, leave it from the first page.
/**
 * Back (phone and TV): closes what is open (a picker, menu or dialog) first; from a page opened from another
 * one (an anime, settings) it goes back; from the other tabs it goes to the home page; on the home page it
 * asks "Uygulamadan çıkılsın mı?" and "Çık" closes the app for good.
 */
onBackButtonPress(() => {
  if (overlay) return void api.playerClose()
  if (closeLayer()) return
  const route = document.body.dataset.route ?? 'home'
  if (route === 'home') return askExit(() => void invoke('player_call', { method: 'exit', args: {} }).catch(() => {}))
  if (['discover', 'calendar', 'library'].includes(route)) return void emit('nav', 'home')
  if (document.querySelector('.navarrows .iconbtn:not(:disabled)')) emit('nav', 'back')
  else emit('nav', 'home')
}).catch(() => {})
void changed
void on

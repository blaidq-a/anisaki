// window.api for the desktop app (Tauri). The UI was written against Electron's preload; the same calls
// now run here: settings / addons / debrid / AniList code from src/main runs in the WebView (as on the
// phone), window controls go to Tauri, and native work (mpv, files, torrents, translation) to Rust
// commands as they are ported. Calls not ported yet answer harmlessly so the UI keeps working.
import { Window, getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { emitTo, listen } from '@tauri-apps/api/event'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import * as settings from '../../../main/settings'
import * as addons from '../../../main/addons'
import * as debrid from '../../../main/debrid'
import * as anilist from '../../../main/anilist-api'
import { fillers } from '../../../main/fillers'
import { subtitleFile, subtitleText, readSub } from './subs'
import { translateToFile, setTranslateFocus, type TranslateSource } from './translate'
import { localReady, translateLocal, warmLocal } from './localmt'
import { parseCues } from '../../../shared/cues'
import { streamTorrent, stopTorrents, torrentStats, warmTorrent } from './torrent'
import { open as pickFolder } from '@tauri-apps/plugin-dialog'
import { notifications as aniNotifications, gql as aniGql } from '../lib/anilist'
import { signIn } from './login'
import { freshToken, malClientId, malDelete, malFinish, malLogin, malPending, malPullList, malPush, resolveMalIds } from './mal'
import { openUrl } from '@tauri-apps/plugin-opener'

// Links leave the app only as web pages, in the default browser (Electron's setWindowOpenHandler).
window.open = ((url?: string | URL) => {
  const u = String(url ?? '')
  if (/^https?:\/\//i.test(u)) openUrl(u).catch(() => {})
  return null
}) as typeof window.open
document.addEventListener('click', e => {
  const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
  if (a && /^https?:\/\//i.test(a.href) && !a.href.startsWith(location.origin)) {
    e.preventDefault()
    openUrl(a.href).catch(() => {})
  }
})

/** "[SubsPlease] Sousou no Frieren - 05 (1080p) [ABCD].mkv" → title + episode */
function parseName(file: string): { title: string; episode: number | null } {
  let s = file.replace(/\.[^.]+$/, '')
  s = s.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/[._]/g, ' ')
  const m = s.match(/(?:^|\s)(?:-\s*|E|EP|Episode\s*)(\d{1,4})(?:v\d)?(?=\s|$)/i) || s.match(/\s(\d{1,4})(?:v\d)?\s*$/)
  const episode = m ? parseInt(m[1], 10) : null
  const title = (m ? s.slice(0, m.index) : s).replace(/\s+-\s*$/, '').replace(/\s+/g, ' ').trim()
  return { title, episode }
}

/** AniList list ⇄ the profile's list (both ways), like the old main process did. */
/** Entries that came out different from the local list (new, or another status / progress / score). */
const changes = (before: Record<string, LibraryEntry>, after: Record<string, LibraryEntry>) =>
  Object.values(after).filter(e => { const b = before[e.id]; return !b || b.status !== e.status || b.progress !== e.progress || (b.score ?? null) !== (e.score ?? null) }).length

/**
 * Syncs run here, not in the settings page: leaving the page doesn't stop them, the result comes as a toast
 * wherever the user is, and the page asks which ones are still running when it opens again.
 */
const syncing = new Set<string>()
const stops = new Map<string, AbortController>()
const stopped = () => new Error('iptal')
const syncState = () => (emit('sync:state', [...syncing]), share('sync:state', [...syncing]))
async function tracked(service: 'anilist' | 'mal', profileId: string, job: (signal: AbortSignal) => Promise<{ total: number; pushed: number; pulled: number }>) {
  const key = service + ':' + profileId
  const label = service === 'mal' ? 'MyAnimeList' : 'AniList'
  if (syncing.has(key)) throw new Error(label + ' zaten eşitleniyor.')
  syncing.add(key)
  const ctl = new AbortController()
  stops.set(key, ctl)
  syncState()
  try {
    // İptal answers at once, even while a request is still waiting; the job itself stops at its next step
    const r = await Promise.race([job(ctl.signal), new Promise<never>((_, no) => ctl.signal.addEventListener('abort', () => no(stopped())))])
    emit('toast', !r.pulled && !r.pushed ? `${label} zaten eşitli · ${r.total} anime` : `${label} eşitlendi · ${r.pulled} değişiklik alındı, ${r.pushed} gönderildi`)
    return r
  } catch (e: any) {
    emit('toast', ctl.signal.aborted ? `${label} eşitlemesi iptal edildi (o ana kadar gönderilenler kaldı)` : `${label} eşitlenemedi: ${e?.message ?? e}`)
    throw e
  } finally {
    stops.delete(key)
    syncing.delete(key)
    syncState()
  }
}

async function syncAniList(profileId: string, signal?: AbortSignal) {
  const p = settings.load().profiles.find(x => x.id === profileId)
  const token = settings.aniListToken(profileId)
  if (!p?.anilist || !token) throw new Error('Bu profile bağlı AniList hesabı yok.')
  const remote = await anilist.pullList(token, p.anilist.userId)
  const { merged, toPush } = anilist.merge(p.library, remote)
  for (const e of Object.values(merged)) if (e.status === 'done' && e.episodes && e.progress < e.episodes) e.progress = e.episodes
  for (const e of toPush) {
    if (signal?.aborted) throw stopped()
    await anilist.pushEntry(token, e).catch(() => {})
  }
  if (signal?.aborted) throw stopped()
  const active = settings.load().activeProfile
  settings.switchProfile(profileId)
  settings.setLibrary(merged)
  settings.switchProfile(active)
  changed()
  return { total: Object.keys(merged).length, pushed: toPush.length, pulled: changes(p!.library, merged) }
}
/** A working MAL access token for a profile (refreshed and saved when it is about to run out). */
async function malAccess(profileId: string): Promise<string | null> {
  const t = settings.malToken(profileId)
  return t ? freshToken(t, n => settings.saveMalToken(profileId, n)) : null
}

/** MyAnimeList list ⇄ the profile's list, the same way as AniList (the more recently changed side wins). */
async function syncMal(profileId: string, signal?: AbortSignal) {
  const access = await malAccess(profileId)
  if (!access) throw new Error('Bu profile bağlı MyAnimeList hesabı yok.')
  const p = settings.load().profiles.find(x => x.id === profileId)!
  const remote = await malPullList(access)
  const { merged, toPush } = anilist.merge(p.library, remote)
  for (const e of Object.values(merged)) if (e.status === 'done' && e.episodes && e.progress < e.episodes) e.progress = e.episodes
  await resolveMalIds(toPush.map(e => e.id))
  for (const e of toPush) {
    if (signal?.aborted) throw stopped()
    await malPush(access, e).catch(() => {})
  }
  if (signal?.aborted) throw stopped()
  const active = settings.load().activeProfile
  settings.switchProfile(profileId)
  settings.setLibrary(merged)
  settings.switchProfile(active)
  changed()
  return { total: Object.keys(merged).length, pushed: toPush.length, pulled: changes(p!.library, merged) }
}

/** AniList client registered with the redirect https://blaidq-a.github.io/anisaki/giris.html (pages/, see login.ts) */
const ANILIST_CLIENT_ID = '57512'
const clientId = () => (settings.load().anilistClientId || ANILIST_CLIENT_ID).trim()
import type { Anime4KMode, DebridProvider, LibraryEntry, PlayerLoading, PlayPayload, ResolveProgress, ResolveRequest } from '../../../shared/types'

// Requests to other sites go through Rust (no CORS limits, like Electron's main process had).
const pageFetch = window.fetch.bind(window)
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  // Tauri's own IPC travels as fetch to http://ipc.localhost too: local hosts stay on the page's fetch
  const remote = /^https?:\/\//i.test(url) && !/^https?:\/\/([^/]*\.)?localhost(:\d+)?(\/|$)/i.test(url) && !/^https?:\/\/127\./.test(url)
  return remote ? tauriFetch(input as any, init) : pageFetch(input as any, init)
}) as typeof fetch

/* ---------------------------------- events ---------------------------------- */
const listeners = new Map<string, Set<(...a: any[]) => void>>()
// Messages that arrive before anyone listens (the player page mounting) wait here for the first listener.
const early = new Map<string, any[][]>()
function on<T extends any[]>(ch: string, cb: (...a: T) => void) {
  if (!listeners.has(ch)) listeners.set(ch, new Set())
  listeners.get(ch)!.add(cb as any)
  const queued = early.get(ch)
  if (queued) {
    early.delete(ch)
    queueMicrotask(() => queued.forEach(a => (cb as any)(...a)))
  }
  return () => void listeners.get(ch)!.delete(cb as any)
}
const emit = (ch: string, ...a: any[]) => {
  const ls = listeners.get(ch)
  if (ls?.size) ls.forEach(f => f(...a))
  else if (/^(player:|mpv:event)/.test(ch)) early.set(ch, [...(early.get(ch) ?? []), a].slice(-50))
}
// Messages from Rust and from the other window (main ⇄ player overlay) arrive as one event
const listening = listen<{ ch: string; args: any[] }>('anisaki', e => emit(e.payload.ch, ...e.payload.args))
const self = getCurrentWindow().label
const other = self === 'main' ? 'overlay' : 'main'
/** Tell the other window too (Electron's main process relayed these between windows). */
const share = (ch: string, ...args: any[]) => emitTo(other, 'anisaki', { ch, args }).catch(() => {})
const changed = () => (emit('settings:changed'), share('settings:changed'))

let loadingInfo: PlayerLoading | null = null
const loadingListeners = new Set<(l: PlayerLoading | null) => void>()
const setLoadingInfo = (l: PlayerLoading | null) => ((loadingInfo = l), loadingListeners.forEach(f => f(l)))

const SETTABLE = ['anime4k', 'anime4kQuality', 'engine', 'builtinSubs', 'autoTranslate', 'localTranslate', 'mpvArgs', 'debridProvider', 'audioLangs', 'subLangs', 'autoSubs', 'watchedAt', 'anilistClientId', 'autoSource', 'preferredQuality', 'preferEmbedded', 'streamMode', 'torrentUploadLimit', 'torrentKeep', 'theme', 'anime4kOff4k', 'skipFillers', 'hideSpoilers', 'noAccountWarn', 'startProfile'] as const
// Everything plays in the embedded mpv now (the old browser player needed Electron's ffmpeg server).
const pub = () => ({ ...settings.publicSettings(), engine: 'mpv' as const })

function setLibrary(entry: LibraryEntry | { id: number; remove: true }) {
  const lib = { ...settings.activeProfile().library }
  if ('remove' in entry) delete lib[entry.id]
  else lib[entry.id] = { ...entry, updated: Date.now() }
  settings.setLibrary(lib)
  share('settings:changed') // the player overlay marks episodes watched
  const p = settings.activeProfile()
  const token = settings.aniListToken(p.id)
  if (token && p.anilist) {
    const job = 'remove' in entry ? anilist.deleteEntry(token, p.anilist.userId, entry.id) : anilist.pushEntry(token, lib[entry.id])
    // the player overlay marks episodes watched: its toasts go to the main window, where they show
    job.catch(e => (emit('toast', 'AniList’e kaydedilemedi: ' + (e?.message ?? e)), share('toast', 'AniList’e kaydedilemedi: ' + (e?.message ?? e))))
  }
  if (settings.malToken(p.id))
    malAccess(p.id)
      .then(access => (!access ? undefined : 'remove' in entry ? malDelete(access, entry.id) : malPush(access, lib[entry.id])))
      .catch(e => (emit('toast', 'MyAnimeList’e kaydedilemedi: ' + (e?.message ?? e)), share('toast', 'MyAnimeList’e kaydedilemedi: ' + (e?.message ?? e))))
  return lib
}

/* ---------------------------------- window ---------------------------------- */
// Window buttons act on the main window, also from the player overlay that covers it.
const win = self === 'main' ? getCurrentWindow() : ((await Window.getByLabel('main')) ?? getCurrentWindow())
const winState = async () => ({ maximized: await win.isMaximized(), fullscreen: await win.isFullscreen() })
win.onResized(async () => emit('win:state', await winState()))

/** The old browser player's ffmpeg pipeline: the desktop app plays everything in mpv now. */
const notYet = (what: string) => async (..._args: any[]): Promise<any> => {
  throw new Error(`${what}: bu oynatıcı artık kullanılmıyor`)
}
const noop = async () => undefined
const translations = new Map<string, AbortController>()
type MtStatus = { state: 'missing' | 'downloading' | 'ready'; progress?: number; error?: string; model?: 'toz' | 'nllb'; mb?: number; other?: boolean }
const off = () => () => {}

/** For the phone build (mobile/src/api.ts), which adds its own player on top of this object. */
export const bus = { on, emit, changed }

export const api = {
  getSettings: async () => pub(),
  setSettings: async (patch: Record<string, unknown>) => {
    settings.save(Object.fromEntries(SETTABLE.filter(k => patch?.[k] !== undefined).map(k => [k, patch[k]])) as any)
    return pub()
  },
  onSettingsChanged: (cb: () => void) => on('settings:changed', cb),
  onToast: (cb: (m: string) => void) => on('toast', cb),

  addProfile: async (name: string) => (settings.addProfile(name), changed(), pub()),
  removeProfile: async (id: string) => (settings.removeProfile(id), changed(), pub()),
  switchProfile: async (id: string) => (settings.switchProfile(id), changed(), pub()),
  renameProfile: async (id: string, name: string) => (settings.renameProfile(id, name), pub()),
  aniListLogin: async (profileId: string) => {
    const id = clientId()
    if (!/^\d+$/.test(id)) throw new Error('AniList Client ID tanımlı değil.')
    const token = await signIn('AniList', `https://anilist.co/api/v2/oauth/authorize?client_id=${id}&response_type=token`, lan => invoke<string>('anilist_wait_token', { lan }))
    const acc = await anilist.viewer(token)
    settings.setAniList(profileId, { ...acc, token } as any)
    // the list syncs in the background (its progress shows on the buttons, the result as a toast)
    tracked('anilist', profileId, sig => syncAniList(profileId, sig)).catch(() => {})
    const r = { total: 0, pushed: 0 }
    await win.setFocus().catch(() => {})
    return { name: acc.name, ...r }
  },
  aniListLogout: async (id: string) => (settings.setAniList(id, null), changed(), pub()),
  aniListCancel: () => invoke<void>('anilist_cancel'),
  aniListReady: async () => /^\d+$/.test(clientId()),
  aniListSync: (profileId: string) => tracked('anilist', profileId, sig => syncAniList(profileId, sig)),
  syncState: async () => [...syncing],
  cancelSync: async (key: string) => stops.get(key)?.abort(),
  onSyncState: (cb: (keys: string[]) => void) => on('sync:state', cb),
  malReady: async () => !!malClientId(),
  malPending: () => malPending(),
  /** Finish the sign-in from the browser's address (when the app missed the redirect) */
  malPaste: async (profileId: string, address: string) => {
    const { account, token } = await malFinish(address.trim())
    invoke('anilist_cancel').catch(() => {})
    settings.setMal(profileId, { ...account, token })
    tracked('mal', profileId, sig => syncMal(profileId, sig)).catch(() => {})
    return { name: account.name, total: 0, pushed: 0 }
  },
  malLogin: async (profileId: string) => {
    const { account, token } = await malLogin()
    settings.setMal(profileId, { ...account, token })
    await win.setFocus().catch(() => {})
    tracked('mal', profileId, sig => syncMal(profileId, sig)).catch(() => {})
    const r = { total: 0, pushed: 0 }
    return { name: account.name, ...r }
  },
  malLogout: async (id: string) => (settings.setMal(id, null), changed(), pub()),
  malSync: (profileId: string) => tracked('mal', profileId, sig => syncMal(profileId, sig)),
  /** AniList notifications of the active profile's account (null: no account linked) */
  notifications: async (page = 1) => {
    const token = settings.aniListToken()
    return token && settings.activeProfile().anilist ? aniNotifications(token, page) : null
  },
  unreadNotifications: async (): Promise<number> => {
    const token = settings.aniListToken()
    if (!token || !settings.activeProfile().anilist) return 0
    const d = await aniGql<any>('query { Viewer { unreadNotificationCount } }', {}, token).catch(() => null)
    return d?.Viewer?.unreadNotificationCount ?? 0
  },
  setDebridKey: async (p: Exclude<DebridProvider, 'none'>, key: string) => {
    const account = key ? await debrid.testKey(p, key) : ''
    settings.setDebridKey(p, key)
    return account
  },
  testDebrid: async (p: Exclude<DebridProvider, 'none'>) => {
    const key = settings.getDebridKey(p)
    if (!key) throw new Error('Kayıtlı anahtar yok.')
    if (settings.usingBuiltinKey(p)) return debrid.testKey(p, key).then(() => 'Uygulamaya gömülü TorBox hesabı çalışıyor')
    return debrid.testKey(p, key)
  },
  setLibrary: async (e: LibraryEntry | { id: number; remove: true }) => setLibrary(e),

  installAddon: async (url: string) => {
    return addons.installAddon(url)
  },
  removeAddon: async (id: string) => addons.removeAddon(id),
  toggleAddon: async (id: string, onOff: boolean) => addons.toggleAddon(id, onOff),
  addonPrefixes: async () => addons.streamIdPrefixes(),
  getStreams: (type: string, ids: string[], byName?: addons.NameQuery) => addons.getStreams(type, ids, byName),
  getSubtitles: (type: string, ids: string[]) => addons.getSubtitles(type, ids),

  checkCached: (hashes: string[]) => debrid.checkCached(hashes),
  resolve: (req: ResolveRequest) => {
    const progress = (p: ResolveProgress) => (emit('debrid:progress', p), share('debrid:progress', p))
    // Debrid when a service is set up (and, in "auto", has the file cached); otherwise straight torrent.
    const s = settings.load()
    const hasDebrid = s.debridProvider !== 'none' && !!settings.getDebridKey(s.debridProvider)
    const useTorrent = s.streamMode === 'torrent' || !hasDebrid || (s.streamMode === 'auto' && !req.cached)
    return useTorrent ? streamTorrent(req, progress) : debrid.resolve(req, progress)
  },
  torrentStats: (hash: string) => torrentStats(hash).catch(() => null),
  /** An anime page opened: start the torrent engine now if episodes may play over torrent. */
  torrentWarm: () => {
    const s = settings.load()
    const hasDebrid = s.debridProvider !== 'none' && !!settings.getDebridKey(s.debridProvider)
    if (s.streamMode !== 'debrid' && (s.streamMode === 'torrent' || s.streamMode === 'auto' || !hasDebrid)) void warmTorrent()
  },
  onResolveProgress: (cb: (p: ResolveProgress) => void) => on('debrid:progress', cb),
  fillers: (titles: string[]) => fillers(titles),

  addFolder: async () => {
    const dir = await pickFolder({ directory: true, multiple: false })
    if (typeof dir === 'string' && dir) settings.save({ localFolders: [...new Set([...settings.load().localFolders, dir])] } as any)
    return pub()
  },
  removeFolder: async (f: string) => (settings.save({ localFolders: settings.load().localFolders.filter((x: string) => x !== f) } as any), pub()),
  scanLocal: async () => {
    const files = await invoke<{ path: string; name: string; size: number }[]>('local_scan', { folders: settings.load().localFolders })
    return files.map(f => ({ ...f, ...parseName(f.name) })).sort((a, b) => a.title.localeCompare(b.title) || (a.episode ?? 0) - (b.episode ?? 0))
  },
  // mpv plays files straight from disk
  localUrl: async (f: string) => f,

  // embedded mpv (Rust: src-tauri/src/player.rs)
  mpvAvailable: () => invoke<boolean>('mpv_available'),
  playerOpen: (p: PlayPayload) => {
    // the opening screen stays on the cover until the first picture (the video window is hidden till then)
    const st = settings.load()
    return invoke<void>('player_open', { p, anime4k: st.anime4k, quality: st.anime4kQuality, extraArgs: st.mpvArgs ?? '' })
  },
  playerLoading: (l: PlayerLoading) => {
    // the same opening screen on the main window's cover: the player's own (a separate window) is hidden
    // while the window is dragged, and the cover showed plain black then
    loadingInfo = l
    loadingListeners.forEach(f => f(l))
    // On-device translation in use (main subtitle language isn't English): load the model meanwhile.
    const st = settings.load()
    if (st.localTranslate && st.autoTranslate && st.subLangs[0] && st.subLangs[0] !== 'en') warmLocal()
    return invoke<void>('player_loading', { l })
  },
  onPlayerLoading: (cb: (l: PlayerLoading) => void) => on('player:loading', cb),
  playerClose: () => (setLoadingInfo(null), invoke<void>('player_close')),
  /** What the opening screen shows (title, episode, picture) while the source is found; null once it plays. */
  onLoadingInfo: (cb: (l: PlayerLoading | null) => void) => (cb(loadingInfo), loadingListeners.add(cb), () => void loadingListeners.delete(cb)),
  playerNext: () => invoke<void>('player_to_main', { ch: 'player:next', args: [], closeFirst: true }),
  playerRetry: () => invoke<void>('player_to_main', { ch: 'player:retry', args: [], closeFirst: true }),
  playerEpisode: (delta: number) => invoke<void>('player_to_main', { ch: 'player:episode', args: [delta], closeFirst: false }),
  /** Jump to episode n from the player's episode list */
  playerGoto: (n: number) => invoke<void>('player_to_main', { ch: 'player:goto', args: [n], closeFirst: false }),
  onPlayerGoto: (cb: (n: number) => void) => on('player:goto', cb),
  playerManual: () => invoke<void>('player_close'),
  playerMini: (mini: boolean) => invoke<void>('player_mini', { mini }),
  playerMiniDragStart: () => invoke<void>('player_mini_drag_start'),
  playerMiniDragEnd: () => invoke<boolean>('player_mini_drag_end'),
  playerFullscreen: () => invoke<boolean>('player_fullscreen'),
  onPlayerMode: (cb: (m: { mini: boolean; square: boolean }) => void) => on('player:mode', cb),
  onPlayerCover: (cb: (on: boolean) => void) => on('player:cover', cb),
  onPlayerReset: (cb: () => void) => on('player:reset', cb),
  onPlayerDragging: (cb: (on: boolean) => void) => on('player:dragging', cb),
  onPlayerEpisode: (cb: (d: number) => void) => on('player:episode', cb),
  onPlayerSources: (cb: () => void) => on('player:sources', cb),
  onPlayerLoad: (cb: (p: PlayPayload) => void) => on('player:load', cb),
  onPlayerClosed: (cb: () => void) => on('player:closed', cb),
  onPlayerNext: (cb: () => void) => on('player:next', cb),
  onPlayerRetry: (cb: () => void) => on('player:retry', cb),
  mpvCommand: (cmd: unknown[]) => invoke<unknown>('mpv_command', { cmd }),
  mpvSet: (name: string, value: unknown) => invoke<unknown>('mpv_set', { name, value }),
  mpvAnime4K: (mode: Anime4KMode, quality: 'hq' | 'fast') => {
    settings.save({ anime4k: mode, anime4kQuality: quality } as any)
    share('settings:changed')
    return invoke<void>('mpv_anime4k', { mode, quality })
  },
  /** Shaders for this video only (the saved Anime4K setting stays as it is) */
  mpvShaders: (mode: Anime4KMode, quality: 'hq' | 'fast') => invoke<void>('mpv_anime4k', { mode, quality }),
  onMpv: (cb: (ev: any) => void) => on('mpv:event', cb),

  winMinimize: async () => win.minimize(),
  winMaximize: async () => win.toggleMaximize(),
  winClose: async () => win.close(),
  winDragStart: (mode: string) => invoke<void>('win_drag_start', { mode }),
  winDragEnd: noop,
  winState,
  onWinState: (cb: (s: { maximized: boolean; fullscreen: boolean }) => void) => on('win:state', cb),
  onNav: (cb: (d: 'back' | 'forward' | 'home') => void) => on('nav', cb),

  // seek-bar previews, subtitle files, subtitle sync (Rust: src-tauri/src/media.rs)
  thumbStart: (src: string, duration: number, background: boolean) => invoke<void>('thumb_start', { src, duration, background }),
  thumbAt: (src: string, t: number) => invoke<void>('thumb_at', { src, t }),
  onThumb: (cb: (src: string, t: number, img: string) => void) => on('media:thumb', cb),
  subtitleFile: (url: string, lang?: string) => subtitleFile(url, lang),
  subtitleCues: async (file: string) => parseCues(await readSub(file)),
  audioPcm: async (src: string, from: number, dur: number) => new Float32Array(await invoke<ArrayBuffer>('audio_pcm', { src, from, dur })),
  // On-device translation: Töz ships with the app (nothing to download)
  mtStatus: async () => ({ state: (await localReady('tr')) ? 'ready' : 'missing', model: 'toz', mb: 110, other: false } as MtStatus),
  mtDownload: async () => ({ state: (await localReady('tr')) ? 'ready' : 'missing', model: 'toz', mb: 110, other: false } as MtStatus),
  mtDelete: async (_unusedOnly?: boolean) => ({ state: (await localReady('tr')) ? 'ready' : 'missing', model: 'toz', mb: 110, other: false } as MtStatus),
  onMtProgress: (_cb: (p: number) => void) => () => {},
  /** One line through Töz (Ayarlar → "Töz'ü dene") */
  mtTry: async (text: string) => (await translateLocal([text], 'en', 'tr'))[0],
  translateSubtitle: (jobId: string, source: TranslateSource, names?: string[], to?: string) => {
    const ctl = new AbortController()
    translations.set(jobId, ctl)
    return translateToFile(source, names ?? [], p => emit('subs:translateProgress', jobId, p), to ?? settings.load().subLangs?.[0] ?? 'tr', ctl.signal).finally(() => translations.delete(jobId))
  },
  /** Where the viewer is: translation works on the lines around it first */
  translateFocus: (t: number) => setTranslateFocus(t),
  cancelTranslate: async (jobId: string) => translations.get(jobId)?.abort(),
  onTranslateProgress: (cb: (jobId: string, p: any) => void) => on('subs:translateProgress', cb),
  mediaOpen: notYet('Video açma'),
  mediaClose: async (_sid: string) => undefined,
  mediaStreamUrl: notYet('Video akışı'),
  mediaKeyframe: async (_sid: string, t: number) => t,
  mediaSubsUrl: notYet('Gömülü altyazı'),
  mediaFonts: async (_sid: string): Promise<string[]> => [],
  externalSubtitle: (url: string, lang?: string) => subtitleText(url, lang)
}

// A fresh install gets the usual addons
if (self === 'main') {
  addons.ensureDefaultAddons().then(changed)
  // the player closed: stop downloading / uploading torrents (and delete the parts unless kept)
  on('player:closed', () => void stopTorrents())
}
else listening.then(() => invoke('overlay_ready'))

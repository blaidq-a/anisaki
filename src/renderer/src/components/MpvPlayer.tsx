// Player controls drawn in the transparent overlay window, on top of the embedded mpv video.
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { AddonSubtitle, Anime4KMode, PlayerLoading, PlayPayload, PublicSettings } from '../../../shared/types'
import { MODES } from '../lib/anime4k'
import { align, speechProbabilities } from '../lib/autosync'
import { langCode, langName } from '../lib/subtitles'
import { aniSkip, channelsLabel, codec, fmt, I, Icon, pickSegments, SeekBar, segmentLabel, segmentsFromChapters, type Segment } from './playerUi'
import { Ic, WindowControls } from './ui'
import { resolveRequest, resolveStream, useStreamList } from './StreamPicker'
import { rankStreams, streamKey, torrentMode, type ParsedStream } from '../lib/streams'

/** Line icons of the control bar */
const L = {
  vol: 'M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14',
  mute: 'M11 5 6 9H2v6h4l5 4V5zM22 9l-6 6M16 9l6 6',
  cc: 'M3 5h18v14H3zM7 15h4M14 15h3M7 11h2M12 11h5',
  speaker: 'M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 18a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 6h.01',
  cloud: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z',
  wand: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15v4M17 17h4',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  next: 'M5 4l10 8-10 8zM19 5v14',
  prev: 'M19 20 9 12l10-8zM5 19V5',
  full: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
  unfull: 'M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3',
  left: 'm15 18-6-6 6-6',
  pip: 'M3 5h18v14H3zM12 12h7v5h-7z',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  speed: 'M12 21a9 9 0 1 1 9-9M12 12l4-4',
  next2: 'M4 5l8 7-8 7zM12 5l8 7-8 7z',
  skipop: 'M4 12h12M12 6l6 6-6 6M20 5v14',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  type: 'M4 7V5h16v2M9 19h6M12 5v14',
  chevron: 'm9 18 6-6-6-6',
  expand: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
  eps: 'M3 5h18v4H3zM3 11h18v4H3zM3 17h18v4H3z'
}

interface Track {
  id: number
  type: 'video' | 'audio' | 'sub'
  lang?: string
  title?: string
  codec?: string
  default?: boolean
  forced?: boolean
  external?: boolean
  selected?: boolean
  image?: boolean
  'demux-channel-count'?: number
  'demux-w'?: number
  'demux-h'?: number
  'external-filename'?: string
  /** Absolute stream index in the file (what ffmpeg's -map 0:N uses) */
  'ff-index'?: number
}
type Translation = { state: 'running' | 'done' | 'error'; label: string; msg?: string; trackId?: number }
type Props = Record<string, any>
type Tab = 'subs' | 'sync' | 'audio' | 'video' | 'info' | 'sources' | 'eps'
type Cue = { start: number; end: number; text: string }
type AutoState = { state: 'running'; msg: string } | { state: 'done'; shift: number; confidence: number; before: number } | { state: 'error'; msg: string } | null

/** Fresh links asked for per source + episode after a stall */
const reconnects = new Map<string, number>()
/** Track titles that name a language other than English */
const OTHER_LANG = /t[üu]rk|span|espa|latin|castell|fran[cç]|french|deutsch|german|ital|portu|brasil|brazil|russ|рус|arab|عرب|chin|中文|简|繁|japan|日本|kor|한국|viet|indo|malay|thai|polsk|polish|ukr|hebr|hindi|tamil|nederl|dutch|svensk|swed|norsk|dansk|suomi|finn|magyar|hungar|czech|român|ελλην|greek/i
const mpv = (cmd: unknown[]) => window.api.mpvCommand(cmd).catch(() => undefined)
const setProp = (name: string, value: unknown) => window.api.mpvSet(name, value).catch(() => undefined)
type SubLook = { color: string; outline: string; back: 'none' | 'box' | 'solid'; font: string; bold: boolean }
const SUB_LOOK: SubLook = { color: 'file', outline: 'file', back: 'none', font: 'file', bold: false }
// ASS colours are &HAABBGGRR
const SUB_COLORS: [string, string][] = [['file', 'Dosya'], ['&H00FFFFFF', 'Beyaz'], ['&H0000FFFF', 'Sarı'], ['&H00FFEFC6', 'Açık mavi'], ['&H00C8F5C8', 'Açık yeşil']]
const ls = {
  get: (k: string) => { try { return localStorage.getItem('player.' + k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem('player.' + k, v) } catch {} }
}

export function MpvPlayer({ req, mini, square, onReady }: { req: PlayPayload; mini: boolean; square: boolean; onReady?: () => void }) {
  const [p, setP] = useReducer((s: Props, a: Props) => ({ ...s, ...a }), { pause: false, volume: Number(ls.get('volume') ?? 100) })
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab | null>(null)
  const [showUi, setShowUi] = useState(true)
  const [addonSubs, setAddonSubs] = useState<AddonSubtitle[] | null>(req.subIds ? null : [])
  const [addonLoading, setAddonLoading] = useState<string | null>(null)
  const [skipSegs, setSkipSegs] = useState<Segment[]>([])
  const [mode, setMode] = useState<Anime4KMode>('off')
  const [quality, setQuality] = useState<'hq' | 'fast'>('hq')
  const [notice, setNotice] = useState<string | null>(null)
  const [translations, setTranslations] = useState<Record<string, Translation>>({})
  const [switching, setSwitching] = useState<string | null>(null)
  // Settings menu (gear): pages like Seanime's player settings; choices are remembered in this browser profile.
  const [menu, setMenu] = useState<null | 'root' | 'speed' | 'anime4k'>(null)
  useEffect(() => {
    if (tab) setMenu(null)
  }, [tab])
  // Volume goes up to 300 %; above 100 % the bar turns red.
  const boost = 300
  const [fast, setFast] = useState(false)
  const hold = useRef({ timer: 0, active: false, swallow: false, speed: 1 })
  const [autoNext, setAutoNext] = useState(() => ls.get('autoNext') !== 'off')
  // OP and ED skipped on their own switches (one "OP/ED" switch before; the old value seeds both)
  const [autoSkipOp, setAutoSkipOp] = useState(() => (ls.get('autoSkipOp') ?? ls.get('autoSkip')) === 'on')
  const [autoSkipEd, setAutoSkipEd] = useState(() => (ls.get('autoSkipEd') ?? ls.get('autoSkip')) === 'on')
  const [subScale, setSubScale] = useState(() => Number(ls.get('subScale') ?? 1))
  const [subPos, setSubPos] = useState(() => Number(ls.get('subPos') ?? 100))
  // Subtitle look chosen in the menu; 'file' keeps what the subtitle file says
  const [subLook, setSubLook] = useState<SubLook>(() => ({ ...SUB_LOOK, ...JSON.parse(ls.get('subLook') ?? '{}') }))
  const pbar = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [fs, setFs] = useState(false)
  useEffect(() => {
    window.api.winState().then(s => setFs(s.fullscreen))
    return window.api.onWinState(s => setFs(s.fullscreen))
  }, [])
  const addedSubs = useRef(new Map<string, number>()) // addon subtitle id → mpv track id
  const autoSubDone = useRef(false)
  const marked = useRef(false)
  const idle = useRef(0)

  const time: number = p['time-pos'] ?? 0
  const duration: number = p.duration ?? 0
  const tracks: Track[] = p['track-list'] ?? []
  const audio = tracks.filter(t => t.type === 'audio')
  const subs = tracks.filter(t => t.type === 'sub')
  const video = tracks.find(t => t.type === 'video' && !t.image)
  const curAudio = audio.find(t => t.selected)
  // The main subtitle is the one in `sid`. `selected` is also true for the secondary track (the English one
  // that fills lines in while a translation grows), and taking that one made the panel flicker.
  const sid = typeof p.sid === 'number' ? p.sid : undefined
  const isMainSub = (t: Track) => (sid != null ? t.id === sid : !!t.selected && (t as any)['main-selection'] !== 1)
  const curSub = p.sid === false || p.sid === 'no' ? undefined : subs.find(isMainSub)
  const vp = p['video-params'] ?? {}
  const hdr = vp.gamma === 'pq' ? 'HDR10' : vp.gamma === 'hlg' ? 'HLG' : null
  const buffering = !loaded || p['paused-for-cache'] || p.seeking
  // Straight torrent: while it waits for data, how many peers and how fast (so a slow start is visible)
  const torrentHash = req.src.includes('/t/') ? req.src.split('/t/')[1]?.split('?')[0] : undefined
  const [tstat, setTstat] = useState<{ peers: number; down: number } | null>(null)
  useEffect(() => {
    if (!buffering || !torrentHash || !window.api.torrentStats) return void setTstat(null)
    const tick = () => window.api.torrentStats!(torrentHash).then(s => setTstat(s ? { peers: s.peers, down: s.down } : null))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [buffering, torrentHash])

  /* ------------------------------ mpv events ------------------------------ */
  useEffect(() => {
    window.api.getSettings().then(s => {
      setSettings(s)
      setMode(s.anime4k)
      setQuality(s.anime4kQuality)
    })
    return window.api.onMpv(ev => {
      if (ev.type === 'prop') setP({ [ev.name]: ev.value })
      else if (ev.type === 'event') {
        if (ev.name === 'file-loaded') {
          setLoaded(true)
          setError(null)
          setProp('volume', Number(ls.get('volume') ?? 100))
        } else if (ev.name === 'end-file' && ev.data?.reason === 'error') {
          setError('Video açılamadı' + (ev.data?.file_error ? ` (${ev.data.file_error})` : '') + '. Link süresi dolmuş olabilir; kaynağı tekrar seç.')
        }
      } else if (ev.type === 'exit') setError('Oynatıcı beklenmedik şekilde kapandı.')
    })
  }, [])

  // First frame on screen (or an error): the opening screen above can go.
  const readySent = useRef(false)
  useEffect(() => {
    if (readySent.current || !onReady) return
    if (error || (loaded && (p['time-pos'] ?? 0) > 0.05)) {
      readySent.current = true
      onReady()
    }
  }, [loaded, p['time-pos'] > 0.05, error])
  useEffect(() => {
    const t = setTimeout(() => !readySent.current && ((readySent.current = true), onReady?.()), 20000)
    return () => clearTimeout(t)
  }, [])

  /* ------------------------------ subtitles ------------------------------ */
  useEffect(() => {
    if (!req.subIds) return
    let live = true
    window.api.getSubtitles(req.subIds.type, req.subIds.ids).then(
      l => live && setAddonSubs(l),
      () => live && setAddonSubs([])
    )
    const t = setTimeout(() => live && setAddonSubs(s => s ?? []), 12000)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [req.src])

  /** Key under which a subtitle file's sync offset is remembered (per episode). */
  const syncKeyFor = (fileOrTrack: string) => `sync:${req.animeId ?? req.src}:${req.episode ?? ''}:${fileOrTrack.split(/[\\/]/).pop()}`

  /** Add an online subtitle; `shift` (from audio matching) is stored as its sync offset first. */
  const addAddonSub = async (s: AddonSubtitle, shift?: number) => {
    const known = addedSubs.current.get(s.id)
    if (known) return void setProp('sid', known)
    setAddonLoading(s.id)
    try {
      const file = await window.api.subtitleFile(s.url, s.lang)
      if (shift != null && Math.abs(shift) >= 0.05) ls.set(syncKeyFor(file), shift.toFixed(3))
      await mpv(['sub-add', file, 'select', `${langName(s.lang)} · ${s.addon}`, langCode(s.lang) ?? s.lang])
      const list = ((await mpv(['get_property', 'track-list'])) as Track[] | undefined) ?? []
      const added = list.find(t => t.type === 'sub' && t['external-filename'] === file)
      if (added) addedSubs.current.set(s.id, added.id)
    } catch (e: any) {
      setNotice('Altyazı yüklenemedi: ' + String(e.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setAddonLoading(null)
    }
  }

  const chooseSub = (id: number | 'no', lang?: string | null) => {
    setProp('sid', id)
    // "Kapalı" is remembered for this anime only (it used to switch subtitles off everywhere).
    if (req.animeId) ls.set('subOff:' + req.animeId, id === 'no' ? '1' : '')
  }

  /* ------------------ machine translation to the main subtitle language ------------------ */
  // The target is the first subtitle language in Ayarlar (Turkish, Spanish…). English is the source, so
  // with English first there is nothing to translate. A ref: progress callbacks are registered once.
  const mainLang = useRef('tr')
  mainLang.current = settings?.subLangs?.[0] || 'tr'
  const main = mainLang.current
  const mainName = langName(main)
  // Translation sources: embedded English first (its timing matches this exact release), then online English.
  const englishSources = useMemo(() => {
    const out: { key: string; label: string; source: Parameters<typeof window.api.translateSubtitle>[1] }[] = []
    if (main === 'en') return out
    // Only text subtitles can be translated (not PGS/VobSub pictures). subIndex = position among the file's subtitles.
    const embedded = subs.filter(t => !t.external)
    embedded
      .filter(t => langCode(t.lang) === 'en' && /^(subrip|srt|ass|ssa|webvtt|mov_text|text)$/i.test(t.codec ?? '') && !/sign|song/i.test(t.title ?? ''))
      .forEach(t => out.push({ key: 'emb' + t.id, label: `Dosyadaki İngilizce${t.title && !/^english$/i.test(t.title) ? ` (${t.title})` : ''}`, source: { kind: 'embedded', src: req.src, subIndex: embedded.indexOf(t), lang: 'en' } }))
    // Tracks whose language the file doesn't say ("Bilinmeyen dil") are nearly always English: translatable too
    embedded
      .filter(t => (!t.lang || /^(und|unk|mul|zxx|unknown)$/i.test(t.lang)) && /^(subrip|srt|ass|ssa|webvtt|mov_text|text)$/i.test(t.codec ?? '') && !/sign|song/i.test(t.title ?? ''))
      // ...unless the title names another language (group names like "Erai-raws" or "CR" are fine)
      .filter(t => !t.title || /english|eng\b/i.test(t.title) || !OTHER_LANG.test(t.title))
      .forEach(t => out.push({ key: 'emb' + t.id, label: `Dosyadaki altyazı (dili belirtilmemiş${t.title ? ', ' + t.title : ''})`, source: { kind: 'embedded', src: req.src, subIndex: embedded.indexOf(t), lang: 'en' } }))
    ;(addonSubs ?? [])
      .filter(s => langCode(s.lang) === 'en')
      .slice(0, 2)
      .forEach((s, i) => out.push({ key: 'web' + s.id, label: `İnternetteki İngilizce #${i + 1} (${s.addon})`, source: { kind: 'addon', url: s.url, lang: s.lang } }))
    return out
  }, [tracks, addonSubs, main])

  // Translations grow while they run: each part comes as a new file. The new file is added as a track
  // and the old one removed afterwards (selected if the old one was), so the subtitle never blinks
  // (sub-reload unloaded the track for a moment). latest = newest file, loaded = the one on screen.
  const growing = useRef(new Map<string, { trackId?: number; adding?: Promise<void>; select: boolean; shift?: number; latest?: string; loaded?: string; files?: Set<string> }>())
  /** Is the subtitle on screen one of this translation's files? (its track id changes with every part)
   *  While it grows and was chosen it counts as shown even in the moment one part replaces the other, so
   *  the panel doesn't flicker between it and "Kapalı" on every part. */
  const showing = (key: string) => {
    const f = curSub?.['external-filename']
    const g = growing.current.get(key)
    if (f && g?.files?.has(f)) return true
    return !!g?.select && translations[key]?.state === 'running' && (!curSub || !!curSub.external)
  }
  const addGrowing = async (key: string, file: string) => {
    const g = growing.current.get(key)
    if (!g || !alive.current) return
    g.latest = file
    if (g.adding) return g.adding
    g.adding = (async () => {
      while (alive.current && g.latest && g.latest !== g.loaded) {
        const f = g.latest
        ;(g.files ??= new Set()).add(f)
        const to = mainLang.current
        const before = ((await mpv(['get_property', 'track-list'])) as Track[] | undefined) ?? []
        const old = g.trackId != null ? before.find(t => t.id === g.trackId) : undefined
        const select = old ? !!old.selected : g.select
        // the sync offset follows the subtitle to its new file
        const shift = old?.['external-filename'] ? ls.get(syncKeyFor(old['external-filename'])) : g.shift != null && Math.abs(g.shift) >= 0.05 ? g.shift.toFixed(3) : null
        if (shift) ls.set(syncKeyFor(f), shift)
        await mpv(['sub-add', f, select ? 'select' : 'auto', `${langName(to)} (otomatik çeviri)`, to])
        const list = ((await mpv(['get_property', 'track-list'])) as Track[] | undefined) ?? []
        const id = list.find(t => t.type === 'sub' && t['external-filename'] === f)?.id
        if (old && id != null) await mpv(['sub-remove', old.id])
        g.trackId = id ?? g.trackId
        g.loaded = f
        if (!old && g.select) ls.set('subLang', to)
        setTranslations(t => (t[key] ? { ...t, [key]: { ...t[key], trackId: g.trackId } } : t))
      }
    })()
    await g.adding
    g.adding = undefined
  }

  // Each player (one per episode) has its own id: translations of the previous episode can't reach it
  // (job ids were "emb2" for every file, so another anime's half-done translation was loaded here),
  // and the ones still running are cancelled when it goes away.
  const session = useRef(Math.random().toString(36).slice(2))
  const alive = useRef(true)
  const jobOf = (key: string) => session.current + ':' + key
  useEffect(
    () => () => {
      alive.current = false
      for (const key of growing.current.keys()) window.api.cancelTranslate(jobOf(key)).catch(() => {})
    },
    []
  )
  useEffect(
    () =>
      window.api.onTranslateProgress((job, pr) => {
        if (!job.startsWith(session.current + ':')) return
        const key = job.slice(session.current.length + 1)
        if (pr.partial) addGrowing(key, pr.partial)
        const msg =
          pr.ahead === -1
            ? `Çevriliyor… izlediğin yerin altyazısı dosyadan okunuyor${pr.done ? ` · ${pr.done} satır hazır` : ''}`
            : pr.ahead != null && pr.covered
            ? pr.total
              ? `Çevriliyor… %${Math.round((pr.done / pr.total) * 100)}${isFinite(pr.ahead) ? ` · izlediğin yerden ${fmt(pr.ahead)}’a kadar hazır` : ''}`
              : `Çevriliyor… ${isFinite(pr.ahead) ? fmt(pr.ahead) + '’a kadar hazır' : pr.done + ' satır hazır'}`
            : pr.covered
            ? `Çevriliyor… ${fmt(pr.covered)}’a kadar hazır`
            : pr.stage === 'reading'
              ? `Dosyadan okunuyor… ${pr.done ? Math.round(pr.done / 1024) + ' KB' : ''}`
              : `Çevriliyor… %${pr.total ? Math.round((pr.done / pr.total) * 100) : 0}`
        setTranslations(t => (t[key]?.state === 'running' ? { ...t, [key]: { ...t[key], msg } } : t))
      }),
    []
  )

  const translate = async (key: string, label: string, source: Parameters<typeof window.api.translateSubtitle>[1], select = true, shift?: number) => {
    const cur = translations[key]
    if (cur?.state === 'done' && cur.trackId) return void (select && chooseSub(cur.trackId, mainLang.current))
    // still running: the part translated so far can be watched already
    if (cur?.state === 'running') {
      const g = growing.current.get(key)
      if (g) g.select = g.select || select
      if (select && g?.trackId != null) chooseSub(g.trackId, mainLang.current)
      return
    }
    setTranslations(t => ({ ...t, [key]: { state: 'running', label, msg: 'Başlıyor…' } }))
    growing.current.set(key, { select, shift })
    const name = langName(mainLang.current)
    flash(`${name} altyazı hazırlanıyor…`, 3000)
    try {
      window.api.translateFocus(time)
      const file = await window.api.translateSubtitle(jobOf(key), source, req.names ?? [], mainLang.current)
      if (!alive.current) return
      // Finished: a cached result is loaded now; a growing track already shows everything (the last
      // part has the same lines as the finished file), so it is only waited for, not reloaded.
      const g = growing.current.get(key)
      if (g?.trackId == null || !g.latest) await addGrowing(key, file)
      else await g.adding
      setTranslations(t => ({ ...t, [key]: { state: 'done', label, trackId: g?.trackId } }))
      flash(`${name} altyazı hazır`)
    } catch (e: any) {
      if (!alive.current) return
      const msg = String(e.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      setTranslations(t => ({ ...t, [key]: { state: 'error', label, msg } }))
      flash(`${name} altyazı hazırlanamadı: ${msg}`, 6000)
    }
  }

  // While a translation runs it follows the viewer: a seek or a resumed film is translated from there first.
  const translating = Object.values(translations).some(t => t.state === 'running')
  useEffect(() => {
    if (translating) window.api.translateFocus(time)
  }, [translating, Math.floor(time / 3)])

  // A line the growing translation hasn't reached yet is translated on its own the moment it shows (like on
  // the TV): the English track runs as an invisible second subtitle, so its line on screen is known, and the
  // Turkish one is drawn in its place until the translated file covers that part. On-device AI only.
  const fillKey = settings?.localTranslate ? Object.keys(translations).find(k => k.startsWith('emb') && translations[k].state === 'running' && showing(k)) : undefined
  const fillCache = useRef(new Map<string, string>())
  // Where the subtitles sit now (sub-pos: higher while the controls show); the filled-in line follows it
  const [subAt, setSubAt] = useState(100)
  useEffect(() => {
    if (!fillKey) return
    void setProp('secondary-sid', Number(fillKey.slice(3)))
    void setProp('secondary-sub-visibility', false)
    return () => {
      void setProp('secondary-sid', 'no')
      void mpv(['osd-overlay', 63, 'none', ''])
    }
  }, [fillKey])
  const enLine = fillKey ? String(p['secondary-sub-text'] ?? '').trim() : ''
  const trLine = String(p['sub-text'] ?? '').trim()
  useEffect(() => {
    const hide = () => void mpv(['osd-overlay', 63, 'none', ''])
    if (!fillKey || !enLine || trLine) return hide()
    let live = true
    const draw = (t: string) => {
      const ass = t.replace(/[{}]/g, '').replace(/\r?\n/g, '\\N')
      // An overlay has no sub-pos of its own: placed where the subtitles are (above the controls while
      // they show; it stayed on the bar), ~4 % above that line like a file's own bottom margin
      const r = box.current?.getBoundingClientRect()
      const w = Math.round(720 * (r && r.height ? r.width / r.height : 16 / 9))
      const y = Math.round((720 * Math.max(10, subAt - 4)) / 100)
      void mpv(['osd-overlay', 63, 'ass-events', `{\\an2\\pos(${Math.round(w / 2)},${y})\\fnArial\\fs${Math.round(44 * subScale)}\\bord2.4\\shad1}${ass}`, w, 720, 0, 'no', 'no'])
    }
    const done = fillCache.current.get(enLine)
    if (done) draw(done)
    else {
      hide()
      window.api.mtTry(enLine.replace(/\s*\n\s*/g, ' ')).then(t => {
        if (!t) return
        fillCache.current.set(enLine, t)
        if (live) draw(t)
      }, () => {})
    }
    return () => void (live = false)
  }, [fillKey, enLine, trLine, subAt, subScale])

  /* ---------------------- audio + subtitle auto selection ---------------------- */
  // Audio: first preferred language that exists (Ayarlar → Diller).
  const audioDone = useRef(false)
  useEffect(() => {
    if (audioDone.current || !loaded || !settings || !audio.length) return
    audioDone.current = true
    // A track's language comes from its tag, or from its title ("Japanese", "日本語") when the tag is missing.
    const langOf = (a: Track) => {
      const c = langCode(a.lang)
      if (c) return c
      const t = (a.title ?? '').toLowerCase()
      if (/japan|日本|jpn/.test(t)) return 'ja'
      if (/english|\beng\b|dub/.test(t)) return 'en'
      return null
    }
    for (const [i, l] of settings.audioLangs.entries()) {
      const t = audio.find(a => langOf(a) === l)
      if (t) return void (!t.selected && setProp('aid', t.id))
      // Main language missing by tag: an untagged track is usually the original (Japanese) audio,
      // so take it before falling back to the backup language (often an English dub).
      if (i === 0 && l === 'ja') {
        const und = audio.find(a => !langOf(a))
        if (und) return void (!und.selected && setProp('aid', und.id))
      }
    }
  }, [loaded, tracks, settings])

  // Online subtitles are checked against the audio: Silero finds speech, the cues are slid over it,
  // and only a subtitle whose lines actually meet the speech is used (with the shift it needs).
  const speech = useRef<Promise<{ from: number; speech: Float32Array }> | null>(null)
  const [checks, setChecks] = useState<Record<string, { state: 'running' } | { state: 'ok' | 'bad'; shift: number; score: number }>>({})
  const [autoStatus, setAutoStatus] = useState<string | null>(null)
  // The status pill only shows a moment when something starts, and when it ends (or fails); not the
  // whole time it runs.
  const statusTimer = useRef(0)
  // Short notes (skipped OP / ED / fillers): no close button, can't be clicked or selected, go by themselves
  const [autoNote, setAutoNote] = useState<string | null>(null)
  const noteTimer = useRef(0)
  const note = (msg: string, ms = 3000) => {
    setAutoNote(msg)
    clearTimeout(noteTimer.current)
    noteTimer.current = window.setTimeout(() => setAutoNote(null), ms)
  }
  const flash = (msg: string, ms = 3500) => {
    setAutoStatus(msg)
    clearTimeout(statusTimer.current)
    statusTimer.current = window.setTimeout(() => setAutoStatus(null), ms)
  }

  const getSpeech = () =>
    (speech.current ??= (async () => {
      // Listen to 3 minutes from ~30 % into the episode: past the cold open and the opening song, where
      // there is plenty of dialogue. (The first minutes are mostly music and make every subtitle look wrong.)
      // 3 minutes still hold dozens of lines and cost far less to fetch (over the network) and to scan.
      // The check starts right after loading, when the duration may not have arrived yet: ask mpv.
      const len = Number(duration || (await mpv(['get_property', 'duration'])) || 0)
      const from = len > 600 ? Math.round(len * 0.3) : 0
      const pcm = await window.api.audioPcm(req.src, from, 180)
      return { from, speech: await speechProbabilities(pcm) }
    })())

  const checkSub = async (s: AddonSubtitle) => {
    setChecks(c => ({ ...c, [s.id]: { state: 'running' } }))
    try {
      const sp = await getSpeech()
      const file = await window.api.subtitleFile(s.url, s.lang)
      const r = align(sp.speech, sp.from, await window.api.subtitleCues(file), 0)
      // Fits: one clear shift wins, or the best shift stands far above all others with a good score.
      const ok = (r.confidence >= 0.35 && r.score >= 0.12) || (r.score >= 0.2 && r.z >= 4)
      const res = { state: ok ? 'ok' : 'bad', shift: r.shift, score: r.score } as const
      setChecks(c => ({ ...c, [s.id]: res }))
      return res
    } catch {
      const res = { state: 'bad', shift: 0, score: -1 } as const
      setChecks(c => ({ ...c, [s.id]: res }))
      return res
    }
  }

  /** Best online subtitle in a language, checked against the audio (null if none fits). */
  const bestOnline = async (lang: string) => {
    const cands = (addonSubs ?? []).filter(s => langCode(s.lang) === lang).slice(0, 4)
    // All candidates at once: they share one speech scan, only the downloads and the (quick) matching differ.
    const results = await Promise.all(cands.map(checkSub))
    let best: { s: AddonSubtitle; shift: number; score: number } | null = null
    results.forEach((r, i) => {
      if (r.state === 'ok' && (!best || r.score > best.score)) best = { s: cands[i], shift: r.shift, score: r.score }
    })
    return best as { s: AddonSubtitle; shift: number; score: number } | null
  }

  const isDialogue = (t: Track) => !t.forced && !/sign|song|lyric|karaoke|forced/i.test(t.title ?? '')

  useEffect(() => {
    if (autoSubDone.current || !loaded || addonSubs === null || !settings) return
    autoSubDone.current = true
    if (req.animeId && ls.get('subOff:' + req.animeId) === '1') return void setProp('sid', 'no')
    const langs = [...new Set(settings.subLangs.filter(Boolean))]
    const emb = subs.filter(t => !t.external && isDialogue(t))
    const embOf = (lang: string) => emb.find(t => langCode(t.lang) === lang)
    ;(async () => {
      // Show something right away: an embedded dialogue track in a preferred language (or English).
      // Languages are tried in order (main first): embedded → online (checked) → translation for Turkish.
      // "Videonun içindeki altyazıyı otomatik aç": meanwhile a subtitle inside the file is shown right away.
      const quick = settings.preferEmbedded ? langs.map(embOf).find(Boolean) ?? embOf('en') : undefined
      if (quick) setProp('sid', quick.id)
      for (const lang of langs) {
        const e = embOf(lang)
        if (e) return void setProp('sid', e.id) // embedded tracks fit this exact video
        const web = (addonSubs ?? []).filter(s => langCode(s.lang) === lang)
        if (web.length) {
          if (!settings.autoSubs) return void addAddonSub(web[0])
          flash(`${langName(lang)} altyazılar sesle karşılaştırılıyor…`, 3000)
          const best = await bestOnline(lang)
          if (best) {
            flash(`${langName(lang)} altyazı seçildi · ${best.s.addon}`)
            return void addAddonSub(best.s, best.shift)
          }
          flash(`İnternetteki ${langName(lang)} altyazılar videoya uymadı`, 4000)
        }
        if (lang === langs[0] && lang !== 'en' && settings.autoTranslate) {
          // Translate English: embedded first (exact timing), else the best-matching online one.
          const embEn = englishSources.find(s => s.source.kind === 'embedded')
          if (embEn) return void translate(embEn.key, embEn.label, embEn.source, true)
          if ((addonSubs ?? []).some(s => langCode(s.lang) === 'en')) {
            if (settings.autoSubs) flash('İngilizce altyazılar sesle karşılaştırılıyor…', 3000)
            const best = settings.autoSubs ? await bestOnline('en') : { s: addonSubs!.find(s => langCode(s.lang) === 'en')!, shift: 0, score: 0 }
            if (best) {
              const src = englishSources.find(x => x.key === 'web' + best.s.id)
              return void translate('web' + best.s.id, src?.label ?? 'İnternetteki İngilizce', { kind: 'addon', url: best.s.url, lang: best.s.lang }, true, best.shift)
            }
          }
        }
      }
      if (!quick) setNotice('Tercih ettiğin dillerde videoya uyan altyazı bulunamadı. Altyazı panelinden elle seçebilirsin.')
    })()
  }, [loaded, addonSubs, tracks, settings])

  /* ------------------------------ subtitle sync ------------------------------ */
  // The offset is remembered per episode and per subtitle track, and reset when switching tracks.
  const delay: number = p['sub-delay'] ?? 0
  const curSubFile = curSub?.external ? curSub['external-filename'] : undefined
  const trackKey = curSub ? (curSub.external ? (curSubFile ?? '').split(/[\\/]/).pop() : 'emb' + (curSub['ff-index'] ?? curSub.id)) : null
  const syncKey = trackKey ? `sync:${req.animeId ?? req.src}:${req.episode ?? ''}:${trackKey}` : null
  const applying = useRef<string | null>(null)
  const [cues, setCues] = useState<Cue[]>([])
  const [auto, setAuto] = useState<AutoState>(null)

  useEffect(() => {
    setAuto(null)
    if (!syncKey) return
    const saved = Number(ls.get(syncKey) ?? 0)
    applying.current = syncKey
    setProp('sub-delay', saved).then(() => (applying.current = null))
  }, [syncKey])

  useEffect(() => {
    if (!syncKey || applying.current) return
    if (Math.abs(delay) < 0.001) {
      try { localStorage.removeItem('player.' + syncKey) } catch {}
    } else ls.set(syncKey, delay.toFixed(3))
  }, [delay])

  useEffect(() => {
    setCues([])
    if (curSubFile) window.api.subtitleCues(curSubFile).then(setCues, () => setCues([]))
  }, [curSubFile])

  const setDelay = (d: number) => setProp('sub-delay', Math.round(d * 1000) / 1000)

  const runAutoSync = async () => {
    if (!curSubFile) return
    setAuto({ state: 'running', msg: 'Ses alınıyor…' })
    const before = delay
    try {
      const span = 150 // listen to ±150 s around the current position
      const from = Math.max(0, time - span)
      const pcm = await window.api.audioPcm(req.src, from, span * 2)
      setAuto({ state: 'running', msg: 'Konuşma aranıyor… %0' })
      const speech = await speechProbabilities(pcm, p => setAuto({ state: 'running', msg: `Konuşma aranıyor… %${Math.round(p * 100)}` }))
      const r = align(speech, from, cues, before)
      // Only move the subtitles when one shift clearly wins and it's clearly better than leaving them.
      if (r.confidence < 0.35 || (Math.abs(r.shift) >= 0.2 && r.gain < 0.05)) {
        setAuto({ state: 'error', msg: 'Ses ile altyazı arasında net bir eşleşme bulunamadı, altyazıya dokunmadım. Konuşmanın bol olduğu bir yerde tekrar dene ya da satırı yakala.' })
        return
      }
      await setDelay(before + r.shift)
      setAuto({ state: 'done', shift: r.shift, confidence: r.confidence, before })
    } catch (e: any) {
      setAuto({ state: 'error', msg: String(e.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    }
  }

  /** "I just heard this line": put its start ~0.6 s before now (reaction time). */
  const catchLine = (c: Cue) => setDelay(time - 0.6 - c.start)
  const nearCues = useMemo(() => {
    const shown = cues.map((c, i) => ({ ...c, i, at: c.start + delay }))
    const idx = shown.findIndex(c => c.at > time - 12)
    const from = Math.max(0, (idx < 0 ? shown.length : idx) - 2)
    return shown.slice(from, from + 8)
  }, [cues, Math.round(time), delay])

  /* ------------------------------ OP / ED skip ------------------------------ */
  useEffect(() => {
    if (!req.malId || !req.episode || !duration) return
    let live = true
    aniSkip(req.malId, req.episode, duration).then(s => live && setSkipSegs(s), () => {})
    return () => {
      live = false
    }
  }, [req.malId, req.episode, Math.round(duration / 10)])

  const segments = useMemo(() => pickSegments(segmentsFromChapters(p['chapter-list'] ?? [], duration), skipSegs), [p['chapter-list'], skipSegs, duration])
  const curSeg = segments.find(s => time >= s.start && time < s.end)
  const skippable = curSeg && curSeg.kind !== 'normal' && curSeg.end - time > 2 ? curSeg : null
  const nearEnd = duration > 0 && (duration - time < 90 || curSeg?.kind === 'ed' || curSeg?.kind === 'preview')

  /* ------------------------------ player settings ------------------------------ */
  useEffect(() => {
    setProp('volume-max', boost)
  }, [])
  // Subtitle look (size, height) for text subtitles.
  // While the controls show, the subtitles move up above them (back down when they hide).
  const uiVisible = !!(showUi || tab || p.pause)
  useEffect(() => {
    setProp('sub-scale', subScale)
    let pos = subPos
    if (uiVisible && !mini && pbar.current && box.current) {
      // Only as far as the seek bar's top (the bar's faded top part may stay under the text); the
      // subtitle's own bottom margin (~4 % of the height in most files) already keeps it a little higher.
      const seek = (pbar.current.querySelector('.seek') as HTMLElement | null) ?? pbar.current
      const b = box.current.getBoundingClientRect()
      const dist = b.bottom - seek.getBoundingClientRect().top + 4
      const lift = Math.max(0, (dist / Math.max(1, b.height)) * 100 - 4)
      pos = Math.min(subPos, Math.round(100 - lift))
    }
    setProp('sub-pos', pos)
    setSubAt(pos)
  }, [subScale, subPos, uiVisible, mini])
  // Colour, outline, background box, font: libass style overrides (left empty: the file's own look)
  // Anything chosen replaces the file's look outright ("force": mpv's own style for dialogue, so "İnce"
  // really is thin instead of being added on top of the file's outline and shadow); all "Dosya" keeps it.
  useEffect(() => {
    const custom = JSON.stringify(subLook) !== JSON.stringify(SUB_LOOK)
    ls.set('subLook', JSON.stringify(subLook))
    setProp('sub-ass-style-overrides', '')
    if (!custom) return void setProp('sub-ass-override', 'yes')
    const rgb = (ass: string) => '#' + ass.slice(-6).match(/../g)!.reverse().join('') // &HAABBGGRR → #RRGGBB
    setProp('sub-color', subLook.color === 'file' ? '#FFFFFF' : rgb(subLook.color))
    setProp('sub-border-color', '#000000')
    setProp('sub-border-size', subLook.outline === 'file' ? 2.5 : Number(subLook.outline))
    setProp('sub-shadow-offset', subLook.back === 'none' ? 1 : 0)
    setProp('sub-border-style', subLook.back === 'none' ? 'outline-and-shadow' : 'background-box')
    setProp('sub-back-color', subLook.back === 'box' ? '#80000000' : '#E0000000')
    setProp('sub-font', subLook.font === 'file' ? 'Arial' : subLook.font)
    setProp('sub-bold', subLook.bold ? 'yes' : 'no')
    setProp('sub-ass-override', 'force')
  }, [subLook])
  // Skip OP / ED automatically (once per segment).
  const skipped = useRef(new Set<number>())
  useEffect(() => {
    if (!skippable || skipped.current.has(skippable.start)) return
    if (!(skippable.kind === 'op' && autoSkipOp) && !(skippable.kind === 'ed' && autoSkipEd)) return
    skipped.current.add(skippable.start)
    seek(skippable.end)
    note(skippable.kind === 'op' ? 'Opening atlandı' : 'Ending atlandı')
  }, [autoSkipOp, autoSkipEd, skippable?.start])
  // "2 filler bölüm atlandı" and the like, from the anime page, once the video plays
  useEffect(() => {
    if (loaded && req.notice) note(req.notice, 4000)
  }, [loaded])
  // 4K video: Anime4K adds nothing there and only loads the GPU, so it is switched off for this video
  // (Ayarlar → Oynatıcı; on by default). 1080p and below keep it.
  const is4k = (vp.h ?? 0) >= 1800 || (vp.w ?? 0) >= 3400
  const off4k = useRef(false)
  useEffect(() => {
    if (!is4k || off4k.current || !settings?.anime4kOff4k || mode === 'off') return
    off4k.current = true
    window.api.mpvShaders('off', quality)
    note('4K video: Anime4K bu videoda kapalı', 4000)
  }, [is4k, settings?.anime4kOff4k, mode])
  // Next episode when this one ends.
  const endedRef = useRef(false)
  useEffect(() => {
    if (!autoNext || !req.hasNext || endedRef.current || !loaded || !p['eof-reached']) return
    endedRef.current = true
    goEp(1)
  }, [p['eof-reached'], autoNext])
  const setLs = (k: string, v: string) => ls.set(k, v)

  /* ----------------- wrong file? compare length with the episode's ----------------- */
  const [wrongFile, setWrongFile] = useState<string | null>(null)
  const wrongChecked = useRef(false)
  useEffect(() => {
    if (wrongChecked.current || !loaded || !duration || !req.expectedDuration) return
    wrongChecked.current = true
    const ratio = duration / req.expectedDuration
    if (ratio < 0.6 || ratio > 1.7)
      setWrongFile(`Bu dosya ${fmt(duration)} uzunluğunda, bu bölüm ise yaklaşık ${fmt(req.expectedDuration)} sürüyor. Yanlış dosya olabilir.`)
  }, [loaded, duration])
  // "Başka kaynak": the source list opens inside the player; the episode keeps playing meanwhile.
  const retry = () => setTab('sources')

  /* ------------- stalled connection: get a fresh link and continue from the same spot ------------- */
  // Debrid links can stop answering mid-stream (expired, or the server cut the connection). If the
  // video stays stuck (buffering / seeking without progress) for 15 s, ask for the link again.
  const stall = useRef({ t: -1, since: 0 })
  const stuck = loaded && !error && !p.pause && (p['paused-for-cache'] || p.seeking)
  useEffect(() => {
    if (!stuck) return void (stall.current.since = 0)
    const s0 = stall.current
    if (s0.since === 0 || Math.abs(time - s0.t) > 1) {
      s0.since = Date.now()
      s0.t = time
    }
    const timer = setInterval(async () => {
      if (!stall.current.since || Date.now() - stall.current.since < 15000) return
      clearInterval(timer)
      // At most 3 fresh links per episode and source (the player remounts on every new link).
      const k = (req.resolve?.infoHash ?? '') + ':' + (req.episode ?? '')
      const tries = reconnects.get(k) ?? 0
      if (!req.resolve || tries >= 3) return void setNotice('Bağlantı takıldı. Kaynak menüsünden başka bir kaynak seçebilirsin.')
      reconnects.set(k, tries + 1)
      setNotice('Bağlantı takıldı, yeniden bağlanılıyor…')
      try {
        const url = await window.api.resolve(req.resolve)
        await window.api.playerOpen({ ...req, src: url, start: Math.max(0, stall.current.t - 2) })
      } catch (e: any) {
        setNotice('Yeniden bağlanılamadı: ' + String(e.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [stuck])

  /* --------------------- resume point for "continue watching" --------------------- */
  useEffect(() => {
    if (!req.animeId || !req.episode || !duration || time < 5) return
    try {
      localStorage.setItem('resume:' + req.animeId, JSON.stringify({ ep: req.episode, t: Math.round(time), d: Math.round(duration), at: Date.now() }))
    } catch {}
  }, [Math.floor(time / 5)])

  /* ---------------------------- progress marking ---------------------------- */
  useEffect(() => {
    if (marked.current || !req.animeId || !req.episode || !duration || !settings || time / duration < (settings.watchedAt ?? 0.8)) return
    marked.current = true
    const cur = settings.library[req.animeId]
    if ((cur?.progress ?? 0) >= req.episode) return
    const done = req.episodes != null && req.episode >= req.episodes
    window.api.setLibrary({
      id: req.animeId, title: req.title, cover: req.cover ?? '', episodes: req.episodes ?? null, score: cur?.score ?? null, updated: Date.now(),
      progress: req.episode, status: done ? 'done' : cur?.status === 'plan' || !cur ? 'watching' : cur.status
    })
  }, [time > duration * (settings?.watchedAt ?? 0.8)])

  /* -------------------------------- controls -------------------------------- */
  // Seek-bar preview frames, read by ffmpeg from the same source. Prepared in the background over the
  // whole episode (not for straight torrents: that would download pieces all over the file).
  const frames = useRef(new Map<number, string>())
  const [, framesVer] = useState(0)
  useEffect(
    () =>
      window.api.onThumb((src, t, img) => {
        if (src !== req.src) return
        frames.current.set(t, img)
        framesVer(v => v + 1)
      }),
    [req.src]
  )
  const thumbsStarted = useRef(false)
  useEffect(() => {
    if (thumbsStarted.current || !duration) return
    thumbsStarted.current = true
    window.api.thumbStart(req.src, duration, !req.src.includes('/torrent?'))
  }, [duration])
  const preview = useMemo(
    () => ({
      at: (t: number) => {
        let best: string | undefined
        let d = Infinity
        for (const [k, v] of frames.current) if (Math.abs(k - t) < d) (d = Math.abs(k - t)), (best = v)
        return d <= 20 ? best : undefined
      },
      request: (t: number) => window.api.thumbAt(req.src, t)
    }),
    [req.src]
  )
  const toggle = () => mpv(['cycle', 'pause'])
  const seek = (t: number) => mpv(['seek', Math.max(0, Math.min(duration - 0.5, t)), 'absolute'])
  const seekRel = (d: number) => mpv(['seek', d, 'relative'])
  const close = () => window.api.playerClose()
  /** Previous / next episode without closing the player: the main window finds the source meanwhile. */
  const goEp = (delta: number) => {
    if (switching || (delta > 0 ? !req.hasNext : !req.hasPrev)) return
    setTab(null)
    setSwitching(delta > 0 ? `${(req.episode ?? 0) + 1}. bölüm hazırlanıyor…` : `${(req.episode ?? 2) - 1}. bölüm hazırlanıyor…`)
    setProp('pause', true)
    window.api.playerEpisode(delta)
  }
  const next = () => goEp(1)
  const fullscreen = () => window.api.playerFullscreen()
  const setVolume = (v: number) => {
    setProp('volume', v)
    setProp('mute', false)
    ls.set('volume', String(v))
  }
  const chooseMode = (m: Anime4KMode, q = quality) => {
    setMode(m)
    setQuality(q)
    setNotice(null)
    window.api.mpvAnime4K(m, q)
  }
  const poke = () => {
    setShowUi(true)
    clearTimeout(idle.current)
    idle.current = window.setTimeout(() => setShowUi(false), 2800)
  }

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = e => {
    const el = e.target as HTMLElement
    if (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range') return
    switch (e.key) {
      case ' ': case 'k': e.preventDefault(); toggle(); break
      case 'ArrowRight': e.preventDefault(); seekRel(e.shiftKey ? 85 : 10); break
      case 'ArrowLeft': e.preventDefault(); seekRel(e.shiftKey ? -85 : -10); break
      case 'ArrowUp': e.preventDefault(); setVolume(Math.min(boost, (p.volume ?? 100) + 5)); break
      case 'ArrowDown': e.preventDefault(); setVolume(Math.max(0, (p.volume ?? 100) - 5)); break
      case 'f': fullscreen(); break
      case 'm': setProp('mute', !p.mute); break
      case 'a': { const ids = MODES.map(m => m.id); chooseMode(ids[(ids.indexOf(mode) + 1) % ids.length]); break }
      case 'c': setTab(t => (t === 'subs' ? null : 'subs')); break
      case 's': if (skippable) seek(skippable.end); break
      case 'n': goEp(1); break
      case 'p': goEp(-1); break
      case 'r': if (req.subIds) retry(); break
      case 'g': setProp('sub-delay', Math.round(((p['sub-delay'] ?? 0) - 0.1) * 10) / 10); break
      case 'h': setProp('sub-delay', Math.round(((p['sub-delay'] ?? 0) + 0.1) * 10) / 10); break
      case 'Escape': if (menu) setMenu(null); else if (tab) setTab(null); else if (fs) fullscreen(); else close(); break
      case 'BrowserBack': close(); break
      default: return
    }
    poke()
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', h)
    poke()
    return () => window.removeEventListener('keydown', h)
  }, [])

  /* --------------------------------- labels --------------------------------- */
  const h = vp.h ?? video?.['demux-h'] ?? 0
  // Short quality name shown under the source (cloud) button
  const quality_ = h ? (h >= 2000 ? '4K' : h >= 1400 ? '2K' : h >= 1000 ? 'FHD' : h >= 700 ? 'HD' : 'SD') : ''
  const subLabel = curSub ? (curSub.title?.includes('otomatik çeviri') ? `${langName(curSub.lang)} (çeviri)` : langName(curSub.lang)) : 'Kapalı'
  // The main subtitle language gets its own section (ready-made + machine translation); the rest follow.
  const embTr = subs.filter(t => !t.external && langCode(t.lang) === main)
  // Only the preferred subtitle languages are listed (Ayarlar → Dil ve altyazı); unlabeled tracks too.
  const prefs = settings?.subLangs?.length ? settings.subLangs : ['tr', 'en']
  const wanted = (lang?: string | null) => !lang || lang === 'und' || prefs.includes(langCode(lang) ?? '')
  const embOther = subs.filter(t => !t.external && langCode(t.lang) !== main && wanted(t.lang))
  const webTr = (addonSubs ?? []).filter(s => langCode(s.lang) === main)
  const addonGroups = useMemo(() => {
    const g = new Map<string, AddonSubtitle[]>()
    ;(addonSubs ?? []).forEach(s => {
      const k = langCode(s.lang) ?? s.lang
      g.set(k, [...(g.get(k) ?? []), s])
    })
    return [...g.entries()].sort(([a], [b]) => (a === main ? -1 : b === main ? 1 : a === 'en' ? -1 : b === 'en' ? 1 : langName(a).localeCompare(langName(b), 'tr')))
  }, [addonSubs, main])
  const bufferedTo = time + Math.max(0, (p['demuxer-cache-time'] ?? 0) - time)

  // Hold on the video: 2x while held (like YouTube); the click that ends the hold does not pause.
  const holdStart = (e: React.PointerEvent) => {
    if (e.button !== 0 || mini || p.pause) return
    clearTimeout(hold.current.timer)
    hold.current.timer = window.setTimeout(() => {
      hold.current.active = true
      hold.current.speed = p.speed ?? 1
      setProp('speed', 2)
      setFast(true)
    }, 380)
  }
  const holdEnd = () => {
    clearTimeout(hold.current.timer)
    if (!hold.current.active) return
    hold.current.active = false
    hold.current.swallow = true
    setProp('speed', hold.current.speed)
    setFast(false)
  }

  return (
    <div ref={box} className={'player mpv' + (showUi || tab || p.pause ? '' : ' hide-ui') + (mini ? ' mini' : '') + (square ? ' square' : '')} onMouseMove={poke}>
      <div
        className="click-layer"
        onPointerDown={holdStart}
        onPointerUp={holdEnd}
        onPointerLeave={holdEnd}
        onClick={() => {
          if (hold.current.swallow) return void (hold.current.swallow = false)
          menu ? setMenu(null) : tab ? setTab(null) : toggle()
        }}
        onDoubleClick={() => (mini ? window.api.playerMini(false) : fullscreen())}
      />
      {fast && <div className="fast-badge">2x ▶▶</div>}
      {mini && (
        // Mini player: play/pause, back to full size, close, thin progress line.
        <div
          className="minictl"
          onPointerDown={e => {
            if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
            // Drag to move (snaps to the nearest corner); a plain click pauses / plays.
            const el = e.currentTarget
            el.setPointerCapture(e.pointerId)
            window.api.playerMiniDragStart()
            const up = async () => {
              el.removeEventListener('pointerup', up)
              if (!(await window.api.playerMiniDragEnd())) toggle()
            }
            el.addEventListener('pointerup', up)
          }}
        >
          <button className="minibtn" onClick={() => window.api.playerMini(false)} aria-label="Büyüt" title="Büyüt"><Ic d={L.expand} size={16} /></button>
          <button className="minibtn" onClick={close} aria-label="Kapat" title="Kapat"><Icon d={I.close} size={16} /></button>
          <button className="miniplay" onClick={toggle} aria-label={p.pause ? 'Oynat' : 'Duraklat'}><Icon d={p.pause ? I.play : I.pause} size={26} /></button>
          <div className="miniseek"><i style={{ width: duration ? (time / duration) * 100 + '%' : 0 }} /></div>
        </div>
      )}

      {switching && (
        <div className="loading switching">
          <div className="spinner" />
          <span>{switching}</span>
        </div>
      )}
      {buffering && !error && !switching && (
        <div className="loading">
          <div className="spinner" />
          {!loaded && <span>Yükleniyor…</span>}
          {tstat && <small className="tstat">{tstat.peers} eş · {(tstat.down / 1e6).toFixed(1)} MB/sn</small>}
          {tstat && req.subIds && <TorrentRescue req={req} settings={settings} time={time} down={tstat.down} />}
          {loaded && p['cache-buffering-state'] != null && p['paused-for-cache'] && <span>Arabellek %{p['cache-buffering-state']}</span>}
        </div>
      )}
      {p.pause && loaded && !buffering && !error && !tab && !switching && (
        <button className="bigplay" onClick={toggle} aria-label="Oynat"><Icon d={I.play} size={44} /></button>
      )}
      {error && (
        <div className="perror">
          <p>{error}</p>
          <button className="btn" onClick={close}>Geri dön</button>
        </div>
      )}

      {!fs && <WindowGrips />}
      {/* The top strip works like a title bar: drag to move the window (also out of fullscreen), double click to maximize. */}
      <div className="pdrag" onPointerDown={e => startDrag(e, 'move')} onDoubleClick={() => window.api.winMaximize()} />
      <div className="ptop">
        <button className="ghostbtn" onClick={close} aria-label="Oynatıcıyı kapat" title="Geri (Esc)"><Ic d={L.left} size={20} /></button>
        <div className="ptitle">
          <strong>{req.title}</strong>
          {req.subtitle && <span>{req.subtitle}</span>}
        </div>
        <span className="grow" />
        {!fs && <WindowControls />}
      </div>

      {wrongFile && (
        <div className="pnotice warnbox">
          <span>{wrongFile}</span>
          {req.subIds && <button className="btn sm" onClick={() => { setWrongFile(null); retry() }}>Başka kaynak seç</button>}
          <button onClick={() => setWrongFile(null)} aria-label="Kapat"><Icon d={I.close} size={14} /></button>
        </div>
      )}
      {autoNote && <div className="pnote" key={autoNote}><Ic d={L.next2} size={15} /> {autoNote}</div>}
      {notice && (
        <div className="pnotice">
          {notice}
          <button onClick={() => setNotice(null)} aria-label="Kapat"><Icon d={I.close} size={14} /></button>
        </div>
      )}

      {autoStatus && <div className="psubstate">{autoStatus}</div>}

      <div className="skipzone">
        {skippable && (
          <button className="skipbtn" onClick={() => seek(skippable.end)}>
            <Icon d={I.skip} size={18} /> {skippable.kind === 'op' ? 'Openingi atla' : skippable.kind === 'ed' ? 'Endingi atla' : skippable.kind === 'recap' ? 'Özeti atla' : 'Atla'}
          </button>
        )}
        {req.hasNext && nearEnd && (
          <button className="skipbtn primary" onClick={next}>
            Sonraki bölüm <Icon d={I.next} size={16} />
          </button>
        )}
      </div>

      {tab && (
        <aside className="ppanel" onClick={e => e.stopPropagation()}>
          <nav className="ptabs" role="tablist">
            {([['subs', 'Altyazı'], ['sync', 'Senkron'], ['audio', 'Ses'], ['eps', 'Bölümler'], ['sources', 'Kaynak'], ['info', 'Bilgi']] as const).filter(([id]) => (id !== 'sources' || req.subIds) && (id !== 'eps' || req.episodeList?.length)).map(([id, l]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{l}</button>
            ))}
            <button className="ptabs-close" onClick={() => setTab(null)} aria-label="Paneli kapat"><Icon d={I.close} size={16} /></button>
          </nav>
          <div className="pbody">
            {tab === 'subs' && (
              <>
                <div className="psubtop">
                  <button className="tchip" aria-pressed={!curSub && !Object.keys(translations).some(showing)} onClick={() => chooseSub('no')}>Kapalı</button>
                  <button className="tchip" onClick={() => setTab('sync')} disabled={!curSub}>
                    Senkron{Math.abs(delay) >= 0.05 ? ` · ${delay > 0 ? '+' : ''}${delay.toFixed(1)} sn` : ''} ›
                  </button>
                </div>

                <h4>{mainName}</h4>
                {embTr.map(t => (
                  <button key={t.id} className="opt" aria-pressed={isMainSub(t)} onClick={() => chooseSub(t.id, t.lang)}>
                    <strong>{t.title && !/^(turkish|türkçe|english|full|dialogue)$/i.test(t.title) ? t.title : mainName}{t.forced ? ' · Zorunlu' : ''}</strong>
                    <small>{['Dosyada', codec(t.codec)].filter(Boolean).join(' · ')}</small>
                  </button>
                ))}
                {webTr.map(s => {
                  const tid = addedSubs.current.get(s.id)
                  const [site, ...rel] = s.addon.split(' · ')
                  return (
                    <button key={s.id} className="opt" disabled={addonLoading === s.id} aria-pressed={!!tid && curSub?.id === tid} onClick={() => { addAddonSub(s); ls.set('subLang', main) }}>
                      <strong>{rel.join(' · ') || site}</strong>
                      <small>{addonLoading === s.id ? 'İndiriliyor…' : `${site} · internetten`}</small>
                      {checks[s.id] && <MatchBadge c={checks[s.id]} />}
                    </button>
                  )
                })}
                {/* Machine translation: the best English source; the others are tucked away. */}
                {englishSources.slice(0, 1).map(s => {
                  const t = translations[s.key]
                  return (
                    <button key={s.key} className="opt" aria-pressed={showing(s.key) || (t?.trackId != null && curSub?.id === t.trackId)} onClick={() => translate(s.key, s.label, s.source)}>
                      <strong>Otomatik çeviri</strong>
                      <small>{s.label} → {mainName}</small>
                      {t?.state === 'running' && <small className="warn">{t.msg}</small>}
                      {t?.state === 'error' && <small className="err">{t.msg} · tekrar denemek için tıkla</small>}
                    </button>
                  )
                })}
                {englishSources.length > 1 && (
                  <details>
                    <summary>Başka İngilizce kaynaktan çevir <span className="pmuted">{englishSources.length - 1}</span></summary>
                    {englishSources.slice(1).map(s => {
                      const t = translations[s.key]
                      return (
                        <button key={s.key} className="opt" aria-pressed={showing(s.key) || (t?.trackId != null && curSub?.id === t.trackId)} onClick={() => translate(s.key, s.label, s.source)}>
                          <strong>{s.label}</strong>
                          <small>→ {mainName}</small>
                          {t?.state === 'running' && <small className="warn">{t.msg}</small>}
                          {t?.state === 'error' && <small className="err">{t.msg} · tekrar denemek için tıkla</small>}
                        </button>
                      )
                    })}
                  </details>
                )}
                {!embTr.length && !webTr.length && !englishSources.length && (
                  <p className="pmuted">
                    {addonSubs === null
                      ? `${mainName} altyazı aranıyor…`
                      : main === 'en'
                        ? 'İngilizce altyazı bulunamadı.'
                        : `${mainName} altyazı ya da çevrilebilecek İngilizce altyazı bulunamadı.`}
                  </p>
                )}
                {englishSources.length > 0 && !embTr.length && !webTr.length && (
                  <p className="pmuted">Hazır {mainName} altyazı yok. {settings?.localTranslate && main === 'tr' ? 'Otomatik çeviri bu bilgisayarda yapay zekâ ile yapılır.' : 'Otomatik çeviri internetteki çeviri hizmetleriyle yapılır.'} Anime terimlerinde hatalar olabilir.</p>
                )}

                <details className="plook">
                  <summary>Altyazı görünümü <span className="pmuted">{subScale === 1 && subPos === 100 && JSON.stringify(subLook) === JSON.stringify(SUB_LOOK) ? 'Varsayılan' : 'Özel'}</span></summary>
                  <span className="pmenu2-label">Boyut · %{Math.round(subScale * 100)}</span>
                  <input className="range pmenu2-range" type="range" min={0.6} max={2} step={0.05} value={subScale} onChange={e => { setSubScale(Number(e.target.value)); setLs('subScale', e.target.value) }} />
                  <span className="pmenu2-label">Yükseklik · {subPos === 100 ? 'en alt' : `%${100 - subPos} yukarı`}</span>
                  <input className="range pmenu2-range" type="range" min={70} max={100} step={1} value={subPos} onChange={e => { setSubPos(Number(e.target.value)); setLs('subPos', e.target.value) }} />
                  <span className="pmenu2-label">Renk</span>
                  <div className="seg dark pmenu2-seg">
                    {SUB_COLORS.map(([v, l]) => (
                      <button key={v} aria-pressed={subLook.color === v} onClick={() => setSubLook(s => ({ ...s, color: v }))}>{l}</button>
                    ))}
                  </div>
                  <span className="pmenu2-label">Kenar</span>
                  <div className="seg dark pmenu2-seg">
                    {([['file', 'Dosya'], ['1.5', 'İnce'], ['2.5', 'Normal'], ['4', 'Kalın']] as const).map(([v, l]) => (
                      <button key={v} aria-pressed={subLook.outline === v} onClick={() => setSubLook(s => ({ ...s, outline: v }))}>{l}</button>
                    ))}
                  </div>
                  <span className="pmenu2-label">Arka plan</span>
                  <div className="seg dark pmenu2-seg">
                    {([['none', 'Yok'], ['box', 'Yarı saydam kutu'], ['solid', 'Koyu kutu']] as const).map(([v, l]) => (
                      <button key={v} aria-pressed={subLook.back === v} onClick={() => setSubLook(s => ({ ...s, back: v }))}>{l}</button>
                    ))}
                  </div>
                  <span className="pmenu2-label">Yazı tipi</span>
                  <div className="seg dark pmenu2-seg">
                    {([['file', 'Dosya'], ['Arial', 'Arial'], ['Trebuchet MS', 'Trebuchet'], ['Verdana', 'Verdana'], ['Segoe UI', 'Segoe']] as const).map(([v, l]) => (
                      <button key={v} aria-pressed={subLook.font === v} onClick={() => setSubLook(s => ({ ...s, font: v }))}>{l}</button>
                    ))}
                  </div>
                  <label className="pmenu2-check"><input type="checkbox" checked={subLook.bold} onChange={e => setSubLook(s => ({ ...s, bold: e.target.checked }))} /> Kalın yazı</label>
                  <button className="pmenu2-opt" onClick={() => { setSubScale(1); setSubPos(100); setLs('subScale', '1'); setLs('subPos', '100'); setSubLook(SUB_LOOK) }}>Varsayılana dön</button>
                  <small className="pmuted">“Dosya” seçenekleri altyazı dosyasının kendi stilini korur. Oynatıcı düğmeleri açıkken altyazı otomatik olarak çubuğun üstüne çıkar.</small>
                </details>

                <h4>Dosyadaki altyazılar</h4>
                {embOther.length === 0 && <p className="pmuted">Tercih ettiğin dillerde başka altyazı yok.</p>}
                {embOther.map(t => (
                  <button key={t.id} className="opt" aria-pressed={isMainSub(t)} onClick={() => chooseSub(t.id, t.lang)}>
                    <strong>{langName(t.lang)}{t.forced ? ' · Zorunlu' : ''}</strong>
                    <small>{[t.title, codec(t.codec), t.default ? 'Varsayılan' : null].filter(Boolean).join(' · ')}</small>
                  </button>
                ))}
                <h4>İnternetten</h4>
                {addonSubs === null && <p className="pmuted">Altyazılar aranıyor…</p>}
                {addonSubs?.length === 0 && (
                  <p className="pmuted">{req.subIds?.ids.some(i => i.startsWith('tt')) ? 'Bu bölüm için internette altyazı bulunamadı.' : 'Bu yapımın IMDb eşlemesi yok, internetten altyazı aranamıyor.'}</p>
                )}
                {addonGroups.filter(([lang]) => lang !== main && prefs.includes(lang)).map(([lang, list]) => (
                  <details key={lang} open={lang === 'en'}>
                    <summary>{langName(lang)} <span className="pmuted">{list.length}</span></summary>
                    {list.map((s, i) => {
                      const tid = addedSubs.current.get(s.id)
                      return (
                        <button key={s.id} className="opt" disabled={addonLoading === s.id} aria-pressed={!!tid && curSub?.id === tid} onClick={() => { addAddonSub(s); ls.set('subLang', langCode(s.lang) ?? '') }}>
                          <strong>{langName(s.lang)} #{i + 1}</strong>
                          <small>{addonLoading === s.id ? 'İndiriliyor…' : s.addon}</small>
                          {checks[s.id] && <MatchBadge c={checks[s.id]} />}
                        </button>
                      )
                    })}
                  </details>
                ))}
              </>
            )}

            {tab === 'eps' && req.episodeList && (
              <div className="peps">
                {req.episodeList.map(e => (
                  <button key={e.number} className={'pep' + (e.number === req.episode ? ' cur' : '')} onClick={() => e.number !== req.episode && window.api.playerGoto(e.number)}>
                    <span className="pep-img" style={e.image ? { backgroundImage: `url(${e.image})` } : undefined}><b>{e.number}</b></span>
                    <span className="pep-t">
                      <strong>{e.title ?? `${e.number}. bölüm`}</strong>
                      <small>{e.number === req.episode ? 'Şu an oynatılıyor' : e.filler ? 'Filler' : `${e.number}. bölüm`}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {tab === 'sync' && (
              <>
                {!curSub && <p className="pmuted">Önce bir altyazı seç.</p>}
                {curSub && (
                  <>
                    <div className="syncbig">
                      <output>{delay > 0 ? '+' : ''}{delay.toFixed(2)} sn</output>
                      <small>{Math.abs(delay) < 0.05 ? 'Altyazı dosyadaki zamanında' : delay > 0 ? `Altyazı ${delay.toFixed(1)} sn geç gösteriliyor` : `Altyazı ${(-delay).toFixed(1)} sn erken gösteriliyor`}</small>
                    </div>
                    <div className="delay">
                      <button onClick={() => setDelay(delay - 1)}>−1 sn</button>
                      <button onClick={() => setDelay(delay - 0.1)}>−0.1</button>
                      <button onClick={() => setDelay(delay + 0.1)}>+0.1</button>
                      <button onClick={() => setDelay(delay + 1)}>+1 sn</button>
                      {Math.abs(delay) >= 0.001 && <button onClick={() => setDelay(0)}>Sıfırla</button>}
                    </div>
                    <p className="pmuted">Altyazı konuşmadan önce çıkıyorsa artır, sonra çıkıyorsa azalt. Kısayol: <kbd>G</kbd> / <kbd>H</kbd>. Ayar bu bölüm ve bu altyazı için hatırlanır.</p>

                    <h4>Otomatik senkron</h4>
                    {curSubFile ? (
                      <>
                        <button className="opt" disabled={auto?.state === 'running'} onClick={runAutoSync}>
                          <strong>{auto?.state === 'running' ? auto.msg : 'Sesi dinleyerek eşleştir'}</strong>
                          <small>Bulunduğun yerin çevresindeki 5 dakikada konuşmayı yapay zekâ ile bulur (her dil, müzik ve efektlerin içinden) ve altyazı satırlarıyla eşleştirir (±30 sn).</small>
                        </button>
                        {auto?.state === 'done' && (
                          <div className="syncres">
                            <span>
                              {Math.abs(auto.shift) < 0.05 ? 'Altyazı zaten senkron görünüyor.' : `Altyazı ${Math.abs(auto.shift).toFixed(2)} sn ${auto.shift > 0 ? 'geriye' : 'öne'} alındı.`}{' '}
                              Güven: {auto.confidence > 0.6 ? 'yüksek' : auto.confidence > 0.4 ? 'orta' : 'düşük'}
                            </span>
                            {Math.abs(auto.shift) >= 0.05 && <button onClick={() => { setDelay(auto.before); setAuto(null) }}>Geri al</button>}
                          </div>
                        )}
                        {auto?.state === 'error' && <p className="pwarn">{auto.msg}</p>}
                      </>
                    ) : (
                      <p className="pmuted">Otomatik senkron internetten ya da çeviriyle eklenen altyazılarda çalışır. Dosyanın içindeki altyazılar genelde videoyla zaten uyumludur.</p>
                    )}

                    <h4>Satırı yakala</h4>
                    {curSubFile && cues.length > 0 ? (
                      <>
                        <p className="pmuted">Bir cümleyi duyduğun anda o satıra tıkla; altyazı o ana kaydırılır.</p>
                        <div className="cuelist">
                          {nearCues.map(c => (
                            <button key={c.i} className={'cue' + (time >= c.at && time < c.end + delay ? ' now' : '')} onClick={() => catchLine(c)}>
                              <span className="cue-t">{fmt(c.at)}</span>
                              <span className="cue-x">{c.text}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="pmuted">Bir cümleyi duyduğun anda, o cümlenin altyazısını şimdi göster:</p>
                        <div className="delay">
                          <button onClick={() => mpv(['sub-step', -1])}>‹ Önceki satır şimdi</button>
                          <button onClick={() => mpv(['sub-step', 1])}>Sonraki satır şimdi ›</button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </>
            )}

            {tab === 'audio' && (
              <>
                {audio.map(t => (
                  <button key={t.id} className="opt" aria-pressed={!!t.selected} onClick={() => { setProp('aid', t.id); ls.set('audioLang', langCode(t.lang) ?? '') }}>
                    <strong>{langName(t.lang)}</strong>
                    <small>{[t.title, codec(t.codec), channelsLabel(t['demux-channel-count']), t.default ? 'Varsayılan' : null].filter(Boolean).join(' · ')}</small>
                  </button>
                ))}
              </>
            )}

            {tab === 'video' && (
              <>
                <h4>Anime4K</h4>
                {MODES.map(m => (
                  <button key={m.id} className="opt" aria-pressed={mode === m.id} onClick={() => chooseMode(m.id)}>
                    <strong>{m.label}</strong>
                    <small>{m.hint}</small>
                  </button>
                ))}
                <h4>Kalite</h4>
                <div className="seg dark">
                  <button aria-pressed={quality === 'hq'} onClick={() => chooseMode(mode, 'hq')}>Yüksek (güçlü ekran kartı)</button>
                  <button aria-pressed={quality === 'fast'} onClick={() => chooseMode(mode, 'fast')}>Hızlı</button>
                </div>
                <p className="pmuted">Görüntü takılırsa “Hızlı”yı seç. Kısayol: <kbd>A</kbd> modlar arasında geçer.</p>
              </>
            )}

            {tab === 'sources' && <SourcePanel req={req} settings={settings} time={time} />}

            {tab === 'info' && (
              <dl className="pinfo">
                {req.source?.label && (<><dt>Dosya</dt><dd className="mono">{req.source.label}</dd></>)}
                {req.source?.addon && (<><dt>Kaynak</dt><dd>{req.source.addon}{req.source.size ? ' · ' + req.source.size : ''}</dd></>)}
                <dt>Görüntü</dt>
                <dd>{codec(video?.codec)} · {vp.w ?? video?.['demux-w'] ?? '?'}×{vp.h ?? video?.['demux-h'] ?? '?'}{p['container-fps'] ? ` · ${Number(p['container-fps']).toFixed(3).replace(/\.?0+$/, '')} fps` : ''}</dd>
                <dt>Renk</dt>
                <dd>{hdr ?? 'SDR'}{vp.pixelformat ? ` · ${vp.pixelformat}` : ''}{vp.primaries ? ` · ${vp.primaries}` : ''}</dd>
                <dt>Çözücü</dt>
                <dd>{p['hwdec-current'] && p['hwdec-current'] !== 'no' ? `Donanım (${p['hwdec-current']})` : 'Yazılım'}</dd>
                <dt>Ses</dt>
                <dd>{curAudio ? `${langName(curAudio.lang)} · ${codec(curAudio.codec)} ${channelsLabel(curAudio['demux-channel-count'])}` : '—'} ({audio.length} parça)</dd>
                <dt>Altyazı</dt>
                <dd>{subLabel} ({subs.filter(t => !t.external).length} gömülü, {addonSubs?.length ?? 0} internetten)</dd>
                {p['file-format'] && (<><dt>Kapsayıcı</dt><dd>{p['file-format']}</dd></>)}
                {p['video-bitrate'] > 0 && (<><dt>Bit hızı</dt><dd>{(p['video-bitrate'] / 1e6).toFixed(1)} Mb/sn görüntü{p['audio-bitrate'] ? ` · ${Math.round(p['audio-bitrate'] / 1000)} kb/sn ses` : ''}</dd></>)}
                {p['file-size'] > 0 && (<><dt>Boyut</dt><dd>{p['file-size'] >= 1e9 ? (p['file-size'] / 1e9).toFixed(2) + ' GB' : Math.round(p['file-size'] / 1e6) + ' MB'}</dd></>)}
                {segments.length > 1 && (<><dt>Bölümler</dt><dd>{segments.filter(s => s.kind !== 'normal').map(s => `${segmentLabel(s)} ${fmt(s.start)}–${fmt(s.end)}`).join(' · ') || `${segments.length} bölüm`}</dd></>)}
                <dt>Motor</dt>
                <dd>mpv{mode !== 'off' ? ` · Anime4K ${mode} (${quality === 'hq' ? 'yüksek' : 'hızlı'})` : ''}</dd>
              </dl>
            )}
          </div>
        </aside>
      )}

      {menu && (
        <div className="pmenu2" onClick={e => e.stopPropagation()} role="menu">
          {menu === 'root' ? (
            <>
              <h4>Ayarlar</h4>
              <MenuRow icon={L.speed} label="Oynatma hızı" value={`${(p.speed ?? 1).toFixed(2).replace(/0$/, '')}x`} onClick={() => setMenu('speed')} />
              <MenuRow icon={L.next2} label="Otomatik sonraki bölüm" value={autoNext ? 'Açık' : 'Kapalı'} onClick={() => { setAutoNext(v => !v); setLs('autoNext', autoNext ? 'off' : 'on') }} toggle />
              <MenuRow icon={L.skipop} label="Openingi otomatik atla" value={autoSkipOp ? 'Açık' : 'Kapalı'} onClick={() => { setAutoSkipOp(v => !v); setLs('autoSkipOp', autoSkipOp ? 'off' : 'on') }} toggle />
              <MenuRow icon={L.skipop} label="Endingi otomatik atla" value={autoSkipEd ? 'Açık' : 'Kapalı'} onClick={() => { setAutoSkipEd(v => !v); setLs('autoSkipEd', autoSkipEd ? 'off' : 'on') }} toggle />
              <MenuRow icon={L.wand} label="Anime4K" value={mode === 'off' ? 'Kapalı' : `Mod ${mode}`} onClick={() => setMenu('anime4k')} />
              <MenuRow icon={L.next2} label="Filler bölümleri atla" value={settings?.skipFillers ? 'Açık' : 'Kapalı'} onClick={async () => setSettings(await window.api.setSettings({ skipFillers: !settings?.skipFillers }))} toggle />
            </>
          ) : (
            <>
              <button className="pmenu2-back" onClick={() => setMenu('root')}><Ic d={L.left} size={16} /> {menu === 'speed' ? 'Oynatma hızı' : 'Anime4K'}</button>
              {menu === 'speed' && [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(v => (
                <button key={v} className="pmenu2-opt" aria-pressed={Math.abs((p.speed ?? 1) - v) < 0.01} onClick={() => setProp('speed', v)}>{v === 1 ? 'Normal' : v + 'x'}</button>
              ))}
              {menu === 'anime4k' && (
                <>
                  {MODES.map(m => (
                    <button key={m.id} className="pmenu2-opt" aria-pressed={mode === m.id} onClick={() => chooseMode(m.id)}>
                      {m.label}
                      <small>{m.hint}</small>
                    </button>
                  ))}
                  <div className="seg dark pmenu2-seg">
                    <button aria-pressed={quality === 'hq'} onClick={() => chooseMode(mode, 'hq')}>Yüksek kalite</button>
                    <button aria-pressed={quality === 'fast'} onClick={() => chooseMode(mode, 'fast')}>Hızlı</button>
                  </div>
                  {quality === 'hq' && mode !== 'off' && <small className="pmuted">Yüksek kalite güçlü ekran kartı ister; zayıf donanımda görüntü takılabilir.</small>}
                  {off4k.current && <small className="pmuted">Bu video 4K: Anime4K otomatik kapatıldı. Bir mod seçersen yine açılır.</small>}
                </>
              )}
            </>
          )}
        </div>
      )}

      <div ref={pbar} className="pbar" onClick={e => e.stopPropagation()}>
        <SeekBar duration={duration} time={time} buffered={bufferedTo} segments={segments} onSeek={seek} preview={preview} />
        <div className="pctrl">
          {(req.hasPrev || req.hasNext) && (
            <button className="cbtn" onClick={() => goEp(-1)} disabled={!req.hasPrev} title="Önceki bölüm (P)" aria-label="Önceki bölüm"><Ic d={L.prev} size={20} /></button>
          )}
          <button className="cbtn play" onClick={toggle} aria-label={p.pause ? 'Oynat' : 'Duraklat'}><Icon d={p.pause ? I.play : I.pause} size={24} /></button>
          {(req.hasPrev || req.hasNext) && (
            <button className="cbtn" onClick={() => goEp(1)} disabled={!req.hasNext} title="Sonraki bölüm (N)" aria-label="Sonraki bölüm"><Ic d={L.next} size={20} /></button>
          )}
          <button className="cbtn" onClick={() => seekRel(-10)} aria-label="10 saniye geri"><Icon d={I.back10} /></button>
          <button className="cbtn" onClick={() => seekRel(10)} aria-label="10 saniye ileri"><Icon d={I.fwd10} /></button>
          <div className="volgroup">
            <button className="cbtn" onClick={() => setProp('mute', !p.mute)} aria-label="Sesi kapat veya aç"><Ic d={p.mute || p.volume === 0 ? L.mute : L.vol} size={20} /></button>
            <input id="vol" className="range vol" type="range" min={0} max={boost} step={1} value={p.mute ? 0 : p.volume ?? 100} style={{ '--v': `${((p.mute ? 0 : p.volume ?? 100) / boost) * 100}%` } as React.CSSProperties} onChange={e => setVolume(Number(e.target.value))} aria-label="Ses düzeyi" title={`%${Math.round(p.volume ?? 100)}`} />
          </div>
          <span className="ptime">{fmt(time)} <span>/ {fmt(duration)}</span></span>
          {curSeg && curSeg.kind === 'normal' && curSeg.title && segments.length > 1 && <span className="pchapter">· {curSeg.title}</span>}
          <span className="grow" />
          <button className={'cbtn labeled' + (tab === 'subs' || tab === 'sync' ? ' on' : '')} onClick={() => setTab(t => (t === 'subs' ? null : 'subs'))} title="Altyazı (C)">
            <Ic d={L.cc} size={20} /><span>{subLabel}</span>
          </button>
          {!!req.episodeList?.length && <button className={'cbtn' + (tab === 'eps' ? ' on' : '')} onClick={() => setTab(t => (t === 'eps' ? null : 'eps'))} title="Bölümler" aria-label="Bölümler"><Ic d={L.eps} size={19} /></button>}
          <button className={'cbtn' + (tab === 'audio' ? ' on' : '')} onClick={() => setTab(t => (t === 'audio' ? null : 'audio'))} title="Ses parçası" aria-label="Ses parçası"><Ic d={L.speaker} size={20} /></button>
          <button className={'cbtn' + (menu ? ' on' : '')} onClick={() => { setTab(null); setMenu(m => (m ? null : 'root')) }} title="Ayarlar" aria-label="Oynatıcı ayarları"><Ic d={L.gear} size={20} /></button>
          {req.subIds && (
            <button className={'cbtn' + (tab === 'sources' ? ' on' : '')} onClick={() => setTab(t => (t === 'sources' ? null : 'sources'))} title="Başka kaynak: ses bozuk, görüntü yanlış ya da takılıyorsa (R)" aria-label="Başka kaynak"><Ic d={L.cloud} size={20} />{quality_ && <small className="qtag">{quality_}{hdr ? ' HDR' : ''}</small>}</button>
          )}
          <button className={'cbtn' + (tab === 'info' ? ' on' : '')} onClick={() => setTab(t => (t === 'info' ? null : 'info'))} title="Bilgi" aria-label="Yayın bilgisi"><Ic d={L.info} size={20} /></button>
          <button className="cbtn" onClick={() => window.api.playerMini(true)} title="Küçült: oynatıcı köşede açık kalır, uygulamada gezebilirsin" aria-label="Küçült"><Ic d={L.pip} size={20} /></button>
          <button className="cbtn" onClick={fullscreen} aria-label={fs ? 'Tam ekrandan çık' : 'Tam ekran'} title={fs ? 'Tam ekrandan çık (Esc)' : 'Tam ekran (F)'}><Ic d={fs ? L.unfull : L.full} size={20} /></button>
        </div>
      </div>
    </div>
  )
}

function MenuRow({ icon, label, value, onClick, toggle }: { icon: string; label: string; value: string; onClick: () => void; toggle?: boolean }) {
  return (
    <button className="pmenu2-row" onClick={onClick}>
      <Ic d={icon} size={17} />
      <span>{label}</span>
      <em className={toggle && value === 'Açık' ? 'on' : ''}>{value}</em>
      {!toggle && <Ic d={L.chevron} size={15} />}
    </button>
  )
}

/** Sources of this episode inside the player; picking one switches the video and keeps the position. */
/** Sources a stalled torrent already left, per anime + episode (not tried again automatically) */
const leftSources = new Map<string, Set<string>>()

/**
 * A straight torrent that gives nothing: peers are connected but none sends the pieces this episode
 * needs (common with season packs, where most peers fetch other episodes). After 25 s of (almost) no
 * data while waiting, the next best source is opened at the same spot, as if picked from "Kaynak".
 * Mounted only while the player waits for a torrent, so the 25 s are one continuous stall.
 */
function TorrentRescue({ req, settings, time, down }: { req: PlayPayload; settings: PublicSettings | null; time: number; down: number }) {
  const { streams } = useStreamList(req.subIds!.type, req.subIds!.ids, req.searchTitles?.length ? { titles: req.searchTitles, episode: req.episode ?? null } : undefined)
  const [msg, setMsg] = useState<string | null>(null)
  const since = useRef(Date.now())
  const done = useRef(false)
  const at = useRef(time)
  at.current = time
  if (down > 50_000) since.current = Date.now()
  useEffect(() => {
    const t = setInterval(async () => {
      if (done.current || !streams || Date.now() - since.current < 25000) return
      done.current = true
      const k = `${req.animeId ?? req.title}:${req.episode ?? ''}`
      const left = leftSources.get(k) ?? new Set<string>()
      leftSources.set(k, left)
      if (req.source?.label) left.add(req.source.label)
      const ranked = rankStreams(streams, req.episode ?? null, settings?.preferredQuality ?? '1080p', new Set(), req.year, req.total, torrentMode(settings), req.searchTitles, settings?.subLangs?.[0], req.later)
      // only sources that can be the right episode (the score drops far below zero for the wrong ones)
      const next = ranked.find(r => r.score > -100 && !left.has(r.s.label))
      if (!next) return setMsg('Bu kaynakta veren yok. Kaynak menüsünden başka bir kaynak seçebilirsin.')
      left.add(next.s.label)
      setMsg('Bu kaynakta veren yok, sıradakine geçiliyor: ' + next.s.label)
      try {
        const url = await resolveStream(next.s, req.episode ?? null)
        await window.api.playerOpen({ ...req, src: url, source: { addon: next.s.addon, label: next.s.label, size: next.s.size }, start: Math.max(0, at.current - 2), resolve: resolveRequest(next.s, req.episode ?? null) })
      } catch (e: any) {
        setMsg('Sıradaki kaynak açılamadı: ' + String(e.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      }
    }, 1000)
    return () => clearInterval(t)
  }, [streams])
  return msg ? <span>{msg}</span> : null
}

function SourcePanel({ req, settings, time }: { req: PlayPayload; settings: PublicSettings | null; time: number }) {
  const { streams, errors } = useStreamList(req.subIds!.type, req.subIds!.ids, req.searchTitles?.length ? { titles: req.searchTitles, episode: req.episode ?? null } : undefined)
  const [busy, setBusy] = useState<string | null>(null)
  const [fail, setFail] = useState<string | null>(null)
  const [res, setRes] = useState('all')
  useEffect(() => window.api.onResolveProgress(p => setBusy(p.message)), [])
  const ranked = useMemo(
    () => (streams ? rankStreams(streams, req.episode ?? null, settings?.preferredQuality ?? '1080p', new Set(), req.year, req.total, torrentMode(settings), req.searchTitles, settings?.subLangs?.[0], req.later) : []),
    [streams, settings?.preferredQuality]
  )
  const bestKey = ranked[0] ? streamKey(ranked[0].s) : null
  const why = new Map(ranked.map(r => [streamKey(r.s), r.why]))
  const current = req.source?.label
  const list = (streams ?? []).filter(s => res === 'all' || s.resolution === res)
  const counts: Record<string, number> = {}
  streams?.forEach(s => s.resolution && (counts[s.resolution] = (counts[s.resolution] ?? 0) + 1))

  const pick = async (s: ParsedStream) => {
    setFail(null)
    setBusy('Hazırlanıyor…')
    try {
      const url = await resolveStream(s, req.episode ?? null)
      await window.api.playerOpen({ ...req, src: url, source: { addon: s.addon, label: s.label, size: s.size }, start: Math.max(0, time - 2), resolve: resolveRequest(s, req.episode ?? null) })
    } catch (e: any) {
      setFail(String(e.message ?? e))
      setBusy(null)
    }
  }

  return (
    <>
      <div className="seg dark srcres">
        {['all', '2160p', '1080p', '720p', '480p'].filter(r => r === 'all' || counts[r]).map(r => (
          <button key={r} aria-pressed={res === r} onClick={() => setRes(r)}>{r === 'all' ? `Tümü ${streams?.length ?? ''}` : `${r} ${counts[r]}`}</button>
        ))}
      </div>
      {busy && <p className="pwarn">{busy}</p>}
      {fail && <p className="pwarn err">{fail}</p>}
      {!streams && <p className="pmuted">Eklentilerden kaynaklar isteniyor…</p>}
      {streams?.length === 0 && <p className="pmuted">Bu bölüm için kaynak bulunamadı.</p>}
      {list.map((s, i) => {
        const k = streamKey(s)
        const bad = why.get(k)?.find(w => /özel bölüm|kurgu|başka yapım|biçimi/.test(w))
        return (
          <button key={i} className={'opt src' + (bad ? ' dim' : '')} disabled={!!busy} aria-pressed={s.label === current} onClick={() => pick(s)}>
            <span className="srcbadges">
              {s.resolution && <b>{s.resolution}</b>}
              {s.cached && <b className="c">⚡</b>}
              {k === bestKey && <b className="best">Önerilen</b>}
            </span>
            <strong className="srcname">{s.label}</strong>
            <small>{[s.addon, s.size, s.seeders != null ? s.seeders + ' seed' : null, ...s.tags, bad].filter(Boolean).join(' · ')}</small>
          </button>
        )
      })}
      {errors.length > 0 && <p className="pmuted">Yanıt vermeyen: {errors.join(' · ')}</p>}
    </>
  )
}

/** Start moving / resizing the main window; ends on the next mouse up anywhere. */
function startDrag(e: React.PointerEvent, mode: string) {
  if (e.button !== 0) return
  e.preventDefault()
  // Pointer capture: the release is seen even when the cursor is outside the window at that moment.
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  window.api.winDragStart(mode)
  const end = () => {
    window.api.winDragEnd()
    el.removeEventListener('pointerup', end)
    el.removeEventListener('lostpointercapture', end)
    window.removeEventListener('blur', end)
  }
  el.addEventListener('pointerup', end)
  el.addEventListener('lostpointercapture', end)
  window.addEventListener('blur', end)
}

/** Thin strips on the window edges for resizing while the player covers the window. */
function WindowGrips() {
  return (
    <>
      {['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map(m => (
        <div key={m} className={'grip grip-' + m} onPointerDown={e => startDrag(e, m)} />
      ))}
    </>
  )
}

/** Result of checking an online subtitle against the audio. */
function MatchBadge({ c }: { c: { state: 'running' } | { state: 'ok' | 'bad'; shift: number; score: number } }) {
  if (c.state === 'running') return <small className="warn">Sesle karşılaştırılıyor…</small>
  if (c.state === 'bad') return <small className="err">Videoya uymuyor</small>
  const moved = Math.abs(c.shift) >= 0.1 ? ` · ${c.shift > 0 ? '+' : ''}${c.shift.toFixed(1)} sn kaydırıldı` : ''
  return <small className="okc">Videoya uyuyor{moved}</small>
}

/** Root of the overlay window: waits for the main window to send something to play. */
export function OverlayRoot() {
  const [req, setReq] = useState<PlayPayload | null>(null)
  const [loading, setLoading] = useState<PlayerLoading | null>(null)
  const [mode, setMode] = useState({ mini: false, square: false })
  const [n, setN] = useState(0)
  const [ready, setReady] = useState(false)
  // Fade the opening screen out once the video shows, then drop it.
  useEffect(() => {
    if (!ready || !loading) return
    const t = setTimeout(() => setLoading(null), 350)
    return () => clearTimeout(t)
  }, [ready])
  useEffect(() => {
    document.documentElement.classList.add('overlay-mode')
    // Same accent theme as the app
    const theme = () => window.api.getSettings().then(s => (document.documentElement.dataset.theme = s.theme === 'kagit' || s.theme === 'sakura' ? 'grafit' : s.theme)) // the player stays dark on light themes
    theme()
    const offs = [
      window.api.onSettingsChanged(theme),
      window.api.onPlayerLoad(p => {
        // The opening screen stays on top until the first video frame, so no black gap shows.
        setLoading(l => l ?? { title: p.title, subtitle: p.subtitle, backdrop: p.cover })
        setReady(false)
        setReq(p)
        setN(x => x + 1)
      }),
      // A new episode is being prepared: the opening screen replaces the old video's controls.
      window.api.onPlayerLoading(l => {
        setReq(null)
        setReady(false)
        setLoading(l)
      }),
      window.api.onPlayerReset(() => {
        setReq(null)
        setLoading(null)
      }),
      window.api.onPlayerMode(setMode),
      // the window is being moved or resized: the controls hide meanwhile (they would trail behind the video)
      window.api.onPlayerDragging?.(on => void document.documentElement.classList.toggle('pdragging', on)) ?? (() => {}),
    ]
    return () => offs.forEach(f => f())
  }, [])
  return (
    <>
      {req && <MpvPlayer key={n} req={req} mini={mode.mini} square={mode.square} onReady={() => setReady(true)} />}
      {loading && !mode.mini && <OpeningScreen l={loading} square={mode.square} fading={ready} />}
    </>
  )
}

/** Opening screen while the source is found (backdrop, title, status), like Nuvio / Stremio. */
function OpeningScreen({ l, square, fading }: { l: PlayerLoading; square: boolean; fading?: boolean }) {
  const msg = 'Yükleniyor…'
  const [fs, setFs] = useState(false)
  useEffect(() => {
    window.api.winState().then(s => setFs(s.fullscreen))
    const offs = [window.api.onWinState(s => setFs(s.fullscreen))]
    const key = (e: KeyboardEvent) => e.key === 'Escape' && window.api.playerClose()
    window.addEventListener('keydown', key)
    return () => {
      offs.forEach(f => f())
      window.removeEventListener('keydown', key)
    }
  }, [])
  return (
    <div className={'player mpv opening' + (square ? ' square' : '') + (fading ? ' fading' : '')}>
      {l.backdrop && <div className="opening-bg" style={{ backgroundImage: `url(${l.backdrop})` }} />}
      <div className="opening-shade" />
      {/* Same top bar as the player: back on the left, window buttons on the right; the strip moves the
          window and the edges resize it (the opening screen used to block both). */}
      {!fs && <WindowGrips />}
      <div className="pdrag" onPointerDown={e => startDrag(e, 'move')} onDoubleClick={() => window.api.winMaximize()} />
      <div className="ptop">
        <button className="ghostbtn" onClick={() => window.api.playerClose()} aria-label="Geri" title="Geri (Esc)"><Ic d={L.left} size={20} /></button>
        <span className="grow" />
        {!fs && <WindowControls />}
      </div>
      <div className="opening-mid">
        <h1>{l.title}</h1>
        {l.subtitle && <p>{l.subtitle}</p>}
        <div className="opening-status">
          <div className="spinner sm" />
          <span>{msg}</span>
        </div>
      </div>
    </div>
  )
}

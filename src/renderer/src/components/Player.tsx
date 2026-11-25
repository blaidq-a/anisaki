import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AddonSubtitle, Anime4KMode, MediaInfo, MediaTrack } from '../../../shared/types'
import { Anime4KRenderer, MODES, webgpuSupported } from '../lib/anime4k'
import { langCode, langName, streamText, SubtitleLayer } from '../lib/subtitles'
import { useStore, type PlayRequest } from '../store'

/* ---------------------------------- helpers --------------------------------- */
const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, '0')
  return h ? `${h}:${m.toString().padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
const CODEC: Record<string, string> = {
  aac: 'AAC', opus: 'Opus', flac: 'FLAC', mp3: 'MP3', vorbis: 'Vorbis', ac3: 'Dolby Digital (AC3)', eac3: 'Dolby Digital Plus (EAC3)', dts: 'DTS',
  truehd: 'Dolby TrueHD', h264: 'H.264 (AVC)', hevc: 'H.265 (HEVC)', av1: 'AV1', vp9: 'VP9', ass: 'ASS', ssa: 'SSA', subrip: 'SRT',
  hdmv_pgs_subtitle: 'PGS (görüntü)', dvd_subtitle: 'VobSub (görüntü)', webvtt: 'WebVTT', mov_text: 'MP4 metin'
}
const codec = (c: string) => CODEC[c] ?? c.toUpperCase()
const channels = (t: MediaTrack) => (t.channels ? (t.channels === 2 ? 'Stereo' : t.channels === 1 ? 'Mono' : t.channels === 6 ? '5.1' : t.channels === 8 ? '7.1' : t.channels + ' kanal') : '')
const store = {
  get: (k: string) => { try { return localStorage.getItem('player.' + k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem('player.' + k, v) } catch {} }
}

type SubChoice = { kind: 'embedded'; rel: number } | { kind: 'addon'; sub: AddonSubtitle } | null
type Tab = 'subs' | 'audio' | 'video' | 'info'

const Icon = ({ d, size = 22 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path d={d} fill="currentColor" /></svg>
)
const I = {
  play: 'M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z',
  pause: 'M7 5h3.5v14H7zm6.5 0H17v14h-3.5z',
  back10: 'M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8zm-1.1 11h-1V11.6l-1.2.4v-.9l2.1-.8h.1zm4.5-2c0 1.4-.6 2.1-1.6 2.1s-1.6-.7-1.6-2.1v-.8c0-1.4.6-2.1 1.6-2.1s1.6.7 1.6 2.1zm-1 .1v-1c0-.8-.2-1.2-.6-1.2s-.6.4-.6 1.2v1c0 .8.2 1.2.6 1.2s.6-.4.6-1.2z',
  fwd10: 'M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8zm-1.1 11h-1V11.6l-1.2.4v-.9l2.1-.8h.1zm4.5-2c0 1.4-.6 2.1-1.6 2.1s-1.6-.7-1.6-2.1v-.8c0-1.4.6-2.1 1.6-2.1s1.6.7 1.6 2.1zm-1 .1v-1c0-.8-.2-1.2-.6-1.2s-.6.4-.6 1.2v1c0 .8.2 1.2.6 1.2s.6-.4.6-1.2z',
  vol: 'M4 9v6h4l5 5V4L8 9zm12.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
  mute: 'M4 9v6h4l5 5V4L8 9zm12.6 3 2.4-2.4-1.1-1.1-2.4 2.4-2.4-2.4L12 9.6l2.4 2.4-2.4 2.4 1.1 1.1 2.4-2.4 2.4 2.4 1.1-1.1z',
  cc: 'M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1zm7 0h-1.5v-.5h-2v3h2V13H18v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1z',
  audio: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3z',
  sparkle: 'M12 2l2.2 6.3L20.5 10l-6.3 2.2L12 18.5l-2.2-6.3L3.5 10l6.3-1.7zM19 15l1 2.6 2.6 1-2.6 1L19 22l-1-2.6-2.6-1 2.6-1z',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2zm0-8h-2V7h2z',
  full: 'M5 5h5v2H7v3H5zm9 0h5v5h-2V7h-3zM5 14h2v3h3v2H5zm12 0h2v5h-5v-2h3z',
  next: 'M6 6l8.5 6L6 18zm10 0h2v12h-2z',
  close: 'M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7l-1.4-1.4L9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z'
}

/* ---------------------------------- player ---------------------------------- */
export function Player({ req }: { req: PlayRequest }) {
  const { settings, setSettings, setPlay } = useStore()
  const wrap = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const a4kCanvas = useRef<HTMLCanvasElement>(null)
  const subsHost = useRef<HTMLDivElement>(null)
  const renderer = useRef<Anime4KRenderer | null>(null)
  const subs = useRef<SubtitleLayer | null>(null)
  const subsAbort = useRef<AbortController | null>(null)
  const offset = useRef(0) // stream start time when transcoding
  const marked = useRef(false)
  const idle = useRef(0)
  const fellBack = useRef(false)

  const [sid, setSid] = useState<string | null>(null)
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [probing, setProbing] = useState(true)
  const [transcode, setTranscode] = useState(false)
  const [audioRel, setAudioRel] = useState(0)
  const [addonSubs, setAddonSubs] = useState<AddonSubtitle[] | null>(req.subIds ? null : [])
  const [sub, setSub] = useState<SubChoice>(null)
  const [subState, setSubState] = useState<string | null>(null)
  const [subDelay, setSubDelay] = useState(0)
  const [mode, setMode] = useState<Anime4KMode>(webgpuSupported() ? settings?.anime4k ?? 'A' : 'off')
  const [paused, setPaused] = useState(true)
  const [time, setTime] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [scrub, setScrub] = useState<number | null>(null)
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null)
  const [volume, setVolume] = useState(Number(store.get('volume') ?? 1))
  const [muted, setMuted] = useState(false)
  const [waiting, setWaiting] = useState(true)
  const [showUi, setShowUi] = useState(true)
  const [tab, setTab] = useState<Tab | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [a4kInfo, setA4kInfo] = useState('')

  const seekGen = useRef(0) // newer seeks cancel older ones still waiting on ffmpeg
  const pending = useRef<number | null>(null) // target of a seek that hasn't started playing yet

  const duration = info?.duration || (video.current && isFinite(video.current.duration) ? video.current.duration + offset.current : 0)
  const absTime = () => pending.current ?? offset.current + (video.current?.currentTime ?? 0)

  /** Restart the ffmpeg stream at the keyframe before t (transcode mode). Returns false if superseded. */
  const restartStream = async (t: number, audio: number): Promise<boolean> => {
    if (!sid) return false
    const my = ++seekGen.current
    pending.current = t
    setTime(t)
    setWaiting(true)
    const k = await window.api.mediaKeyframe(sid, t)
    const url = await window.api.mediaStreamUrl(sid, k, audio)
    if (my !== seekGen.current) return false
    offset.current = k
    video.current!.src = url
    return true
  }

  const close = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    setPlay(null)
  }

  /* ------------------------------ 1. open media ------------------------------ */
  useEffect(() => {
    let live = true
    let opened: string | null = null
    const v = video.current!
    v.volume = volume
    ;(async () => {
      try {
        const r = await Promise.race([window.api.mediaOpen(req.src), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 25000))])
        opened = r.sid
        if (!live) return void window.api.mediaClose(r.sid)
        setSid(r.sid)
        setInfo(r.info)
        // Audio: remembered language, else the file's default track.
        const prefLang = store.get('audioLang')
        const a = r.info.audio.find(t => prefLang && langCode(t.lang) === prefLang) ?? r.info.audio.find(t => t.default) ?? r.info.audio[0]
        const rel = a?.rel ?? 0
        setAudioRel(rel)
        if (r.info.video.hdr && webgpuSupported()) {
          setMode('off')
          setNotice(`${r.info.video.hdr} kaynak: Anime4K renkleri soldurduğu için kapatıldı. Görüntü sekmesinden yine açabilirsin.`)
        }
        const direct = r.info.video.supported && (!a || (a.supported && a.rel === 0))
        if (direct) v.src = req.src
        else {
          setTranscode(true)
          offset.current = 0
          v.src = await window.api.mediaStreamUrl(r.sid, 0, rel)
        }
      } catch {
        // Probe failed (unreachable, unusual host): just try the browser.
        if (live) v.src = req.src
      } finally {
        if (live) {
          setProbing(false)
          v.play().catch(() => {})
        }
      }
    })()
    return () => {
      live = false
      if (opened) window.api.mediaClose(opened)
    }
  }, [req.src])

  /* --------------------------- 2. subtitle addons --------------------------- */
  useEffect(() => {
    if (!req.subIds) return
    let live = true
    const timer = setTimeout(() => live && setAddonSubs(s => s ?? []), 10000)
    window.api.getSubtitles(req.subIds.type, req.subIds.ids).then(
      list => live && setAddonSubs(list),
      () => live && setAddonSubs([])
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [req.src])

  /* ---------------------- 3. pick a subtitle automatically ---------------------- */
  const autoPicked = useRef(false)
  useEffect(() => {
    if (autoPicked.current || probing || addonSubs === null) return
    autoPicked.current = true
    const pref = store.get('subLang') ?? 'tr'
    if (pref === 'off') return
    const emb = (info?.subtitles ?? []).filter(t => t.supported)
    const byLang = (l: string) => emb.find(t => langCode(t.lang) === l && !t.forced) ?? emb.find(t => langCode(t.lang) === l)
    const addonBy = (l: string) => addonSubs.find(s => langCode(s.lang) === l)
    const e1 = byLang(pref)
    if (e1) return setSub({ kind: 'embedded', rel: e1.rel })
    const a1 = addonBy(pref)
    if (a1) return setSub({ kind: 'addon', sub: a1 })
    const fallback = byLang('en') ?? emb.find(t => t.default) ?? emb[0]
    if (fallback) return setSub({ kind: 'embedded', rel: fallback.rel })
    const a2 = addonBy('en')
    if (a2) setSub({ kind: 'addon', sub: a2 })
  }, [probing, addonSubs, info])

  /* ---------------------------- 4. load subtitles ---------------------------- */
  useEffect(() => {
    subsAbort.current?.abort()
    if (!subs.current) subs.current = new SubtitleLayer(subsHost.current!)
    const layer = subs.current
    if (!sub) {
      layer.clear()
      setSubState(null)
      return
    }
    const ac = new AbortController()
    subsAbort.current = ac
    ;(async () => {
      try {
        if (sub.kind === 'addon') {
          setSubState('Altyazı indiriliyor…')
          const text = await window.api.externalSubtitle(sub.sub.url, sub.sub.lang)
          if (ac.signal.aborted) return
          await layer.load(text)
          setSubState(null)
        } else if (sid) {
          setSubState('Altyazı dosyadan okunuyor…')
          const fonts = await window.api.mediaFonts(sid)
          if (ac.signal.aborted) return
          let first = true
          await streamText(
            await window.api.mediaSubsUrl(sid, sub.rel),
            async (text, done) => {
              if (ac.signal.aborted) return
              if (first) {
                first = false
                await layer.load(text, fonts)
              } else await layer.update(text)
              setSubState(done ? null : 'Altyazı yükleniyor… (ileri kısımlar birkaç saniye içinde gelir)')
              layoutSubs()
            },
            ac.signal
          )
        }
        layoutSubs()
      } catch (e: any) {
        if (!ac.signal.aborted) setSubState('Altyazı yüklenemedi: ' + String(e.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      }
    })()
    return () => ac.abort()
  }, [sub, sid])

  useEffect(
    () => () => {
      subsAbort.current?.abort()
      subs.current?.clear()
      renderer.current?.destroy()
    },
    []
  )

  /* --------------------- 5. frame loop: subtitles + time --------------------- */
  useEffect(() => {
    let h = 0
    const loop = () => {
      const v = video.current
      if (v && subs.current) subs.current.render(absTime() - subDelay, v.videoWidth, v.videoHeight)
      h = requestAnimationFrame(loop)
    }
    h = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(h)
  }, [subDelay])

  const layoutSubs = useCallback(() => {
    const v = video.current
    const w = wrap.current
    if (!v || !w || !subs.current) return
    const W = w.clientWidth
    const H = w.clientHeight
    const vw = v.videoWidth || 16
    const vh = v.videoHeight || 9
    const scale = Math.min(W / vw, H / vh)
    const width = vw * scale
    const height = vh * scale
    subs.current.layout({ x: (W - width) / 2, y: (H - height) / 2, width, height })
  }, [])

  /* ------------------------------ 6. Anime4K ------------------------------ */
  const rebuildA4k = () => {
    const r = renderer.current
    if (!r || mode === 'off') return
    try {
      r.build(mode)
      const v = video.current!
      if (v.videoWidth) setA4kInfo(`${v.videoWidth}×${v.videoHeight} → ${a4kCanvas.current!.width}×${a4kCanvas.current!.height}`)
    } catch (e: any) {
      setNotice('Anime4K başlatılamadı: ' + e.message)
      setMode('off')
    }
  }

  useEffect(() => {
    if (mode === 'off') {
      renderer.current?.destroy()
      renderer.current = null
      setA4kInfo('')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        if (!renderer.current) {
          const r = new Anime4KRenderer(video.current!, a4kCanvas.current!)
          await r.init()
          if (cancelled) return r.destroy()
          renderer.current = r
          r.start()
        }
        rebuildA4k()
      } catch (e: any) {
        setNotice(e.message)
        setMode('off')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mode])

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      rebuildA4k()
      layoutSubs()
    })
    ro.observe(wrap.current!)
    return () => ro.disconnect()
  }, [mode])

  /* -------------------------------- seeking -------------------------------- */
  const seekTo = async (t: number) => {
    const v = video.current!
    t = Math.max(0, Math.min(duration ? duration - 1 : t, t))
    if (!transcode || !sid) {
      v.currentTime = t
      return
    }
    const wasPaused = v.paused
    if ((await restartStream(t, audioRel)) && !wasPaused) v.play().catch(() => {})
  }

  const chooseAudio = async (t: MediaTrack) => {
    if (!sid || !info) return
    store.set('audioLang', langCode(t.lang) ?? '')
    setAudioRel(t.rel)
    const at = absTime()
    const v = video.current!
    const wasPaused = v.paused
    if (info.video.supported && t.supported && t.rel === 0) {
      seekGen.current++
      pending.current = null
      setTranscode(false)
      offset.current = 0
      v.src = req.src
      v.currentTime = at
    } else {
      setTranscode(true)
      if (!(await restartStream(at, t.rel))) return
    }
    if (!wasPaused) v.play().catch(() => {})
  }

  const chooseSub = (c: SubChoice) => {
    setSub(c)
    store.set('subLang', c === null ? 'off' : (langCode(c.kind === 'addon' ? c.sub.lang : info?.subtitles[c.rel]?.lang) ?? 'tr'))
  }

  /* ----------------------------- progress mark ----------------------------- */
  const onTime = async () => {
    const v = video.current!
    const t = absTime()
    if (scrub == null) setTime(t)
    if (v.buffered.length) setBuffered(offset.current + v.buffered.end(v.buffered.length - 1))
    if (!marked.current && req.animeId && req.episode && duration && t / duration > 0.85 && settings) {
      marked.current = true
      const cur = settings.library[req.animeId]
      if ((cur?.progress ?? 0) < req.episode) {
        const done = req.episodes != null && req.episode >= req.episodes
        const lib = await window.api.setLibrary({
          id: req.animeId, title: req.title, cover: req.cover ?? '', episodes: req.episodes ?? null, score: cur?.score ?? null, updated: Date.now(),
          progress: req.episode, status: done ? 'done' : cur?.status === 'plan' || !cur ? 'watching' : cur.status
        })
        setSettings({ ...settings, library: lib })
      }
    }
  }

  /* -------------------------------- controls -------------------------------- */
  const toggle = () => {
    const v = video.current!
    v.paused ? v.play().catch(() => {}) : v.pause()
  }
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : wrap.current!.requestFullscreen())
  const chooseMode = (m: Anime4KMode) => {
    setMode(m)
    setNotice(null)
    window.api.setSettings({ anime4k: m }).then(setSettings)
  }
  const poke = () => {
    setShowUi(true)
    clearTimeout(idle.current)
    idle.current = window.setTimeout(() => !video.current?.paused && setShowUi(false), 2800)
  }

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement
    if ((el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range') || el.tagName === 'SELECT') return
    const v = video.current!
    switch (e.key) {
      case ' ': case 'k': e.preventDefault(); toggle(); break
      case 'ArrowRight': e.preventDefault(); seekTo(absTime() + 10); break
      case 'ArrowLeft': e.preventDefault(); seekTo(absTime() - 10); break
      case 'ArrowUp': e.preventDefault(); v.volume = Math.min(1, v.volume + 0.1); break
      case 'ArrowDown': e.preventDefault(); v.volume = Math.max(0, v.volume - 0.1); break
      case 'f': fullscreen(); break
      case 'm': v.muted = !v.muted; break
      case 'a': { const ids = MODES.map(m => m.id); chooseMode(ids[(ids.indexOf(mode) + 1) % ids.length]); break }
      case 'c': setTab(t => (t === 'subs' ? null : 'subs')); break
      case 's': seekTo(absTime() + 85); break
      case 'g': setSubDelay(d => Math.round((d - 0.1) * 10) / 10); break
      case 'h': setSubDelay(d => Math.round((d + 0.1) * 10) / 10); break
      case 'Escape': if (tab) setTab(null); else if (!document.fullscreenElement) close(); break
      default: return
    }
    poke()
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  /* ------------------------------ derived labels ------------------------------ */
  const shownTime = scrub ?? time
  const pct = duration ? (shownTime / duration) * 100 : 0
  const bufPct = duration ? Math.min(100, (buffered / duration) * 100) : 0
  const curAudio = info?.audio.find(t => t.rel === audioRel)
  const quality = info ? `${info.video.height >= 2000 ? '4K' : info.video.height ? info.video.height + 'p' : ''}${info.video.hdr ? ' · ' + info.video.hdr : ''}` : ''
  const subLabel = sub === null ? 'Kapalı' : sub.kind === 'addon' ? langName(sub.sub.lang) : langName(info?.subtitles[sub.rel]?.lang)
  const addonGroups = useMemo(() => {
    const g = new Map<string, AddonSubtitle[]>()
    ;(addonSubs ?? []).forEach(s => g.set(langCode(s.lang) ?? s.lang, [...(g.get(langCode(s.lang) ?? s.lang) ?? []), s]))
    return [...g.entries()].sort(([a], [b]) => (a === 'tr' ? -1 : b === 'tr' ? 1 : a === 'en' ? -1 : b === 'en' ? 1 : langName(a).localeCompare(langName(b), 'tr')))
  }, [addonSubs])

  /* ---------------------------------- view ---------------------------------- */
  return (
    <div className={'player' + (showUi || tab ? '' : ' hide-ui')} ref={wrap} onMouseMove={poke}>
      <video
        ref={video}
        crossOrigin="anonymous"
        className={mode !== 'off' ? 'under' : ''}
        onPlay={() => { setPaused(false); poke() }}
        onPause={() => { setPaused(true); setShowUi(true) }}
        onTimeUpdate={onTime}
        onLoadedMetadata={() => { pending.current = null; rebuildA4k(); layoutSubs(); setError(null) }}
        onSeeked={() => renderer.current?.draw(true)}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onVolumeChange={e => { setVolume(e.currentTarget.volume); setMuted(e.currentTarget.muted); store.set('volume', String(e.currentTarget.volume)) }}
        onEnded={() => setShowUi(true)}
        onError={async () => {
          const c = video.current?.error?.code
          // The browser rejected the container/codec: retry once through ffmpeg.
          if (!transcode && sid && info?.video.supported && !fellBack.current) {
            fellBack.current = true
            setTranscode(true)
            if (await restartStream(absTime(), audioRel)) video.current!.play().catch(() => {})
            return
          }
          setError(
            c === 4
              ? `Bu video dahili oynatıcıda açılamıyor${info ? ` (${codec(info.video.codec)}${info.video.pixFmt?.includes('10') ? ' 10-bit' : ''})` : ''}. Ayarlar’dan mpv’yi seçip tekrar dene ya da başka bir kaynak seç.`
              : 'Video yüklenemedi. Link süresi dolmuş olabilir; kaynağı tekrar seç.'
          )
        }}
      />
      <canvas ref={a4kCanvas} className={mode !== 'off' ? 'a4k' : 'a4k off'} />
      <div className="subs-host" ref={subsHost} />
      <div className="click-layer" onClick={() => (tab ? setTab(null) : toggle())} onDoubleClick={fullscreen} />

      {(waiting || probing) && !error && (
        <div className="loading">
          <div className="spinner" />
          {probing && <span>Dosya inceleniyor…</span>}
        </div>
      )}
      {paused && !waiting && !probing && !error && !tab && (
        <button className="bigplay" onClick={toggle} aria-label="Oynat"><Icon d={I.play} size={44} /></button>
      )}
      {error && (
        <div className="perror">
          <p>{error}</p>
          <button className="btn" onClick={close}>Geri dön</button>
        </div>
      )}

      <div className="ptop">
        <button className="ghostbtn" onClick={close} aria-label="Kapat">‹</button>
        <div className="ptitle">
          <strong>{req.title}</strong>
          {req.subtitle && <span>{req.subtitle}</span>}
        </div>
        <div className="pbadges">
          {quality && <span>{quality}</span>}
          {transcode && curAudio && !curAudio.supported && <span title="Ses bu oynatıcıda çözülemediği için anında AAC’ye dönüştürülüyor">Ses dönüştürülüyor</span>}
          {mode !== 'off' && <span className="accent">Anime4K {MODES.find(m => m.id === mode)?.label.replace('Mod ', '')}</span>}
        </div>
      </div>

      {notice && (
        <div className="pnotice">
          {notice}
          <button onClick={() => setNotice(null)} aria-label="Kapat"><Icon d={I.close} size={14} /></button>
        </div>
      )}
      {subState && <div className="psubstate">{subState}</div>}

      {req.onNext && duration > 0 && duration - time < 90 && (
        <button className="nextep" onClick={() => { close(); req.onNext!() }}>
          Sonraki bölüm <Icon d={I.next} size={16} />
        </button>
      )}

      {/* ------------------------------ side panel ------------------------------ */}
      {tab && (
        <aside className="ppanel" onClick={e => e.stopPropagation()}>
          <nav className="ptabs" role="tablist">
            {([['subs', 'Altyazı'], ['audio', 'Ses'], ['video', 'Görüntü'], ['info', 'Bilgi']] as const).map(([id, l]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{l}</button>
            ))}
            <button className="ptabs-close" onClick={() => setTab(null)} aria-label="Paneli kapat"><Icon d={I.close} size={16} /></button>
          </nav>

          <div className="pbody">
            {tab === 'subs' && (
              <>
                <button className="opt" aria-pressed={sub === null} onClick={() => chooseSub(null)}>
                  <strong>Kapalı</strong>
                </button>
                <h4>Dosyadaki altyazılar</h4>
                {!info?.subtitles.length && <p className="pmuted">{probing ? 'Dosya inceleniyor…' : 'Bu dosyada gömülü altyazı yok.'}</p>}
                {info?.subtitles.map(t => (
                  <button key={t.rel} className="opt" disabled={!t.supported} aria-pressed={sub?.kind === 'embedded' && sub.rel === t.rel} onClick={() => chooseSub({ kind: 'embedded', rel: t.rel })}>
                    <strong>{langName(t.lang)}{t.forced ? ' · Zorunlu' : ''}</strong>
                    <small>{[t.title, codec(t.codec), t.default ? 'Varsayılan' : null, !t.supported ? 'görüntü tabanlı, desteklenmiyor' : null].filter(Boolean).join(' · ')}</small>
                  </button>
                ))}
                <h4>Eklentilerden</h4>
                {addonSubs === null && <p className="pmuted">Altyazı eklentilerine soruluyor…</p>}
                {addonSubs?.length === 0 && <p className="pmuted">Eklentilerden altyazı gelmedi. Eklentiler sayfasından OpenSubtitles’ı kurabilirsin.</p>}
                {addonGroups.map(([lang, list]) => (
                  <details key={lang} open={lang === 'tr'}>
                    <summary>{langName(lang)} <span className="pmuted">{list.length}</span></summary>
                    {list.map((s, i) => (
                      <button key={s.id} className="opt" aria-pressed={sub?.kind === 'addon' && sub.sub.id === s.id} onClick={() => chooseSub({ kind: 'addon', sub: s })}>
                        <strong>{langName(s.lang)} #{i + 1}</strong>
                        <small>{s.addon}</small>
                      </button>
                    ))}
                  </details>
                ))}
                <h4>Zamanlama</h4>
                <div className="delay">
                  <button onClick={() => setSubDelay(d => Math.round((d - 0.1) * 10) / 10)}>−0.1 sn</button>
                  <output>{subDelay > 0 ? '+' : ''}{subDelay.toFixed(1)} sn</output>
                  <button onClick={() => setSubDelay(d => Math.round((d + 0.1) * 10) / 10)}>+0.1 sn</button>
                  {subDelay !== 0 && <button onClick={() => setSubDelay(0)}>Sıfırla</button>}
                </div>
                <p className="pmuted">Altyazı erken geliyorsa artır, geç geliyorsa azalt. Kısayol: <kbd>G</kbd> / <kbd>H</kbd></p>
              </>
            )}

            {tab === 'audio' && (
              <>
                {!info?.audio.length && <p className="pmuted">{probing ? 'Dosya inceleniyor…' : 'Ses parçası bilgisi alınamadı.'}</p>}
                {info?.audio.map(t => (
                  <button key={t.rel} className="opt" aria-pressed={audioRel === t.rel} onClick={() => chooseAudio(t)}>
                    <strong>{langName(t.lang)}</strong>
                    <small>{[t.title, codec(t.codec), channels(t), t.default ? 'Varsayılan' : null].filter(Boolean).join(' · ')}</small>
                    {!t.supported && <small className="warn">Tarayıcı çözemiyor, AAC’ye dönüştürülerek çalınır</small>}
                  </button>
                ))}
                <h4>Ses düzeyi</h4>
                <input id="volPanel" className="range" type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={e => { const v = video.current!; v.volume = Number(e.target.value); v.muted = false }} aria-label="Ses düzeyi" />
              </>
            )}

            {tab === 'video' && (
              <>
                <h4>Anime4K</h4>
                {!webgpuSupported() && <p className="pmuted">Bu cihazda WebGPU yok, Anime4K kullanılamıyor.</p>}
                {MODES.map(m => (
                  <button key={m.id} className="opt" aria-pressed={mode === m.id} disabled={m.id !== 'off' && !webgpuSupported()} onClick={() => chooseMode(m.id)}>
                    <strong>{m.label}</strong>
                    <small>{m.hint}</small>
                  </button>
                ))}
                {info?.video.hdr && <p className="pwarn">Bu kaynak {info.video.hdr}. Anime4K HDR renkleri doğru işleyemediği için görüntü soluk görünebilir.</p>}
                {a4kInfo && <p className="pmuted mono">İşleme: {a4kInfo}</p>}
              </>
            )}

            {tab === 'info' && (
              <dl className="pinfo">
                {req.source?.label && (<><dt>Dosya</dt><dd className="mono">{req.source.label}</dd></>)}
                {req.source?.addon && (<><dt>Kaynak</dt><dd>{req.source.addon}{req.source.size ? ' · ' + req.source.size : ''}</dd></>)}
                <dt>Oynatma</dt>
                <dd>
                  {probing
                    ? 'İnceleniyor…'
                    : !transcode
                      ? 'Doğrudan (dönüştürme yok)'
                      : curAudio && !curAudio.supported
                        ? `Görüntü olduğu gibi, ses ${codec(curAudio.codec)} → AAC dönüştürülüyor`
                        : 'Dönüştürme yok, seçilen ses parçası için yeniden paketleniyor'}
                </dd>
                {info && (
                  <>
                    <dt>Görüntü</dt>
                    <dd>{codec(info.video.codec)}{info.video.profile ? ` (${info.video.profile})` : ''} · {info.video.width}×{info.video.height}{info.video.fps ? ` · ${info.video.fps} fps` : ''}</dd>
                    <dt>Renk</dt>
                    <dd>{info.video.hdr ?? 'SDR'}{info.video.pixFmt ? ` · ${info.video.pixFmt}` : ''}</dd>
                    <dt>Ses</dt>
                    <dd>{curAudio ? `${langName(curAudio.lang)} · ${codec(curAudio.codec)} ${channels(curAudio)}` : '—'} ({info.audio.length} parça)</dd>
                    <dt>Altyazı</dt>
                    <dd>{subLabel} ({info.subtitles.length} gömülü, {addonSubs?.length ?? 0} eklentiden)</dd>
                    <dt>Kapsayıcı</dt>
                    <dd>{info.container}</dd>
                    {info.bitrate > 0 && (<><dt>Bit hızı</dt><dd>{(info.bitrate / 1e6).toFixed(1)} Mb/sn</dd></>)}
                    {info.size > 0 && (<><dt>Boyut</dt><dd>{info.size >= 1e9 ? (info.size / 1e9).toFixed(2) + ' GB' : Math.round(info.size / 1e6) + ' MB'}</dd></>)}
                    {info.hasFonts && (<><dt>Fontlar</dt><dd>Dosyaya gömülü fontlar kullanılıyor</dd></>)}
                  </>
                )}
                {mode !== 'off' && a4kInfo && (<><dt>Anime4K</dt><dd className="mono">{a4kInfo}</dd></>)}
              </dl>
            )}
          </div>
        </aside>
      )}

      {/* ------------------------------ bottom bar ------------------------------ */}
      <div className="pbar" onClick={e => e.stopPropagation()}>
        <div
          className="seek"
          onMouseMove={e => {
            const r = e.currentTarget.getBoundingClientRect()
            const x = Math.max(0, Math.min(r.width, e.clientX - r.left))
            setHover({ x, t: (x / r.width) * duration })
          }}
          onMouseLeave={() => setHover(null)}
        >
          <div className="seek-track">
            <div className="seek-buf" style={{ width: bufPct + '%' }} />
            <div className="seek-fill" style={{ width: pct + '%' }} />
            <div className="seek-thumb" style={{ left: pct + '%' }} />
          </div>
          <input
            id="seek"
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={shownTime}
            onChange={e => setScrub(Number(e.target.value))}
            onPointerUp={() => { if (scrub != null) { seekTo(scrub); setScrub(null) } }}
            onKeyUp={() => { if (scrub != null) { seekTo(scrub); setScrub(null) } }}
            aria-label="Konum"
          />
          {hover && duration > 0 && <div className="seek-tip" style={{ left: hover.x }}>{fmt(hover.t)}</div>}
        </div>

        <div className="pctrl">
          <button className="cbtn" onClick={toggle} aria-label={paused ? 'Oynat' : 'Duraklat'}><Icon d={paused ? I.play : I.pause} /></button>
          <button className="cbtn" onClick={() => seekTo(absTime() - 10)} aria-label="10 saniye geri"><Icon d={I.back10} /></button>
          <button className="cbtn" onClick={() => seekTo(absTime() + 10)} aria-label="10 saniye ileri"><Icon d={I.fwd10} /></button>
          <div className="volgroup">
            <button className="cbtn" onClick={() => { const v = video.current!; v.muted = !v.muted }} aria-label="Sesi kapat veya aç"><Icon d={muted || volume === 0 ? I.mute : I.vol} /></button>
            <input id="vol" className="range vol" type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={e => { const v = video.current!; v.volume = Number(e.target.value); v.muted = false }} aria-label="Ses düzeyi" />
          </div>
          <span className="ptime">{fmt(shownTime)} <span>/ {fmt(duration)}</span></span>
          <span className="grow" />
          <button className="pill-btn" onClick={() => seekTo(absTime() + 85)} title="S tuşu">Openingi atla</button>
          <button className={'cbtn labeled' + (tab === 'subs' ? ' on' : '')} onClick={() => setTab(t => (t === 'subs' ? null : 'subs'))} title="Altyazı (C)">
            <Icon d={I.cc} /><span>{subLabel}</span>
          </button>
          <button className={'cbtn' + (tab === 'audio' ? ' on' : '')} onClick={() => setTab(t => (t === 'audio' ? null : 'audio'))} title="Ses parçası" aria-label="Ses parçası"><Icon d={I.audio} /></button>
          <button className={'cbtn' + (tab === 'video' ? ' on' : '') + (mode !== 'off' ? ' accent' : '')} onClick={() => setTab(t => (t === 'video' ? null : 'video'))} title="Anime4K (A)" aria-label="Görüntü ve Anime4K"><Icon d={I.sparkle} /></button>
          <button className={'cbtn' + (tab === 'info' ? ' on' : '')} onClick={() => setTab(t => (t === 'info' ? null : 'info'))} title="Bilgi" aria-label="Yayın bilgisi"><Icon d={I.info} /></button>
          {req.onNext && <button className="cbtn" onClick={() => { close(); req.onNext!() }} title="Sonraki bölüm" aria-label="Sonraki bölüm"><Icon d={I.next} /></button>}
          <button className="cbtn" onClick={fullscreen} aria-label="Tam ekran"><Icon d={I.full} /></button>
        </div>
      </div>
    </div>
  )
}

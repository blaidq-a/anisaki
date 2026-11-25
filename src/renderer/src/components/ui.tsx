// Small shared pieces: icons, window buttons, list editing (menu + dialog), trailer dialog, drag scrolling.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { LibraryEntry, PublicSettings } from '../../../shared/types'
import type { Anime } from '../lib/anilist'
import { useStore, type MenuItem } from '../store'

/* ------------------------------------ icons ------------------------------------ */
// Line icons, 24×24, stroke = currentColor.
export const P = {
  plus: 'M12 5v14M5 12h14',
  check: 'm5 12 5 5L20 7',
  play: 'M7 4.5v15l12.5-7.5z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  pause: 'M9 5v14M15 5v14',
  x: 'M6 6l12 12M18 6 6 18',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  open: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  film: 'M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4',
  star: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  left: 'm15 18-6-6 6-6',
  right: 'm9 18 6-6-6-6',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 7.5h.01',
  tv: 'M3 6h18v12H3zM8 21h8M12 18v3',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  shuffle: 'M3 7h4l10 10h4M3 17h4l3-3M14 10l3-3h4M18 4l3 3-3 3M18 14l3 3-3 3',
  order: 'M4 6h3M4 12h3M4 18h3M10 6h10M10 12h10M10 18h10',
  skip: 'M5 5v14l9-7zM16 5v14'
}
export function Ic({ d, size = 18, fill = false, sw = 2 }: { d: string; size?: number; fill?: boolean; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

/* -------------------------------- window buttons -------------------------------- */
export function WindowControls() {
  const [st, setSt] = useState({ maximized: false, fullscreen: false })
  useEffect(() => {
    window.api.winState().then(setSt)
    return window.api.onWinState(setSt)
  }, [])
  return (
    <div className="winctl">
      <button onClick={() => window.api.winMinimize()} aria-label="Simge durumuna küçült" title="Küçült">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" /></svg>
      </button>
      <button onClick={() => window.api.winMaximize()} aria-label={st.maximized || st.fullscreen ? 'Önceki boyut' : 'Ekranı kapla'} title={st.maximized ? 'Önceki boyut' : 'Büyüt'}>
        {st.maximized || st.fullscreen ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"><path d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z" /></svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"><path d="M.5.5h9v9h-9z" /></svg>
        )}
      </button>
      <button className="close" onClick={() => window.api.winClose()} aria-label="Kapat" title="Kapat">
        <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor"><path d="M0 0l10 10M10 0 0 10" /></svg>
      </button>
    </div>
  )
}

/* ---------------------------------- list status ---------------------------------- */
export const STATUS: { id: LibraryEntry['status']; label: string; icon: string }[] = [
  { id: 'watching', label: 'İzliyorum', icon: P.play },
  { id: 'plan', label: 'İzleyeceğim', icon: P.clock },
  { id: 'done', label: 'Bitirdim', icon: P.check },
  { id: 'hold', label: 'Ara verdim', icon: P.pause },
  { id: 'drop', label: 'Bıraktım', icon: P.x }
]

type ListAnime = Pick<Anime, 'id' | 'title' | 'cover' | 'episodes'>

export async function saveEntry(settings: PublicSettings, setSettings: (s: PublicSettings) => void, a: ListAnime, patch: Partial<LibraryEntry> | null) {
  const mine = settings.library[a.id] as LibraryEntry | undefined
  const lib =
    patch === null
      ? await window.api.setLibrary({ id: a.id, remove: true })
      : await window.api.setLibrary({ id: a.id, title: a.title, cover: a.cover, episodes: a.episodes, status: 'plan', progress: 0, score: null, ...mine, ...patch, updated: Date.now() })
  setSettings({ ...settings, library: lib })
}

/** Menu entries for putting an anime on the list (used by the + button and right click). */
export function useListItems() {
  const { settings, setSettings, toast } = useStore()
  return (a: ListAnime): MenuItem[] => {
    if (!settings) return []
    const mine = settings.library[a.id]
    const items: MenuItem[] = STATUS.map(s => ({
      label: s.label,
      icon: <Ic d={s.icon} size={15} />,
      checked: mine?.status === s.id,
      onClick: () =>
        saveEntry(settings, setSettings, a, { status: s.id, ...(s.id === 'done' && a.episodes ? { progress: a.episodes } : {}) }).then(
          () => toast(`${a.title} → ${s.label}`),
          e => toast(String(e.message ?? e))
        )
    }))
    if (mine) items.push({ sep: true, label: '' }, { label: 'Listeden çıkar', danger: true, icon: <Ic d={P.trash} size={15} />, onClick: () => saveEntry(settings, setSettings, a, null) })
    return items
  }
}

/** Seanime-style "+" button on a poster: opens the list menu right under it. */
export function AddToList({ a }: { a: ListAnime }) {
  const { menu, settings } = useStore()
  const items = useListItems()
  const on = !!settings?.library[a.id]
  return (
    <span
      className={'addlist' + (on ? ' on' : '')}
      role="button"
      tabIndex={0}
      aria-label="Listeye ekle"
      title={on ? 'Listede' : 'Listeye ekle'}
      onClick={e => {
        e.stopPropagation()
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        menu({ clientX: r.left, clientY: r.bottom + 6 }, items(a))
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      <Ic d={on ? P.check : P.plus} size={16} sw={2.4} />
    </span>
  )
}

/** Right-click menu of an anime card. */
export function useCardMenu() {
  const { go, menu } = useStore()
  const items = useListItems()
  return (e: React.MouseEvent, a: ListAnime, ep?: number, extra: MenuItem[] = []) =>
    menu(e, [
      { label: 'Anime sayfasını aç', icon: <Ic d={P.open} size={15} />, onClick: () => go({ name: 'anime', id: a.id }) },
      ...(ep ? [{ label: `${ep}. bölümü oynat`, icon: <Ic d={P.play} size={15} />, onClick: () => go({ name: 'anime', id: a.id, ep }) }] : []),
      ...extra,
      { sep: true, label: '' },
      ...items(a)
    ])
}

/* -------------------------------- list editor dialog -------------------------------- */
export function ListEditor({ a, onClose }: { a: ListAnime & { banner?: string | null }; onClose: () => void }) {
  const { settings, setSettings } = useStore()
  const mine = settings?.library[a.id]
  const [status, setStatus] = useState<LibraryEntry['status'] | ''>(mine?.status ?? '')
  const [progress, setProgress] = useState(mine?.progress ?? 0)
  const [score, setScore] = useState<number | null>(mine?.score ?? null)
  const max = a.episodes ?? 9999
  const save = async () => {
    if (!settings) return
    if (!status) await saveEntry(settings, setSettings, a, null)
    else await saveEntry(settings, setSettings, a, { status, progress, score })
    onClose()
  }
  return (
    <div className="dialog listedit" role="dialog" aria-label="Listeyi düzenle">
      <div className="dialog-head" style={a.banner ? { backgroundImage: `url(${a.banner})` } : undefined}>
        <img src={a.cover} alt="" />
        <div>
          <small>Listeyi düzenle</small>
          <strong>{a.title}</strong>
        </div>
        <button className="xbtn" onClick={onClose} aria-label="Kapat"><Ic d={P.x} /></button>
      </div>
      <div className="dialog-body">
        <div className="field2">
          <span>Durum</span>
          <div className="statuspick">
            {STATUS.map(s => (
              <button key={s.id} aria-pressed={status === s.id} onClick={() => setStatus(s.id)}>
                <Ic d={s.icon} size={15} />
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field2 two">
          <label>
            <span>İzlenen bölüm</span>
            <div className="stepper2">
              <button onClick={() => setProgress(p => Math.max(0, p - 1))} aria-label="Azalt">−</button>
              <input type="number" min={0} max={max} value={progress} onChange={e => setProgress(Math.max(0, Math.min(max, Number(e.target.value) || 0)))} />
              <span>/ {a.episodes ?? '?'}</span>
              <button onClick={() => setProgress(p => Math.min(max, p + 1))} aria-label="Artır">+</button>
            </div>
          </label>
          <label>
            <span>Puanım</span>
            <div className="scorepick">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                <button key={n} aria-pressed={score === n} onClick={() => setScore(s => (s === n ? null : n))}>{n}</button>
              ))}
            </div>
          </label>
        </div>
      </div>
      <div className="dialog-foot">
        {mine && <button className="btn danger" onClick={() => { setStatus(''); settings && saveEntry(settings, setSettings, a, null).then(onClose) }}>Listeden çıkar</button>}
        <span className="grow" />
        <button className="btn ghost" onClick={onClose}>Vazgeç</button>
        <button className="btn" onClick={save} disabled={!status && !mine}>Kaydet</button>
      </div>
    </div>
  )
}

/* ---------------------------------- trailer dialog ---------------------------------- */
/** Other trailers of the same show (Kitsu, MyAnimeList): often uploaded by another channel. */
async function otherTrailers(mal: number): Promise<string[]> {
  const get = (url: string) => fetch(url, { signal: AbortSignal.timeout(8000) }).then(r => (r.ok ? r.json() : null)).catch(() => null)
  const [kitsu, jikan] = await Promise.all([
    get(`https://kitsu.io/api/edge/mappings?filter[externalSite]=myanimelist/anime&filter[externalId]=${mal}&include=item`),
    get(`https://api.jikan.moe/v4/anime/${mal}`)
  ])
  return [kitsu?.included?.[0]?.attributes?.youtubeVideoId, jikan?.data?.trailer?.youtube_id].filter((x): x is string => !!x)
}

/**
 * Trailer in a YouTube embed. Uploaders often block their video in some countries ("not available in
 * your country"); then the next trailer of the show is tried, and if none plays, a YouTube search link.
 */
export function TrailerDialog({ id, mal, title, onClose }: { id: string; mal?: number | null; title: string; onClose: () => void }) {
  const [list, setList] = useState<string[]>([id])
  const [i, setI] = useState(0)
  const frame = useRef<HTMLIFrameElement>(null)
  // When it runs out of trailers before the others arrived, it waits for them before giving up.
  const [lookedUp, setLookedUp] = useState(!mal)
  useEffect(() => {
    if (!mal) return
    let live = true
    otherTrailers(mal)
      .then(more => live && setList(l => [...new Set([...l, ...more])]))
      .finally(() => live && setLookedUp(true))
    return () => {
      live = false
    }
  }, [mal])
  // The embed reports errors over postMessage once it is told someone listens (101 / 150: blocked here).
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!/youtube(-nocookie)?\.com$/.test(new URL(e.origin).hostname) || e.source !== frame.current?.contentWindow) return
      let d: any
      try {
        d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
      } catch {
        return
      }
      if (d?.event === 'onError') setI(x => x + 1)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])
  const listen = () => {
    const w = frame.current?.contentWindow
    const say = () => w?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*')
    say()
    setTimeout(say, 500)
  }
  const cur = list[i]
  return (
    <div className="dialog trailer" role="dialog" aria-label={title + ' fragmanı'}>
      <div className="trailer-head">
        <strong>{title} · Fragman</strong>
        <button className="xbtn" onClick={onClose} aria-label="Kapat"><Ic d={P.x} /></button>
      </div>
      <div className="trailer-frame">
        {cur ? (
          <iframe
            key={cur}
            ref={frame}
            onLoad={listen}
            src={`https://www.youtube-nocookie.com/embed/${cur}?autoplay=1&rel=0&modestbranding=1&enablejsapi=1`}
            title={title + ' fragmanı'}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <div className="trailer-none">
            {lookedUp ? (
              <>
                <p>Bu animenin fragmanları ülkende engelli.</p>
                <button className="btn" onClick={() => window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(title + ' trailer')}`)}>YouTube’da ara</button>
              </>
            ) : <p>Başka fragman aranıyor…</p>}
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------------------------------- drag scrolling ---------------------------------- */
/** Horizontal rows scroll by dragging with the mouse (and the wheel); a drag doesn't count as a click. */
export function DragRow({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let down = false
    let moved = 0
    let x0 = 0
    let s0 = 0
    let v = 0
    let last = 0
    let raf = 0
    const md = (e: MouseEvent) => {
      if (e.button !== 0) return
      down = true
      moved = 0
      x0 = e.clientX
      s0 = el.scrollLeft
      last = e.clientX
      v = 0
      cancelAnimationFrame(raf)
    }
    const mm = (e: MouseEvent) => {
      if (!down) return
      const dx = e.clientX - x0
      moved = Math.max(moved, Math.abs(dx))
      if (moved > 4) {
        el.classList.add('dragging')
        el.scrollLeft = s0 - dx
        v = e.clientX - last
        last = e.clientX
      }
    }
    const mu = () => {
      if (!down) return
      down = false
      el.classList.remove('dragging')
      // glide a little after letting go
      const glide = () => {
        if (Math.abs(v) < 0.5) return
        el.scrollLeft -= v
        v *= 0.92
        raf = requestAnimationFrame(glide)
      }
      if (moved > 4) glide()
    }
    const click = (e: MouseEvent) => {
      if (moved > 4) {
        e.preventDefault()
        e.stopPropagation()
        moved = 0
      }
    }
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth && e.shiftKey) {
        el.scrollLeft += e.deltaY
        e.preventDefault()
      }
    }
    const drag = (e: DragEvent) => e.preventDefault()
    el.addEventListener('mousedown', md)
    window.addEventListener('mousemove', mm)
    window.addEventListener('mouseup', mu)
    el.addEventListener('click', click, true)
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('dragstart', drag)
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('mousedown', md)
      window.removeEventListener('mousemove', mm)
      window.removeEventListener('mouseup', mu)
      el.removeEventListener('click', click, true)
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('dragstart', drag)
    }
  }, [])
  const scrollBy = (d: number) => ref.current?.scrollBy({ left: d * (ref.current.clientWidth * 0.8), behavior: 'smooth' })
  return (
    <div className="dragwrap">
      <button className="dragarrow l" onClick={() => scrollBy(-1)} aria-label="Sola kaydır"><Ic d={P.left} size={20} /></button>
      <div className={className + ' dragrow'} ref={ref}>{children}</div>
      <button className="dragarrow r" onClick={() => scrollBy(1)} aria-label="Sağa kaydır"><Ic d={P.right} size={20} /></button>
    </div>
  )
}

/**
 * The show's title logo (TheTVDB "clearlogo") with the title under it; the plain title when there is no
 * logo, or when the "logo" turns out to be a square picture with a background (TheTVDB has some).
 */
export function TitleLogo({ src, title, className }: { src: string | null | undefined; title: string; className: string }) {
  const [bad, setBad] = useState<string | null>(null)
  if (!src || bad === src) return <h1>{title}</h1>
  return (
    <>
      <img className={className} src={src} alt={title} title={title} onLoad={e => {
        const i = e.currentTarget
        if (i.naturalWidth / Math.max(1, i.naturalHeight) < 1.6) setBad(src)
      }} onError={() => setBad(src)} />
      <h1 className="sub-title">{title}</h1>
    </>
  )
}

/** A later season / part of a show: its own AniList banner beats the series-wide fanart (same for every season). */
export const laterSeason = (a: { title?: string | null; romaji?: string | null }, relations?: { relation?: string }[]) =>
  !!relations?.some(r => r.relation === 'PREQUEL') ||
  // "Season 2", "2nd Season", "Part 2", "S2", or a number / roman numeral at the end ("Edgerunners 2", "Overlord III")
  [a.title, a.romaji].some(t => /\b(season|part|cour)\s*\d|\b\d+(st|nd|rd|th)\s+season\b|\bs\d\b|\s(ii|iii|iv|v|[2-9])\s*$/i.test(t ?? ''))

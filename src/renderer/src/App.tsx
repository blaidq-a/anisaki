import { useEffect, useMemo, useRef, useState } from 'react'
import { StoreProvider, useStore, type Route } from './store'
import { Home } from './pages/Home'
import { Discover } from './pages/Discover'
import { AnimeDetail } from './pages/AnimeDetail'
import { Library } from './pages/Library'
import { Settings } from './pages/Settings'
import { Calendar } from './pages/Calendar'
import { Notifications } from './pages/Notifications'
import { Player } from './components/Player'
import { OverlayRoot } from './components/MpvPlayer'
import { Ic, P, WindowControls } from './components/ui'
import { aniCancelWaiting } from '../../shared/anilimit'
import type { PlayerLoading, ProfileInfo } from '../../shared/types'
import { checkUpdate, installUpdate, updatesOn, type Release } from './lib/update'
import { onLoginQr } from './desktop/login'
import qrcode from 'qrcode-generator'

const NAV: { route: Route; label: string; icon: string }[] = [
  { route: { name: 'home' }, label: 'Ana sayfa', icon: P.home },
  { route: { name: 'discover' }, label: 'Keşfet', icon: P.compass },
  { route: { name: 'calendar' }, label: 'Takvim', icon: P.calendar },
  { route: { name: 'library' }, label: 'Listem', icon: P.bookmark }
]

/** A profile's picture: its own, else the linked AniList / MyAnimeList account's profile picture. */
const pic = (p: ProfileInfo) => p.avatar ?? p.anilist?.avatar ?? p.mal?.avatar ?? null

function ProfileMenu() {
  const { settings, setSettings, go } = useStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [])
  if (!settings) return null
  const active = settings.profiles.find(p => p.id === settings.activeProfile) ?? settings.profiles[0]
  const avatar = (p: typeof active) => (pic(p) ? <img src={pic(p)!} alt="" /> : <span>{p.name[0]?.toUpperCase()}</span>)
  return (
    <div className="pmenu" ref={ref}>
      <button className="pmenu-btn" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label="Profil">
        <div className="pavatar sm">{avatar(active)}</div>
      </button>
      {open && (
        <div className="pmenu-pop">
          <div className="pmenu-head">
            <strong>{active.name}</strong>
            <small>{active.anilist ? `AniList: ${active.anilist.name}` : 'AniList bağlı değil'}</small>
          </div>
          {settings.profiles
            .filter(p => p.id !== active.id)
            .map(p => (
              <button key={p.id} className="pmenu-item" onClick={async () => { setSettings(await window.api.switchProfile(p.id)); setOpen(false) }}>
                <div className="pavatar xs">{avatar(p)}</div>
                {p.name}
              </button>
            ))}
          <button className="pmenu-item" onClick={() => { go({ name: 'settings' }); setOpen(false) }}>Profiller ve ayarlar</button>
        </div>
      )}
    </div>
  )
}

/** Unread AniList notifications, checked every few minutes. */
function Bell() {
  const { go, route, settings } = useStore()
  const [n, setN] = useState(0)
  const linked = !!settings?.profiles.find(p => p.id === settings.activeProfile)?.anilist
  useEffect(() => {
    if (!linked) return setN(0)
    const check = () => window.api.unreadNotifications().then(setN, () => {})
    check()
    const t = setInterval(check, 5 * 60_000)
    const read = () => setN(0)
    window.addEventListener('anisaki:notifsread', read)
    return () => (clearInterval(t), window.removeEventListener('anisaki:notifsread', read))
  }, [linked, settings?.activeProfile])
  return (
    <button className={'iconbtn bell' + (route.name === 'notifications' ? ' on' : '')} onClick={() => go({ name: 'notifications' })} aria-label="Bildirimler" title="Bildirimler">
      <Ic d={P.bell} />
      {n > 0 && <span className="badge">{n > 99 ? '99+' : n}</span>}
    </button>
  )
}

/** A profile with no AniList account keeps its list only on this computer: say so once (can be silenced). */
function AccountWarning() {
  const { settings, setSettings, go } = useStore()
  const [hidden, setHidden] = useState(false)
  if (!settings || hidden || settings.noAccountWarn) return null
  const p = settings.profiles.find(x => x.id === settings.activeProfile)
  if (!p || p.anilist || p.mal) return null
  return (
    <div className="acct-warn" role="status">
      <Ic d={P.info} size={18} />
      <span>Bu profile AniList ya da MyAnimeList hesabı bağlı değil. İzleme ilerlemen yalnızca bu cihazda tutuluyor, uygulama silinirse kaybolabilir.</span>
      <button className="btn sm" onClick={() => go({ name: 'settings', tab: 'general' })}>Hesap bağla</button>
      <button className="btn ghost sm" onClick={() => setHidden(true)}>Kapat</button>
      <button className="btn ghost sm" onClick={async () => setSettings(await window.api.setSettings({ noAccountWarn: true }))}>Bir daha uyarma</button>
    </div>
  )
}

// Search history: kept by the app (the browser's own autofill list is off), newest first
const HKEY = 'anisaki:searchHistory'
const readHistory = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(HKEY) ?? '[]')
  } catch {
    return []
  }
}
const writeHistory = (h: string[]) => {
  try {
    localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 8)))
  } catch {}
}

function Shell() {
  const { route, go, back, forward, canBack, play, settings } = useStore()
  const [q, setQ] = useState('')
  const [history, setHistory] = useState<string[]>(readHistory)
  const [histOpen, setHistOpen] = useState(false)
  const remember = (v: string) => {
    const t = v.trim()
    if (t.length < 2) return
    const h = [t, ...history.filter(x => x.toLowerCase() !== t.toLowerCase())].slice(0, 8)
    setHistory(h)
    writeHistory(h)
  }
  const forget = (v: string | null) => {
    const h = v == null ? [] : history.filter(x => x !== v)
    setHistory(h)
    writeHistory(h)
  }
  // The top bar is see-through over the home banner and turns solid once the page scrolls.
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => setScrolled(false), [route])
  const timer = useRef<number>(0)

  // Typing here drives Keşfet's search: the first pause opens Keşfet, after that the open page just
  // follows the text (it used to reopen Keşfet and take the cursor away mid-word).
  const search = (v: string, now = false) => {
    setQ(v)
    clearTimeout(timer.current)
    if (route.name === 'discover') return void window.dispatchEvent(new CustomEvent('anisaki:search', { detail: v.trim() }))
    const run = () => {
      if (v.trim().length >= 2) go({ name: 'discover', f: { search: v.trim() } })
    }
    if (now) run()
    else timer.current = window.setTimeout(run, 500)
  }

  // Ctrl+K (or /) jumps to the search box from anywhere.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select')
      if ((e.ctrlKey && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
        e.preventDefault()
        document.getElementById('search')?.focus()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // Keşfet's own search box writes back here, so both boxes always show the same text.
  useEffect(() => {
    const h = (e: Event) => setQ((e as CustomEvent<string>).detail)
    window.addEventListener('anisaki:dsearch', h)
    return () => window.removeEventListener('anisaki:dsearch', h)
  }, [])

  // Clear the box; leave the search results page if that's where we are.
  const clearSearch = () => {
    clearTimeout(timer.current)
    setQ('')
    if (route.name === 'discover') window.dispatchEvent(new CustomEvent('anisaki:search', { detail: '' }))
  }

  let page
  switch (route.name) {
    case 'home': page = <Home />; break
    case 'discover': page = <Discover key={JSON.stringify(route.f ?? {})} initial={route.f ?? {}} />; break
    case 'anime': page = <AnimeDetail key={route.id + ':' + (route.ep ?? '')} id={route.id} autoEp={route.ep} rnd={route.rnd} />; break
    case 'calendar': page = <Calendar />; break
    case 'notifications': page = <Notifications />; break
    case 'library': page = <Library />; break
    case 'settings': page = <Settings key={route.tab ?? ''} tab={route.tab} />; break
  }
  const libCount = settings ? Object.keys(settings.library).length : 0
  // the page shown, for the phone / TV Back key (mobile/src/api.ts) and the remote's starting point
  useEffect(() => void (document.body.dataset.route = route.name), [route.name])

  return (
    <div className={'shell' + (route.name === 'home' || route.name === 'anime' ? ' over' : '') + (scrolled ? ' scrolled' : '')}>
      <header className="topbar">
        <div className="navarrows">
          <button className="iconbtn" onClick={back} disabled={!canBack} aria-label="Geri" title="Geri (fare geri tuşu)"><Ic d={P.left} /></button>
          <button className="iconbtn" onClick={forward} aria-label="İleri" title="İleri"><Ic d={P.right} /></button>
        </div>
        <button className="logo" onClick={() => go({ name: 'home' })}>
          <span className="seal" lang="ja" aria-hidden="true">咲</span>
          <span>Anisaki</span>
        </button>
        <nav className="topnav">
          {NAV.map(n => (
            <button key={n.label} aria-current={route.name === n.route.name} onClick={() => go(n.route)}>
              <Ic d={n.icon} size={16} />
              {n.label}
              {n.route.name === 'library' && libCount > 0 && <span className="count">{libCount}</span>}
            </button>
          ))}
        </nav>
        <div className="drag-space" />
        <div className="searchbox">
          <Ic d={P.search} size={16} />
          <input
            id="search"
            autoComplete="off"
            spellCheck={false}
            value={q}
            onChange={e => search(e.target.value)}
            onFocus={() => setHistOpen(true)}
            // a search is remembered when it is finished: Enter, or leaving the box (not every pause while typing)
            onBlur={() => (remember(q), setTimeout(() => setHistOpen(false), 150))}
            onKeyDown={e => (e.key === 'Enter' ? (search(q, true), remember(q), setHistOpen(false)) : e.key === 'Escape' && (q ? (e.preventDefault(), clearSearch()) : setHistOpen(false)))}
            placeholder="Anime ara…"
          />
          {histOpen && !q && history.length > 0 && (
            <div className="shist" onMouseDown={e => e.preventDefault()}>
              <div className="shist-head">
                <span>Son aramalar</span>
                <button onClick={() => forget(null)}>Tümünü temizle</button>
              </div>
              {history.map(h => (
                <div key={h} className="shist-row">
                  <button className="shist-item" onClick={() => { search(h, true); remember(h); setHistOpen(false) }}>
                    <Ic d={P.clock} size={14} /> <span>{h}</span>
                  </button>
                  <button className="shist-x" onClick={() => forget(h)} aria-label={h + ' aramasını sil'} title="Sil"><Ic d={P.x} size={13} /></button>
                </div>
              ))}
            </div>
          )}
          {!q && <kbd className="kbd">Ctrl K</kbd>}
          {q && (
            <button className="search-clear" onClick={clearSearch} aria-label="Aramayı temizle" title="Temizle (Esc)">
              <Ic d={P.x} size={14} sw={2.4} />
            </button>
          )}
        </div>
        <button className={'iconbtn' + (route.name === 'settings' ? ' on' : '')} onClick={() => go({ name: 'settings' })} aria-label="Ayarlar" title="Ayarlar">
          <Ic d={P.gear} />
        </button>
        <Bell />
        <ProfileMenu />
        <WindowControls />
      </header>
      <main className="content" onScroll={e => setScrolled(e.currentTarget.scrollTop > 40)}>
        {route.name === 'home' && <AccountWarning />}
        {page}
      </main>
      {play && <Player req={play} />}
    </div>
  )
}

export function App() {
  // The transparent overlay window (controls over embedded mpv) loads this same bundle with #overlay.
  if (location.hash === '#overlay') return <OverlayRoot />
  return <MainApp />
}

/** AniList asked to slow down (or is unreachable): a countdown, then everything that waited carries on by itself. */
function AniListWait() {
  const [w, setW] = useState<{ until: number; why: string } | null>(null)
  const [, tick] = useState(0)
  useEffect(() => {
    const h = (e: Event) => setW((e as CustomEvent<{ until: number; why: string }>).detail)
    window.addEventListener('anisaki:ratelimit', h)
    return () => window.removeEventListener('anisaki:ratelimit', h)
  }, [])
  useEffect(() => {
    if (!w) return
    const t = setInterval(() => (Date.now() >= w.until ? setW(null) : tick(x => x + 1)), 250)
    return () => clearInterval(t)
  }, [w])
  if (!w) return null
  const s = Math.max(0, Math.ceil((w.until - Date.now()) / 1000))
  return (
    <div className="alwait" role="status">
      <div className="spinner sm" />
      <span>{w.why === 'limit' ? 'AniList çok sık istek aldı, kısa bir ara istiyor.' : 'AniList’e şu an ulaşılamıyor.'} <b>{s} sn</b> sonra kendiliğinden tekrar denenecek.</span>
      <button className="btn ghost sm" onClick={() => (aniCancelWaiting(), setW(null))} title="Bekleyen yüklemeleri bırak">İptal</button>
    </div>
  )
}

/** "Yeni sürüm var": install now (PC: the installer runs and the app closes; Android: its installer opens) or later */
function UpdatePrompt({ rel, onClose }: { rel: Release; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose()
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [busy])
  const go = async () => {
    setBusy('Yeni sürüm indiriliyor…')
    try {
      await installUpdate(rel)
      setBusy('Kurulum başladı.')
    } catch (e: any) {
      setBusy(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setTimeout(() => setBusy(null), 4000)
    }
  }
  return (
    <div className="modal-back updateask" onClick={() => !busy && onClose()}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <h2>Yeni sürüm var: Anisaki {rel.version}</h2>
        {rel.notes && <p className="muted">{rel.notes}</p>}
        {busy ? <p>{busy}</p> : (
          <div className="row">
            <button className="btn primary" data-tv-start onClick={go}>Şimdi güncelle</button>
            <button className="btn ghost" onClick={onClose}>Sonra</button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * TV sign-in: a QR code for the phone (the TV has no browser to sign in with). The phone opens AniList's /
 * MyAnimeList's page and the sign-in comes back to this TV over the home network. Back / Vazgeç cancels.
 */
function LoginQr() {
  const [q, setQ] = useState<{ url: string; service: string } | null>(null)
  useEffect(() => onLoginQr(setQ), [])
  // Back on the remote (sent as Escape) cancels the sign-in
  useEffect(() => {
    if (!q) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && void window.api.aniListCancel()
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [q])
  const cells = useMemo(() => {
    if (!q) return null
    const c = qrcode(0, 'M')
    c.addData(q.url)
    c.make()
    const n = c.getModuleCount()
    let d = ''
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (c.isDark(y, x)) d += `M${x},${y}h1v1h-1z`
    return { n, d }
  }, [q])
  if (!q || !cells) return null
  return (
    <div className="modal-back loginqr" onClick={() => void window.api.aniListCancel()}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <h2>{q.service} ile bağla</h2>
        <svg viewBox={`-2 -2 ${cells.n + 4} ${cells.n + 4}`} width="300" height="300" shapeRendering="crispEdges" role="img" aria-label="Giriş QR kodu">
          <rect x="-2" y="-2" width={cells.n + 4} height={cells.n + 4} fill="#fff" />
          <path d={cells.d} fill="#000" />
        </svg>
        <p>Telefonunun kamerasıyla okut, {q.service} hesabınla giriş yap. Giriş bitince bu TV kendiliğinden bağlanır.</p>
        <p className="muted">Telefon bu TV ile aynı Wi-Fi ağında olmalı.</p>
        <button className="btn" data-tv-start onClick={() => void window.api.aniListCancel()}>Vazgeç</button>
      </div>
    </div>
  )
}

/** Black under the full-size player (the controls are their own window and can trail a fast drag). */
function PlayerCover() {
  const [on, setOn] = useState(false)
  const [l, setL] = useState<PlayerLoading | null>(null)
  useEffect(() => window.api.onPlayerCover(setOn), [])
  useEffect(() => window.api.onLoadingInfo?.(setL) ?? undefined, [])
  // While the source is found the cover shows the opening screen too: the player's controls window (which
  // draws it) is hidden while the app is dragged, and the window showed plain black meanwhile.
  return on ? (
    <div className="pcover">
      {l && (
        <>
          {l.backdrop && <div className="opening-bg" style={{ backgroundImage: `url(${l.backdrop})` }} />}
          <div className="opening-shade" />
          <div className="opening-mid">
            <h1>{l.title}</h1>
            {l.subtitle && <p>{l.subtitle}</p>}
            <div className="opening-status"><div className="spinner sm" /></div>
          </div>
        </>
      )}
    </div>
  ) : null
}

/**
 * "Kim izliyor?": with more than one profile the app opens on a profile picker (like a streaming app),
 * unless Ayarlar → Profiller names a profile to open with. Once per start of the app.
 */
let profileAsked = false
function ProfileGate() {
  const { settings, setSettings } = useStore()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  // the remote (and the keyboard) start on the profile used last
  useEffect(() => {
    if (!open) return
    // tried a few times: right after the app starts the page itself may not have the focus yet (TV)
    const ts = [50, 400, 1200, 2500].map(ms => setTimeout(() => {
      if (box.current?.contains(document.activeElement)) return
      ;(box.current?.querySelector<HTMLElement>('[data-last]') ?? box.current?.querySelector<HTMLElement>('button'))?.focus()
    }, ms))
    return () => ts.forEach(clearTimeout)
  }, [open])
  useEffect(() => {
    if (!settings || profileAsked) return
    profileAsked = true
    if (settings.profiles.length < 2) return
    const start = settings.profiles.find(p => p.id === settings.startProfile)
    if (!start) return setOpen(true)
    if (start.id !== settings.activeProfile) window.api.switchProfile(start.id).then(setSettings)
  }, [settings])
  if (!open || !settings) return null
  const pick = async (id: string) => {
    if (id !== settings.activeProfile) setSettings(await window.api.switchProfile(id))
    setOpen(false)
  }
  return (
    <div className="whopick" role="dialog" aria-label="Profil seç" ref={box}>
      <h1>Kim izliyor?</h1>
      <div className="whopick-row">
        {settings.profiles.map(p => (
          <button key={p.id} className="whopick-p" onClick={() => pick(p.id)} data-last={p.id === settings.activeProfile || undefined}>
            <div className="pavatar">{pic(p) ? <img src={pic(p)!} alt="" /> : <span>{p.name[0]?.toUpperCase()}</span>}</div>
            <span>{p.name}</span>
          </button>
        ))}
      </div>
      <small>Her açılışta sormasın istersen: Ayarlar → Profiller ve hesaplar → “Uygulama açılınca”</small>
    </div>
  )
}

function MainApp() {
  const [toast, setToast] = useState<string | null>(null)
  const t = useRef<number>(0)
  const show = (m: string) => {
    setToast(m)
    clearTimeout(t.current)
    t.current = window.setTimeout(() => setToast(null), 3000)
  }
  useEffect(() => window.api.onToast(show), [])
  // a new version: asked once at start, in a window with "Şimdi güncelle" (also in Ayarlar → Sürüm ve güncellemeler)
  const [release, setRelease] = useState<Release | null>(null)
  useEffect(() => {
    if (!updatesOn()) return
    const t = setTimeout(() => checkUpdate().then(r => r && setRelease(r), () => {}), 8000)
    return () => clearTimeout(t)
  }, [])
  // AniList rate limit: requests wait instead of failing; say why things pause
  return (
    <StoreProvider onToast={show}>
      <Shell />
      <ProfileGate />
      <AniListWait />
      <PlayerCover />
      <LoginQr />
      {release && <UpdatePrompt rel={release} onClose={() => setRelease(null)} />}
      {toast && <div className="toast">{toast}</div>}
    </StoreProvider>
  )
}

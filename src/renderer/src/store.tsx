import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { PublicSettings } from '../../shared/types'
import type { DiscoverFilters } from './lib/anilist'

export type SettingsTab = 'general' | 'appearance' | 'player' | 'languages' | 'sources' | 'addons' | 'local'
export type Route =
  | { name: 'home' }
  | { name: 'discover'; f?: DiscoverFilters }
  | { name: 'anime'; id: number; ep?: number; /** opened by Keşfet's "random": next random with these filters */ rnd?: DiscoverFilters }
  | { name: 'calendar' }
  | { name: 'notifications' }
  | { name: 'library' }
  | { name: 'settings'; tab?: SettingsTab }

export interface PlayRequest {
  src: string
  title: string
  subtitle?: string
  animeId?: number
  malId?: number | null
  episode?: number
  episodes?: number | null
  cover?: string
  onNext?: () => void
  onPrev?: () => void
  /** Play episode n (the player's episode list) */
  onGoto?: (n: number) => void
  /** Episode titles / pictures for the player's episode list */
  episodeList?: { number: number; title: string | null; image: string | null; filler?: boolean }[]
  /** Show this episode's source list (phone player's "Kaynaklar") */
  onPick?: () => void
  /** Open another source for this episode (the current one is wrong or broken) */
  onRetry?: () => void
  /** Expected episode length in seconds, to spot a wrong file */
  expectedDuration?: number | null
  /** Stremio ids for asking subtitle addons */
  subIds?: { type: string; ids: string[] }
  /** Where the stream came from, shown in the info panel */
  source?: { addon: string; label: string; size?: string | null }
  /** Shown in the player once it starts (e.g. "2 filler bölüm atlandı") */
  notice?: string
  /** Character names the subtitle translation keeps */
  names?: string[]
  year?: number | null
  total?: number | null
  later?: boolean
  /** How the link was made, to get a fresh one if playback stalls */
  resolve?: import('../../shared/types').ResolveRequest
  searchTitles?: string[]
}

export interface MenuItem {
  label: string
  icon?: ReactNode
  onClick?: () => void
  checked?: boolean
  danger?: boolean
  sep?: boolean
}

interface Store {
  settings: PublicSettings | null
  setSettings: (s: PublicSettings) => void
  refresh: () => Promise<void>
  route: Route
  go: (r: Route) => void
  back: () => void
  forward: () => void
  canBack: boolean
  play: PlayRequest | null
  setPlay: (p: PlayRequest | null) => void
  /** True while the player is open in the overlay (main window stays underneath) */
  playerOpen: boolean
  toast: (msg: string) => void
  /** Context menu at the mouse position */
  menu: (e: { clientX: number; clientY: number; preventDefault?: () => void }, items: MenuItem[]) => void
  /** A dialog over the page (list editor, trailer…); null closes it */
  modal: (node: ReactNode | null) => void
}

const Ctx = createContext<Store>(null!)
export const useStore = () => useContext(Ctx)

export function StoreProvider({ children, onToast }: { children: ReactNode; onToast: (m: string) => void }) {
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [stack, setStack] = useState<{ list: Route[]; i: number }>({ list: [{ name: 'home' }], i: 0 })
  const [play, setBuiltinPlay] = useState<PlayRequest | null>(null)
  const [playerOpen, setPlayerOpen] = useState(false)
  const [menuState, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [modalNode, setModal] = useState<ReactNode | null>(null)
  const nextRef = useRef<(() => void) | undefined>(undefined)
  const prevRef = useRef<(() => void) | undefined>(undefined)
  const retryRef = useRef<(() => void) | undefined>(undefined)
  const pickRef = useRef<(() => void) | undefined>(undefined)
  const gotoRef = useRef<((n: number) => void) | undefined>(undefined)

  const refresh = useCallback(async () => setSettings(await window.api.getSettings()), [])
  // Accent color theme (Ayarlar → Görünüm)
  useEffect(() => {
    if (settings?.theme) document.documentElement.dataset.theme = settings.theme
  }, [settings?.theme])

  const go = useCallback((r: Route) => {
    setStack(s => ({ list: [...s.list.slice(0, s.i + 1), r], i: s.i + 1 }))
    document.querySelector('.content')?.scrollTo(0, 0)
  }, [])
  const back = useCallback(() => setStack(s => (s.i > 0 ? { ...s, i: s.i - 1 } : s)), [])
  const forward = useCallback(() => setStack(s => (s.i < s.list.length - 1 ? { ...s, i: s.i + 1 } : s)), [])

  useEffect(() => {
    refresh()
    const offs = [
      window.api.onSettingsChanged(() => refresh()),
      window.api.onPlayerClosed(() => {
        setPlayerOpen(false)
        refresh()
      }),
      window.api.onPlayerNext(() => nextRef.current?.()),
      window.api.onPlayerEpisode(d => (d < 0 ? prevRef.current : nextRef.current)?.()),
      window.api.onPlayerGoto(n => gotoRef.current?.(n)),
      window.api.onPlayerRetry(() => retryRef.current?.()),
      window.api.onPlayerSources(() => pickRef.current?.()),
      window.api.onNav(d => (d === 'back' ? back() : d === 'home' ? go({ name: 'home' }) : forward()))
    ]
    // Mouse back / forward buttons
    const mouse = (e: MouseEvent) => {
      if (e.button === 3) (e.preventDefault(), back())
      else if (e.button === 4) (e.preventDefault(), forward())
    }
    window.addEventListener('mouseup', mouse)
    return () => {
      offs.forEach(f => f())
      window.removeEventListener('mouseup', mouse)
    }
  }, [refresh, back, forward])

  /** Embedded mpv opens in the overlay window; the browser player renders here. */
  const setPlay = useCallback(
    (p: PlayRequest | null) => {
      if (!p || settings?.engine === 'builtin') return setBuiltinPlay(p)
      nextRef.current = p.onNext
      prevRef.current = p.onPrev
      retryRef.current = p.onRetry
      pickRef.current = p.onPick
      gotoRef.current = p.onGoto
      const { onNext, onPrev, onRetry, onPick, onGoto, ...payload } = p
      setPlayerOpen(true)
      window.api.playerOpen({ ...payload, hasNext: !!onNext, hasPrev: !!onPrev, canRetry: !!onRetry }).catch((e: any) => {
        setPlayerOpen(false)
        onToast(String(e.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      })
    },
    [settings?.engine, onToast]
  )

  const menu = useCallback<Store['menu']>((e, items) => {
    e.preventDefault?.()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }, [])

  useEffect(() => {
    if (!menuState) return
    const close = () => setMenu(null)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('mousedown', close)
    // (not on a TV: holding the remote's OK, which opens it, also takes the window's focus for a moment)
    const blur = () => !document.documentElement.classList.contains('tv') && close()
    window.addEventListener('blur', blur)
    window.addEventListener('keydown', key)
    document.querySelector('.content')?.addEventListener('scroll', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', blur)
      window.removeEventListener('keydown', key)
      document.querySelector('.content')?.removeEventListener('scroll', close)
    }
  }, [menuState])

  useEffect(() => {
    if (!modalNode) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setModal(null)
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [modalNode])

  return (
    <Ctx.Provider
      value={{
        settings, setSettings, refresh, route: stack.list[stack.i], go, back, forward, canBack: stack.i > 0,
        play, setPlay, playerOpen, toast: onToast, menu, modal: setModal
      }}
    >
      {children}
      {menuState && <ContextMenu {...menuState} onClose={() => setMenu(null)} />}
      {modalNode && (
        <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && setModal(null)}>
          {modalNode}
        </div>
      )}
    </Ctx.Provider>
  )
}

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  useEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) })
  }, [x, y])
  return (
    <div className="ctxmenu" ref={ref} style={{ left: pos.x, top: pos.y }} onMouseDown={e => e.stopPropagation()} role="menu">
      {items.map((it, i) =>
        it.sep ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={(it.danger ? 'danger' : '') + (it.checked ? ' checked' : '')}
            onClick={() => {
              onClose()
              it.onClick?.()
            }}
          >
            <span className="ctx-ico">{it.icon}</span>
            {it.label}
          </button>
        )
      )}
    </div>
  )
}

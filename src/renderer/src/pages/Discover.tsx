import { useEffect, useRef, useState } from 'react'
import { discover, randomAnime, FORMAT_TR, GENRE_TR, GENRES, SEASON_TR, SORT_TR, STATUS_TR, type Anime, type DiscoverFilters } from '../lib/anilist'
import { AnimeCard, Skeletons } from '../components/AnimeCard'
import { Ic, P } from '../components/ui'
import { useStore } from '../store'

const YEARS = Array.from({ length: new Date().getFullYear() + 2 - 1970 }, (_, i) => new Date().getFullYear() + 1 - i)

/** Keşfet: AniList search with filters on the left, results in a grid that loads more as you scroll. */
export function Discover({ initial }: { initial: DiscoverFilters }) {
  const [f, setF] = useState<DiscoverFilters>(initial)
  const [items, setItems] = useState<Anime[] | null>(null)
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [genresOpen, setGenresOpen] = useState(false)
  const sentinel = useRef<HTMLDivElement>(null)
  const gen = useRef(0)

  const set = (patch: Partial<DiscoverFilters>) => setF(x => ({ ...x, ...patch }))
  const { go, toast } = useStore()
  const [rolling, setRolling] = useState(false)
  const roll = useRef(0)
  // A random anime with the current filters; its page gets "previous / next random" buttons
  const random = async () => {
    // a second click while it is choosing cancels it
    const mine = ++roll.current
    if (rolling) return setRolling(false)
    setRolling(true)
    try {
      const { search: _s, ...rest } = f
      const a = await randomAnime(rest)
      if (mine !== roll.current) return
      if (a) go({ name: 'anime', id: a.id, rnd: rest })
      else toast('Bu filtrelerle anime bulunamadı.')
    } catch (e: any) {
      if (mine === roll.current) toast(String(e.message ?? e))
    } finally {
      if (mine === roll.current) setRolling(false)
    }
  }

  // The search box in the top bar and this one are the same search.
  useEffect(() => {
    const h = (e: Event) => set({ search: (e as CustomEvent<string>).detail || undefined })
    window.addEventListener('anisaki:search', h)
    return () => window.removeEventListener('anisaki:search', h)
  }, [])
  const setSearch = (v: string) => {
    set({ search: v || undefined })
    window.dispatchEvent(new CustomEvent('anisaki:dsearch', { detail: v }))
  }

  useEffect(() => {
    const g = ++gen.current
    setItems(null)
    setErr(null)
    setPage(1)
    const t = setTimeout(
      () =>
        discover(f, 1).then(
          r => {
            if (g !== gen.current) return
            setItems(r.items)
            setHasNext(r.hasNext)
          },
          e => g === gen.current && setErr(e.message)
        ),
      f.search !== initial.search ? 350 : 0
    )
    return () => clearTimeout(t)
  }, [JSON.stringify(f)])

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(es => {
      if (!es[0].isIntersecting || !hasNext || loadingMore || !items) return
      const g = gen.current
      setLoadingMore(true)
      discover(f, page + 1)
        .then(r => {
          if (g !== gen.current) return
          setItems(x => [...(x ?? []), ...r.items.filter(a => !x?.some(b => b.id === a.id))])
          setHasNext(r.hasNext)
          setPage(p => p + 1)
        })
        .finally(() => setLoadingMore(false))
    }, { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [items, hasNext, loadingMore, page])

  const active = Object.entries(f).filter(([k, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length) && k !== 'sort').length

  return (
    <div className="discover">
      <aside className="filters">
        <div className="searchbox big">
          <Ic d={P.search} size={16} />
          <input id="dsearch" autoComplete="off" spellCheck={false} value={f.search ?? ''} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Escape' && f.search && (e.preventDefault(), setSearch(''))} placeholder="Başlık" />
          {f.search && (
            <button className="search-clear" onClick={() => setSearch('')} aria-label="Aramayı temizle" title="Temizle (Esc)">
              <Ic d={P.x} size={14} />
            </button>
          )}
        </div>
        <button className="btn random" onClick={random}>
          <Ic d={rolling ? P.x : P.shuffle} size={16} /> {rolling ? 'Seçiliyor… (iptal)' : 'Rastgele anime'}
        </button>
        {f.studio && (
          <div className="fchip">
            <span>Stüdyo: <b>{f.studio.name}</b></span>
            <button onClick={() => set({ studio: undefined })} aria-label="Stüdyo filtresini kaldır"><Ic d={P.x} size={14} /></button>
          </div>
        )}
        <label className="fsel">
          <span>Sıralama</span>
          <select value={f.sort ?? (f.search ? '' : 'POPULARITY_DESC')} onChange={e => set({ sort: e.target.value || undefined })}>
            {f.search && <option value="">En uygun</option>}
            {Object.entries(SORT_TR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <div className="fsel">
          <span>Türler {f.genres?.length ? `· ${f.genres.length}` : ''}</span>
          <button className="fsel-btn" onClick={() => setGenresOpen(o => !o)} aria-expanded={genresOpen}>
            {f.genres?.length ? f.genres.map(g => GENRE_TR[g] ?? g).join(', ') : 'Tüm türler'}
          </button>
          {genresOpen && (
            <div className="genregrid">
              {GENRES.map(g => (
                <button key={g} aria-pressed={!!f.genres?.includes(g)} onClick={() => set({ genres: f.genres?.includes(g) ? f.genres.filter(x => x !== g) : [...(f.genres ?? []), g] })}>
                  {GENRE_TR[g] ?? g}
                </button>
              ))}
            </div>
          )}
        </div>
        <label className="fsel">
          <span>Tür (format)</span>
          <select value={f.format ?? ''} onChange={e => set({ format: e.target.value || undefined })}>
            <option value="">Tüm formatlar</option>
            {Object.entries(FORMAT_TR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="fsel">
          <span>Sezon</span>
          <select value={f.season ?? ''} onChange={e => set({ season: e.target.value || undefined })}>
            <option value="">Tüm sezonlar</option>
            {Object.entries(SEASON_TR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="fsel">
          <span>Yıl</span>
          <select value={f.year ?? ''} onChange={e => set({ year: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">Tüm yıllar</option>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="fsel">
          <span>Durum</span>
          <select value={f.status ?? ''} onChange={e => set({ status: e.target.value || undefined })}>
            <option value="">Tüm durumlar</option>
            {Object.entries(STATUS_TR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="fsel">
          <span>En az puan</span>
          <select value={f.minScore ?? ''} onChange={e => set({ minScore: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">Tüm puanlar</option>
            {[9, 8, 7, 6, 5].map(n => <option key={n} value={n}>★ {n}+</option>)}
          </select>
        </label>
        {active > 0 && (
          <button className="btn ghost sm" onClick={() => setF({})}>
            <Ic d={P.trash} size={14} /> Filtreleri temizle
          </button>
        )}
      </aside>

      <section className="results">
        <h1>{title(f)}</h1>
        {err && <div className="state">{err}</div>}
        {items?.length === 0 && <div className="state">Bu filtrelerle sonuç yok. Bir filtreyi kaldırmayı ya da romaji adıyla aramayı dene.</div>}
        <div className="grid">{items ? items.map(a => <AnimeCard key={a.id} a={a} />) : !err && <Skeletons n={18} />}</div>
        <div ref={sentinel} className="sentinel">{loadingMore && <div className="spinner sm" />}</div>
      </section>
    </div>
  )
}

function title(f: DiscoverFilters) {
  if (f.search) return `“${f.search}”`
  if (f.studio) return f.studio.name
  if (f.genres?.length === 1) return GENRE_TR[f.genres[0]] ?? f.genres[0]
  if (f.season && f.year) return `${SEASON_TR[f.season]} ${f.year}`
  if (f.status === 'NOT_YET_RELEASED') return 'Yakında'
  if (f.sort === 'SCORE_DESC') return 'En yüksek puanlılar'
  return 'Keşfet'
}

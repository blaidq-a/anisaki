import { useEffect, useMemo, useState } from 'react'
import { animeByIds, browse, getMappings, currentSeason, FORMAT_TR, GENRE_TR, latestEpisodes, SEASON_TR, timeAgo, type AiredEpisode, type Anime } from '../lib/anilist'
import { AnimeCard, Skeletons } from '../components/AnimeCard'
import { AddToList, DragRow, Ic, P, TitleLogo, laterSeason, useCardMenu } from '../components/ui'
import { useStore } from '../store'
import { hideFromContinue, useHidden } from '../lib/hidden'

function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): [T | null, string | null] {
  const [v, setV] = useState<T | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    fn().then(r => live && setV(r), e => live && setErr(e.message))
    return () => {
      live = false
    }
  }, deps)
  return [v, err]
}

/* ------------------------------------ hero ------------------------------------ */
/** Full-width banner under the (see-through) top bar: title, info pills, Play + list + details. */
function Hero({ items }: { items: Anime[] }) {
  const { go } = useStore()
  const [i, setI] = useState(0)
  // Held still while a button in it has the focus (TV remote): turning to the next show would take the
  // focused button away under the viewer's cursor.
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (items.length < 2 || held) return
    const t = setInterval(() => setI(x => (x + 1) % items.length), 9000)
    return () => clearInterval(t)
  }, [items.length, i, held])
  // Full-HD background art and the show's logo (ani.zip / TheTVDB); AniList's banner is small and blurry
  // when stretched over the whole window.
  const [art, setArt] = useState<Record<number, { fanart: string | null; logo: string | null }>>({})
  useEffect(() => {
    items.forEach(x => getMappings(x.id).then(m => setArt(o => ({ ...o, [x.id]: { fanart: m.fanart, logo: m.logo } })), () => {}))
  }, [items.map(x => x.id).join(',')])
  if (!items.length) return <div className="hero3 skeleton" />
  const a = items[i]
  const eps = a.episodes ?? (a.nextEpisode ? a.nextEpisode - 1 : null)
  const logo = art[a.id]?.logo
  // Swipe sideways on a touch screen (the phone has no arrows)
  const swipe = { x: 0 }
  return (
    <section
      className="hero3"
      onFocus={() => setHeld(true)}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false) }}
      onTouchStart={e => (swipe.x = e.touches[0].clientX)}
      onTouchEnd={e => {
        const d = e.changedTouches[0].clientX - swipe.x
        if (Math.abs(d) > 60) setI(x => (x + (d < 0 ? 1 : -1) + items.length) % items.length)
      }}
    >
      {items.map((x, k) => (
        <div key={x.id} className={'hero3-bg' + (k === i ? ' on' : '')} style={{ backgroundImage: `url(${laterSeason(x) ? x.banner ?? x.cover : art[x.id]?.fanart ?? x.banner ?? x.cover})` }} />
      ))}
      <div className="hero3-shade" />
      <div className="hero3-body" key={a.id}>
        <TitleLogo src={laterSeason(a) ? null : logo} title={a.title} className="hero3-logo" />
        <div className="pills">
          {a.score != null && <span className="pill"><Ic d={P.star} size={13} fill /> {a.score.toFixed(1)}</span>}
          {a.year && <span className="pill"><Ic d={P.clock} size={13} /> {a.year}</span>}
          {eps ? <span className="pill">{`${eps} bölüm`}</span> : null}
          {a.format && <button className="pill" onClick={() => go({ name: 'discover', f: { format: a.format! } })}>{FORMAT_TR[a.format] ?? a.format}</button>}
          {a.genres.slice(0, 3).map(g => <button key={g} className="pill" onClick={() => go({ name: 'discover', f: { genres: [g] } })}>{GENRE_TR[g] ?? g}</button>)}
        </div>
        <p>{a.description}</p>
        <div className="hero3-btns">
          <button className="pill-play" onClick={() => go({ name: 'anime', id: a.id, ep: 1 })}><Ic d={P.play} size={18} fill /> İzle</button>
          <span className="circ-wrap"><AddToList a={a} /></span>
          <button className="circ" onClick={() => go({ name: 'anime', id: a.id })} aria-label="Detaylar" title="Detaylar"><Ic d={P.info} size={20} /></button>
        </div>
      </div>
      <div className="hero3-nav">
        <button onClick={() => setI(x => (x - 1 + items.length) % items.length)} aria-label="Önceki"><Ic d={P.left} size={20} /></button>
        <button onClick={() => setI(x => (x + 1) % items.length)} aria-label="Sonraki"><Ic d={P.right} size={20} /></button>
      </div>
    </section>
  )
}

/* ------------------------------ continue watching ------------------------------ */
interface Resume { ep: number; t: number; d: number; at: number }
const readResume = (id: number): Resume | null => {
  try {
    return JSON.parse(localStorage.getItem('resume:' + id) ?? 'null')
  } catch {
    return null
  }
}

function ContinueWatching() {
  const { settings, go } = useStore()
  const cardMenu = useCardMenu()
  const hidden = useHidden()
  const entries = useMemo(() => (settings ? Object.values(settings.library).filter(e => e.status === 'watching' && !hidden.includes(e.id)) : []), [settings?.library, hidden])
  const sorted = entries
    .map(e => ({ e, r: readResume(e.id) }))
    .sort((a, b) => (b.r?.at ?? b.e.updated) - (a.r?.at ?? a.e.updated))
    .slice(0, 40)
  const [info] = useLoad(() => animeByIds(sorted.map(x => x.e.id)), [sorted.map(x => x.e.id).join(',')])
  // Nothing to continue: the show is over and watched to the end, or the newest aired episode is watched.
  // It comes back by itself when a new episode airs.
  const midway = (x: (typeof sorted)[number]) => !!(x.r && x.r.d && x.r.t / x.r.d < (settings?.watchedAt ?? 0.8) && x.r.ep > x.e.progress)
  const aired = (x: (typeof sorted)[number]) => {
    const a = info?.[x.e.id]
    if (a?.nextEpisode) return a.nextEpisode - 1
    return a?.episodes ?? x.e.episodes ?? null
  }
  const rows = sorted.filter(x => midway(x) || aired(x) == null || x.e.progress < aired(x)!).slice(0, 8)
  // Thumbnail of the episode to continue (ani.zip), falling back to the anime's banner.
  const epOf = (e: (typeof rows)[number]) => (e.r && e.r.d && e.r.t / e.r.d < (settings?.watchedAt ?? 0.8) ? e.r.ep : e.e.progress + 1)
  const [thumbs] = useLoad(
    async () => Object.fromEntries(await Promise.all(rows.map(async x => [x.e.id, (await getMappings(x.e.id).catch(() => null))?.episodes.find(p => p.number === epOf(x))?.image ?? null] as const))),
    [rows.map(x => x.e.id + ':' + epOf(x)).join(',')]
  )
  if (!rows.length) return null
  return (
    <section className="block">
      <div className="block-head"><h2>İzlemeye devam et</h2><button className="link" onClick={() => go({ name: 'library' })}>Tümü →</button></div>
      <DragRow className="cw">
        {rows.map(({ e, r }) => {
          const a = info?.[e.id]
          const resumeHere = r && r.d && r.t / r.d < (settings?.watchedAt ?? 0.8)
          const ep = resumeHere ? r!.ep : e.progress + 1
          return (
            <button key={e.id} className="cw-card" onClick={() => go({ name: 'anime', id: e.id, ep: e.episodes && ep > e.episodes ? undefined : ep })} onContextMenu={ev => cardMenu(ev, { id: e.id, title: e.title, cover: e.cover, episodes: e.episodes }, ep, [{ label: 'Gizle', icon: <Ic d={P.eye} size={15} />, onClick: () => hideFromContinue(e.id) }])}>
              <div className="cw-img" style={{ backgroundImage: `url(${thumbs?.[e.id] ?? a?.banner ?? a?.cover ?? e.cover})` }}>
                <div className="cw-txt">
                  <strong>{e.title}</strong>
                  <span className="cw-sub">
                    <small>{`${ep}. bölüm`}</small>
                    {resumeHere ? <small>{`${Math.max(1, Math.round((r!.d - r!.t) / 60))} dk kaldı`}</small> : <small>{`${e.progress}/${e.episodes ?? '?'} izlendi`}</small>}
                  </span>
                </div>
                {resumeHere && <div className="cw-bar"><i style={{ width: (r!.t / r!.d) * 100 + '%' }} /></div>}
              </div>
            </button>
          )
        })}
      </DragRow>
    </section>
  )
}

/* -------------------------------- latest episodes -------------------------------- */
function LatestEpisodes() {
  const [items, err] = useLoad<AiredEpisode[]>(() => latestEpisodes(18))
  return (
    <section className="block">
      <div className="block-head"><h2>Son yayınlanan bölümler</h2></div>
      {err && <div className="state">{err}</div>}
      <div className="grid2">
        {items
          ? items.map(x => <AnimeCard key={x.anime.id + '-' + x.episode} a={x.anime} ep={x.episode} sub={`${x.episode}. bölüm · ${timeAgo(x.airingAt)}`} />)
          : <Skeletons n={12} />}
      </div>
    </section>
  )
}

/* ---------------------------------- trending ---------------------------------- */

/** "Trend ▾" row with chips (now / this season / all time), ranked posters. */
function Trending() {
  const cs = currentSeason()
  const [tab, setTab] = useState<'now' | 'season' | 'all'>('now')
  const [items] = useLoad(
    () => browse(tab === 'now' ? { sort: ['TRENDING_DESC'], perPage: 16 } : tab === 'season' ? { ...cs, sort: ['POPULARITY_DESC'], perPage: 16 } : { sort: ['POPULARITY_DESC'], perPage: 16 }),
    [tab]
  )
  return (
    <section className="block">
      <div className="block-head">
        <h2><span className="h-dim">Trend</span> Animeler</h2>
        <div className="chips">
          {([['now', 'Şimdi'], ['season', 'Bu sezon'], ['all', 'Tüm zamanlar']] as const).map(([k, l]) => (
            <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      </div>
      <DragRow className="strip">
        {items ? items.items.map((a, i) => <AnimeCard key={a.id} a={a} rank={i + 1} />) : <Skeletons n={8} />}
      </DragRow>
    </section>
  )
}

function Row({ title, sub, load, more }: { title: string; sub?: string; load: () => Promise<{ items: Anime[] }>; more?: () => void }) {
  const [r, err] = useLoad(load)
  return (
    <section className="block">
      <div className="block-head"><h2>{title}</h2>{sub && <p>{sub}</p>}{more && <button className="link" onClick={more}>Tümü →</button>}</div>
      {err ? <div className="state">{err}</div> : <DragRow className="strip">{r ? r.items.map(a => <AnimeCard key={a.id} a={a} />) : <Skeletons n={8} />}</DragRow>}
    </section>
  )
}

export function Home() {
  const { settings, go } = useStore()
  const cs = currentSeason()
  const [hero] = useLoad(() => browse({ sort: ['TRENDING_DESC'], perPage: 10 }))
  const noAddons = settings && settings.addons.length === 0

  return (
    <div className="home">
      <Hero items={(hero?.items ?? []).filter(a => a.banner).slice(0, 8)} />
      <div className="home-body">
        <div className="home-main">
          {noAddons && (
            <div className="banner-note">
              <strong>Henüz eklenti yok.</strong> Bölümleri izleyebilmek için bir Stremio eklentisi kur ve debrid anahtarını ekle.
              <div className="row-btns">
                <button className="btn" onClick={() => go({ name: 'settings', tab: 'addons' })}>Eklenti ekle</button>
              </div>
            </div>
          )}
          <ContinueWatching />
          <Trending />
          <LatestEpisodes />
          <Row title="Bu sezon" sub={`${SEASON_TR[cs.season]} ${cs.year} · popülerliğe göre`} load={() => browse({ ...cs, sort: ['POPULARITY_DESC'] })} more={() => go({ name: 'discover', f: { season: cs.season, year: cs.year } })} />
          <Row title="Yakında" sub="En çok beklenenler" load={() => browse({ status: 'NOT_YET_RELEASED', sort: ['POPULARITY_DESC'] })} more={() => go({ name: 'discover', f: { status: 'NOT_YET_RELEASED' } })} />
          <Row title="Tüm zamanların en iyileri" load={() => browse({ sort: ['SCORE_DESC'] })} more={() => go({ name: 'discover', f: { sort: 'SCORE_DESC' } })} />
        </div>
      </div>
    </div>
  )
}

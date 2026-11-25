import { useEffect, useRef, useState } from 'react'
import { characterNames, FORMAT_TR, franchise, GENRE_TR, getAnime, getMappings, kitsuEpisodeArt, randomAnime, SEASON_TR, STATUS_TR, streamIds, watchOrder, type Anime, type DiscoverFilters, type Mappings, type Related } from '../lib/anilist'
import { AnimeCard } from '../components/AnimeCard'
import { resolveRequest, StreamPicker } from '../components/StreamPicker'
import type { ResolveRequest } from '../../../shared/types'
import { Ic, ListEditor, P, STATUS, TitleLogo, TrailerDialog, laterSeason } from '../components/ui'
import { useStore } from '../store'
import { getUiLang } from '../lib/i18n'
import { openUrl } from '@tauri-apps/plugin-opener'
import { invoke } from '@tauri-apps/api/core'
/** A TV: trailers open in its YouTube app (an embedded player stuttered there, and Back returns here). */
const onTv = () => document.documentElement.classList.contains('tv')

type Full = Anime & { relations: (Anime & { relation?: string })[] }
type Fillers = { filler: number[]; mixed: number[] } | null

const REL_TR: Record<string, string> = { SEQUEL: 'Devamı', PREQUEL: 'Öncesi', SIDE_STORY: 'Yan hikâye', PARENT: 'Ana seri', SPIN_OFF: 'Spin-off', ALTERNATIVE: 'Alternatif', SUMMARY: 'Özet', FRANCHISE: 'Seriden' }

/** Time left until the next episode airs, ticking every second. */
function Countdown({ at, ep }: { at: number; ep: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.floor(at - now / 1000))
  const parts = [[Math.floor(s / 86400), 'gün'], [Math.floor(s / 3600) % 24, 'sa'], [Math.floor(s / 60) % 60, 'dk'], [s % 60, 'sn']] as const
  const when = new Date(at * 1000).toLocaleString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
  return (
    <div className="countdown" title={when}>
      <small>{ep}. bölüm {s ? 'yayınlanmasına' : 'yayınlandı'}</small>
      {s > 0 && (
        <div className="cd-row">
          {parts.map(([v, l], i) => (i === 0 && !v ? null : <span key={l}><b>{String(v).padStart(i ? 2 : 1, '0')}</b><i>{l}</i></span>))}
        </div>
      )}
      <small className="cd-when">{when}</small>
    </div>
  )
}

/** The franchise in watch order (release order of the story), opened from the anime page. */
function WatchOrder({ a, onClose }: { a: Anime; onClose: () => void }) {
  const { go } = useStore()
  const [list, setList] = useState<Awaited<ReturnType<typeof watchOrder>> | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => void watchOrder(a).then(setList, e => setErr(e.message)), [a.id])
  let n = 0
  return (
    <div className="dialog worder" role="dialog" aria-label="İzleme sırası">
      <div className="trailer-head">
        <strong>İzleme sırası</strong>
        <button className="xbtn" onClick={onClose} aria-label="Kapat"><Ic d={P.x} /></button>
      </div>
      <p className="muted wo-note">Yayın sırasına göre. Ana hikâye numaralı; OVA, özel bölüm ve yan hikâyeler arada, isteğe bağlı.</p>
      <div className="wo-list">
        {err && <div className="state">{err}</div>}
        {!list && !err && <div className="state"><div className="spinner sm" /></div>}
        {list?.map(x => (
          <button key={x.id} className={'wo-item' + (x.id === a.id ? ' me' : '') + (x.main ? '' : ' opt')} onClick={() => { onClose(); x.id !== a.id && go({ name: 'anime', id: x.id }) }}>
            <span className="wo-n">{x.main ? ++n : '·'}</span>
            <img src={x.cover} alt="" loading="lazy" />
            <span className="wo-t">
              <strong>{x.title}</strong>
              <small>{[FORMAT_TR[x.format ?? ''] ?? x.format, x.year, x.episodes ? x.episodes + ' bölüm' : null, x.main ? null : 'isteğe bağlı'].filter(Boolean).join(' · ')}</small>
            </span>
            {x.id === a.id && <span className="wo-me">Bu anime</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Long descriptions are cut to a few lines with "Devamını oku". */
function Synopsis({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 420 || text.split('\n').length > 5
  return (
    <div className="synwrap">
      <p className={'syn' + (long && !open ? ' clamp' : '')}>{text}</p>
      {long && <button className="more" onClick={() => setOpen(o => !o)}>{open ? 'Daha az göster' : 'Devamını oku'}</button>}
    </div>
  )
}

export function AnimeDetail({ id, autoEp, rnd }: { id: number; autoEp?: number; rnd?: DiscoverFilters }) {
  const { settings, setSettings, setPlay, go, back, canBack, modal, playerOpen, menu } = useStore()
  const [rel, setRel] = useState<Related[] | null>(null)
  const [rolling, setRolling] = useState(false)
  const roll = useRef(0)
  // Filler episodes jumped over by the last "next episode" (told in the player)
  const skippedFillers = useRef(0)
  const [a, setA] = useState<Full | null>(null)
  const [m, setM] = useState<Mappings | null>(null)
  // Pictures / titles from Kitsu for episodes ani.zip has none for
  const [art, setArt] = useState<Map<number, { image: string | null; title: string | null }> | null>(null)
  const [fillers, setFillers] = useState<Fillers>(null)
  const [names, setNames] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [pickEp, setPickEp] = useState<number | null>(null)
  // Episode opened with "Kaynağı kendim seçeyim" (right click / long press): show the list, no automatic choice
  const [manual, setManual] = useState(false)
  const press = useRef(0)
  useEffect(() => void window.api.torrentWarm?.(), [])
  const [range, setRange] = useState(0)
  const [dtab, setDtab] = useState<'eps' | 'rel'>('eps')
  const [epQuery, setEpQuery] = useState('')
  const [newestFirst, setNewestFirst] = useState(false)
  const [hideFiller, setHideFiller] = useState(false)
  // Sources that failed (wrong file, broken audio…) per episode, skipped by the automatic choice.
  const failed = useRef<Record<number, Set<string>>>({})
  // Episode switch started from inside the player (the player stays open while the source is found).
  const fromPlayer = useRef(false)

  useEffect(() => {
    getAnime(id).then(setA, e => setErr(e.message))
    getMappings(id).then(setM)
    characterNames(id).then(setNames)
  }, [id])
  // The whole franchise (several AniList requests) only when the İlişkili tab is opened
  useEffect(() => {
    if (dtab === 'rel' && !rel) franchise(id).then(setRel, () => {})
  }, [dtab, id])

  useEffect(() => {
    setArt(null)
    if (!a || !m || a.format === 'MOVIE') return
    const aired = a.nextEpisode ? a.nextEpisode - 1 : a.episodes ?? m.episodes.length
    const missing = Array.from({ length: aired }, (_, i) => i + 1).some(n => !m.episodes.find(e => e.number === n)?.image)
    if (!missing) return
    let live = true
    kitsuEpisodeArt(a, m).then(x => live && setArt(x), () => {})
    return () => {
      live = false
    }
  }, [a?.id, m])

  useEffect(() => {
    if (!a || a.format === 'MOVIE') return
    window.api.fillers([a.romaji, a.title].filter(Boolean)).then(f => setFillers(f), () => {})
  }, [a?.id])

  // Opened from "latest episodes" / "continue watching": go straight to that episode.
  const autoDone = useRef(false)
  useEffect(() => {
    if (autoEp && a && m && !autoDone.current) {
      autoDone.current = true
      setPickEp(a.format === 'MOVIE' ? 1 : autoEp)
    }
  }, [a, m])

  // Automatic source choice: the player opens at once with an opening screen (no list, no status box).
  const opening = useRef(false) // the opening screen is showing for the episode being picked
  const toList = useRef(false) // the player was closed on purpose to show the source list
  const quiet = !!settings?.autoSource && settings.engine !== 'builtin' && !manual
  useEffect(() => {
    if (pickEp == null || !a || !m || !quiet) return
    opening.current = true
    const info = m.episodes.find(e => e.number === pickEp)
    window.api.playerLoading({
      title: a.title,
      subtitle: a.format === 'MOVIE' ? undefined : `${pickEp}. bölüm${info?.title ? ' · ' + info.title : ''}`,
      backdrop: info?.image ?? a.banner ?? a.cover
    })
  }, [pickEp, quiet, a?.id, !!m])
  // Closing the opening screen cancels the search.
  useEffect(
    () =>
      window.api.onPlayerClosed(() => {
        if (toList.current) return void (toList.current = false)
        if (opening.current) {
          opening.current = false
          setPickEp(null)
        }
      }),
    []
  )

  if (err) return <div className="page"><div className="state">{err}</div></div>
  if (!a) return <div className="page"><div className="state"><div className="spinner sm" /></div></div>

  const mine = settings?.library[a.id]
  const aired = a.nextEpisode ? a.nextEpisode - 1 : a.episodes ?? m?.episodes.length ?? 0
  // The next episode is listed too (marked "Yakında"): sources often have it before AniList's air time
  // (early releases, simulcast time zones). Opening it looks for sources like any other episode.
  const upcoming = a.format !== 'MOVIE' && a.nextEpisode && (a.episodes == null || a.nextEpisode <= a.episodes) ? a.nextEpisode : null
  const count = a.format === 'MOVIE' ? 1 : upcoming ?? aired
  const episodes = Array.from({ length: count }, (_, i) => {
    const n = i + 1
    const e = m?.episodes.find(e => e.number === n) ?? { number: n, title: null, image: null, airDate: null, overview: null, tvdbSeason: null, tvdbEpisode: null }
    const k = art?.get(n)
    return k ? { ...e, image: e.image ?? k.image, title: e.title ?? k.title } : e
  })
  const kind = (n: number) => (fillers?.filler.includes(n) ? 'filler' : fillers?.mixed.includes(n) ? 'mixed' : null)
  // Long shows are split into pages of 100 episodes.
  const PAGE = 100
  const pages = Math.ceil(episodes.length / PAGE)
  const all = range === -1 // "Tümü"
  const curPage = Math.min(range, Math.max(0, pages - 1))
  const shownEps = episodes.length > PAGE && !all ? episodes.slice(curPage * PAGE, curPage * PAGE + PAGE) : episodes

  const playEpisode = (ep: number, url: string, label: string, src?: { addon: string; size?: string | null }, key?: string, resolve?: ResolveRequest) => {
    const epInfo = episodes[ep - 1]
    // Next / previous from the player skips filler episodes when that is turned on
    const step = (dir: 1 | -1) => {
      let n = ep + dir
      let skipped = 0
      while (settings?.skipFillers && kind(n) === 'filler' && n + dir >= 1 && n + dir <= episodes.length) (n += dir), skipped++
      return { n, skipped }
    }
    const switchTo = (dir: 1 | -1) => () => {
      const { n, skipped } = step(dir)
      skippedFillers.current = skipped
      fromPlayer.current = true
      setManual(false)
      setPickEp(n)
    }
    const notice = skippedFillers.current ? `${skippedFillers.current} filler bölüm atlandı` : undefined
    skippedFillers.current = 0
    setPlay({
      src: url,
      title: a.title,
      subtitle: a.format === 'MOVIE' ? label : `${ep}. bölüm${epInfo?.title ? ' · ' + epInfo.title : ''}`,
      animeId: a.id,
      malId: a.idMal,
      episode: ep,
      episodes: a.episodes,
      cover: a.cover,
      onNext: ep < episodes.length ? switchTo(1) : undefined,
      onPrev: ep > 1 && a.format !== 'MOVIE' ? switchTo(-1) : undefined,
      notice,
      onGoto: a.format === 'MOVIE' ? undefined : (n: number) => {
        if (n === ep) return
        fromPlayer.current = true
        setManual(false)
        setPickEp(n)
      },
      episodeList: a.format === 'MOVIE' ? undefined : episodes.map(e => ({ number: e.number, title: e.title, image: e.image, filler: kind(e.number) === 'filler' })),
      onPick: () => {
        fromPlayer.current = false
        setManual(true)
        setPickEp(ep)
      },
      // "Başka kaynak" in the player: remember this one as bad and pick again automatically.
      onRetry: () => {
        if (key) (failed.current[ep] ??= new Set()).add(key)
        fromPlayer.current = false
        setPickEp(ep)
      },
      expectedDuration: a.duration ? a.duration * 60 : null,
      subIds: m ? streamIds(a, m, ep) : undefined,
      source: { addon: src?.addon ?? '', label, size: src?.size },
      names,
      resolve,
      searchTitles: [a.romaji, a.title, a.native ?? ""].filter(Boolean),
      year: a.year,
      later: laterSeason(a, a.relations),
      total: episodes.length
    })
  }

  const epMenu = (ev: { clientX: number; clientY: number; preventDefault?: () => void }, n: number) =>
    menu(ev, [
      { label: 'Oynat', icon: <Ic d={P.play} size={15} />, onClick: () => { setManual(false); setPickEp(n) } },
      { label: 'Kaynağı kendim seçeyim', icon: <Ic d={P.list} size={15} />, onClick: () => { setManual(true); setPickEp(n) } }
    ])

  /** Click plays episode n; right click or a long press opens the menu (play / pick the source myself). */
  const pressProps = (n: number) => ({
    onClick: () => {
      if (press.current === -1) return void (press.current = 0) // long press already opened the menu
      setManual(false)
      setPickEp(n)
    },
    onContextMenu: (ev: React.MouseEvent) => epMenu(ev, n),
    onPointerDown: (ev: React.PointerEvent) => {
      if (ev.button !== 0) return
      const { clientX, clientY } = ev
      press.current = window.setTimeout(() => {
        press.current = -1
        epMenu({ clientX, clientY }, n)
      }, 550)
    },
    onPointerUp: () => press.current > 0 && (clearTimeout(press.current), (press.current = 0)),
    onPointerLeave: () => press.current > 0 && (clearTimeout(press.current), (press.current = 0))
  })

  const ids = pickEp != null && m ? streamIds(a, m, pickEp) : null
  const discover = (f: Parameters<typeof go>[0]) => go(f)
  const status = STATUS.find(s => s.id === mine?.status)
  const relations = rel ?? a.relations
  // a second click while it is choosing cancels it
  const nextRandom = async () => {
    const mine = ++roll.current
    if (rolling) return setRolling(false)
    setRolling(true)
    try {
      const r = await randomAnime(rnd ?? {})
      if (r && mine === roll.current) go({ name: 'anime', id: r.id, rnd: rnd ?? {} })
    } catch {
      /* cancelled or AniList busy */
    } finally {
      if (mine === roll.current) setRolling(false)
    }
  }

  const hasKinds = !!fillers && (fillers.filler.length > 0 || fillers.mixed.length > 0)
  const q = epQuery.trim().toLowerCase()
  const listed = shownEps
    .filter(e => !hideFiller || kind(e.number) !== 'filler')
    .filter(e => !q || String(e.number) === q || (e.title ?? '').toLowerCase().includes(q))
  if (newestFirst) listed.reverse()
  // Finished (status or every episode watched): the button starts over instead of "continue from the last"
  const finished = !!mine && a.format !== 'MOVIE' && (mine.status === 'done' || (a.episodes != null && mine.progress >= a.episodes))
  const nextEp = finished ? 1 : Math.min(episodes.length, (mine?.progress ?? 0) + 1)
  const dateFmt = (d: string) => new Date(d).toLocaleDateString(getUiLang() === 'en' ? 'en-US' : 'tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className="detail2">
      <div className="d2-bg" style={{ backgroundImage: `url(${laterSeason(a, a.relations) ? a.banner ?? a.cover : m?.fanart ?? a.banner ?? a.cover})` }} />
      <div className="d2-wrap">
        <aside className="d2-side">
          {rnd ? (
            <div className="rnd-nav">
              <button className="tchip" onClick={back} disabled={!canBack}><Ic d={P.left} size={15} /> Önceki</button>
              <button className="tchip on" onClick={nextRandom} title={rolling ? 'İptal etmek için tıkla' : 'Rastgele başka bir anime'}><Ic d={rolling ? P.x : P.shuffle} size={15} /> {rolling ? 'Seçiliyor… (iptal)' : 'Sıradaki'}</button>
            </div>
          ) : (
            <button className="circ sm" onClick={back} aria-label="Geri" title="Geri"><Ic d={P.left} size={18} /></button>
          )}
          <img className="d2-cover" src={a.cover} alt="" />
          {a.status === 'RELEASING' && a.nextAiringAt && a.nextEpisode && <Countdown at={a.nextAiringAt} ep={a.nextEpisode} />}
          <dl className="d2-facts">
            {a.format && (<><dt>Format</dt><dd><button className="ulink" onClick={() => discover({ name: 'discover', f: { format: a.format! } })}>{FORMAT_TR[a.format] ?? a.format}</button></dd></>)}
            {a.format !== 'MOVIE' && (<><dt>Bölümler</dt><dd>{a.episodes ?? (aired ? `${aired}+` : '?')}</dd></>)}
            {a.duration ? (<><dt>Süre</dt><dd>{`${a.duration} dk`}</dd></>) : null}
            {a.status && (<><dt>Durum</dt><dd><button className="ulink" onClick={() => discover({ name: 'discover', f: { status: a.status! } })}>{STATUS_TR[a.status] ?? a.status}</button></dd></>)}
            {a.score != null && (<><dt>Puan</dt><dd className="d2-score"><Ic d={P.star} size={14} fill /> {a.score.toFixed(1)}</dd></>)}
            {a.studioList.length > 0 && (
              <><dt>Stüdyo</dt><dd>{a.studioList.map(s => <button key={s.id} className="ulink" onClick={() => discover({ name: 'discover', f: { studio: s } })}>{s.name}</button>)}</dd></>
            )}
            {a.season && a.year ? (
              <><dt>Sezon</dt><dd><button className="ulink" onClick={() => discover({ name: 'discover', f: { season: a.season!, year: a.year! } })}>{`${SEASON_TR[a.season]} ${a.year}`}</button></dd></>
            ) : null}
            {mine && (<><dt>İlerlemen</dt><dd>{`${mine.progress}/${a.episodes ?? '?'}`}{mine.score ? ` · ★ ${mine.score}` : ''}</dd></>)}
            {(a.romaji !== a.title || a.native) && (<><dt>Diğer adlar</dt><dd className="d2-alt">{[a.romaji !== a.title ? a.romaji : null, a.native].filter(Boolean).join(' · ')}</dd></>)}
          </dl>
        </aside>

        <main className="d2-main">
          <TitleLogo src={laterSeason(a, a.relations) ? null : m?.logo} title={a.title} className="d2-logo" />
          <div className="pills">
            {a.score != null && <span className="pill"><Ic d={P.star} size={13} fill /> {a.score.toFixed(1)}</span>}
            {a.year && <button className="pill" onClick={() => discover({ name: 'discover', f: { year: a.year! } })}><Ic d={P.clock} size={13} /> {a.year}</button>}
            {a.format !== 'MOVIE' && aired > 0 && <span className="pill">{`${a.episodes ?? aired} bölüm`}</span>}
            {a.format && <button className="pill" onClick={() => discover({ name: 'discover', f: { format: a.format! } })}>{FORMAT_TR[a.format] ?? a.format}</button>}
            {a.genres.map(g => (
              <button key={g} className="pill" onClick={() => discover({ name: 'discover', f: { genres: [g] } })}>{GENRE_TR[g] ?? g}</button>
            ))}
          </div>
          <Synopsis text={a.description} />

          <div className="hero3-btns">
            {episodes.length > 0 && (
              <button className="pill-play" title="Sağ tık / basılı tut: kaynağı kendin seç" {...pressProps(nextEp)}>
                <Ic d={P.play} size={18} fill /> {a.format === 'MOVIE' ? 'İzle' : finished ? 'Baştan izle' : mine?.progress ? `${nextEp}. bölümden devam et` : '1. bölümü izle'}
              </button>
            )}
            <button className={'circ' + (mine ? ' on' : '')} onClick={() => modal(<ListEditor a={a} onClose={() => modal(null)} />)} aria-label={status ? status.label : 'Listeye ekle'} title={status ? status.label : 'Listeye ekle'}>
              <Ic d={status ? status.icon : P.plus} size={20} sw={2.4} />
            </button>
            {a.trailer && (
              <button className="circ" onClick={() => (onTv() ? void invoke('player_call', { method: 'youtube', args: { id: a.trailer } }).catch(() => void openUrl(`https://www.youtube.com/watch?v=${a.trailer}`).catch(() => {})) : modal(<TrailerDialog id={a.trailer!} mal={a.idMal} title={a.title} onClose={() => modal(null)} />))} aria-label="Fragman" title="Fragman">
                <Ic d={P.film} size={19} />
              </button>
            )}
            <button className="circ al" onClick={() => window.open(`https://anilist.co/anime/${a.id}`)} aria-label="AniList’te aç" title="AniList’te aç">AL</button>
            {a.idMal && <button className="circ al" onClick={() => window.open(`https://myanimelist.net/anime/${a.idMal}`)} aria-label="MyAnimeList’te aç" title="MyAnimeList’te aç">MAL</button>}
            {relations.length > 0 && (
              <button className="circ" onClick={() => modal(<WatchOrder a={a} onClose={() => modal(null)} />)} aria-label="İzleme sırası" title="İzleme sırası">
                <Ic d={P.order} size={19} />
              </button>
            )}
          </div>

          <nav className="d2-tabs">
            <button aria-pressed={dtab === 'eps'} onClick={() => setDtab('eps')}><Ic d={P.list} size={16} /> {a.format === 'MOVIE' ? 'İzle' : 'Bölümler'} <small>{episodes.length}</small></button>
            {relations.length > 0 && (
              <button aria-pressed={dtab === 'rel'} onClick={() => setDtab('rel')}><Ic d={P.film} size={16} /> İlişkili <small>{relations.length}</small></button>
            )}
          </nav>

          {dtab === 'eps' && (
            <section className="d2-eps">
              {episodes.length > 12 && (
                <div className="searchbox wide">
                  <Ic d={P.search} size={16} />
                  <input value={epQuery} onChange={e => setEpQuery(e.target.value)} placeholder="Bölüm ara (numara ya da ad)" />
                </div>
              )}
              <div className="d2-tools">
                {episodes.length > 1 && (
                  <button className="tchip" onClick={() => setNewestFirst(v => !v)}><Ic d={P.list} size={14} /> {newestFirst ? 'En yeni' : 'En eski'}</button>
                )}
                {hasKinds && fillers!.filler.length > 0 && (
                  <button className="tchip" aria-pressed={hideFiller} onClick={() => setHideFiller(v => !v)}>Filler’ı gizle <small>{fillers!.filler.length}</small></button>
                )}
                {hasKinds && fillers!.filler.length > 0 && (
                  <button
                    className="tchip"
                    aria-pressed={!!settings?.skipFillers}
                    title="Sonraki bölüme geçerken filler bölümleri atla (oynatıcının ayarlarında da var)"
                    onClick={async () => setSettings(await window.api.setSettings({ skipFillers: !settings?.skipFillers }))}
                  >
                    <Ic d={P.skip} size={13} /> Filler’ı otomatik atla
                  </button>
                )}
                {pages > 1 && <span className="tsep" />}
                {pages > 1 &&
                  Array.from({ length: pages }, (_, i) => (
                    <button key={i} className="tchip" aria-pressed={!all && i === curPage} onClick={() => setRange(i)}>
                      {i * PAGE + 1}–{Math.min(episodes.length, (i + 1) * PAGE)}
                    </button>
                  ))}
                {pages > 1 && <button className="tchip" aria-pressed={all} onClick={() => setRange(-1)}>Tümü</button>}
              </div>
              {hasKinds && (
                <p className="legend">
                  <i className="lg-mixed" /> <b>Karışık: hikâye + filler</b> <i className="lg-filler" /> <b>Filler: hikâye dışı</b>
                </p>
              )}
              {!m?.kitsu && m && <p className="muted">Bu anime eklentilerin kullandığı kimliklerle eşleşmiyor; kaynaklar adıyla aranıyor.</p>}
              {episodes.length === 0 && <div className="state">Henüz yayınlanmış bölüm yok.</div>}
              <div className="episodes2">
                {listed.map(e => {
                  const watched = (mine?.progress ?? 0) >= e.number
                  const k = kind(e.number)
                  const spoil = !!settings?.hideSpoilers && !watched && a.format !== 'MOVIE'
                  return (
                    <button key={e.number} className={'ep2' + (watched ? ' watched' : '') + (spoil ? ' spoil' : '') + (e.number === nextEp && mine ? ' next' : '') + (e.number === upcoming ? ' upcoming' : '')} {...pressProps(e.number)}>
                      <div className="ep2-thumb">
                        {e.image ? (
                          <img src={e.image} alt="" loading="lazy" />
                        ) : (
                          // no picture anywhere: the show's own art, dimmed (the badge already says which episode)
                          <div className="ep-ph art" style={{ backgroundImage: `url(${laterSeason(a, a.relations) ? a.banner ?? a.cover : m?.fanart ?? a.banner ?? a.cover})` }} />
                        )}
                        <span className="ep2-badge">{a.format === 'MOVIE' ? 'Film' : `${e.number}. bölüm`}{k && <span className={'ep2-kind ' + k}>{k === 'filler' ? 'Filler' : 'Karışık'}</span>}</span>
                        {watched && <span className="ep2-watched"><Ic d={P.check} size={12} sw={3} /> İzlendi</span>}
                        {e.number === upcoming && !watched && <span className="ep2-soon">Yakında</span>}
                        {a.duration ? <span className="ep2-dur">{`${a.duration} dk`}</span> : null}
                        <span className="ep2-play"><Ic d={P.play} size={22} fill /></span>
                      </div>
                      <div className="ep2-text">
                        <strong>{a.format === 'MOVIE' ? a.title : spoil ? `${e.number}. bölüm` : e.title ?? `${e.number}. bölüm`}</strong>
                        {e.overview && !spoil && <p>{e.overview}</p>}
                        {e.airDate && <small>{dateFmt(e.airDate)}</small>}
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {dtab === 'rel' && (
            <div className="grid2">
              {relations.map(r => (
                <div key={r.id} className="rel">
                  <small>{REL_TR[r.relation ?? ''] ?? ''}</small>
                  <AnimeCard a={r} />
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {pickEp != null && ids && (
        <StreamPicker
          key={pickEp + (manual ? 'm' : '')}
          type={ids.type}
          ids={ids.ids}
          titles={[a.romaji, a.title, a.native ?? ""].filter(Boolean)}
          title={`${a.title} · ${a.format === 'MOVIE' ? 'Film' : pickEp + '. bölüm'}`}
          episode={a.format === 'MOVIE' ? null : pickEp}
          year={a.year}
          total={episodes.length}
          later={laterSeason(a, a.relations)}
          auto={!!settings?.autoSource && !manual}
          skip={failed.current[pickEp] ?? new Set()}
          onClose={() => setPickEp(null)}
          quiet={quiet}
          onNeedUser={() => {
            // No source could be started automatically: close the opening screen and show the list.
            if (opening.current || (fromPlayer.current && playerOpen)) {
              toList.current = true
              window.api.playerManual()
            }
            opening.current = false
            fromPlayer.current = false
          }}
          onPlay={(url, s, key) => {
            const ep = pickEp
            opening.current = false
            fromPlayer.current = false
            setPickEp(null)
            playEpisode(ep, url, s.label, { addon: s.addon, size: s.size }, key, resolveRequest(s, a.format === 'MOVIE' ? null : ep))
          }}
        />
      )}
    </div>
  )
}

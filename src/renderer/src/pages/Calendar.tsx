import { useEffect, useMemo, useState } from 'react'
import { airingBetween, FORMAT_TR, type Airing } from '../lib/anilist'
import { Ic, P } from '../components/ui'
import { useStore } from '../store'

const DAY = 86400

/** Takvim: what airs in the coming week, day by day and hour by hour (AniList airing schedule). */
export function Calendar() {
  const { go, settings } = useStore()
  const [items, setItems] = useState<Airing[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [mineOnly, setMineOnly] = useState(false)
  const start = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return Math.floor(d.getTime() / 1000)
  }, [])
  const [day, setDay] = useState(0)

  useEffect(() => void airingBetween(start - 1, start + 7 * DAY).then(setItems, e => setErr(e.message)), [start])
  const lib = settings?.library ?? {}
  const days = Array.from({ length: 7 }, (_, i) => {
    const t = start + i * DAY
    const list = (items ?? []).filter(x => x.airingAt >= t && x.airingAt < t + DAY && (!mineOnly || lib[x.anime.id]))
    return { t, list }
  })
  const cur = days[day]
  const now = Date.now() / 1000
  const hours = new Map<number, Airing[]>()
  for (const x of cur.list) {
    const h = new Date(x.airingAt * 1000).getHours()
    hours.set(h, [...(hours.get(h) ?? []), x])
  }
  const dayName = (t: number, i: number) => (i === 0 ? 'Bugün' : i === 1 ? 'Yarın' : new Date(t * 1000).toLocaleDateString('tr-TR', { weekday: 'long' }))

  return (
    <div className="page calendar">
      <div className="cal-head">
        <h1>Yayın takvimi</h1>
        <button className="tchip" aria-pressed={mineOnly} onClick={() => setMineOnly(v => !v)}><Ic d={P.bookmark} size={14} /> Sadece listemdekiler</button>
      </div>
      <nav className="cal-days">
        {days.map((d, i) => (
          <button key={d.t} aria-pressed={i === day} onClick={() => setDay(i)} data-tv-start={i === day || undefined}>
            <strong>{dayName(d.t, i)}</strong>
            <small>{new Date(d.t * 1000).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}</small>
            {items && <span className="cal-count">{d.list.length}</span>}
          </button>
        ))}
      </nav>
      {err && <div className="state">{err}</div>}
      {!items && !err && <div className="state"><div className="spinner sm" /></div>}
      {items && cur.list.length === 0 && <div className="state">{mineOnly ? 'Listendeki animelerden bu gün yayınlanan yok.' : 'Bu gün yayın yok.'}</div>}
      <div className="cal-hours">
        {[...hours.entries()].map(([h, list]) => (
          <section key={h} className="cal-hour">
            <div className="cal-time">{String(h).padStart(2, '0')}:00</div>
            <div className="cal-items">
              {list.map(x => {
                const aired = x.airingAt <= now
                const mine = lib[x.anime.id]
                return (
                  <button key={x.anime.id + '-' + x.episode} className={'cal-item' + (aired ? ' aired' : '') + (mine ? ' mine' : '')} onClick={() => go({ name: 'anime', id: x.anime.id })}>
                    <img src={x.anime.cover} alt="" loading="lazy" />
                    <span className="cal-txt">
                      <strong>{x.anime.title}</strong>
                      <small>
                        {new Date(x.airingAt * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} · {x.episode}. bölüm
                        {x.anime.episodes ? ` / ${x.anime.episodes}` : ''} · {FORMAT_TR[x.anime.format ?? ''] ?? x.anime.format}
                      </small>
                    </span>
                    {mine && <span className="cal-tag">Listende</span>}
                    {aired && <span className="cal-tag ok">Yayınlandı</span>}
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

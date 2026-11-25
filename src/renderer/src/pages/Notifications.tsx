import { useEffect, useState } from 'react'
import { timeAgo, type AniNotification } from '../lib/anilist'
import { Ic, P } from '../components/ui'
import { useStore } from '../store'

/** Bildirimler: the linked AniList account's notifications (new episodes of followed shows, follows, likes…). */
export function Notifications() {
  const { go } = useStore()
  const [items, setItems] = useState<AniNotification[] | null>(null)
  const [none, setNone] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)

  const load = (p: number) =>
    window.api.notifications(p).then(
      r => {
        if (!r) return setNone(true)
        setItems(x => (p === 1 ? r.items : [...(x ?? []), ...r.items]))
        setHasNext(r.hasNext)
        setPage(p)
        window.dispatchEvent(new Event('anisaki:notifsread'))
      },
      e => setErr(String(e.message ?? e))
    )
  useEffect(() => void load(1), [])

  return (
    <div className="page notifs">
      <h1>Bildirimler</h1>
      {none && (
        <div className="state">
          <p>Bildirimler bağlı AniList hesabından gelir. Bu profile bağlı hesap yok.</p>
          <button className="btn" onClick={() => go({ name: 'settings', tab: 'general' })}>Hesap bağla</button>
        </div>
      )}
      {err && <div className="state">{err}</div>}
      {!items && !none && !err && <div className="state"><div className="spinner sm" /></div>}
      {items?.length === 0 && <div className="state">Hiç bildirim yok.</div>}
      <div className="notif-list">
        {items?.map(n => (
          <button key={n.id} className="notif" onClick={() => n.anime && go({ name: 'anime', id: n.anime.id, ...(n.kind === 'AIRING' && n.episode ? { ep: n.episode } : {}) })} disabled={!n.anime}>
            {n.anime ? <img src={n.anime.cover} alt="" /> : n.user?.avatar ? <img className="round" src={n.user.avatar} alt="" /> : <span className="notif-ic"><Ic d={P.bell} /></span>}
            <span className="notif-txt">
              {n.anime && <strong>{n.anime.title}</strong>}
              <span>{n.text}</span>
              <small>{timeAgo(n.at)}</small>
            </span>
            {n.kind === 'AIRING' && <span className="notif-play"><Ic d={P.play} size={16} fill /> İzle</span>}
          </button>
        ))}
      </div>
      {hasNext && <button className="btn ghost" onClick={() => load(page + 1)}>Daha fazla</button>}
    </div>
  )
}

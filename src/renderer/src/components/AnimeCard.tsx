import type { Anime } from '../lib/anilist'
import { FORMAT_TR, GENRE_TR } from '../lib/anilist'
import { useStore } from '../store'
import { AddToList, Ic, P, useCardMenu } from './ui'

export const LIB_STATUS = {
  watching: { label: 'İzliyorum', cls: 's-watching' },
  plan: { label: 'İzleyeceğim', cls: 's-plan' },
  done: { label: 'Bitirdim', cls: 's-done' },
  hold: { label: 'Ara verdim', cls: 's-hold' },
  drop: { label: 'Bıraktım', cls: 's-drop' }
} as const

type CardAnime = Pick<Anime, 'id' | 'title' | 'cover' | 'score' | 'format' | 'episodes' | 'year'> & Partial<Pick<Anime, 'nextEpisode' | 'duration' | 'genres'>>

/**
 * Poster card: title and info sit inside the poster over a dark fade. Click opens the anime, "+" puts it on
 * the list, right click shows a menu.
 */
export function AnimeCard({ a, ep, sub, rank }: { a: CardAnime; ep?: number; sub?: string; rank?: number }) {
  const { go, settings } = useStore()
  const cardMenu = useCardMenu()
  const mine = settings?.library[a.id]
  const pct = mine && a.episodes ? Math.min(100, (mine.progress / a.episodes) * 100) : null
  const eps = a.episodes ?? (a.nextEpisode ? a.nextEpisode - 1 : null)
  const genre = a.genres?.[0]
  return (
    <button className="card" onClick={() => go({ name: 'anime', id: a.id, ep })} onContextMenu={e => cardMenu(e, a, ep)} title={a.title}>
      <div className="poster">
        <img src={a.cover} alt="" loading="lazy" draggable={false} />
        {rank != null && <span className="rankbadge">{rank}</span>}
        <AddToList a={a} />
        {ep != null && <span className="epbadge">{`${ep}. bölüm`}</span>}
        {mine && ep == null && <span className={'tag ' + LIB_STATUS[mine.status].cls}>{LIB_STATUS[mine.status].label}</span>}
        <div className="poster-txt">
          <h3>{a.title}</h3>
          <div className="meta">
            {sub ??
              (mine ? (
                `${mine.progress}/${a.episodes ?? '?'} bölüm izlendi`
              ) : (
                <>
                  {genre ? <span>{GENRE_TR[genre] ?? genre}</span> : a.format ? <span>{FORMAT_TR[a.format] ?? a.format}</span> : null}
                  {eps ? <span><Ic d={P.tv} size={11} /> {eps}</span> : null}
                  {a.score != null && <span className="sc">{a.score.toFixed(1)} <Ic d={P.star} size={10} fill /></span>}
                </>
              ))}
          </div>
        </div>
        {pct != null && (
          <div className="prog">
            <i style={{ width: pct + '%' }} />
          </div>
        )}
      </div>
    </button>
  )
}

export function Skeletons({ n = 12 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div key={i}>
          <div className="skel" />
        </div>
      ))}
    </>
  )
}

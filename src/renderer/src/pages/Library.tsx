import { useState } from 'react'
import { AnimeCard, LIB_STATUS } from '../components/AnimeCard'
import { useStore } from '../store'
import { unhideFromContinue, useHidden } from '../lib/hidden'

export function Library() {
  const { settings } = useStore()
  const [filter, setFilter] = useState<string>('all')
  const hidden = useHidden()
  const all = settings ? Object.values(settings.library).sort((a, b) => b.updated - a.updated) : []
  const hiddenEntries = all.filter(e => hidden.includes(e.id))
  const shown = filter === 'all' ? all : filter === 'hidden' ? hiddenEntries : all.filter(e => e.status === filter)
  const count = (k: string) => all.filter(e => e.status === k).length

  return (
    <div className="page">
      <div className="row-head">
        <h2>Listem</h2>
        <p>{all.length} anime · bu bilgisayarda saklanır</p>
      </div>
      <div className="chips">
        <button className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Tümü {all.length}</button>
        {Object.entries(LIB_STATUS).map(([k, v]) => (
          <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {v.label} {count(k)}
          </button>
        ))}
        {hiddenEntries.length > 0 && (
          <button className="chip" aria-pressed={filter === 'hidden'} onClick={() => setFilter('hidden')}>Gizlenenler {hiddenEntries.length}</button>
        )}
      </div>
      {filter === 'hidden' && <p className="muted">“İzlemeye devam et”ten gizlediğin animeler. Sadece bu uygulamada gizlenir; AniList ve MAL listene dokunulmaz.</p>}
      {shown.length === 0 ? (
        <div className="state">
          {all.length === 0 ? 'Listen boş. Bir animenin sayfasında “Listem” kutusundan durum seçince burada görünür.' : filter === 'hidden' ? 'Gizlenen anime yok.' : 'Bu durumda anime yok.'}
        </div>
      ) : (
        <div className="grid">
          {shown.map(e => (
            <div key={e.id} className="hidcard">
              <AnimeCard a={{ id: e.id, title: e.title, cover: e.cover, score: null, format: null, episodes: e.episodes, year: null }} />
              {filter === 'hidden' && (
                <button className="btn sm" onClick={() => unhideFromContinue(e.id)}>Geri getir</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

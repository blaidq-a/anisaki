import { useEffect, useMemo, useRef, useState } from 'react'
import type { ResolveProgress, ResolveRequest } from '../../../shared/types'
import { LANG_LABEL, otherAnime, otherSeason, subLangIn, parseStream, rankStreams, sortStreams, streamKey, torrentMode, type ParsedStream } from '../lib/streams'
import { useStore } from '../store'

interface Props {
  type: string
  ids: string[]
  title: string
  /** Anime titles for the name search on nyaa (shows without Kitsu / IMDb ids) */
  titles?: string[]
  /** The anime is a later season (prefer releases that say so) */
  later?: boolean
  /** Episode number, used to rank sources and to pick the right file inside packs */
  episode: number | null
  /** First air year of the anime, to tell a same-named live-action series apart */
  year?: number | null
  /** Episodes aired so far (long shows use 3-4 digit numbers) */
  total?: number | null
  /** Try the best sources one after another without asking */
  auto: boolean
  /** Sources that already failed for this episode */
  skip: Set<string>
  onClose: () => void
  onPlay: (url: string, s: ParsedStream, key: string) => void
  /** The automatic choice gave up (or is off) and the user has to pick: called once */
  onNeedUser?: () => void
  /** The player's opening screen shows the progress: draw nothing while the automatic choice runs */
  quiet?: boolean
}

const clean = (e: any) => String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Sources from all addons for one episode, with debrid cache status (also used by the player overlay). */
export function useStreamList(type: string, ids: string[], byName?: { titles: string[]; episode: number | null }) {
  const [streams, setStreams] = useState<ParsedStream[] | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  useEffect(() => {
    let live = true
    setStreams(null)
    ;(async () => {
      const groups = await window.api.getStreams(type, ids, byName)
      if (!live) return
      setErrors(groups.filter(g => g.error).map(g => `${g.addon}: ${g.error}`))
      let list = groups.flatMap(g => g.streams.map(s => parseStream(s, g.addon)))
      const hashes = [...new Set(list.filter(s => s.raw.infoHash && !s.direct).map(s => s.raw.infoHash!.toLowerCase()))]
      if (hashes.length) {
        const cached = new Set(await window.api.checkCached(hashes).catch(() => [] as string[]))
        list = list.map(s => (s.raw.infoHash && cached.has(s.raw.infoHash.toLowerCase()) ? { ...s, cached: true } : s))
      }
      if (live) setStreams(sortStreams(list))
    })().catch(e => {
      if (!live) return
      setErrors([clean(e)])
      setStreams([])
    })
    return () => {
      live = false
    }
  }, [type, ids.join('|'), byName?.titles.join('|'), byName?.episode])
  return { streams, errors }
}

/** What debrid / torrent needs to (re)make a link for a torrent source */
export const resolveRequest = (s: ParsedStream, episode: number | null): ResolveRequest | undefined =>
  s.raw.infoHash ? { infoHash: s.raw.infoHash, fileIdx: s.raw.fileIdx, filename: s.raw.behaviorHints?.filename, sources: s.raw.sources, episode: episode ?? undefined, cached: s.cached } : undefined

/** Turn a source into a playable URL (debrid for torrents). Throws with a readable message. */
export async function resolveStream(s: ParsedStream, episode: number | null): Promise<string> {
  if (s.raw.url) return s.raw.url
  if (!s.raw.infoHash) throw new Error('Bu kaynak oynatılamıyor.')
  try {
    return await window.api.resolve(resolveRequest(s, episode)!)
  } catch (e) {
    throw new Error(clean(e))
  }
}

export function StreamPicker({ type, ids, titles, title, episode, year, total, auto, skip, onClose, onPlay, onNeedUser, quiet, later }: Props) {
  const { settings, go } = useStore()
  const { streams, errors } = useStreamList(type, ids, titles?.length ? { titles, episode } : undefined)
  const [res, setRes] = useState<string>('all')
  const [busy, setBusy] = useState<ResolveProgress | null>(null)
  const [fail, setFail] = useState<string | null>(null)
  const [autoRun, setAutoRun] = useState<{ label: string; n: number; total: number } | null>(null)
  const [tried, setTried] = useState<string[]>([])
  // With the automatic choice the list stays hidden: only a small status pill shows, unless it fails.
  const [sheet, setSheet] = useState(!auto)
  const stopAuto = useRef(!auto)

  useEffect(() => window.api.onResolveProgress(setBusy), [])

  const ranked = useMemo(() => (streams ? rankStreams(streams, episode, settings?.preferredQuality ?? '1080p', skip, year, total, torrentMode(settings), titles, settings?.subLangs?.[0], later) : []), [streams, skip, settings?.preferredQuality, titles?.join("|"), settings?.subLangs?.[0], later])
  const best = ranked[0]?.s
  // Torrents of another anime (wrong addon mapping) go to the bottom, marked.
  const other = useMemo(() => {
    const m = new Map<ParsedStream, string>()
    for (const s of streams ?? []) {
      if (otherAnime(s, titles)) m.set(s, 'Başka anime')
      else if (otherSeason(s, titles)) m.set(s, 'Başka sezon')
    }
    return m
  }, [streams, titles?.join('|')])
  const shown = useMemo(
    () => (streams ?? []).filter(s => res === 'all' || s.resolution === res).sort((a, b) => Number(other.has(a)) - Number(other.has(b))),
    [streams, res, other]
  )
  const resCounts = useMemo(() => {
    const c: Record<string, number> = {}
    streams?.forEach(s => s.resolution && (c[s.resolution] = (c[s.resolution] ?? 0) + 1))
    return c
  }, [streams])

  /** Turn a source into a playable URL (debrid for torrents). Throws with a readable message. */
  const resolveUrl = async (s: ParsedStream): Promise<string> => {
    if (s.raw.url) return s.raw.url
    if (!s.raw.infoHash) throw new Error('Bu kaynak oynatılamıyor.')
    setBusy({ stage: 'adding', message: 'Hazırlanıyor…' })
    try {
      return await resolveStream(s, episode)
    } finally {
      setBusy(null)
    }
  }

  const pick = async (s: ParsedStream) => {
    stopAuto.current = true
    setAutoRun(null)
    setFail(null)
    if (s.raw.externalUrl && !s.raw.url && !s.raw.infoHash) return window.open(s.raw.externalUrl)
    try {
      onPlay(await resolveUrl(s), s, streamKey(s))
    } catch (e) {
      setFail(clean(e))
    }
  }

  // Automatic choice: try the best few in order; a failure moves on to the next one.
  useEffect(() => {
    if (!streams) return
    if (!auto || stopAuto.current) return void onNeedUser?.()
    const queue = ranked.filter(r => r.score > 0).slice(0, 4)
    if (!queue.length) {
      onNeedUser?.()
      setSheet(true)
      return void setFail('Uygun kaynak bulunamadı; listeden kendin seç.')
    }
    let cancelled = false
    ;(async () => {
      const errs: string[] = []
      for (let i = 0; i < queue.length; i++) {
        if (cancelled || stopAuto.current) return
        const s = queue[i].s
        setAutoRun({ label: s.label, n: i + 1, total: queue.length })
        try {
          const url = await resolveUrl(s)
          if (cancelled || stopAuto.current) return
          setAutoRun(null)
          return onPlay(url, s, streamKey(s))
        } catch (e) {
          errs.push(clean(e))
          setTried(t => [...t, streamKey(s)])
        }
      }
      setAutoRun(null)
      onNeedUser?.()
      setSheet(true)
      setFail('Otomatik seçilen kaynaklar açılamadı: ' + errs.join(' · ') + ' Listeden başka bir kaynak seç.')
    })()
    return () => {
      cancelled = true
    }
  }, [streams])

  const noAddons = settings && settings.addons.filter(a => a.enabled).length === 0
  const noDebrid = settings?.debridProvider === 'none'

  if (!sheet && quiet) return null
  if (!sheet)
    return (
      <div className="autopill" role="status">
        <div className="spinner sm" />
        <div>
          <strong>{title}</strong>
          <small>{busy?.message ?? (autoRun ? `En iyi kaynak açılıyor (${autoRun.n}/${autoRun.total})` : 'Kaynaklar aranıyor…')}</small>
        </div>
        <button className="btn ghost sm" onClick={() => { stopAuto.current = true; setAutoRun(null); setSheet(true) }}>Kendim seçeyim</button>
        <button className="iconbtn" onClick={() => { stopAuto.current = true; onClose() }} aria-label="İptal">✕</button>
      </div>
    )

  return (
    <div className="sheet" role="dialog" aria-label="Kaynak seç">
      <div className="sheet-head">
        <div>
          <h3>Kaynak seç</h3>
          <p>{title}</p>
        </div>
        <button className="iconbtn" onClick={onClose} aria-label="Kapat">✕</button>
      </div>

      {noAddons ? (
        <div className="state">
          Kurulu eklenti yok.
          <br />
          <button className="btn" onClick={() => go({ name: 'settings', tab: 'addons' })}>Eklenti ekle</button>
        </div>
      ) : (
        <>
          {noDebrid && (
            <div className="hint">Debrid bağlı değil: torrent kaynakları doğrudan eşlerden indirilerek oynatılır. Hız seed sayısına bağlıdır.</div>
          )}
          <div className="chips">
            {['all', '2160p', '1080p', '720p', '480p'].map(r =>
              r === 'all' || resCounts[r] ? (
                <button key={r} className="chip" aria-pressed={res === r} onClick={() => setRes(r)}>
                  {r === 'all' ? `Tümü ${streams?.length ?? ''}` : `${r} ${resCounts[r]}`}
                </button>
              ) : null
            )}
          </div>
          {autoRun && (
            <div className="autorun">
              <div>
                <strong>Otomatik seçiliyor ({autoRun.n}/{autoRun.total})</strong>
                <small>{autoRun.label}</small>
              </div>
              <button className="btn ghost sm" onClick={() => { stopAuto.current = true; setAutoRun(null) }}>Kendim seçeyim</button>
            </div>
          )}
          {busy && (
            <div className="resolving">
              <div>{busy.message}</div>
              {busy.progress != null && (
                <div className="prog">
                  <i style={{ width: busy.progress + '%' }} />
                </div>
              )}
            </div>
          )}
          {fail && <div className="error">{fail}</div>}
          <div className="streams">
            {!streams && <div className="state">Eklentilerden kaynaklar isteniyor…</div>}
            {streams?.length === 0 && <div className="state">Bu bölüm için kaynak bulunamadı.</div>}
            {shown.map((s, i) => (
              <button key={i} className={"stream" + (s === best ? " best" : "") + (skip.has(streamKey(s)) || tried.includes(streamKey(s)) ? " failed" : "")} disabled={!!busy} onClick={() => pick(s)}>
                <div className="stream-badges">
                  {s.resolution && <span className="res">{s.resolution}</span>}
                  {s.cached && <span className="cached" title="Debrid önbelleğinde, anında açılır">⚡</span>}
                  {s.direct && !s.cached && <span className="direct">Link</span>}
                  {s === best && <span className="bestb">Önerilen</span>}
                </div>
                <div className="stream-body">
                  <div className="stream-title">{s.label}</div>
                  <div className="stream-meta">
                    <span>{s.addon}</span>
                    {s.size && <span>{s.size}</span>}
                    {s.seeders != null && <span>{s.seeders} seed</span>}
                    {other.has(s) && <span className="t warn">{other.get(s)}</span>}
                    {subLangIn(s, settings?.subLangs?.[0]) === 'named' && <span className="t">{LANG_LABEL[settings!.subLangs[0]] ?? settings!.subLangs[0]} altyazı</span>}
                    {s.tags.map(t => (
                      <span key={t} className={/HDR|Dolby Vision/.test(t) ? 't warn' : 't'}>{t}</span>
                    ))}
                  </div>
                </div>
              </button>
            ))}
          </div>
          {errors.length > 0 && <div className="hint">Yanıt vermeyen eklentiler: {errors.join(' · ')}</div>}
        </>
      )}
    </div>
  )
}

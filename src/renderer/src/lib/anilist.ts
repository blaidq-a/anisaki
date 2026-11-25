// AniList (catalog) + ani.zip (episode titles and id mappings to kitsu / imdb).

export interface Anime {
  id: number
  idMal: number | null
  title: string
  romaji: string
  native: string | null
  cover: string
  banner: string | null
  color: string | null
  score: number | null
  format: string | null
  episodes: number | null
  /** Minutes per episode */
  duration: number | null
  nextEpisode: number | null
  /** When the next episode airs (unix seconds) */
  nextAiringAt: number | null
  /** First air date as yyyymmdd (for ordering a franchise) */
  start: number | null
  status: string | null
  season: string | null
  year: number | null
  genres: string[]
  studios: string
  studioList: { id: number; name: string }[]
  description: string
  /** YouTube video id */
  trailer: string | null
}

const FIELDS = `id idMal title { romaji english native } coverImage { extraLarge large color } bannerImage
  averageScore format episodes duration status season seasonYear genres
  nextAiringEpisode { episode airingAt } startDate { year month day } studios(isMain:true) { nodes { id name } } description(asHtml:false) trailer { id site }`

import { aniObserve, aniPause, aniSlot, retryAfter } from '../../../shared/anilimit'

const cache = new Map<string, unknown>()

// Every request goes through the app-wide AniList gate (src/shared/anilimit.ts): paced under AniList's
// limit, one shared pause with a countdown after a 429. The same request asked twice at once is sent once.
const inflight = new Map<string, Promise<unknown>>()

export async function gql<T>(query: string, variables: Record<string, unknown>, token?: string): Promise<T> {
  const key = query + JSON.stringify(variables)
  if (!token && cache.has(key)) return cache.get(key) as T
  if (!token && inflight.has(key)) return inflight.get(key) as Promise<T>
  // Rate limit (429), AniList being down (5xx) or no connection: never an error on screen. Every request
  // waits for the same moment (Retry-After, else growing pauses), the app shows a countdown, then retries.
  const job = (async () => {
    for (let attempt = 0; ; attempt++) {
      await aniSlot()
      let res: Response | null = null
      try {
        res = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
          body: JSON.stringify({ query, variables })
        })
      } catch {
        res = null
      }
      if (!res || res.status === 429 || res.status >= 500) {
        if (res?.status === 429) aniPause(retryAfter(res), 'limit')
        else aniPause(Math.min(60, 5 * 2 ** Math.min(attempt, 4)), 'down')
        continue
      }
      aniObserve(res)
      if (!res.ok) throw new Error('AniList yanıt vermedi (' + res.status + ')')
      const json = await res.json()
      if (!token) cache.set(key, json.data)
      return json.data as T
    }
  })()
  if (!token) {
    inflight.set(key, job)
    job.finally(() => inflight.delete(key)).catch(() => {})
  }
  return job
}

export function norm(a: any): Anime {
  return {
    id: a.id,
    idMal: a.idMal,
    title: a.title.english || a.title.romaji,
    romaji: a.title.romaji,
    native: a.title.native,
    cover: a.coverImage?.extraLarge || a.coverImage?.large,
    banner: a.bannerImage,
    color: a.coverImage?.color,
    score: a.averageScore ? a.averageScore / 10 : null,
    format: a.format,
    episodes: a.episodes,
    duration: a.duration ?? null,
    nextEpisode: a.nextAiringEpisode?.episode ?? null,
    nextAiringAt: a.nextAiringEpisode?.airingAt ?? null,
    start: a.startDate?.year ? a.startDate.year * 10000 + (a.startDate.month ?? 12) * 100 + (a.startDate.day ?? 28) : null,
    status: a.status,
    season: a.season,
    year: a.seasonYear,
    genres: a.genres ?? [],
    studios: (a.studios?.nodes ?? []).map((s: any) => s.name).join(', '),
    studioList: (a.studios?.nodes ?? []).map((s: any) => ({ id: s.id, name: s.name })),
    description: (a.description ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{2,}/g, '\n').trim(),
    trailer: a.trailer?.site === 'youtube' ? a.trailer.id : null
  }
}

export function currentSeason(): { season: string; year: number } {
  const d = new Date()
  const m = d.getMonth() + 1
  if (m === 12) return { season: 'WINTER', year: d.getFullYear() + 1 }
  return { season: m <= 2 ? 'WINTER' : m <= 5 ? 'SPRING' : m <= 8 ? 'SUMMER' : 'FALL', year: d.getFullYear() }
}

export async function browse(vars: { sort: string[]; season?: string; year?: number; status?: string; search?: string; page?: number; perPage?: number }): Promise<{ items: Anime[]; hasNext: boolean }> {
  const q = `query ($page:Int, $perPage:Int, $sort:[MediaSort], $season:MediaSeason, $year:Int, $status:MediaStatus, $search:String) {
    Page(page:$page, perPage:$perPage) { pageInfo { hasNextPage }
      media(type:ANIME, isAdult:false, sort:$sort, season:$season, seasonYear:$year, status:$status, search:$search) { ${FIELDS} } } }`
  const data = await gql<any>(q, { page: 1, perPage: 24, ...vars })
  return { items: data.Page.media.map(norm), hasNext: data.Page.pageInfo.hasNextPage }
}

export async function getAnime(id: number): Promise<Anime & { relations: Anime[] }> {
  const q = `query ($id:Int) { Media(id:$id, type:ANIME) { ${FIELDS}
    relations { edges { relationType node { ${FIELDS} type } } } } }`
  const data = await gql<any>(q, { id })
  const relations = (data.Media.relations?.edges ?? [])
    .filter((e: any) => e.node.type === 'ANIME' && ['SEQUEL', 'PREQUEL', 'SIDE_STORY', 'PARENT', 'SPIN_OFF'].includes(e.relationType))
    .map((e: any) => ({ ...norm(e.node), relation: e.relationType }))
  return { ...norm(data.Media), relations }
}

export interface EpisodeInfo {
  number: number
  title: string | null
  image: string | null
  airDate: string | null
  overview: string | null
  tvdbSeason: number | null
  tvdbEpisode: number | null
}

export interface Mappings {
  kitsu: number | null
  imdb: string | null
  episodes: EpisodeInfo[]
  /** Full-HD background art and transparent title logo (TheTVDB via ani.zip), when there are any */
  fanart: string | null
  logo: string | null
}

/** Episode list and external ids. Stremio anime addons mostly use kitsu ids. */
export async function getMappings(anilistId: number): Promise<Mappings> {
  const key = 'anizip' + anilistId
  if (cache.has(key)) return cache.get(key) as Mappings
  let json: any = {}
  try {
    const res = await fetch('https://api.ani.zip/mappings?anilist_id=' + anilistId)
    if (res.ok) json = await res.json()
  } catch {
    /* fall back to AniList episode count */
  }
  const episodes: EpisodeInfo[] = Object.entries(json.episodes ?? {})
    .filter(([k]) => /^\d+$/.test(k))
    .map(([k, e]: [string, any]) => ({
      number: Number(k),
      title: e.title?.en || e.title?.['x-jat'] || null,
      image: e.image ?? null,
      airDate: e.airDate ?? e.airdate ?? null,
      overview: e.overview ?? e.summary ?? null,
      tvdbSeason: e.seasonNumber ?? null,
      tvdbEpisode: e.episodeNumber ?? null
    }))
    .sort((a, b) => a.number - b.number)
  const img = (t: string) => (json.images ?? []).find((i: any) => i.coverType === t)?.url ?? null
  const m: Mappings = { kitsu: json.mappings?.kitsu_id ?? null, imdb: json.mappings?.imdb_id ?? null, episodes, fanart: img('Fanart'), logo: img('Clearlogo') }
  cache.set(key, m)
  return m
}

/**
 * Episode thumbnails and titles from Kitsu for the episodes ani.zip has no picture for (often the newest
 * ones, or later seasons of old shows). Kitsu's id comes from ani.zip or from Kitsu's own MyAnimeList
 * mapping. Only used when Kitsu counts the episodes the same way (same total), so numbers line up.
 */
export async function kitsuEpisodeArt(anime: Pick<Anime, 'id' | 'idMal' | 'episodes' | 'nextEpisode'>, m: Mappings): Promise<Map<number, { image: string | null; title: string | null }>> {
  const out = new Map<number, { image: string | null; title: string | null }>()
  const key = 'kitsuart' + anime.id
  if (cache.has(key)) return cache.get(key) as typeof out
  const get = (url: string) => fetch(url, { signal: AbortSignal.timeout(10000) }).then(r => (r.ok ? r.json() : null)).catch(() => null)
  try {
    let kitsu = m.kitsu
    if (!kitsu && anime.idMal) {
      const j = await get(`https://kitsu.io/api/edge/mappings?filter[externalSite]=myanimelist/anime&filter[externalId]=${anime.idMal}&include=item`)
      kitsu = j?.included?.[0]?.id ? Number(j.included[0].id) : null
    }
    if (!kitsu) return out
    const info = await get(`https://kitsu.io/api/edge/anime/${kitsu}`)
    const kCount = info?.data?.attributes?.episodeCount ?? null
    const total = anime.episodes ?? null
    if (kCount != null && total != null && kCount !== total) return out
    const aired = anime.nextEpisode ? anime.nextEpisode - 1 : total ?? kCount ?? 0
    for (let off = 0; off < Math.min(aired, 400); off += 20) {
      const page = await get(`https://kitsu.io/api/edge/anime/${kitsu}/episodes?page[limit]=20&page[offset]=${off}&sort=number`)
      const rows = page?.data ?? []
      for (const e of rows) {
        const a = e.attributes ?? {}
        if (a.number) out.set(a.number, { image: a.thumbnail?.original ?? null, title: a.canonicalTitle || a.titles?.en_us || a.titles?.en || null })
      }
      if (rows.length < 20) break
    }
  } finally {
    cache.set(key, out)
  }
  return out
}

/** Candidate Stremio ids for one episode, best first. */
export function streamIds(anime: Anime, m: Mappings, ep: number): { type: string; ids: string[] } {
  const isMovie = anime.format === 'MOVIE'
  const ids: string[] = []
  const info = m.episodes.find(e => e.number === ep)
  if (m.kitsu) ids.push(isMovie ? `kitsu:${m.kitsu}` : `kitsu:${m.kitsu}:${ep}`)
  if (m.imdb) {
    if (isMovie) ids.push(m.imdb)
    else ids.push(`${m.imdb}:${info?.tvdbSeason ?? 1}:${info?.tvdbEpisode ?? ep}`)
  }
  ids.push(isMovie ? `anilist:${anime.id}` : `anilist:${anime.id}:${ep}`)
  if (anime.idMal) ids.push(isMovie ? `mal:${anime.idMal}` : `mal:${anime.idMal}:${ep}`)
  return { type: isMovie ? 'movie' : 'series', ids }
}

export const SEASON_TR: Record<string, string> = { WINTER: 'Kış', SPRING: 'İlkbahar', SUMMER: 'Yaz', FALL: 'Sonbahar' }
export const STATUS_TR: Record<string, string> = { RELEASING: 'Yayında', FINISHED: 'Tamamlandı', NOT_YET_RELEASED: 'Yakında', CANCELLED: 'İptal', HIATUS: 'Ara verdi' }
export const FORMAT_TR: Record<string, string> = { TV: 'TV', TV_SHORT: 'Kısa TV', MOVIE: 'Film', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Özel', MUSIC: 'Müzik' }

export interface AiredEpisode {
  episode: number
  airingAt: number
  anime: Anime
}

/** Episodes that aired most recently (AniList airing schedule). */
export async function latestEpisodes(perPage = 18): Promise<AiredEpisode[]> {
  const q = `query ($now:Int, $perPage:Int) { Page(page:1, perPage:$perPage) {
    airingSchedules(airingAt_lesser:$now, sort:TIME_DESC) { episode airingAt media { ${FIELDS} isAdult countryOfOrigin } } } }`
  const now = Math.floor(Date.now() / 1000 / 600) * 600 // round to 10 min so the request is cacheable
  const data = await gql<any>(q, { now, perPage: perPage * 2 })
  return data.Page.airingSchedules
    .filter((s: any) => s.media && !s.media.isAdult && s.media.countryOfOrigin === 'JP')
    .slice(0, perPage)
    .map((s: any) => ({ episode: s.episode, airingAt: s.airingAt, anime: norm(s.media) }))
}

/** Banner/cover info for a set of ids (used for "continue watching" cards). */
export async function animeByIds(ids: number[]): Promise<Record<number, Anime>> {
  if (!ids.length) return {}
  const q = `query ($ids:[Int]) { Page(page:1, perPage:50) { media(id_in:$ids, type:ANIME) { ${FIELDS} } } }`
  const data = await gql<any>(q, { ids })
  return Object.fromEntries(data.Page.media.map((m: any) => [m.id, norm(m)]))
}

export function timeAgo(unix: number): string {
  const s = Math.max(0, Date.now() / 1000 - unix)
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} dk önce`
  if (s < 86400) return `${Math.round(s / 3600)} sa önce`
  return `${Math.round(s / 86400)} gün önce`
}


/* ---------------------------------- discover ---------------------------------- */
export const GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller']
export const GENRE_TR: Record<string, string> = {
  Action: 'Aksiyon', Adventure: 'Macera', Comedy: 'Komedi', Drama: 'Dram', Ecchi: 'Ecchi', Fantasy: 'Fantastik', Horror: 'Korku',
  'Mahou Shoujo': 'Büyücü kız', Mecha: 'Mecha', Music: 'Müzik', Mystery: 'Gizem', Psychological: 'Psikolojik', Romance: 'Romantik',
  'Sci-Fi': 'Bilim kurgu', 'Slice of Life': 'Gündelik yaşam', Sports: 'Spor', Supernatural: 'Doğaüstü', Thriller: 'Gerilim'
}
export const SORT_TR: Record<string, string> = {
  TRENDING_DESC: 'Trend', POPULARITY_DESC: 'Popülerlik', SCORE_DESC: 'En yüksek puan', START_DATE_DESC: 'En yeni', FAVOURITES_DESC: 'En çok favori', SCORE: 'En düşük puan', POPULARITY: 'En az bilinen', TITLE_ROMAJI: 'Ada göre (A-Z)'
}

export interface DiscoverFilters {
  search?: string
  sort?: string
  genres?: string[]
  format?: string
  season?: string
  year?: number
  status?: string
  minScore?: number
  studio?: { id: number; name: string }
}

/** AniList search with the filters of the Keşfet page; a studio switches to that studio's works. */
export async function discover(f: DiscoverFilters, page = 1): Promise<{ items: Anime[]; hasNext: boolean; last?: number }> {
  const sort = [f.search && !f.sort ? 'SEARCH_MATCH' : f.sort ?? 'POPULARITY_DESC']
  if (f.studio) {
    const q = `query ($id:Int, $page:Int, $sort:[MediaSort]) { Studio(id:$id) { media(page:$page, perPage:30, sort:$sort, isMain:true) {
      pageInfo { hasNextPage lastPage } nodes { ${FIELDS} type isAdult } } } }`
    const data = await gql<any>(q, { id: f.studio.id, page, sort: sort[0] === 'SEARCH_MATCH' ? ['POPULARITY_DESC'] : sort })
    const m = data.Studio?.media
    const items = (m?.nodes ?? []).filter((x: any) => x.type === 'ANIME' && !x.isAdult).map(norm)
    return { items: filterLocal(items, f), hasNext: !!m?.pageInfo?.hasNextPage, last: m?.pageInfo?.lastPage }
  }
  const q = `query ($page:Int, $sort:[MediaSort], $search:String, $genres:[String], $format:MediaFormat, $season:MediaSeason, $year:Int, $status:MediaStatus, $score:Int, $pop:Int) {
    Page(page:$page, perPage:30) { pageInfo { hasNextPage lastPage }
      media(type:ANIME, isAdult:false, sort:$sort, search:$search, genre_in:$genres, format:$format, season:$season, seasonYear:$year, status:$status, averageScore_greater:$score, popularity_greater:$pop) { ${FIELDS} } } }`
  const vars: Record<string, unknown> = { page, sort }
  if (f.search) vars.search = f.search
  if (f.genres?.length) vars.genres = f.genres
  if (f.format) vars.format = f.format
  if (f.season) vars.season = f.season
  if (f.year) vars.year = f.year
  if (f.status) vars.status = f.status
  if (f.minScore) vars.score = f.minScore * 10 - 1
  // "Worst rated" / "least known": only shows enough people rated, else it is a list of unknown shorts
  if (f.sort === 'SCORE') (vars.score ??= 1), (vars.pop = 2000)
  if (f.sort === 'POPULARITY') vars.pop = 300
  const data = await gql<any>(q, vars)
  return { items: data.Page.media.map(norm), hasNext: data.Page.pageInfo.hasNextPage, last: data.Page.pageInfo.lastPage }
}

/** Studio listings can't be filtered by AniList; apply the other filters here. */
function filterLocal(items: Anime[], f: DiscoverFilters) {
  return items.filter(
    a =>
      (!f.genres?.length || f.genres.every(g => a.genres.includes(g))) &&
      (!f.format || a.format === f.format) &&
      (!f.season || a.season === f.season) &&
      (!f.year || a.year === f.year) &&
      (!f.status || a.status === f.status) &&
      (!f.minScore || (a.score ?? 0) >= f.minScore) &&
      (!f.search || (a.title + ' ' + a.romaji).toLowerCase().includes(f.search.toLowerCase()))
  )
}

/** Character names, kept as is by the subtitle translation. */
export async function characterNames(id: number): Promise<string[]> {
  const q = `query ($id:Int) { Media(id:$id) { characters(perPage:40, sort:[ROLE, RELEVANCE]) { nodes { name { full first last alternative } } } } }`
  try {
    const data = await gql<any>(q, { id })
    // Aliases only as single words ("Okarun", "Ichi-nii"): longer ones are epithets ("Corrupt Priest",
    // "Substitute Soul Reaper") that should be translated, not kept in English.
    return (data.Media?.characters?.nodes ?? [])
      .flatMap((c: any) => [c.name.full, c.name.first, c.name.last, ...(c.name.alternative ?? []).filter((a: unknown) => typeof a === 'string' && !/\s/.test(a.trim()))])
      .filter((n: any) => typeof n === 'string' && n.length > 1)
  } catch {
    return []
  }
}

/* ---------------------------------- franchise ---------------------------------- */
export type Related = Anime & { relation?: string }
const FRANCHISE_REL = ['SEQUEL', 'PREQUEL', 'SIDE_STORY', 'PARENT', 'ALTERNATIVE', 'SPIN_OFF', 'SUMMARY']
// Story parts walked through to find the whole franchise; spin-offs / alternatives are listed but not followed.
const FOLLOW = ['SEQUEL', 'PREQUEL', 'SIDE_STORY', 'PARENT']

/**
 * Every anime of the franchise (all seasons, films, OVAs…), not only the direct neighbours AniList
 * lists on a page: the relation graph is walked level by level (one request per level).
 */
export async function franchise(id: number): Promise<Related[]> {
  const key = 'franchise' + id
  if (cache.has(key)) return cache.get(key) as Related[]
  const seen = new Map<number, Related>()
  const rel = new Map<number, string>()
  let level = [id]
  const done = new Set<number>()
  for (let depth = 0; level.length && depth < 8 && seen.size < 60; depth++) {
    level.forEach(x => done.add(x))
    const q = `query ($ids:[Int]) { Page(page:1, perPage:50) { media(id_in:$ids, type:ANIME) { id
      relations { edges { relationType node { ${FIELDS} type isAdult } } } } } }`
    const data = await gql<any>(q, { ids: level })
    const next = new Set<number>()
    for (const m of data.Page.media)
      for (const e of m.relations?.edges ?? []) {
        const n = e.node
        if (n.type !== 'ANIME' || n.isAdult || n.id === id || !FRANCHISE_REL.includes(e.relationType)) continue
        if (!seen.has(n.id)) seen.set(n.id, norm(n))
        // the relation shown is the one to the opened anime when it has one
        if (m.id === id || !rel.has(n.id)) rel.set(n.id, m.id === id ? e.relationType : rel.get(n.id) ?? 'FRANCHISE')
        if (FOLLOW.includes(e.relationType) && !done.has(n.id)) next.add(n.id)
      }
    level = [...next].slice(0, 50)
  }
  const out = [...seen.values()].map(a => ({ ...a, relation: rel.get(a.id) })).sort((a, b) => (a.start ?? 99999999) - (b.start ?? 99999999))
  cache.set(key, out)
  return out
}

/**
 * Watch order: the main story (TV / ONA seasons, films, OVAs, specials that are part of it) by air date,
 * recaps and music videos left out. Chronological release order is what most guides recommend.
 */
export async function watchOrder(a: Anime): Promise<(Anime & { relation?: string; main: boolean })[]> {
  const all = [...(await franchise(a.id)), { ...a, relation: 'SELF' }]
  return all
    .filter(x => x.format !== 'MUSIC' && x.relation !== 'SUMMARY')
    .map(x => ({ ...x, main: ['TV', 'ONA', 'MOVIE'].includes(x.format ?? '') && x.relation !== 'SPIN_OFF' && x.relation !== 'ALTERNATIVE' }))
    .sort((x, y) => (x.start ?? 99999999) - (y.start ?? 99999999))
}

/* ---------------------------------- calendar ---------------------------------- */
export interface Airing { episode: number; airingAt: number; anime: Anime }
/** Episodes airing between two times (unix seconds), Japanese TV only, oldest first. */
export async function airingBetween(from: number, to: number): Promise<Airing[]> {
  const out: Airing[] = []
  for (let page = 1; page <= 8; page++) {
    const q = `query ($page:Int, $from:Int, $to:Int) { Page(page:$page, perPage:50) { pageInfo { hasNextPage }
      airingSchedules(airingAt_greater:$from, airingAt_lesser:$to, sort:TIME) { episode airingAt media { ${FIELDS} isAdult countryOfOrigin } } } }`
    const data = await gql<any>(q, { page, from, to })
    for (const s of data.Page.airingSchedules)
      if (s.media && !s.media.isAdult && s.media.countryOfOrigin === 'JP') out.push({ episode: s.episode, airingAt: s.airingAt, anime: norm(s.media) })
    if (!data.Page.pageInfo.hasNextPage) break
  }
  return out
}

/* ---------------------------------- random ---------------------------------- */
/** A random anime matching Keşfet's filters (among the reasonably known ones). */
export async function randomAnime(f: DiscoverFilters): Promise<Anime | null> {
  const base = { ...f, sort: 'POPULARITY_DESC', search: undefined }
  // AniList says how many pages there are (one request); the shows past ~100 pages are too obscure to suggest
  const first = await discover(base, 1)
  if (!first.items.length) return null
  const pages = Math.max(1, Math.min(first.last ?? 1, 100))
  const page = 1 + Math.floor(Math.random() * pages)
  const r = page === 1 ? first : await discover(base, page)
  const list = r.items.length ? r.items : first.items
  return list[Math.floor(Math.random() * list.length)]
}

/* ---------------------------------- notifications ---------------------------------- */
export interface AniNotification { id: number; kind: string; text: string; at: number; anime?: { id: number; title: string; cover: string } ; episode?: number; user?: { name: string; avatar: string | null } }
/** The signed-in user's AniList notifications (new episodes, follows, likes, replies…). */
export async function notifications(token: string, page = 1): Promise<{ items: AniNotification[]; unread: number; hasNext: boolean }> {
  const media = `media { id title { romaji english } coverImage { large } }`
  const user = `user { name avatar { medium } }`
  const q = `query ($page:Int) { Viewer { unreadNotificationCount } Page(page:$page, perPage:30) { pageInfo { hasNextPage }
    notifications(resetNotificationCount:true) {
      ... on AiringNotification { id type createdAt episode contexts ${media} }
      ... on RelatedMediaAdditionNotification { id type createdAt context ${media} }
      ... on MediaDataChangeNotification { id type createdAt context reason ${media} }
      ... on FollowingNotification { id type createdAt context ${user} }
      ... on ActivityLikeNotification { id type createdAt context ${user} }
      ... on ActivityReplyNotification { id type createdAt context ${user} }
      ... on ActivityMentionNotification { id type createdAt context ${user} }
      ... on ActivityMessageNotification { id type createdAt context ${user} }
      ... on ThreadCommentReplyNotification { id type createdAt context ${user} }
    } } }`
  const data = await gql<any>(q, { page }, token)
  const items: AniNotification[] = (data.Page.notifications ?? []).filter((n: any) => n?.id).map((n: any) => {
    const m = n.media ? { id: n.media.id, title: n.media.title.english || n.media.title.romaji, cover: n.media.coverImage?.large } : undefined
    const u = n.user ? { name: n.user.name, avatar: n.user.avatar?.medium ?? null } : undefined
    let text: string
    if (n.type === 'AIRING') text = `${n.episode}. bölüm yayınlandı`
    else if (n.type === 'RELATED_MEDIA_ADDITION') text = 'AniList’e eklendi (izlediğin bir seriyle ilişkili)'
    else if (n.type === 'MEDIA_DATA_CHANGE') text = 'Bilgileri güncellendi' + (n.reason ? ': ' + n.reason : '')
    else text = (u?.name ?? '') + (n.context ?? '')
    return { id: n.id, kind: n.type, text, at: n.createdAt, anime: m, episode: n.episode, user: u }
  })
  return { items, unread: data.Viewer?.unreadNotificationCount ?? 0, hasNext: data.Page.pageInfo.hasNextPage }
}

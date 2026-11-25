// AniList API calls without Electron: shared by the desktop app and the phone app.
import type { LibraryEntry } from '../shared/types'
import { aniObserve, aniPause, aniSlot, retryAfter } from '../shared/anilimit'

const API = 'https://graphql.anilist.co'

export async function gql<T = any>(token: string | null, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  let res!: Response
  // Over AniList's rate limit (429): wait as long as it asks (Retry-After) and try again
  for (let attempt = 0; attempt < 12; attempt++) {
    await aniSlot() // the app-wide AniList gate (src/shared/anilimit.ts)
    res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20000)
    })
    aniObserve(res)
    if (res.status !== 429) break
    // everybody waits as long as AniList asks; the app shows a countdown and this call carries on afterwards
    aniPause(retryAfter(res))
  }
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok || json.errors) throw new Error('AniList: ' + (json.errors?.[0]?.message ?? `HTTP ${res.status}`))
  return json.data
}

export interface Account {
  userId: number
  name: string
  avatar: string | null
  token: string
}

/** The logged-in user of a token */
export async function viewer(token: string): Promise<Account> {
  const d = await gql(token, 'query { Viewer { id name avatar { medium } } }')
  return { userId: d.Viewer.id, name: d.Viewer.name, avatar: d.Viewer.avatar?.medium ?? null, token }
}

const TO_AL: Record<LibraryEntry['status'], string> = { watching: 'CURRENT', plan: 'PLANNING', done: 'COMPLETED', hold: 'PAUSED', drop: 'DROPPED' }
const FROM_AL: Record<string, LibraryEntry['status']> = { CURRENT: 'watching', REPEATING: 'watching', PLANNING: 'plan', COMPLETED: 'done', PAUSED: 'hold', DROPPED: 'drop' }

/** Push one entry (status, progress, score) to AniList. */
export async function pushEntry(token: string, e: LibraryEntry): Promise<void> {
  await gql(
    token,
    // scoreRaw is always 0–100, whatever score format the account uses ("score" follows the account's
    // format: a 10-point score sent to a 100-point account became 8/100).
    `mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $scoreRaw: Int) {
      SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, scoreRaw: $scoreRaw) { id }
    }`,
    { mediaId: e.id, status: TO_AL[e.status], progress: e.progress, ...(e.score != null ? { scoreRaw: Math.round(e.score * 10) } : {}) }
  )
}

export async function deleteEntry(token: string, userId: number, mediaId: number): Promise<void> {
  const d = await gql(token, 'query ($userId: Int, $mediaId: Int) { MediaList(userId: $userId, mediaId: $mediaId) { id } }', { userId, mediaId }).catch(() => null)
  const id = d?.MediaList?.id
  if (id) await gql(token, 'mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }', { id })
}

/** The user's whole anime list on AniList, as library entries. */
export async function pullList(token: string, userId: number): Promise<Record<string, LibraryEntry>> {
  const d = await gql(
    token,
    `query ($userId: Int) {
      MediaListCollection(userId: $userId, type: ANIME) { lists { entries {
        mediaId status progress score(format: POINT_10) updatedAt
        media { episodes title { romaji english } coverImage { extraLarge large } }
      } } }
    }`,
    { userId }
  )
  const out: Record<string, LibraryEntry> = {}
  for (const list of d.MediaListCollection.lists ?? [])
    for (const e of list.entries ?? []) {
      out[e.mediaId] = {
        id: e.mediaId,
        title: e.media.title.english || e.media.title.romaji,
        cover: e.media.coverImage?.extraLarge || e.media.coverImage?.large || '',
        episodes: e.media.episodes,
        status: FROM_AL[e.status] ?? 'watching',
        progress: e.progress ?? 0,
        score: e.score || null,
        updated: (e.updatedAt ?? 0) * 1000
      }
    }
  return out
}

/** Merge AniList and local lists: for each anime the more recently changed side wins. */
export function merge(local: Record<string, LibraryEntry>, remote: Record<string, LibraryEntry>): { merged: Record<string, LibraryEntry>; toPush: LibraryEntry[] } {
  const merged: Record<string, LibraryEntry> = { ...remote }
  const toPush: LibraryEntry[] = []
  for (const [id, l] of Object.entries(local)) {
    const r = remote[id]
    if (!r || l.updated > r.updated + 1000) {
      merged[id] = l
      toPush.push(l)
    }
  }
  return { merged, toPush }
}

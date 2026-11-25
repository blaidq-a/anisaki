// MyAnimeList: sign-in (OAuth code + PKCE "plain", the only kind MAL takes), token refresh, and the list
// both ways. The app's lists are keyed by AniList id, so MAL ids are mapped through AniList (idMal).
import { invoke } from '@tauri-apps/api/core'
import type { LibraryEntry } from '../../../shared/types'
import { gql } from '../lib/anilist'
import { LOGIN_REDIRECT, signIn } from './login'

// The client id lives in a git-ignored file (mal-client.gen.ts); without it MAL sign-in is off.
const mods = import.meta.glob('./mal-client.gen.ts', { eager: true }) as Record<string, { MAL_CLIENT_ID?: string }>
export const malClientId = () => Object.values(mods)[0]?.MAL_CLIENT_ID ?? ''

// MyAnimeList sends the browser to Anisaki's sign-in page, which passes it on to the app (see login.ts)
const REDIRECT = LOGIN_REDIRECT
const API = 'https://api.myanimelist.net/v2'
export type MalToken = { access: string; refresh: string; expires: number }
export type MalAccount = { userId: number; name: string; avatar: string | null }

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
const random = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => CHARS[b % CHARS.length]).join('')

async function token(params: Record<string, string>): Promise<MalToken> {
  const res = await fetch('https://myanimelist.net/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: malClientId(), ...params }).toString()
  })
  const j: any = await res.json().catch(() => ({}))
  if (!res.ok || !j.access_token) throw new Error('MyAnimeList: ' + (j.message || j.error || 'HTTP ' + res.status))
  return { access: j.access_token, refresh: j.refresh_token, expires: Date.now() + (j.expires_in ?? 2_592_000) * 1000 }
}

// The sign-in in progress is kept on the device: a phone can put the app to sleep or close it while the
// browser is open (Samsung did), and the browser then showed "127.0.0.1 refused to connect". The address
// it shows still carries the code, so pasting it into the app finishes the sign-in (see malFinish).
const PENDING = 'malPending'
type Pending = { verifier: string; state: string; at: number }
const loadPending = (): Pending | null => {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING) ?? 'null') as Pending | null
    return p && Date.now() - p.at < 30 * 60_000 ? p : null
  } catch {
    return null
  }
}
/** A sign-in was started in the last 30 minutes and not finished (its address can be pasted). */
export const malPending = () => !!loadPending()

/** Opens MAL's sign-in page in the browser and waits for it to come back to the app. */
export async function malLogin(): Promise<{ account: MalAccount; token: MalToken }> {
  if (!malClientId()) throw new Error('MyAnimeList Client ID tanımlı değil.')
  const verifier = random(96)
  const state = random(16)
  try {
    localStorage.setItem(PENDING, JSON.stringify({ verifier, state, at: Date.now() }))
  } catch {}
  const q = await signIn(
    'MyAnimeList',
    `https://myanimelist.net/v1/oauth2/authorize?response_type=code&client_id=${malClientId()}&code_challenge=${verifier}&code_challenge_method=plain&state=${state}&redirect_uri=${encodeURIComponent(REDIRECT)}`,
    lan => invoke<string>('mal_wait_code', { lan })
  )
  return malFinish(q)
}

/** Finishes a sign-in from the callback's query, or from the whole address pasted from the browser. */
export async function malFinish(callback: string): Promise<{ account: MalAccount; token: MalToken }> {
  const q = new URLSearchParams(callback.includes('?') ? callback.slice(callback.indexOf('?') + 1) : callback)
  if (q.get('error')) throw new Error('MyAnimeList girişi onaylanmadı.')
  const p = loadPending()
  if (!p || q.get('state') !== p.state || !q.get('code')) throw new Error('MyAnimeList girişi doğrulanamadı, tekrar dene.')
  const t = await token({ grant_type: 'authorization_code', code: q.get('code')!, redirect_uri: REDIRECT, code_verifier: p.verifier })
  try {
    localStorage.removeItem(PENDING)
  } catch {}
  const me = await api<any>(t.access, '/users/@me?fields=picture')
  return { account: { userId: me.id, name: me.name, avatar: me.picture ?? null }, token: t }
}

/** A token that is still good for a day; refreshed (MAL tokens last 31 days) when it isn't. */
export async function freshToken(t: MalToken, save: (t: MalToken) => void): Promise<string> {
  if (t.expires - Date.now() > 86_400_000) return t.access
  const n = await token({ grant_type: 'refresh_token', refresh_token: t.refresh })
  save(n)
  return n.access
}

async function api<T>(access: string, path: string, init: RequestInit = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(path.startsWith('http') ? path : API + path, { ...init, headers: { Authorization: 'Bearer ' + access, ...(init.headers ?? {}) } })
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
      continue
    }
    if (!res.ok) throw new Error('MyAnimeList: HTTP ' + res.status)
    return (res.status === 204 ? null : await res.json().catch(() => null)) as T
  }
}

const TO_MAL: Record<LibraryEntry['status'], string> = { watching: 'watching', plan: 'plan_to_watch', done: 'completed', hold: 'on_hold', drop: 'dropped' }
const FROM_MAL: Record<string, LibraryEntry['status']> = { watching: 'watching', plan_to_watch: 'plan', completed: 'done', on_hold: 'hold', dropped: 'drop' }

/** AniList id → MAL id (remembered: AniList is asked once per anime). */
const malIds = new Map<number, number | null>()
async function malIdOf(anilistId: number): Promise<number | null> {
  if (malIds.has(anilistId)) return malIds.get(anilistId)!
  const d = await gql<any>('query ($id:Int) { Media(id:$id, type:ANIME) { idMal } }', { id: anilistId }).catch(() => null)
  const m = d?.Media?.idMal ?? null
  malIds.set(anilistId, m)
  return m
}

/** MAL ids for many anime at once, 50 per AniList request (one request per anime hit AniList's rate limit). */
export async function resolveMalIds(anilistIds: number[]): Promise<void> {
  const todo = [...new Set(anilistIds)].filter(id => !malIds.has(id))
  for (let i = 0; i < todo.length; i += 50) {
    const chunk = todo.slice(i, i + 50)
    const d = await gql<any>('query ($ids:[Int]) { Page(page:1, perPage:50) { media(id_in:$ids, type:ANIME) { id idMal } } }', { ids: chunk }).catch(() => null)
    const found = new Map<number, number | null>((d?.Page?.media ?? []).map((m: any) => [m.id, m.idMal ?? null]))
    for (const id of chunk) malIds.set(id, found.get(id) ?? null)
  }
}

/** The user's whole MAL list as library entries keyed by AniList id (shows AniList doesn't know are skipped). */
export async function malPullList(access: string): Promise<Record<string, LibraryEntry>> {
  const rows: any[] = []
  let next: string | null = '/users/@me/animelist?fields=list_status,num_episodes&limit=1000&nsfw=true'
  while (next) {
    const page: any = await api(access, next)
    rows.push(...(page?.data ?? []))
    next = page?.paging?.next ?? null
  }
  const out: Record<string, LibraryEntry> = {}
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50)
    const d = await gql<any>(
      'query ($ids:[Int]) { Page(page:1, perPage:50) { media(idMal_in:$ids, type:ANIME) { id idMal episodes title { romaji english } coverImage { extraLarge large } } } }',
      { ids: chunk.map(r => r.node.id) }
    )
    const byMal = new Map<number, any>((d?.Page?.media ?? []).map((m: any) => [m.idMal, m]))
    for (const r of chunk) {
      const m = byMal.get(r.node.id)
      if (!m) continue
      malIds.set(m.id, r.node.id)
      const st = r.list_status ?? {}
      out[m.id] = {
        id: m.id,
        title: m.title.english || m.title.romaji,
        cover: m.coverImage?.extraLarge || m.coverImage?.large || '',
        episodes: m.episodes ?? r.node.num_episodes ?? null,
        status: FROM_MAL[st.status] ?? 'watching',
        progress: st.num_episodes_watched ?? 0,
        score: st.score || null,
        updated: st.updated_at ? Date.parse(st.updated_at) : 0
      }
    }
  }
  return out
}

/** Save one entry on MAL. */
export async function malPush(access: string, e: LibraryEntry): Promise<void> {
  const id = await malIdOf(e.id)
  if (!id) return
  const body = new URLSearchParams({ status: TO_MAL[e.status], num_watched_episodes: String(e.progress ?? 0), ...(e.score != null ? { score: String(Math.round(e.score)) } : {}) })
  await api(access, `/anime/${id}/my_list_status`, { method: 'PATCH', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() })
}

export async function malDelete(access: string, anilistId: number): Promise<void> {
  const id = await malIdOf(anilistId)
  if (id) await api(access, `/anime/${id}/my_list_status`, { method: 'DELETE' }).catch(() => {})
}

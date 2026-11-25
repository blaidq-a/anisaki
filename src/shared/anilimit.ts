// One gate for every AniList request of the app (catalog pages, list sync, MAL id lookups). AniList allows
// 90 requests a minute per IP, but only 30 while it is under load (it says which in X-RateLimit-Limit).
// Without a gate a page asking a dozen things plus a list sync went over it, and after the pause every
// waiting request went out together and hit it again, so the countdown started over and over.
//
// A token bucket that follows AniList's own numbers: a few requests right away (pages stay quick), then
// spaced to stay just under the current limit. After a 429 everybody waits the time AniList asks for.

let limit = 30 // assume the busy limit until AniList tells otherwise
let tokens = 5
let last = Date.now()
let pausedUntil = 0
let epoch = 0 // bumped by "İptal": requests still waiting for a turn give up
let queue: Promise<void> = Promise.resolve()
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const every = () => (60_000 / limit) * 1.1
const capacity = () => Math.max(2, Math.floor(limit / 6))

/** Wait for a turn to send one AniList request. */
export function aniSlot(): Promise<void> {
  const mine = epoch
  const turn = queue.then(async () => {
    for (;;) {
      if (mine !== epoch) throw new Error('İptal edildi')
      const now = Date.now()
      if (pausedUntil > now) {
        await sleep(Math.min(500, pausedUntil - now))
        continue
      }
      tokens = Math.min(capacity(), tokens + (now - last) / every())
      last = now
      if (tokens >= 1) {
        tokens -= 1
        return
      }
      await sleep(Math.min(500, (1 - tokens) * every()))
    }
  })
  queue = turn.catch(() => {})
  return turn
}

/** Read AniList's limit from an answer (it changes between 90 and 30) and slow down when almost used up. */
export function aniObserve(res: Response) {
  const l = Number(res.headers.get('X-RateLimit-Limit'))
  if (l > 0) limit = l
  const left = Number(res.headers.get('X-RateLimit-Remaining'))
  if (res.headers.has('X-RateLimit-Remaining') && left <= 1) tokens = Math.min(tokens, 0)
}

/** AniList answered 429 (or is down): everybody waits, and the bucket starts empty afterwards. */
export function aniPause(seconds: number, why: 'limit' | 'down' = 'limit') {
  const until = Date.now() + seconds * 1000
  if (until <= pausedUntil) return
  const fresh = pausedUntil <= Date.now()
  pausedUntil = until
  tokens = 0
  last = until
  if (fresh) (globalThis as any).dispatchEvent?.(new CustomEvent('anisaki:ratelimit', { detail: { until, why } }))
}

/** "İptal" on the countdown: the requests waiting for a turn stop (pages show what they have). */
export function aniCancelWaiting() {
  epoch++
}

export const retryAfter = (res: Response | null) => {
  const n = Number(res?.headers.get('Retry-After'))
  return n > 0 ? Math.min(120, n) : 60
}

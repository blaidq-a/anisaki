// Torrents found by name on nyaa.si (like Seanime): many shows have no Kitsu / IMDb mapping, so
// id-based addons (Torrentio) return nothing for them. Results look like Stremio streams so the
// rest of the app (ranking, debrid, torrent) treats them the same. Works in Node and in the phone app.
import type { StremioStream } from '../shared/types'

const pad = (n: number) => String(n).padStart(2, '0')
const unescape = (s: string) => s.replace(/&#34;|&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const tag = (item: string, name: string) => unescape(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(item)?.[1]?.trim() ?? '')

async function nyaa(q: string): Promise<StremioStream[]> {
  const url = 'https://nyaa.si/?page=rss&f=0&c=1_0&q=' + encodeURIComponent(q)
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
  if (!res.ok) throw new Error('nyaa HTTP ' + res.status)
  const xml = await res.text()
  const out: StremioStream[] = []
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item = m[1]
    const title = tag(item, 'title')
    const infoHash = tag(item, 'nyaa:infoHash').toLowerCase()
    if (!title || !/^[a-f0-9]{40}$/.test(infoHash)) continue
    const seeders = tag(item, 'nyaa:seeders')
    const size = tag(item, 'nyaa:size').replace('GiB', 'GB').replace('MiB', 'MB')
    const res = /\b(2160p|1080p|720p|480p)\b/i.exec(title)?.[1] ?? ''
    out.push({
      name: `Nyaa\n${res}`,
      title: `${title}\n👤 ${seeders} 💾 ${size} ⚙️ nyaa`,
      infoHash,
      sources: ['tracker:http://nyaa.tracker.wf:7777/announce', 'tracker:udp://open.stealth.si:80/announce', 'tracker:udp://tracker.opentrackr.org:1337/announce'],
      behaviorHints: { filename: title + (/\.(mkv|mp4)$/i.test(title) ? '' : '.mkv') }
    } as StremioStream)
  }
  return out
}

/**
 * AnimeTosho: indexes nyaa, AniDex, TokyoTosho and more, so older / rarer shows find more releases.
 * Its feed lives on its own host (feed.animetosho.org doesn't resolve on some networks: .xyz first).
 * "is_seadex" marks the release SeaDex lists as the best one for the show.
 */
async function tosho(q: string): Promise<StremioStream[]> {
  let list: any[] | null = null
  for (const host of ['https://feed.animetosho.xyz', 'https://feed.animetosho.net', 'https://feed.animetosho.org']) {
    try {
      const res = await fetch(`${host}/json?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) continue
      list = await res.json()
      break
    } catch {
      /* next host */
    }
  }
  const out: StremioStream[] = []
  for (const t of list ?? []) {
    const infoHash = String(t.info_hash ?? '').toLowerCase()
    const title = String(t.title ?? t.torrent_name ?? '')
    if (!title || !/^[a-f0-9]{40}$/.test(infoHash)) continue
    const gb = Number(t.total_size) / 1e9
    const size = gb >= 1 ? gb.toFixed(2) + ' GB' : Math.round(gb * 1000) + ' MB'
    const res = /\b(2160p|1080p|720p|480p)\b/i.exec(title)?.[1] ?? ''
    out.push({
      name: `AnimeTosho\n${res}`,
      title: `${title}\n👤 ${t.seeders ?? 0} 💾 ${size} ⚙️ animetosho${t.is_seadex ? ' 🏅 SeaDex' : ''}`,
      infoHash,
      sources: ['tracker:http://nyaa.tracker.wf:7777/announce', 'tracker:udp://open.stealth.si:80/announce', 'tracker:udp://tracker.opentrackr.org:1337/announce'],
      behaviorHints: { filename: title + (/\.(mkv|mp4)$/i.test(title) ? '' : '.mkv') }
    } as StremioStream)
  }
  return out
}

/**
 * Shorter forms of a title, the way releases name it: full AniList titles ("JoJo no Kimyou na Bouken:
 * Steel Ball Run - 2nd & 3rd STAGE") match nothing on nyaa, "Steel Ball Run" matches every release.
 */
export function titleVariants(titles: string[]): string[] {
  const SEASON = /\s*(?:[-–:]\s*)?(?:\b\d+(?:st|nd|rd|th)\s*(?:[&-]\s*\d+(?:st|nd|rd|th)\s*)?(?:season|stage|cour|part)\b|\b(?:season|stage|cour|part)\s*\d+\b|\b(?:the\s+)?final season\b)\s*$/i
  const tidy = (t: string) => t.replace(/[!?()[\]"“”]/g, ' ').replace(/\s+/g, ' ').replace(/\s*[-–:]\s*$/, '').trim()
  const out: string[] = []
  for (const t of titles.filter(Boolean)) {
    const full = tidy(t.replace(/[:]/g, ' '))
    const base = tidy(t.replace(SEASON, '').replace(SEASON, ''))
    const [before, ...rest] = base.split(/:\s+/)
    const after = rest.join(' ')
    const dashCut = tidy(base.split(/\s+[-–]\s+/)[0])
    // the part before a colon alone only when it is more than one word ("BLEACH" alone finds the old series)
    const head = tidy(before)
    for (const v of [full, tidy(base.replace(/:/g, ' ')), tidy(after), dashCut.replace(/:/g, ' '), after && head.split(' ').length < 2 ? '' : head])
      if (v && v.length >= 4) out.push(v)
  }
  return [...new Set(out.map(s => tidy(s)))]
}

/** Search nyaa by the anime's titles (+ episode number); duplicates are dropped. */
export async function searchByName(titles: string[], episode: number | null): Promise<StremioStream[]> {
  // the full titles first, then the short forms releases use; a handful of queries at most
  const names = titleVariants(titles).slice(0, 4)
  // long series number episodes with three digits ("Doraemon (2005) - 019"): "19" alone finds other ones
  const queries = names.map(n => (episode != null ? `${n} ${pad(episode)}` : n))
  if (episode != null && episode < 100) queries.push(...names.slice(0, 2).map(n => `${n} ${String(episode).padStart(3, '0')}`))
  // nyaa for every query, AnimeTosho for the two main ones (it already covers nyaa's releases too)
  const results = await Promise.all([
    ...queries.map(q => nyaa(q).catch(() => [] as StremioStream[])),
    ...queries.slice(0, 2).map(q => tosho(q).catch(() => [] as StremioStream[]))
  ])
  const seen = new Set<string>()
  return results.flat().filter(s => (seen.has(s.infoHash!) ? false : (seen.add(s.infoHash!), true)))
}

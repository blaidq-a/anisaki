// Stremio addon protocol client: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md
import type { AddonManifest, AddonStreams, AddonSubtitle, InstalledAddon } from '../shared/types'
import { load, save } from './settings'
import { searchByName } from './search'

export function normalizeBase(input: string): string {
  let url = input.trim()
  if (url.startsWith('stremio://')) url = 'https://' + url.slice('stremio://'.length)
  url = url.replace(/\/manifest\.json(\?.*)?$/, '').replace(/\/+$/, '')
  if (!/^https?:\/\//.test(url)) throw new Error('Geçerli bir eklenti adresi değil. https:// veya stremio:// ile başlamalı.')
  return url
}

async function getJson<T>(url: string, timeoutMs = 15000): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

export async function installAddon(input: string): Promise<InstalledAddon> {
  const base = normalizeBase(input)
  const manifest = await getJson<AddonManifest>(base + '/manifest.json')
  if (!manifest?.id || !manifest.name) throw new Error('Bu adreste bir Stremio eklentisi bulunamadı.')
  if (manifest.behaviorHints?.configurationRequired)
    throw new Error(`${manifest.name} önce yapılandırılmalı. Eklentinin sitesinde ayarları yapıp oluşan linki yapıştır.`)
  const addon: InstalledAddon = { base, manifest, enabled: true }
  const addons = load().addons.filter(a => a.manifest.id !== manifest.id)
  save({ addons: [...addons, addon] })
  return addon
}

export function removeAddon(id: string): void {
  save({ addons: load().addons.filter(a => a.manifest.id !== id) })
}

export function toggleAddon(id: string, enabled: boolean): void {
  save({ addons: load().addons.map(a => (a.manifest.id === id ? { ...a, enabled } : a)) })
}

/** Does this addon serve the given resource ('stream', 'subtitles') for this type and id? */
function serves(m: AddonManifest, resource: string, type: string, id: string): boolean {
  for (const r of m.resources) {
    if (typeof r === 'string') {
      if (r !== resource) continue
      const types = m.types
      const prefixes = m.idPrefixes
      if (types.includes(type) && (!prefixes || prefixes.some(p => id.startsWith(p)))) return true
    } else if (r.name === resource) {
      const types = r.types ?? m.types
      const prefixes = r.idPrefixes ?? m.idPrefixes
      if (types.includes(type) && (!prefixes || prefixes.some(p => id.startsWith(p)))) return true
    }
  }
  return false
}

/** Which id prefixes the enabled stream addons accept (used to pick kitsu vs imdb ids). */
export function streamIdPrefixes(): string[] {
  const out = new Set<string>()
  for (const a of load().addons.filter(a => a.enabled)) {
    for (const r of a.manifest.resources) {
      const isStream = typeof r === 'string' ? r === 'stream' : r.name === 'stream'
      if (!isStream) continue
      const prefixes = (typeof r === 'object' && r.idPrefixes) || a.manifest.idPrefixes || ['*']
      prefixes.forEach(p => out.add(p))
    }
  }
  return [...out]
}

/**
 * Ask every enabled addon for streams. `ids` holds candidate ids for the same episode
 * (e.g. kitsu:123:4 and tt123:1:4); each addon gets the first id it accepts.
 */
/** What to search by name when id-based addons find little (titles + episode) */
export interface NameQuery {
  titles: string[]
  episode: number | null
}

/**
 * Waits for the promises, but only `graceMs` past the first one that brought something (a non-empty list or
 * a group with streams), and never longer than `hardMs`. Unfinished ones come back as undefined.
 */
// Only the addons' answers start the grace time (the name search on nyaa is quick but thin: when it started
// the clock, Torrentio answering at 4-5 s was dropped). With no addon answer, whatever came is used after 8 s.
function withGrace<T>(ps: Promise<T>[], graceMs: number, hardMs: number, starters = ps.length): Promise<(T | undefined)[]> {
  return new Promise(resolve => {
    const out: (T | undefined)[] = ps.map(() => undefined)
    let left = ps.length
    let grace: ReturnType<typeof setTimeout> | null = null
    const done = () => resolve(out)
    const hard = setTimeout(done, hardMs)
    if (!left) return done()
    const anyUseful = () => out.some(v => (Array.isArray(v) ? v.length > 0 : !!(v as any)?.streams?.length))
    setTimeout(() => anyUseful() && !grace && done(), 8000)
    ps.forEach((p, i) =>
      p.then(v => {
        out[i] = v
        const useful = Array.isArray(v) ? v.length > 0 : !!(v as any)?.streams?.length
        if (useful && !grace && i < starters) grace = setTimeout(done, graceMs)
        if (--left === 0) (clearTimeout(hard), grace && clearTimeout(grace), done())
      })
    )
  })
}

export async function getStreams(type: string, ids: string[], byName?: NameQuery): Promise<AddonStreams[]> {
  const addons = load().addons.filter(a => a.enabled)
  const jobs = addons
    .map(a => ({ a, id: ids.find(id => serves(a.manifest, 'stream', type, id)) }))
    .filter(j => j.id)
    .map(async ({ a, id }) => {
      try {
        const json = await getJson<{ streams?: AddonStreams['streams'] }>(`${a.base}/stream/${type}/${id}.json`, 20000)
        return { addon: a.manifest.name, addonId: a.manifest.id, streams: json.streams ?? [] }
      } catch (e: any) {
        return { addon: a.manifest.name, addonId: a.manifest.id, streams: [], error: e?.message ?? String(e) }
      }
    })
  // Name search on nyaa (like Seanime) runs alongside; torrents the addons already listed are dropped.
  const named = byName?.titles.length ? searchByName(byName.titles, byName.episode).catch(() => []) : Promise.resolve([])
  // Don't wait for the slowest addon: once one has answered with streams, the others get a few more
  // seconds; whatever hasn't answered by then is left out (it used to hold the list for up to 20 s).
  const used = addons.filter(a => ids.some(id => serves(a.manifest, 'stream', type, id)))
  const all = await withGrace<any>([...jobs, named], 3500, 20000, jobs.length)
  const groups: AddonStreams[] = (all.slice(0, jobs.length) as (AddonStreams | undefined)[]).map((g, i) => g ?? { addon: used[i]?.manifest.name ?? '?', addonId: used[i]?.manifest.id ?? '?', streams: [], error: 'zaman aşımı' })
  const extra: Awaited<typeof named> = all[jobs.length] ?? []
  const known = new Set(groups.flatMap(g => g.streams.map(s => s.infoHash?.toLowerCase()).filter(Boolean)))
  const fresh = extra.filter(s => !known.has(s.infoHash!.toLowerCase()))
  if (fresh.length) groups.push({ addon: 'Nyaa / AnimeTosho', addonId: 'builtin.nyaa', streams: fresh })
  return groups
}

/** OpenSubtitles' official Stremio addon, queried even when not installed (Ayarlar → Altyazı). */
const BUILTIN_OPENSUBTITLES: InstalledAddon = {
  base: 'https://opensubtitles-v3.strem.io',
  enabled: true,
  manifest: {
    id: 'org.stremio.opensubtitlesv3',
    name: 'OpenSubtitles',
    version: 'yerleşik',
    types: ['movie', 'series'],
    resources: [{ name: 'subtitles', types: ['movie', 'series'], idPrefixes: ['tt'] }],
    idPrefixes: ['tt']
  }
}

/** Ask subtitle addons (e.g. OpenSubtitles) for subtitles of one episode. */
export async function getSubtitles(type: string, ids: string[]): Promise<AddonSubtitle[]> {
  const s = load()
  const addons = s.addons.filter(a => a.enabled)
  if (s.builtinSubs && !s.addons.some(a => a.base.includes('opensubtitles-v3.strem.io'))) addons.push(BUILTIN_OPENSUBTITLES)
  const jobs = addons
    .map(a => ({ a, id: ids.find(id => serves(a.manifest, 'subtitles', type, id)) }))
    .filter(j => j.id)
    .map(async ({ a, id }) => {
      try {
        const json = await getJson<{ subtitles?: { id?: string; url: string; lang: string }[] }>(`${a.base}/subtitles/${type}/${id}.json`, 15000)
        return (json.subtitles ?? []).map((s, i) => ({ id: s.id ?? `${a.manifest.id}-${i}`, url: s.url, lang: s.lang, addon: a.manifest.name }))
      } catch {
        return []
      }
    })
  return (await Promise.all(jobs)).flat()
}

/** First run: install the usual addons so a new copy (e.g. a friend's) works right away. */
export async function ensureDefaultAddons(): Promise<void> {
  const s = load() as ReturnType<typeof load> & { defaultsDone?: boolean }
  if (s.defaultsDone) return
  if (!s.addons.length) {
    for (const url of ['https://torrentio.strem.fun/manifest.json', 'https://opensubtitles-v3.strem.io/manifest.json']) {
      await installAddon(url).catch(() => {})
    }
  }
  save({ defaultsDone: true } as any)
}

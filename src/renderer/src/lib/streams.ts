// Reads quality info out of Stremio stream titles (Torrentio-style "name\nTitle\n👤 60 💾 1.45 GB").
import { episodeOf } from '../../../shared/episode'
import type { StremioStream } from '../../../shared/types'

export interface ParsedStream {
  raw: StremioStream
  addon: string
  resolution: '2160p' | '1080p' | '720p' | '480p' | null
  size: string | null
  sizeBytes: number
  seeders: number | null
  group: string | null
  tags: string[]
  label: string
  direct: boolean
  cached: boolean
}

const UNITS: Record<string, number> = { KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }

export function parseStream(s: StremioStream, addon: string): ParsedStream {
  const text = `${s.name ?? ''}\n${s.title ?? ''}\n${s.description ?? ''}\n${s.behaviorHints?.filename ?? ''}`
  const res = /\b(2160p|4k|1080p|720p|480p)\b/i.exec(text)?.[1]?.toLowerCase()
  const size = /💾\s*([\d.]+\s*[KMGT]B)/i.exec(text)?.[1] ?? /\b([\d.]+\s*[GM]B)\b/.exec(text)?.[1] ?? null
  const sizeBytes = size ? parseFloat(size) * (UNITS[size.replace(/[\d.\s]/g, '').toUpperCase()] ?? 1) : s.behaviorHints?.videoSize ?? 0
  const seeders = /👤\s*(\d+)/.exec(text)?.[1]
  const group = /^\s*\[([^\]]+)\]/m.exec(s.behaviorHints?.filename ?? s.title ?? '')?.[1] ?? null
  const tags: string[] = []
  if (/\b(HEVC|x265|H\.?265)\b/i.test(text)) tags.push('HEVC')
  if (/\b(AV1)\b/i.test(text)) tags.push('AV1')
  if (/\b(10.?bit|Hi10)\b/i.test(text)) tags.push('10bit')
  if (/\b(DV|DoVi|Dolby.?Vision)\b/i.test(text)) tags.push('Dolby Vision')
  else if (/\bHDR(10\+?)?\b/i.test(text)) tags.push('HDR')
  const heavyAudio = /\b(DDP|DD\+|E-?AC-?3|AC-?3|DD5|DTS(-HD)?|TrueHD|Atmos)\b/i.exec(text)?.[1]
  // mpv plays these natively (the old browser player had to convert them)
  if (heavyAudio) tags.push(`Ses ${heavyAudio.toUpperCase()}`)
  if (/\b(dual.?audio)\b/i.test(text)) tags.push('Çift ses')
  if (/\b(multi.?subs?)\b/i.test(text)) tags.push('Çoklu altyazı')
  if (/\b(batch|complete|season \d+\])\b/i.test(text) || /\b\d{2,4}\s*[-~]\s*\d{2,4}\b/.test(s.title?.split('\n')[0] ?? '')) tags.push('Paket')
  const label = (s.behaviorHints?.filename ?? s.title?.split('\n')[0] ?? s.name ?? 'Kaynak').trim()
  return {
    raw: s,
    addon,
    resolution: res ? ((res === '4k' ? '2160p' : res) as ParsedStream['resolution']) : null,
    size,
    sizeBytes,
    seeders: seeders ? Number(seeders) : null,
    group,
    tags,
    label,
    direct: !!s.url,
    cached: /⚡|\[(RD|TB|AD|PM)\+\]|instant/i.test(s.name ?? '')
  }
}

const RES_RANK = { '2160p': 4, '1080p': 3, '720p': 2, '480p': 1 } as const

export function sortStreams(list: ParsedStream[]): ParsedStream[] {
  return [...list].sort(
    (a, b) =>
      Number(b.cached) - Number(a.cached) ||
      Number(b.direct) - Number(a.direct) ||
      (RES_RANK[b.resolution ?? '480p'] ?? 0) - (RES_RANK[a.resolution ?? '480p'] ?? 0) ||
      // Same resolution: SDR before HDR/DV (Anime4K and most screens handle it better)
      Number(a.tags.includes('HDR') || a.tags.includes('Dolby Vision')) - Number(b.tags.includes('HDR') || b.tags.includes('Dolby Vision')) ||
      (b.seeders ?? 0) - (a.seeders ?? 0)
  )
}

/* ------------------------------ automatic choice ------------------------------ */

/** Stable id for a stream, so a failed one can be skipped next time. */
export const streamKey = (s: ParsedStream) => s.raw.infoHash ? `${s.raw.infoHash.toLowerCase()}:${s.raw.fileIdx ?? ''}` : s.raw.url ?? s.label

const GOOD_GROUPS = /\b(SubsPlease|Erai-raws|ASW|Judas|EMBER|Commie|HorribleSubs|SallySubs|Tsundere-Raws|Kametsu|Beatrice-Raws|Anime Time|Yameii|DKB|VARYG|ToonsHub)\b/i

export interface Ranked {
  s: ParsedStream
  score: number
  /** Why it got this score, shown in the UI */
  why: string[]
}

/**
 * Score sources for one episode. Instant (cached/direct) sources, the preferred resolution, single
 * episode files whose name carries the right episode number and sane sizes win; files that name a
 * different episode are dropped.
 */
/**
 * Not the episode that was asked for, even when the number matches: specials ("SP 01", a Specials/ folder),
 * fan edits (One Pace) and a live-action series of the same name (a release year far from the anime's).
 */
export function wrongKind(s: ParsedStream, year?: number | null, total?: number | null, episode?: number | null): string | null {
  const name = s.raw.behaviorHints?.filename ?? ''
  const lines = (s.raw.title ?? '').split('\n')
  const text = [s.raw.name, ...lines, name].join('\n')
  if (/\bone[ ._-]?pace\b/i.test(text)) return 'kurgu (One Pace)'
  if (/\b(?:SP|OVA|OAD|Special|Movie)\s*[-_]?\s*0*\d+\b/i.test(lines[0] + '\n' + name)) return 'özel bölüm'
  if (lines.some(l => /(^|\/)(specials?|extras?|sp|ova|oad|movies?|bonus|nc ?op|nc ?ed|creditless)\//i.test(l))) return 'özel bölüm'
  // Live-action releases are named like western TV (S01E01) and carry their own year.
  if (year && /S\d{1,2}\s?E\d/i.test(text)) {
    const years = [...text.matchAll(/(?:^|[^\d])(19[5-9]\d|20[0-4]\d)(?!\d)/g)].map(m => Number(m[1]))
    if (years.length && !years.some(y => Math.abs(y - year) <= 1) && years.every(y => y > year + 2)) return 'başka yapım (' + years[0] + ')'
  }
  // A show with hundreds of episodes is numbered 001/0001; "- 01" is then some other series or a special.
  if (total && total >= 100 && episode != null && episode < 100) {
    const num = /(?:\s-\s*|E|EP|Episode\s?)(\d{1,4})(?:v\d)?(?:[\s.[(]|$)/i.exec(name.replace(/\.[^.]+$/, ''))?.[1]
    if (num && num.length < 3) return 'numara biçimi uymuyor'
  }
  return null
}

const STOP = new Set('the and season part movie series final with from for you shin new 2nd 3rd 4th 5th kun chan san'.split(' '))
const compact = (t: string) => t.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * The torrent is another anime altogether: addons sometimes map an id to the wrong show (Darker than Black
 * episode 7 came back as a Nadia pack). True when nothing of the anime's titles appears in the torrent's name.
 */
export function otherAnime(s: ParsedStream, titles?: (string | null | undefined)[] | null): boolean {
  if (!s.raw.infoHash || !titles?.length) return false
  const text = compact([(s.raw.title ?? '').split('\n')[0], s.raw.behaviorHints?.filename ?? ''].join(' '))
  if (!text) return false
  const keys = new Set<string>()
  for (const t of titles) {
    if (!t) continue
    const c = compact(t)
    // Japanese / Chinese titles have no spaces: look for the whole title, or its first few characters.
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(t)) {
      if (c.length >= 2) keys.add(c.slice(0, Math.min(c.length, 4)))
      continue
    }
    for (const w of t.toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u)) if (w.length >= 3 && !STOP.has(w)) keys.add(w)
    if (c.length >= 3) keys.add(c)
  }
  if (!keys.size) return false
  for (const k of keys) if (text.includes(k)) return false
  return true
}

/**
 * How torrents get played:'none' = debrid only, 'fallback' = debrid when cached else straight torrent,
 * 'only' = always straight torrent (no debrid, or the user chose it).
 */
export type TorrentMode = 'none' | 'fallback' | 'only'

/** How releases name a language: flag emoji and words / codes (ISO 639-1 code → patterns). */
const LANG_MARKS: Record<string, RegExp> = {
  tr: /🇹🇷|\b(turkish|türkçe|turkce|tur)\b/i,
  en: /🇬🇧|🇺🇸|\b(english|eng)\b/i,
  es: /🇪🇸|🇲🇽|\b(spanish|español|espanol|spa|esp|lat(?:ino)?)\b/i,
  pt: /🇵🇹|🇧🇷|\b(portuguese|português|portugues|por|pt-?br)\b/i,
  fr: /🇫🇷|\b(french|français|francais|fre|fra|vostfr)\b/i,
  de: /🇩🇪|\b(german|deutsch|ger|deu)\b/i,
  it: /🇮🇹|\b(italian|italiano|ita)\b/i,
  ru: /🇷🇺|\b(russian|rus)\b|рус/i,
  ar: /🇸🇦|🇦🇪|\b(arabic|ara)\b/i,
  pl: /🇵🇱|\b(polish|polski|pol)\b/i,
  id: /🇮🇩|\b(indonesian|indo|ind)\b/i,
  vi: /🇻🇳|\b(vietnamese|vie)\b/i,
  th: /🇹🇭|\b(thai|tha)\b/i,
  ko: /🇰🇷|\b(korean|kor)\b/i,
  zh: /🇨🇳|🇹🇼|\b(chinese|chs|cht|chi)\b|简|繁/i
}
export const LANG_LABEL: Record<string, string> = { tr: 'Türkçe', en: 'İngilizce', es: 'İspanyolca', pt: 'Portekizce', fr: 'Fransızca', de: 'Almanca', it: 'İtalyanca', ru: 'Rusça', ar: 'Arapça', pl: 'Lehçe', id: 'Endonezce', vi: 'Vietnamca', th: 'Tayca', ko: 'Korece', zh: 'Çince' }

/**
 * Does the release say it carries subtitles in this language? 'named': the language / its flag is in the
 * name; 'multi': a streaming-site rip with many subtitles (Netflix, Amazon, Disney+ include most languages).
 */
export function subLangIn(s: ParsedStream, lang: string | null | undefined): 'named' | 'multi' | null {
  if (!lang) return null
  const text = [s.raw.name, s.raw.title, s.raw.behaviorHints?.filename].join('\n')
  if (LANG_MARKS[lang]?.test(text)) return 'named'
  if (/\b(MSubs?|Multi[ -]?Subs?|MultiSub)\b/i.test(text) && /\b(NF|AMZN|DSNP|Netflix|Amazon|Disney)\b/i.test(text)) return 'multi'
  return null
}

const spaced = (t: string) => ' ' + t.toLowerCase().normalize('NFKC').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/[._]/g, ' ').replace(/\s+/g, ' ') + ' '
const GENERIC = new Set('season seasons complete series episode episodes part batch collection the and tv web bluray bdrip dual audio eng english sub subs dub'.split(' '))
// "2nd Season", "Season 2", and the short forms releases use: "S2 - 01", "S02E01"
const ORD = (t: string) => Number(/\b(\d+)(?:st|nd|rd|th)\s+season\b/.exec(t)?.[1] ?? /\bseason\s*(\d+)\b/.exec(t)?.[1] ?? /\bs(\d{1,2})(?:e\d{1,4})?\b/.exec(t)?.[1] ?? NaN)
// A season number or roman numeral right after the title: "Overlord III - 02", "Konosuba 2 - 01", "Mob Psycho 100 II"
const ROMAN: Record<string, number> = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6 }
const TAIL = /\s(ii|iii|iv|v|vi|[2-9])\s*$/
const tailSeason = (t: string) => {
  const m = TAIL.exec(t.trim())
  return m ? ROMAN[m[1]] ?? Number(m[1]) : NaN
}
/** The anime's own season: "2nd Season" / "Season 2" / "S2", else a numeral at the end of a title, else 1 */
const seasonOf = (own: string[]) => own.map(ORD).find(n => !isNaN(n)) ?? own.map(tailSeason).find(n => !isNaN(n)) ?? 1
/** Title without its subtitle and season numeral: "overlord iii" → "overlord" */
const coreOf = (t: string) => t.trim().replace(/[:\-–].*$/, '').replace(TAIL, '').trim()
/** Season numeral the release puts right after the title, NaN when there is none */
function nameSeason(name: string, own: string[]): number {
  for (const t of own) {
    const c = coreOf(t)
    if (c.length < 3) continue
    const at = name.indexOf(c)
    if (at < 0) continue
    const m = /^\s+(ii|iii|iv|v|vi|[2-9])(?=\s*(-|:|$|\s\d))/.exec(name.slice(at + c.length))
    if (m) return ROMAN[m[1]] ?? Number(m[1])
  }
  return NaN
}
/** Years in a release name ("Black Clover (2026) - 01"); the bracket text is kept for this. */
const yearsIn = (t: string) => [...t.matchAll(/(?<![\d])(19[6-9]\d|20[0-4]\d)(?![\d])/g)].map(m => Number(m[1]))

/**
 * Same show, another season: name searches for "Jujutsu Kaisen 01" also find "Jujutsu Kaisen: Shimetsu Kaiyuu - 01"
 * and "Jujutsu Kaisen 2nd Season - 01". True when the release names a season other than this entry's, or puts a
 * subtitle after the title ("Title: Something") that none of the anime's titles have.
 */
export function otherSeason(s: ParsedStream, titles?: (string | null | undefined)[] | null, year?: number | null): boolean {
  if (!s.raw.infoHash || !titles?.length) return false
  const own = titles.filter((t): t is string => !!t && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(t)).map(spaced)
  if (!own.length) return false
  // The file picked inside a pack tells; the pack's own name may list every season ("Season 1 2 3 + Movie").
  const names = [s.raw.behaviorHints?.filename || (s.raw.title ?? '').split('\n')[0]].map(spaced)
  const ownSeason = seasonOf(own)
  const ownWords = new Set(own.join(' ').split(/[^\p{L}\p{N}]+/u).filter(Boolean))
  const ownFinal = own.some(t => /\bfinal\b/.test(t))
  // A later season released under the same name carries its own year: "Black Clover (2026)" is not the 2017 show.
  const rawName = s.raw.behaviorHints?.filename || (s.raw.title ?? '').split('\n')[0]
  const ys = yearsIn(rawName)
  if (year && ys.length && ys.every(y => Math.abs(y - year) > 1) && !own.some(t => yearsIn(t).length)) return true
  for (const name of names) {
    const season = ORD(name)
    if (!isNaN(season) && season !== ownSeason) return true
    const tail = nameSeason(name, own)
    if (!isNaN(tail) && tail !== ownSeason) return true
    if (/\bfinal season\b/.test(name) && !ownFinal) return true
    for (const t of own) {
      // Shortest form of the title: "jujutsu kaisen" out of "jujutsu kaisen: something"
      const base = t.trim().replace(/[:\-–].*$/, '').trim()
      if (base.length < 3) continue
      const at = name.indexOf(base)
      if (at < 0) continue
      // A spin-off puts its own name first: "Vigilante - Boku no Hero Academia Illegals" is not the main show
      const before = name.slice(0, at).split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 3 && !ownWords.has(w) && !GENERIC.has(w))
      if (before.length && /[-–:]\s*$/.test(name.slice(0, at))) return true
      // "Title: Something" or "Title - Something" (an arc / season name none of the anime's titles have)
      const after = /^\s*[:\-–]\s*([\p{L}][\p{L}\s'’]{2,40})/u.exec(name.slice(at + base.length))?.[1]
      if (after && after.split(/[^\p{L}\p{N}]+/u).filter(Boolean).some(w => w.length > 2 && !ownWords.has(w) && !GENERIC.has(w))) return true
    }
  }
  return false
}
/**
 * This entry is a later season (its title says "Season 2" / "2nd Season", or AniList lists a prequel) but the
 * release names no season and no year: "[HorribleSubs] Black Clover - 09" is the first season's episode 9.
 * Not ruled out (some groups number later seasons plainly), only put behind releases that say the season.
 */
export function unmarkedSeason(s: ParsedStream, titles?: (string | null | undefined)[] | null, later?: boolean): boolean {
  if (!s.raw.infoHash || !titles?.length) return false
  const own = titles.filter((t): t is string => !!t).map(spaced)
  const ownSeason = seasonOf(own)
  if (ownSeason < 2 && !later) return false
  const rawName = s.raw.behaviorHints?.filename || (s.raw.title ?? '').split('\n')[0]
  const name = spaced(rawName)
  if (!isNaN(ORD(name)) || !isNaN(nameSeason(name, own)) || yearsIn(rawName).length) return false
  // the whole season title is in the name ("Prisma Illya 3rei!!", "Haikyuu!! To The Top", "Gintama'")
  if (own.some(t => compact(t).length >= 6 && compact(name).includes(compact(t)))) return false
  // the season's own subtitle in the name ("Shimetsu Kaiyuu", "Entertainment District Arc") counts as a mark
  const extra = own
    .map(t => /[:\-–]\s*(.+)$/.exec(t.trim())?.[1])
    .filter((x): x is string => !!x)
    .flatMap(x => x.split(/\s+/))
    .filter(w => w.length > 3 && !GENERIC.has(w) && isNaN(Number(w)))
  return !extra.some(w => name.includes(' ' + w))
}

export function torrentMode(s: { streamMode?: string; debridProvider?: string; debridKeys?: Record<string, boolean> } | null | undefined): TorrentMode {
  if (!s) return 'none'
  const hasDebrid = !!s.debridProvider && s.debridProvider !== 'none' && !!s.debridKeys?.[s.debridProvider]
  if (s.streamMode === 'torrent' || !hasDebrid) return 'only'
  return s.streamMode === 'auto' ? 'fallback' : 'none'
}

export function rankStreams(list: ParsedStream[], episode: number | null, quality: '2160p' | '1080p' | '720p', skip: Set<string> = new Set(), year?: number | null, total?: number | null, tmode: TorrentMode = 'none', titles?: (string | null | undefined)[] | null, subLang?: string | null, later?: boolean): Ranked[] {
  const order = ['480p', '720p', '1080p', '2160p']
  const want = order.indexOf(quality)
  const out: Ranked[] = []
  for (const s of list) {
    if (skip.has(streamKey(s))) continue
    const why: string[] = []
    let score = 0
    const fileName = s.raw.behaviorHints?.filename ?? s.label
    const ep = episodeOf(fileName)
    if (episode != null && ep != null && ep !== episode) continue // names another episode
    // a pack of other episodes ("Episodes 922-935", "001~400" holds 1 but "401~500" doesn't)
    const range = /(?:^|[\s[(_-])(\d{2,4})\s*(?:-|~|to)\s*(\d{2,4})(?=[\s\])_.]|$)/i.exec((s.raw.title ?? '').split('\n')[0] + ' ' + fileName)
    if (episode != null && ep == null && range && +range[1] < 1900 && +range[2] < 1900 && +range[1] < +range[2] && (episode < +range[1] || episode > +range[2])) continue
    // a one-episode entry is itself a special / OVA / film: "OVA", "Special" in the name is right, not a penalty
    const wrong = total === 1 ? null : wrongKind(s, year, total, episode)
    // ...and a batch of the TV series ("Black Clover (01-170) [Batch]") is not that special
    if (total === 1 && range && +range[2] - +range[1] >= 3) (score -= 120), why.push('dizinin bölüm paketi')
    if (wrong) (score -= 150), why.push(wrong)
    if (otherAnime(s, titles)) (score -= 400), why.push('başka anime')
    else if (otherSeason(s, titles, year)) (score -= 400), why.push('başka sezon')
    else if (unmarkedSeason(s, titles, later)) (score -= 180), why.push('sezon belirtilmemiş (ilk sezon olabilir)')
    // The user's first subtitle language inside the file: no download / translation needed.
    const sl = subLangIn(s, subLang)
    if (sl === 'named') (score += 35), why.push((LANG_LABEL[subLang!] ?? subLang) + ' altyazı')
    else if (sl === 'multi') (score += 12), why.push('çok dilli altyazı')
    // Russian releases (Cyrillic names) often carry dubs and burned-in localized titles.
    if (/[Ѐ-ӿ]/.test(fileName + (s.raw.title ?? '').split('\n')[0])) (score -= 40), why.push('Rusça sürüm')
    if (episode != null && ep === episode) (score += 30), why.push('bölüm numarası doğru')

    if (s.cached && tmode !== 'only') (score += 100), why.push('anında açılır')
    else if (s.direct) (score += 70), why.push('doğrudan link')
    else if (tmode === 'none') (score -= 40), why.push('önce indirilmesi gerekir')
    else {
      // Straight torrent: how fast it starts depends on the seeders.
      // Straight torrent: the seeders decide how fast it starts and whether it plays smoothly, so they weigh
      // more than resolution here (a 720p with 300 seeds beats a 1080p with 4).
      const seed = s.seeders ?? 0
      if (seed >= 100) (score += 90), why.push('çok seed')
      else if (seed >= 30) (score += 65), why.push('çok seed')
      else if (seed >= 10) (score += 35), why.push('yeterli seed')
      else if (seed >= 3) score -= 10
      else (score -= 90), why.push('seed yok denecek kadar az')
    }

    const r = order.indexOf(s.resolution ?? '')
    if (r === want) (score += 40), why.push(s.resolution!)
    else if (r >= 0) score += r < want ? 25 - (want - r) * 8 : 15 - (r - want) * 5

    if (s.tags.includes('Paket')) (score -= 25), why.push('paket')
    if (s.tags.includes('HDR') || s.tags.includes('Dolby Vision')) score -= 8
    if (GOOD_GROUPS.test(fileName) || GOOD_GROUPS.test(s.group ?? '')) (score += 10), why.push('bilinen grup')
    if (/🏅 SeaDex/.test(s.raw.title ?? '')) (score += 15), why.push('SeaDex önerisi')

    const mb = s.sizeBytes / 1e6
    if (mb > 0 && !s.tags.includes('Paket')) {
      if (mb < 80) (score -= 30), why.push('dosya çok küçük')
      else if (mb > 8000) score -= 20
    }
    if (s.seeders != null) score += Math.min(15, Math.log2(s.seeders + 1) * 2.5)
    out.push({ s, score, why })
  }
  return out.sort((a, b) => b.score - a.score)
}

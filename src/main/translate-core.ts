// Subtitle machine translation without Node / Electron: shared by the desktop and phone apps.
// Works on ASS text: timing, styles and leading position tags are kept, only the spoken text is
// translated (Google Translate's public web endpoint, no key).
const ENDPOINT = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t'

/* ------------------------------ ASS handling ------------------------------ */
interface Line {
  /** Everything up to and including the 9th comma of the Dialogue line */
  head: string
  /** Leading override block kept as is, e.g. {\an8} */
  lead: string
  /** Plain text to translate (tags removed, \N as spaces) */
  text: string
}

function parseDialogue(raw: string): Line | null {
  if (!raw.startsWith('Dialogue:')) return null
  let idx = -1
  for (let i = 0; i < 9; i++) {
    idx = raw.indexOf(',', idx + 1)
    if (idx < 0) return null
  }
  const head = raw.slice(0, idx + 1)
  const body = raw.slice(idx + 1)
  if (/\\p[1-9]/.test(body)) return null // vector drawings, not text
  const lead = /^(\{[^}]*\})/.exec(body)?.[1] ?? ''
  const text = body
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\[Nn]/g, ' ')
    .replace(/\\h/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return null
  return { head, lead, text }
}

/* Google sometimes blocks an address for a while (too many requests). Then MyMemory (free, public API,
   small daily quota) takes over until Google answers again. */
let googleBlockedUntil = 0

async function myMemory(texts: string[], from: string, to: string): Promise<string[]> {
  const out: string[] = []
  // MyMemory takes ~500 characters per request: send lines in small groups.
  let group: string[] = []
  const flush = async () => {
    if (!group.length) return
    const q = group.join('\n')
    const res = await fetch(`https://api.mymemory.translated.net/get?langpair=${from === 'auto' ? 'en' : from}|${to}&q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(20000) })
    const json: any = await res.json()
    if (json.quotaFinished || json.responseStatus !== 200) throw new Error('Günlük ücretsiz çeviri kotası doldu; biraz sonra tekrar dene.')
    const lines = String(json.responseData?.translatedText ?? '').split('\n')
    const sent = group
    group = []
    if (lines.length === sent.length) out.push(...lines.map(l => l.trim()))
    else for (const t of sent) out.push(...(await myMemory([t], from, to)))
  }
  for (const t of texts) {
    if (group.join('\n').length + t.length > 450) await flush()
    group.push(t)
  }
  await flush()
  return out
}

async function translateBatch(texts: string[], from: string, to: string): Promise<string[]> {
  if (Date.now() < googleBlockedUntil) return myMemory(texts, from, to)
  const body = new URLSearchParams({ q: texts.join('\n') })
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${ENDPOINT}&sl=${from}&tl=${to}`, { method: 'POST', body, signal: AbortSignal.timeout(20000) })
      if (res.status === 429) throw new Error('rate')
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const json: any = await res.json()
      const out = (json[0] as any[]).map(s => s[0] as string).join('').split('\n').map(s => s.trim())
      if (out.length === texts.length) return out
      // Line count drifted (rare): translate this batch one line at a time.
      if (texts.length > 1) return (await Promise.all(texts.map(t => translateBatch([t], from, to)))).flat()
      return [out.join(' ')]
    } catch (e: any) {
      // Blocked (429 / captcha page instead of JSON): stop hammering Google, use the backup for 10 minutes.
      if (e?.message === 'rate' || e instanceof SyntaxError) {
        googleBlockedUntil = Date.now() + 10 * 60 * 1000
        return myMemory(texts, from, to)
      }
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
    }
  }
  return myMemory(texts, from, to).catch(() => {
    throw new Error('Çeviri hizmetine ulaşılamadı.')
  })
}

/** Translate many lines, ~3500 characters per request, a few requests at a time. */
async function translateAll(texts: string[], from: string, to: string, onProgress?: (done: number) => void): Promise<string[]> {
  const batches: number[][] = []
  let cur: number[] = []
  let len = 0
  texts.forEach((t, i) => {
    if (cur.length && (len + t.length > 3500 || cur.length >= 60)) {
      batches.push(cur)
      cur = []
      len = 0
    }
    cur.push(i)
    len += t.length + 1
  })
  if (cur.length) batches.push(cur)
  const out = new Array<string>(texts.length)
  let done = 0
  let next = 0
  const worker = async () => {
    while (next < batches.length) {
      const b = batches[next++]
      const res = await translateBatch(b.map(i => texts[i]), from, to)
      b.forEach((i, k) => (out[i] = res[k] ?? texts[i]))
      done += b.length
      onProgress?.(done)
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return out
}

/* ------------------------- sentence merging, name protection ------------------------- */
const toSec = (t: string) => {
  const [h, m, sec] = t.trim().split(':')
  return Number(h) * 3600 + Number(m) * 60 + Number(sec)
}
const fields = (head: string) => head.slice('Dialogue:'.length).split(',')
const ENDS = /[.!?…♪」』)\]"'”]$/
// Words in names and aliases that are not names on their own ("The Almighty", "Mr. Mantisian")
const COMMON = new Set(
  ('will may hope rose grace faith joy mark bill ray sky sun king queen angel black white red blue green gold silver star moon light dark death boss master doctor captain father mother brother sister man woman girl boy kid ' +
    'the and for from with mr mrs ms miss sir lady lord great little big old young new')
    .split(' ')
    .concat(['mr.', 'mrs.', 'ms.'])
)
const HONORIFIC = '(?:-(?:san|kun|chan|sama|senpai|sensei|dono|nee|nii|tan|chin))?'

/** Replaces character names with tokens Google leaves alone (Turkish suffixes still attach: "Qbzx'ı"). */
/**
 * Placeholder for a name, for the on-device models: an invented name they copy as it is ("Zorvuk") and
 * attach Turkish suffixes to. It ends like the real name (last vowel, vowel or hard/soft consonant), so
 * the suffixes follow the right vowel harmony when the real name is put back ("Luck'un", "Asta'yı").
 */
/** How a number ends when read in Turkish ("46" → "kırk altı" → "altı"), for the suffix ("46'ya"). */
function numberWord(n: number): string {
  const ones = ['', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz']
  const tens = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan']
  if (n % 10) return ones[n % 10]
  if (n % 100) return tens[Math.floor(n / 10) % 10]
  if (n % 1000) return 'yüz'
  return n ? 'bin' : 'sıfır'
}

function nameToken(i: number, name: string) {
  const num = /(\d+)$/.exec(name.trim())
  const low = (num ? numberWord(Number(num[1])) : name.toLowerCase())
    .replace(/-(san|kun|chan|sama|senpai|sensei|dono|nee|nii|tan|chin)$/, '')
    .replace(/y$/, 'i')
  const v = /[aeiouıöü](?=[^aeiouıöü]*$)/.exec(low)?.[0] ?? 'a'
  const end = /[aeiouıöü]$/.test(low) ? '' : /[pçtkfhsşx]$|ck$/.test(low) ? 'k' : 'n'
  return 'ZKDBTGMHSF'[i % 10] + 'oaeu'[Math.floor(i / 10) % 4] + 'rlnm'[Math.floor(i / 40) % 4] + 'v' + v + end + (i >= 160 ? 'a'.repeat(Math.floor(i / 160)) : '')
}

const isCaps = (s: string) => {
  const l = s.replace(/[^\p{L}]/gu, '')
  return l.length >= 4 && l === l.toUpperCase() && l !== l.toLowerCase()
}

/** A placeholder as a whole word (not inside a longer word); placeholders are plain letters. */
const wordRe = (tok: string, flags: string) => new RegExp('(?<![\\p{L}\\p{N}])' + tok + '(?![\\p{L}\\p{N}])', flags + 'u')

/*
 * Proper names that are not characters: two or more capitalised words in a row ("Soul Society",
 * "Soul Reaper", "Gotei 13", "Demon King"). Translated word by word they read badly ("Ruh Topluluğu");
 * Turkish fansubs keep them as they are. Ordinary words that are capitalised only because they start a
 * sentence ("Hey Ichigo", "Thank You") and titles before a name ("Captain Unohana") are left out.
 */
// Capitalised words (not all-caps on-screen text like "WARNING"), or a spell with its number
// ("Hado No. 90", "Bakudo #61": the model turned "No." into "sayı")
const CAP = "[A-Z](?=\\p{Ll})[\\p{L}'’-]*"
const PHRASE = new RegExp(`(?<![\\p{L}\\p{N}'’])(?:${CAP}\\s+(?:No\\.|#)\\s*\\d{1,3}\\b|${CAP}(?:\\s+(?:${CAP}|\\d{1,3})(?![\\p{L}]))+)`, 'gu')
const LEAD = new Set(
  ('a an the this that these those my your his her its our their what who why where when how which whose is are was were be been am do does did have has had ' +
    'i you he she it we they me him us them hey oh ah eh huh hmm wow yes yeah no nope well okay ok so but and or then now just even also please thank thanks sorry ' +
    'let lets let’s don’t can’t won’t i’m you’re it’s that’s there here come go get give take look wait stop see tell say said know think want need like love hate ' +
    'if because since after before until while all any some every each both many much more most few other another same such only very really too not never ' +
    'always maybe perhaps still yet again once twice first last next new old young little big great good bad right left one two three ' +
    'mr mrs ms miss mister sir madam lady lord master doctor dr professor captain lieutenant head vice deputy commander general sergeant officer ' +
    'king queen prince princess emperor brother sister uncle aunt grandpa granny grandma father mother dad mom saint lord chief boss')
    .split(' ')
)
function properPhrase(m: string, swap: (s: string) => string): string {
  if (/\s(?:No\.|#)\s*\d/.test(m)) return swap(m) // a spell and its number, as a whole
  const words = m.split(/\s+/)
  const lead = (w: string) => LEAD.has(w.toLowerCase().replace(/['’](s|re|ll|ve|d|m)$/, ''))
  let i = 0
  while (i < words.length && lead(words[i])) i++
  let j = words.length
  while (j > i && lead(words[j - 1])) j--
  const kept = words.slice(i, j)
  // still two words (or a name and a number) and not just numbers
  if (kept.length < 2 || !/^[A-Z]/.test(kept[0])) return m
  const phrase = kept.join(' ').replace(/['’]s$/, '')
  const rest = kept.join(' ').slice(phrase.length)
  return [...words.slice(0, i), swap(phrase) + rest, ...words.slice(j)].join(' ')
}

function protector(names: string[], style: 'google' | 'local' = 'google') {
  // "Ken Takakura" also as "Ken" and "Takakura"; a longer alias ("Substitute Soul Reaper") only whole
  const list = [...new Set(names.flatMap(n => (n.trim().split(/\s+/).length <= 2 ? [n, ...n.split(/\s+/)] : [n])).map(n => n.trim()))]
    .filter(n => n.length >= 3 && /^[A-Z]/.test(n) && !COMMON.has(n.toLowerCase()))
    .sort((a, b) => b.length - a.length)
  if (!list.length && style !== 'local') return { hide: (t: string) => t, show: (t: string) => t, lost: (_h: string, _o: string) => false, onlyNames: (_t: string) => false }
  // on-screen text in capitals names them in capitals too ("THE GREAT MAGE FLAMME")
  const all = style === 'local' ? [...list, ...list.map(n => n.toUpperCase()).filter(n => !list.includes(n))] : list
  const esc = all.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = esc.length ? new RegExp(`\\b(?:${esc.join('|')})${HONORIFIC}\\b`, 'g') : null
  const byText = new Map<string, string>()
  const byToken = new Map<string, string>()
  const token = (i: number, name: string) =>
    style === 'local' ? nameToken(i, name) : 'Q' + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26) % 26) + 'zx'
  const tokens = () => [...byToken.keys()]
  const swap = (m: string) => {
    let tok = byText.get(m)
    if (!tok) {
      tok = token(byText.size, m)
      byText.set(m, tok)
      byToken.set(tok.toLowerCase(), m)
    }
    return tok
  }
  return {
    hide: (t: string) => {
      // proper names of places, groups and terms ("Soul Society", "Gotei 13") stay as they are too
      if (style === 'local' && !isCaps(t)) t = t.replace(PHRASE, m => properPhrase(m, swap))
      return re ? t.replace(re, swap) : t
    },
    show: (t: string) =>
      style === 'local'
        ? tokens().reduce((x, tok) => x.replace(wordRe(tok, 'gi'), byToken.get(tok)!), t)
        : t.replace(/Q[a-z]{2}zx/gi, m => byToken.get(m.toLowerCase()) ?? m),
    /** The model mangled a placeholder: that sentence is translated again without them. */
    lost: (hidden: string, out: string) => tokens().some(tok => wordRe(tok, 'i').test(hidden) && !wordRe(tok, 'i').test(out)),
    /** Nothing but names ("Ichigo...", "Kurosaki!"): nothing to translate (the model added suffixes). */
    onlyNames: (hidden: string) => tokens().length > 0 && !/\p{L}/u.test(tokens().reduce((x, tok) => x.replace(wordRe(tok, 'gi'), ''), hidden))
  }
}

/** Split a translated sentence back over the k lines it came from, in proportion to their length. */
function splitBack(text: string, parts: string[]): string[] {
  if (parts.length === 1) return [text]
  const words = text.split(/\s+/).filter(Boolean)
  const total = parts.reduce((n, p) => n + p.length, 0) || 1
  const chars = words.reduce((n, w) => n + w.length + 1, 0) || 1
  const out: string[] = []
  let wi = 0
  let used = 0 // characters of the translation already placed
  let share = 0 // share of the original covered so far
  for (let k = 0; k < parts.length; k++) {
    const left = parts.length - k - 1
    if (!left) {
      out.push(words.slice(wi).join(' '))
      break
    }
    share += parts[k].length / total
    const chunk: string[] = []
    // Take words until this line has its share; every line keeps at least one word when possible.
    while (wi < words.length - left && (!chunk.length || (used + words[wi].length / 2) / chars < share)) {
      chunk.push(words[wi])
      used += words[wi].length + 1
      wi++
    }
    out.push(chunk.join(' '))
  }
  return out
}

/**
 * Translate the dialogue of an ASS script. Lines that continue one sentence ("You never" / "change at all")
 * are translated together and split back; character names are protected; repeated text is sent once.
 */
/** Another translator (the on-device model): gets unique sentences, returns them translated in order. */
export type Engine = (texts: string[], from: string, to: string, onProgress?: (done: number) => void) => Promise<string[]>

export async function translateAss(ass: string, from = 'en', names: string[] = [], onProgress?: (done: number, total: number) => void, to = 'tr', engine?: Engine): Promise<string> {
  const rows = ass.split(/\r?\n/)
  const parsed = rows.map(parseDialogue)
  const idx = parsed.map((l, i) => (l ? i : -1)).filter(i => i >= 0)
  const info = new Map(idx.map(i => {
    const f = fields(parsed[i]!.head)
    return [i, { start: toSec(f[1]), end: toSec(f[2]), style: f[3], positioned: /\\(pos|move)\(/.test(parsed[i]!.lead) }]
  }))
  idx.sort((a, b) => info.get(a)!.start - info.get(b)!.start || a - b)

  // Group lines that belong to one sentence.
  const groups: number[][] = []
  let cur: number[] = []
  for (const i of idx) {
    const prev = cur[cur.length - 1]
    const a = prev != null ? info.get(prev)! : null
    const b = info.get(i)!
    const joins =
      a && !a.positioned && !b.positioned && a.style === b.style && cur.length < 4 &&
      !ENDS.test(parsed[prev!]!.text) && b.start - a.end < 1.2 && b.start >= a.start && !/^[-–—]/.test(parsed[i]!.text) &&
      // on-screen text in capitals ("ANOMALY DETECTED") is not part of the spoken sentence around it
      isCaps(parsed[prev!]!.text) === isCaps(parsed[i]!.text)
    if (!joins && cur.length) {
      groups.push(cur)
      cur = []
    }
    cur.push(i)
  }
  if (cur.length) groups.push(cur)

  // Names are swapped for invented ones the models copy as they are (the local model translated
  // Black Clover's "Luck" as "şans").
  const guard = protector(names, engine ? 'local' : 'google')
  const sentence = (g: number[]) => guard.hide(g.map(i => parsed[i]!.text).join(' '))
  const all = [...new Set(groups.map(sentence))]
  const keep = engine ? all.filter(t => guard.onlyNames(t)) : []
  const unique = all.filter(t => !keep.includes(t))
  const translated = await (engine ?? translateAll)(unique, from, to, d => onProgress?.(d, unique.length))
  const map = new Map(unique.map((t, i) => [t, translated[i]]))
  for (const t of keep) map.set(t, t)
  // A placeholder the model changed or dropped: that sentence again, with the real names.
  if (engine) {
    const redo = unique.filter((t, i) => guard.lost(t, translated[i] ?? ''))
    if (redo.length) {
      const plain = redo.map(t => guard.show(t))
      const again = await engine(plain, from, to)
      redo.forEach((t, i) => map.set(t, again[i] ?? plain[i]))
    }
  }

  const out = new Map<number, string>()
  for (const g of groups) {
    const tr = guard.show(map.get(sentence(g)) ?? g.map(i => parsed[i]!.text).join(' '))
    splitBack(tr, g.map(i => parsed[i]!.text)).forEach((t, k) => out.set(g[k], t))
  }
  return rows
    .map((r, i) => {
      const l = parsed[i]
      if (!l) return r
      const tr = (out.get(i) || l.text).replace(/[{}]/g, '')
      return l.head + l.lead + tr
    })
    .join('\n')
}

